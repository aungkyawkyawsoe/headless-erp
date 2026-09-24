import { describe, expect, it } from 'vitest';

import worker, { isShellForAssetPath, isStaticAssetPath } from './index.js';

type Fetcher = { fetch: (req: Request) => Promise<Response> };

function envWith(assets: Fetcher, api?: Fetcher): Env {
	return { ASSETS: assets, ...(api ? { API: api } : {}) } as Env;
}

function htmlShell(): Response {
	return new Response('<!doctype html><html></html>', {
		status: 200,
		headers: { 'content-type': 'text/html; charset=utf-8' },
	});
}

function jsChunk(): Response {
	return new Response('export default 1;', {
		status: 200,
		headers: { 'content-type': 'text/javascript; charset=utf-8' },
	});
}

describe('isStaticAssetPath', () => {
	it('matches hashed asset URLs', () => {
		expect(isStaticAssetPath('/assets/index-abc123.js')).toBe(true);
		expect(isStaticAssetPath('/assets/index-abc123.css')).toBe(true);
	});

	it('matches known root-level file extensions', () => {
		expect(isStaticAssetPath('/favicon.svg')).toBe(true);
		expect(isStaticAssetPath('/manifest.json')).toBe(true);
		expect(isStaticAssetPath('/robots.txt')).toBe(true);
	});

	it('does NOT match an extensionless SPA route (even one with a dotted segment further in)', () => {
		expect(isStaticAssetPath('/app/tyres')).toBe(false);
		expect(isStaticAssetPath('/app/doc/PO-2024.1')).toBe(false);
	});
});

describe('isShellForAssetPath', () => {
	it('flags an HTML body answering a static-file URL', () => {
		expect(isShellForAssetPath('/assets/index-abc123.js', 'text/html; charset=utf-8')).toBe(true);
		expect(isShellForAssetPath('/favicon.ico', 'text/html')).toBe(true);
	});

	it('does NOT flag a real JS/CSS response or an SPA route', () => {
		expect(isShellForAssetPath('/assets/index-abc123.js', 'text/javascript')).toBe(false);
		expect(isShellForAssetPath('/app/tyres', 'text/html; charset=utf-8')).toBe(false);
		expect(isShellForAssetPath('/assets/index-abc123.js', null)).toBe(false);
	});
});

describe('worker.fetch', () => {
	it('returns 404 — never the HTML shell — for a missing hashed chunk', async () => {
		const env = envWith({ fetch: async () => htmlShell() });
		const res = await worker.fetch(new Request('https://tg.example/assets/index-OLD.js'), env);

		expect(res.status).toBe(404);
		expect(res.headers.get('content-type')).toContain('text/plain');
		expect(await res.text()).not.toContain('<!doctype');
	});

	it('keeps the SPA HTML fallback for an extensionless route', async () => {
		const env = envWith({ fetch: async () => htmlShell() });
		const res = await worker.fetch(new Request('https://tg.example/app/tyres'), env);

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/html');
	});

	it('passes a real JS asset through untouched', async () => {
		const env = envWith({ fetch: async () => jsChunk() });
		const res = await worker.fetch(new Request('https://tg.example/assets/index-abc123.js'), env);

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('javascript');
	});

	it('answers /health with worker status', async () => {
		const env = envWith({ fetch: async () => htmlShell() });
		const res = await worker.fetch(new Request('https://tg.example/health'), env);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: 'ok', worker: 'tgapp' });
	});

	it('proxies /api/* to the API binding', async () => {
		const api = { fetch: async () => Response.json({ ok: true }) };
		const assets = { fetch: async () => htmlShell() };
		const env = envWith(assets, api);
		const res = await worker.fetch(new Request('https://tg.example/api/entities'), env);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		// The assets binding must never have been consulted for an API path.
		let assetHits = 0;
		const countingAssets = {
			fetch: async () => {
				assetHits += 1;
				return htmlShell();
			},
		};
		await worker.fetch(new Request('https://tg.example/trpc/items'), envWith(countingAssets, api));
		expect(assetHits).toBe(0);
	});
});
