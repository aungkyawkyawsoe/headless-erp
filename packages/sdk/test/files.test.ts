/**
 * Files (media) sub-API — pins the wire contract of the three upload paths
 * and the deliberate deviations from the ordinary pipeline:
 *   - `upload`          multipart + bearer, heals a 401 like any call, but is
 *                       exempt from Idempotency-Key and offline queuing
 *   - `presign`         an ordinary authenticated POST (noQueue)
 *   - `uploadWithToken` self-authenticating: NO bearer even when a session is
 *                       stored, NO heal/refresh on 401, and the token that
 *                       rides the path is REDACTED from every hook/log.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkError } from '../src/errors';
import { createClient, memoryTokenStorage, UPLOAD_TIMEOUT_MS } from '../src/index';
import { createOfflineQueue, memoryQueueStorage } from '../src/offline';

function envelope(data: unknown, status = 200) {
	return new Response(JSON.stringify({ success: true, data }), { status, headers: { 'Content-Type': 'application/json' } });
}

function errorEnvelope(status: number, error: unknown) {
	return new Response(JSON.stringify({ success: false, error }), { status, headers: { 'Content-Type': 'application/json' } });
}

/** The upload response shape (`MediaUploadResult` on the wire). */
const ASSET = {
	key: 'e4f1c2a8-9b3d-4c7e-8f1a-2d6b0e5c9a11.jpg',
	url: '/api/media/e4f1c2a8-9b3d-4c7e-8f1a-2d6b0e5c9a11.jpg',
	filename: 'photo.jpg',
	size: 3,
	mime_type: 'image/jpeg',
};

/** A single-use delegated token — colons included, exactly what presign issues. */
const TOKEN = 'n0nce:1700000000:user-1:sig';

const headerOf = (init: RequestInit | undefined, name: string) => new Headers(init?.headers ?? {}).get(name);
const pathOf = (url: unknown) => new URL(String(url), 'http://localhost').pathname;

function photo() {
	return new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('files.upload', () => {
	it('POSTs multipart to /media/upload with the bearer — no Idempotency-Key, no JSON content-type', async () => {
		let seen: { url: string; init: RequestInit } | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				seen = { url: String(url), init: init ?? {} };
				return envelope(ASSET, 201);
			}),
		);
		const storage = memoryTokenStorage();
		storage.set('jwt-abc');
		const writes: Array<[string, string]> = [];
		const client = createClient({ tokenStorage: storage, onWrite: (p, m) => writes.push([p, m]) });

		await expect(client.files.upload(photo())).resolves.toEqual(ASSET);

		expect(seen?.url).toBe('/api/media/upload');
		expect(headerOf(seen?.init, 'Authorization')).toBe('Bearer jwt-abc');
		// A FormData body: fetch writes the multipart Content-Type (with boundary)
		// itself — the client must not claim application/json.
		expect(seen?.init.body).toBeInstanceOf(FormData);
		expect(headerOf(seen?.init, 'Content-Type')).toBeNull();
		// Uploads are exempt from the automatic Idempotency-Key...
		expect(headerOf(seen?.init, 'Idempotency-Key')).toBeNull();
		// ...and the File's own name rides on the part (the server derives the
		// stored key's extension from it).
		const form = seen?.init.body as FormData;
		expect((form.get('file') as File).name).toBe('photo.jpg');
		// No visibility field by default — the server default ('public') applies.
		expect(form.get('visibility')).toBeNull();
		// A direct upload is an ordinary write to the app's hooks.
		expect(writes).toEqual([['/media/upload', 'POST']]);
	});

	it('honors the filename override and visibility=private', async () => {
		let seen: RequestInit | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				seen = init;
				return envelope(ASSET, 201);
			}),
		);
		const client = createClient();

		await client.files.upload(new Blob([new Uint8Array([1])], { type: 'image/png' }), {
			filename: 'scan.png',
			visibility: 'private',
		});

		const form = seen?.body as FormData;
		expect((form.get('file') as File).name).toBe('scan.png');
		expect(form.get('visibility')).toBe('private');
	});

	it('defaults to the 120s upload timeout and honors a per-call override', async () => {
		const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => envelope(ASSET, 201)),
		);
		const client = createClient();

		await client.files.upload(photo());
		expect(timeoutSpy).toHaveBeenCalledWith(UPLOAD_TIMEOUT_MS);

		timeoutSpy.mockClear();
		await client.files.upload(photo(), { timeoutMs: 5_000 });
		expect(timeoutSpy).toHaveBeenLastCalledWith(5_000);
	});

	it('a 401 heals through refresh-token rotation, then retries exactly once', async () => {
		const calls: Array<[string, string | null]> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				const auth = headerOf(init, 'Authorization');
				calls.push([pathOf(url), auth]);
				if (pathOf(url) === '/api/auth/refresh') return envelope({ token: 'fresh', refresh_token: 'refresh-2' });
				return auth === 'Bearer fresh' ? envelope(ASSET, 201) : errorEnvelope(401, 'Invalid or expired token');
			}),
		);
		const storage = memoryTokenStorage();
		storage.set('stale');
		storage.setRefresh?.('refresh-1');
		const client = createClient({ tokenStorage: storage });

		await expect(client.files.upload(photo())).resolves.toEqual(ASSET);

		expect(calls).toEqual([
			['/api/media/upload', 'Bearer stale'],
			['/api/auth/refresh', null],
			['/api/media/upload', 'Bearer fresh'],
		]);
		expect(storage.getRefresh?.()).toBe('refresh-2');
	});

	it('a network-failed upload or presign never enqueues for offline replay', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
		);
		const storage = memoryQueueStorage();
		const queue = createOfflineQueue({ storage });
		const client = createClient({ offlineQueue: queue });

		// FormData — a media body is unreplayable (blob lifetime, size).
		await expect(client.files.upload(photo())).rejects.toBeInstanceOf(NetworkError);
		// noQueue — a replayed presign would mint a token nobody consumes.
		await expect(client.files.presign()).rejects.toBeInstanceOf(NetworkError);
		// Self-auth — the delegated redeem is unreplayable by shape.
		await expect(client.files.uploadWithToken(photo(), TOKEN)).rejects.toBeInstanceOf(NetworkError);

		expect(queue.pending()).toEqual([]);
	});
});

describe('files.presign', () => {
	it('POSTs /media/presign with the bearer and returns the token envelope', async () => {
		const presigned = {
			token: TOKEN,
			expires_at: '2026-09-28T12:15:00.000Z',
			upload_url: `/api/media/upload/${TOKEN}`,
			max_bytes: 50_000_000,
		};
		let seen: { url: string; auth: string | null; key: string | null } | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				seen = { url: String(url), auth: headerOf(init, 'Authorization'), key: headerOf(init, 'Idempotency-Key') };
				return envelope(presigned);
			}),
		);
		const storage = memoryTokenStorage();
		storage.set('jwt-abc');
		const client = createClient({ tokenStorage: storage });

		await expect(client.files.presign()).resolves.toEqual(presigned);

		expect(seen?.url).toBe('/api/media/presign');
		expect(seen?.auth).toBe('Bearer jwt-abc');
		// An ordinary mutation — the automatic Idempotency-Key applies like any POST.
		expect(seen?.key).not.toBeNull();
	});
});

describe('files.uploadWithToken (delegated redeem)', () => {
	it('redeems with NO bearer even when a session token is stored', async () => {
		let seen: { url: string; auth: string | null; key: string | null } | undefined;
		const writes: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				seen = { url: String(url), auth: headerOf(init, 'Authorization'), key: headerOf(init, 'Idempotency-Key') };
				return envelope(ASSET, 201);
			}),
		);
		const storage = memoryTokenStorage();
		storage.set('jwt-abc'); // a full session is present — the redeem must still not use it
		const client = createClient({ tokenStorage: storage, onWrite: (p) => writes.push(p) });

		await expect(client.files.uploadWithToken(photo(), TOKEN)).resolves.toEqual(ASSET);

		// The raw token rides the path — colons unencoded, exactly the server's route.
		expect(seen?.url).toBe(`/api/media/upload/${TOKEN}`);
		expect(seen?.auth).toBeNull();
		expect(seen?.key).toBeNull();
		// A self-auth path is excluded from write hooks — the uploader is not
		// necessarily the session user (shaped like AUTH_PATHS in every gate).
		expect(writes).toEqual([]);
	});

	it('a 401 surfaces immediately — one call, no refresh, no bearer fallback', async () => {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				calls.push(String(url));
				return errorEnvelope(401, 'Upload token has already been used');
			}),
		);
		const storage = memoryTokenStorage();
		storage.set('jwt-abc');
		storage.setRefresh?.('refresh-1'); // a rotatable session exists — still no rotation
		const client = createClient({ tokenStorage: storage, refreshSession: async () => 'fresh' });

		await expect(client.files.uploadWithToken(photo(), TOKEN)).rejects.toMatchObject({ status: 401, code: 'API_ERROR' });

		expect(calls).toEqual([`/api/media/upload/${TOKEN}`]);
	});

	it('never leaks the token to hooks — every listener sees the redacted path', async () => {
		const settled: string[] = [];
		const errors: Array<[string, number]> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => errorEnvelope(401, 'Upload token expired')),
		);
		const client = createClient({
			onSettled: (p) => settled.push(p),
			onError: (p, _m, status) => errors.push([p, status]),
		});

		await expect(client.files.uploadWithToken(photo(), TOKEN)).rejects.toMatchObject({ status: 401 });

		expect(settled).toEqual(['/media/upload/<token>']);
		expect(errors).toEqual([['/media/upload/<token>', 401]]);
		// Belt and braces: no captured label contains the credential bytes.
		expect([...settled, ...errors.map(([p]) => p)].every((p) => !p.includes(TOKEN))).toBe(true);
	});
});
