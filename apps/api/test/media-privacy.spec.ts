/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Media privacy — per-asset `visibility` + `uploaded_by` (migrations 046/047).
 *
 * `GET /api/media/:key` is a capability URL PUBLIC BY DESIGN: the stored value is
 * a `/api/media/<key>` string clients render as `<img src>`, which cannot send a
 * bearer. Gating it unconditionally would break every client — so visibility is
 * PER ASSET instead:
 *   - a `'public'` asset keeps serving ANONYMOUSLY (the non-breaking control);
 *   - a `'private'` asset requires a caller, and only its uploader or an admin may
 *     read it (anonymous → 401, a non-owner → 403).
 *
 * `GET /api/media` (the library list) is scoped: an admin sees everything, a
 * non-admin sees only their OWN uploads plus every public asset — never another
 * user's private file.
 *
 * The test env (wrangler.testco.jsonc) runs IS_DEV=true, so `dev-token` is a full
 * admin on a local Host. A NON-admin is a freshly created password account with no
 * role, signed in for real (same pattern as media-authz.spec.ts).
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface Envelope<T> {
	success: boolean;
	data: T;
	error?: string;
	code?: string;
}

/** A tiny valid text/plain payload (passes the service's magic-byte sniffing). */
function uploadForm(): FormData {
	const form = new FormData();
	form.append('file', new File(['hello media'], 'note.txt', { type: 'text/plain' }));
	return form;
}

/** Create a real non-admin account via the admin API, then sign it in — returns its bearer. */
async function createAccount(email: string): Promise<string> {
	const password = 'media-privacy-pass';
	const created = await SELF.fetch(`${BASE_URL}/api/users`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify({ email, password, full_name: 'Media Privacy Probe' }),
	});
	const createdBody = (await created.json()) as Envelope<unknown>;
	expect(created.status, createdBody.error ?? '').toBe(201);

	const login = await SELF.fetch(`${BASE_URL}/api/auth/login`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ email, password }),
	});
	expect(login.status).toBe(200);
	return ((await login.json()) as Envelope<{ token: string }>).data.token;
}

/** Upload as the admin (dev-token) or a real account; `visibility` opts into private. */
async function upload(as: 'admin' | { token: string }, visibility?: 'public' | 'private'): Promise<{ key: string; url: string }> {
	const headers = as === 'admin' ? ADMIN : { Authorization: `Bearer ${as.token}` };
	const qs = visibility ? `?visibility=${visibility}` : '';
	const res = await SELF.fetch(`${BASE_URL}/api/media/upload${qs}`, { method: 'POST', headers, body: uploadForm() });
	const body = (await res.json()) as Envelope<{ key: string; url: string }>;
	expect(res.status, JSON.stringify(body)).toBe(201);
	return body.data;
}

/** List the library as `dev-token` (admin) or an account token; returns the asset keys. */
async function listedKeys(as: 'admin' | string): Promise<{ status: number; keys: string[] }> {
	const headers = as === 'admin' ? ADMIN : { Authorization: `Bearer ${as}` };
	const res = await SELF.fetch(`${BASE_URL}/api/media?limit=100`, { headers });
	const body = (await res.json()) as Envelope<{ data: { key: string }[] }>;
	return { status: res.status, keys: res.status === 200 ? body.data.data.map((r) => r.key) : [] };
}

describe('media privacy — visibility + ownership', () => {
	it('(a) serves a PUBLIC asset ANONYMOUSLY — the non-breaking control', async () => {
		const asset = await upload('admin'); // default visibility = public
		const anon = await SELF.fetch(`${BASE_URL}${asset.url}`);
		expect(anon.status).toBe(200);
		expect(await anon.text()).toBe('hello media');
	});

	it('(b) REFUSES a PRIVATE asset to an anonymous caller, SERVES it to its owner (admin too, 403 for a non-owner)', async () => {
		const owner = await createAccount('media-privacy-owner@test.local');
		const asset = await upload({ token: owner }, 'private');

		// Anonymous → 401 (no caller at all).
		const anon = await SELF.fetch(`${BASE_URL}${asset.url}`);
		expect(anon.status).toBe(401);
		expect(((await anon.json()) as Envelope<unknown>).code).toBe('UNAUTHORIZED');

		// Its owner → served (bytes intact).
		const asOwner = await SELF.fetch(`${BASE_URL}${asset.url}`, { headers: { Authorization: `Bearer ${owner}` } });
		expect(asOwner.status).toBe(200);
		expect(await asOwner.text()).toBe('hello media');

		// An admin → served as well.
		const asAdmin = await SELF.fetch(`${BASE_URL}${asset.url}`, { headers: ADMIN });
		expect(asAdmin.status).toBe(200);

		// A DIFFERENT authenticated non-owner → 403 (authenticated but denied).
		const other = await createAccount('media-privacy-other@test.local');
		const asOther = await SELF.fetch(`${BASE_URL}${asset.url}`, { headers: { Authorization: `Bearer ${other}` } });
		expect(asOther.status).toBe(403);
		expect(((await asOther.json()) as Envelope<unknown>).code).toBe('FORBIDDEN');
	});

	it('(c) a non-admin list shows their OWN + PUBLIC assets, never another user’s private one', async () => {
		const alice = await createAccount('media-privacy-alice@test.local');
		const bob = await createAccount('media-privacy-bob@test.local');

		const publicAsset = await upload('admin'); // public — visible to everyone
		const bobPrivate = await upload({ token: bob }, 'private');
		const alicePrivate = await upload({ token: alice }, 'private');

		const { status, keys } = await listedKeys(alice);
		expect(status).toBe(200);
		expect(keys).toContain(publicAsset.key); // public assets are visible
		expect(keys).toContain(alicePrivate.key); // own uploads are visible
		expect(keys).not.toContain(bobPrivate.key); // another user's PRIVATE asset is hidden
	});

	it('(d) an admin list includes everything, including another user’s private asset', async () => {
		const bob = await createAccount('media-privacy-bob-admin@test.local');
		const bobPrivate = await upload({ token: bob }, 'private');

		const { status, keys } = await listedKeys('admin');
		expect(status).toBe(200);
		expect(keys).toContain(bobPrivate.key);
	});
});
