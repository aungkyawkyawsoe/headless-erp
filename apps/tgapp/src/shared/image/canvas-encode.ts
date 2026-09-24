/**
 * Canvas → Blob encoding that works on every client the Mini App runs in.
 *
 * The Canvas export APIs are a moving target and silently differ between the
 * desktop browsers and the phone WebViews (Telegram iOS/Android) we ship to:
 *
 *  - Chromium 139+ / Firefox 138+ / Safari 26+:
 *      `toBlob(type?, quality?)` → `Promise<Blob | null>`
 *  - Chromium 141+ also replaced the classic synchronous string
 *    `toDataURL(type, quality)` with a Promise-based
 *    `toDataURL` → `Promise<string | null>`.
 *  - Early DCE drafts (some embedded / enterprise builds) used a callback-style
 *    `toBlob(callback, type, quality)` / `convertToBlob(callback, …)`.
 *  - On INSECURE contexts — plain-http LAN testing from a phone, which is
 *    exactly how this dev server is reached (`vite server.host: true`) — the
 *    modern methods can be absent entirely, leaving only the classic
 *    synchronous string `toDataURL`.
 *
 * So we probe in that order, accept Promise / direct-string / callback
 * results, and decode `data:` URLs ourselves INSTEAD of round-tripping them
 * through `fetch` — CSP `connect-src` policies and WebView sandboxes commonly
 * block `fetch` on `data:` URLs, which is what broke the previous fix.
 *
 * Returns null only when the canvas genuinely cannot be encoded anywhere.
 */

/** Call a canvas encoder method, awaiting Promise-style results. */
async function probe(
	canvas: HTMLCanvasElement,
	name: string,
	type: string,
	quality?: number,
): Promise<{ value: unknown; promiseLike: boolean }> {
	const fn = (canvas as unknown as Record<string, unknown>)[name];
	if (typeof fn !== 'function') return { value: null, promiseLike: false };
	try {
		const result = (fn as (this: unknown, ...args: unknown[]) => unknown).call(canvas, type, quality);
		if (result && typeof (result as { then?: unknown }).then === 'function') {
			return { value: await result, promiseLike: true };
		}
		return { value: result, promiseLike: false };
	} catch {
		return { value: null, promiseLike: false };
	}
}

/** Call a callback-style encoder (`fn(callback, type, quality)`), timeboxed so
 *  a Promise-style method that ignores the callback can never freeze the UI. */
async function withCallback(canvas: HTMLCanvasElement, name: string, type: string, quality?: number): Promise<Blob | null> {
	const fn = (canvas as unknown as Record<string, unknown>)[name];
	if (typeof fn !== 'function') return null;
	let settled = false;
	const fromCallback = new Promise<Blob | null>((resolve) => {
		const finish = (value: unknown) => {
			if (settled) return;
			settled = true;
			resolve(value instanceof Blob ? value : null);
		};
		try {
			(fn as (this: unknown, ...args: unknown[]) => unknown).call(canvas, finish, type, quality);
		} catch {
			finish(null);
		}
	});
	const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000));
	return Promise.race([fromCallback, deadline]);
}

/** Parse a `data:` URL into a Blob without touching `fetch`. Supports both the
 *  base64 payloads canvas encoders emit and the URL-encoded `charset=utf-8`
 *  form. Anything malformed → null. */
export function dataUrlToBlob(dataUrl: string): Blob | null {
	try {
		const comma = dataUrl.indexOf(',');
		if (comma < 0 || !dataUrl.startsWith('data:')) return null;
		const meta = dataUrl.slice(5, comma); // e.g. `image/jpeg;base64`
		const semi = meta.indexOf(';');
		const mime = (semi >= 0 ? meta.slice(0, semi) : meta).trim() || 'application/octet-stream';
		const payload = dataUrl.slice(comma + 1);
		if (meta.includes(';base64')) {
			const binary = atob(payload);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
			return new Blob([bytes], { type: mime });
		}
		return new Blob([decodeURIComponent(payload)], { type: mime });
	} catch {
		return null;
	}
}

/**
 * Encode `canvas` to a Blob of `type`/`quality`, trying every documented
 * Canvas export signature. Returns null only if no export path works.
 */
export async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
	// 1) Promise-style (or direct-value) `toBlob`.
	const toBlob = await probe(canvas, 'toBlob', type, quality);
	if (toBlob.value instanceof Blob) return toBlob.value;

	// 2) `toDataURL` — Promise-based on Chromium 141+, a classic string on the
	//    rest. Either way, decode the result directly.
	const dataUrl = await probe(canvas, 'toDataURL', type, quality);
	if (typeof dataUrl.value === 'string' && dataUrl.value.startsWith('data:')) {
		const blob = dataUrlToBlob(dataUrl.value);
		if (blob) return blob;
	}

	// 3) Callback-style encoders (early DCE drafts). Skip `toBlob` if it already
	//    behaved promise-style above — it would ignore the callback and burn the
	//    timeout for nothing.
	if (!toBlob.promiseLike) {
		const cb = await withCallback(canvas, 'toBlob', type, quality);
		if (cb) return cb;
	}
	const cv = await withCallback(canvas, 'convertToBlob', type, quality);
	if (cv) return cv;

	return null;
}

/**
 * Sniff the MIME type from a blob's MAGIC BYTES — the client twin of the media
 * route's `sniffMime` (apps/api/src/lib/services/media.service.ts).
 *
 * The upload endpoint verifies the declared type against the payload's first
 * bytes and answers `400 "File content does not match the declared type"` when
 * they disagree, so the declared type must come from the bytes. A canvas's
 * `blob.type` is advisory at best: WebViews that IGNORE the requested
 * `image/jpeg` (and hand back PNG/WebP bytes) commonly keep — or drop — the
 * reported type, which is the "I picked a photo but nothing uploaded" bug.
 *
 * Returns null when the head matches none of the formats a canvas can emit.
 */
export async function sniffImageType(blob: Blob): Promise<string | null> {
	try {
		const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
		const len = head.length;
		const ascii = (start: number, end: number) => String.fromCharCode(...head.slice(start, end));
		if (len >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
		if (
			len >= 8 &&
			head[0] === 0x89 &&
			head[1] === 0x50 &&
			head[2] === 0x4e &&
			head[3] === 0x47 &&
			head[4] === 0x0d &&
			head[5] === 0x0a &&
			head[6] === 0x1a &&
			head[7] === 0x0a
		)
			return 'image/png';
		if (len >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif';
		if (len >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
		if (len >= 12 && ascii(4, 8) === 'ftyp' && (ascii(8, 12) === 'avif' || ascii(8, 12) === 'avis')) return 'image/avif';
		return null;
	} catch {
		return null;
	}
}

/**
 * Wrap an encoded image blob in a `File` whose declared MIME type AND
 * extension MATCH the bytes the encoder actually produced.
 *
 * The bytes decide the declared type (`sniffImageType`); `blob.type` is only a
 * fallback for a head that isn't a recognizable image, and a JPEG the one
 * assumption of last resort. This is what keeps the file aligned with the
 * server's magic-byte check even on WebViews that misreport the encoded type.
 *
 * @param blob     the canvas encoder's output
 * @param baseName a source filename — any extension is stripped and replaced
 */
export async function encodedImageFile(blob: Blob, baseName: string): Promise<File> {
	const sniffed = await sniffImageType(blob);
	// The bytes decide the type; `blob.type` is a fallback for a head that isn't a
	// recognizable image. Either way the value may carry parameters
	// (`image/jpeg;charset=…`) — keep only the essence for BOTH the declared type
	// and the extension.
	const declared = sniffed ?? (blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg');
	const type = declared.split(';')[0].trim().toLowerCase();
	// `image/jpeg` → `jpg`; every other subtype (`png`, `webp`, `avif`, …) maps
	// to itself, sanitized so nothing odd can reach the filename.
	const subtype = type.slice(type.indexOf('/') + 1).replace(/[^a-z0-9]/gi, '');
	const ext = subtype === 'jpeg' ? 'jpg' : subtype || 'jpg';
	// The name rides the multipart part header (`filename="…"`) — a quote, CR/LF or
	// odd byte from a camera/gallery original would corrupt the part and make the
	// server's `parseBody` drop the file (a 400 "Missing file field" the operator
	// cannot diagnose). Keep it a plain, bounded token.
	const base =
		baseName
			.replace(/\.[^.]+$/, '')
			.replace(/[^a-zA-Z0-9._-]+/g, '-')
			.replace(/^[-.]+|[-.]+$/g, '')
			.slice(0, 60) || 'photo';
	return new File([blob], `${base}.${ext}`, { type });
}
