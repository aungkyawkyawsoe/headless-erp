import { describe, expect, it } from 'vitest';

import { canvasToBlob, dataUrlToBlob, encodedImageFile, sniffImageType } from './canvas-encode';

/**
 * The canvas encoder must survive every signature the Canvas DCE APIs have
 * shipped with — none of which exist in a JS unit-test environment, so we fake
 * the canvas surface and assert on the blob the encoder produces.
 */

function fakeCanvas(overrides: Record<string, unknown>): HTMLCanvasElement {
	return overrides as unknown as HTMLCanvasElement;
}

const jpegDataUrl = (payload: string) => `data:image/jpeg;base64,${btoa(payload)}`;

// Minimal magic-byte prefixes — the same signatures the media route's
// `sniffMime` checks (the sniff only inspects the head).
const jpegBytes = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const pngBytes = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const gifBytes = () => new TextEncoder().encode('GIF89a.....');
const webpBytes = () => {
	const bytes = new Uint8Array(16);
	bytes.set(new TextEncoder().encode('RIFF'), 0);
	bytes.set(new TextEncoder().encode('WEBP'), 8);
	return bytes;
};
const avifBytes = () => {
	const bytes = new Uint8Array(16);
	bytes.set(new TextEncoder().encode('ftyp'), 4);
	bytes.set(new TextEncoder().encode('avif'), 8);
	return bytes;
};

describe('canvasToBlob', () => {
	it('uses a Promise-based toBlob (Chromium 139+ / Firefox 138+ / Safari 26+)', async () => {
		const blob = new Blob(['direct'], { type: 'image/jpeg' });
		const canvas = fakeCanvas({ toBlob: async () => blob });
		expect(await canvasToBlob(canvas, 'image/jpeg', 0.9)).toBe(blob);
	});

	it('falls back to a classic STRING toDataURL and decodes it manually', async () => {
		const canvas = fakeCanvas({ toDataURL: () => jpegDataUrl('classic') });
		const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
		expect(blob).not.toBeNull();
		expect(blob!.type).toBe('image/jpeg');
		expect(await blob!.text()).toBe('classic');
	});

	it('awaits a Promise-based toDataURL (Chromium 141+) and decodes it', async () => {
		const canvas = fakeCanvas({ toDataURL: async () => jpegDataUrl('modern') });
		const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
		expect(blob).not.toBeNull();
		expect(await blob!.text()).toBe('modern');
	});

	it('handles a Promise toBlob that resolves null by falling through to toDataURL', async () => {
		const canvas = fakeCanvas({ toBlob: async () => null, toDataURL: async () => jpegDataUrl('nulled') });
		const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
		expect(await blob!.text()).toBe('nulled');
	});

	it('recovers when a Promise toBlob throws (e.g. insecure-context) via toDataURL', async () => {
		const canvas = fakeCanvas({
			toBlob: () => {
				throw new Error('not in a secure context');
			},
			toDataURL: () => jpegDataUrl('thrown'),
		});
		const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
		expect(await blob!.text()).toBe('thrown');
	});

	it('supports early callback-style toBlob(callback, type, quality)', async () => {
		const blob = new Blob(['cb'], { type: 'image/jpeg' });
		const canvas = fakeCanvas({ toBlob: (cb: (b: Blob) => void) => cb(blob) });
		expect(await canvasToBlob(canvas, 'image/jpeg', 0.9)).toBe(blob);
	});

	it('supports callback-style convertToBlob as a last resort', async () => {
		const blob = new Blob(['cv'], { type: 'image/jpeg' });
		const canvas = fakeCanvas({ convertToBlob: (cb: (b: Blob) => void) => cb(blob) });
		expect(await canvasToBlob(canvas, 'image/jpeg', 0.9)).toBe(blob);
	});

	it('skips a redundant callback toBlob when toBlob already behaved promise-style', async () => {
		const blob = new Blob(['draft'], { type: 'image/jpeg' });
		const canvas = fakeCanvas({
			toBlob: async () => null,
			convertToBlob: (cb: (b: Blob) => void) => cb(blob),
		});
		const result = await canvasToBlob(canvas, 'image/jpeg', 0.9);
		expect(result).toBe(blob); // would have hung the cb toBlob path for 2s otherwise
	});

	it('returns null when no encoder exists at all', async () => {
		expect(await canvasToBlob(fakeCanvas({}), 'image/jpeg', 0.9)).toBeNull();
	});
});

describe('dataUrlToBlob', () => {
	it('decodes a base64 data: URL into the right bytes and mime', async () => {
		const blob = dataUrlToBlob(jpegDataUrl('hello'));
		expect(blob).not.toBeNull();
		expect(blob!.type).toBe('image/jpeg');
		expect(await blob!.text()).toBe('hello');
	});

	it('decodes a URL-encoded (non-base64) data: URL', async () => {
		const blob = dataUrlToBlob(`data:text/plain,${encodeURIComponent('a b/c')}`);
		expect(blob).not.toBeNull();
		expect(blob!.type).toBe('text/plain');
		expect(await blob!.text()).toBe('a b/c');
	});

	it('rejects garbage', () => {
		expect(dataUrlToBlob('not a data url')).toBeNull();
		expect(dataUrlToBlob('data:text/plain')).toBeNull();
	});
});

describe('sniffImageType', () => {
	it('recognizes the formats a canvas can emit from their magic bytes', async () => {
		expect(await sniffImageType(new Blob([jpegBytes()]))).toBe('image/jpeg');
		expect(await sniffImageType(new Blob([pngBytes()]))).toBe('image/png');
		expect(await sniffImageType(new Blob([gifBytes()]))).toBe('image/gif');
		expect(await sniffImageType(new Blob([webpBytes()]))).toBe('image/webp');
		expect(await sniffImageType(new Blob([avifBytes()]))).toBe('image/avif');
	});

	it('returns null for bytes that match no image signature', async () => {
		expect(await sniffImageType(new Blob(['not an image']))).toBeNull();
	});
});

describe('encodedImageFile', () => {
	it('keeps JPEG bytes as .jpg / image/jpeg', async () => {
		const file = await encodedImageFile(new Blob([jpegBytes()]), 'photo.png');
		expect(file.type).toBe('image/jpeg');
		expect(file.name).toBe('photo.jpg');
	});

	it('declares the type the BYTES actually are — PNG stays PNG', async () => {
		const file = await encodedImageFile(new Blob([pngBytes()]), 'IMG_0001.heic');
		expect(file.type).toBe('image/png');
		expect(file.name).toBe('IMG_0001.png');
	});

	it('ignores a blob.type that LIES about the bytes (the WebView mismatch bug)', async () => {
		// A WebView that ignores the requested `image/jpeg` hands back PNG bytes /
		// while still reporting `image/jpeg` — trusting that label makes the media
		// route reject the file (declared type ≠ magic bytes). The bytes win.
		const file = await encodedImageFile(new Blob([pngBytes()], { type: 'image/jpeg' }), 'IMG_0002.heic');
		expect(file.type).toBe('image/png');
		expect(file.name).toBe('IMG_0002.png');
	});

	it('ignores an EMPTY blob.type (PNG bytes with no reported type)', async () => {
		const file = await encodedImageFile(new Blob([pngBytes()]), 'photo');
		expect(file.type).toBe('image/png');
		expect(file.name).toBe('photo.png');
	});

	it('falls back to blob.type when the head is not a recognizable image', async () => {
		const file = await encodedImageFile(new Blob(['x'], { type: 'image/webp;charset=binary' }), 'a.b.c');
		expect(file.type).toBe('image/webp');
		expect(file.name).toBe('a.b.webp');
	});

	it('falls back to image/jpeg when neither bytes nor blob.type say anything', async () => {
		const file = await encodedImageFile(new Blob(['x']), 'photo');
		expect(file.type).toBe('image/jpeg');
		expect(file.name).toBe('photo.jpg');
	});

	it('sanitizes a hostile original filename so the multipart part cannot break', async () => {
		// The name rides the part header — a quote/CR/LF must never reach it, or the
		// server's parseBody drops the file as a 400 "Missing file field".
		const file = await encodedImageFile(new Blob([jpegBytes()]), 'ph"oto\r\nX: y.jpg');
		expect(file.type).toBe('image/jpeg');
		expect(file.name).toBe('ph-oto-X-y.jpg');
	});
});
