/**
 * Canvas → Blob encoding that works on every current + legacy browser/WebView.
 *
 * The Canvas export APIs are a moving target:
 *  - Chromium 139+ / Firefox 138+ / Safari 26+ ship Promise-based
 *    `toBlob(type?, quality?)` → `Promise<Blob | null>`.
 *  - Chromium 141+ also replaced the classic STRING `toDataURL(type, quality)`
 *    with a Promise-based `toDataURL` → `Promise<string | null>`.
 *  - Early DCE drafts used a callback-style `toBlob(callback, type, quality)`
 *    / `convertToBlob(callback, …)`.
 *  - On insecure (plain-http) contexts the modern methods can be absent,
 *    leaving only the classic synchronous string `toDataURL`.
 *
 * We probe in that order, accept Promise / direct-string / callback results,
 * and decode `data:` URLs directly instead of round-tripping them through
 * `fetch` — CSP `connect-src` and sandboxed WebViews block `fetch` on data:
 * URLs. Returns null only when the canvas genuinely cannot be encoded.
 */

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

function dataUrlToBlob(dataUrl: string): Blob | null {
	try {
		const comma = dataUrl.indexOf(',');
		if (comma < 0 || !dataUrl.startsWith('data:')) return null;
		const meta = dataUrl.slice(5, comma);
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

/** Encode `canvas` to a Blob of `type`/`quality`, trying every documented
 *  Canvas export signature. Returns null only if no export path works. */
export async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
	const toBlob = await probe(canvas, 'toBlob', type, quality);
	if (toBlob.value instanceof Blob) return toBlob.value;

	const dataUrl = await probe(canvas, 'toDataURL', type, quality);
	if (typeof dataUrl.value === 'string' && dataUrl.value.startsWith('data:')) {
		const blob = dataUrlToBlob(dataUrl.value);
		if (blob) return blob;
	}

	if (!toBlob.promiseLike) {
		const cb = await withCallback(canvas, 'toBlob', type, quality);
		if (cb) return cb;
	}
	const cv = await withCallback(canvas, 'convertToBlob', type, quality);
	if (cv) return cv;

	return null;
}
