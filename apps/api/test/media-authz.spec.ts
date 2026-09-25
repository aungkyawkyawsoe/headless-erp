/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Media route authorization.
 *
 * ONE confirmed bug was fixed here: the presign token was a stateless HMAC with
 * no server-side state, so it could be REPLAYED for its whole ~15 min lifetime
 * and it bound no user. It is now single-use and user-bound (pinned below).
 *
 * Two OTHER findings were deliberately NOT "fixed", because they are documented
 * contracts, not accidents — and the fix would break every client:
 *   - `GET /api/media/:key` (serve) is PUBLIC BY DESIGN: a stored value is a
 *     `/api/media/<key>` string rendered as `<img src>`, and an `<img>` cannot
 *     send an Authorization header. Gating it would break every client that
 *     displays stored media.
 *   - `GET /api/media` (the library list) is for any AUTHENTICATED author: the
 *     Studio gallery browses assets uploaded by others.
 * Both carry a documented residual risk (no owner/visibility column on
 * `_media`); the correct fix is a `visibility` + `uploaded_by` data-model change,
 * not a route flag. These tests PIN the contract so a future "hardening" cannot
 * silently break clients without a deliberate, visible edit here.
 *
 * The test env (wrangler.testco.jsonc) runs IS_DEV=true, so `dev-token` is a full
 * admin on a local Host. A NON-admin is a freshly created password account with
 * no role, signed in for real.
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

async function presign(): Promise<Envelope<{ token: string; upload_url: string }>> {
	const res = await SELF.fetch(`${BASE_URL}/api/media/presign`, { method: 'POST', headers: ADMIN });
	expect(res.status).toBe(200);
	return (await res.json()) as Envelope<{ token: string; upload_url: string }>;
}

async function delegatedUpload(token: string): Promise<{ status: number; body: Envelope<unknown> }> {
	const res = await SELF.fetch(`${BASE_URL}/api/media/upload/${token}`, { method: 'POST', body: uploadForm() });
	return { status: res.status, body: (await res.json().catch(() => ({}))) as Envelope<unknown> };
}

describe('media route authorization', () => {
	it('burns a presign token on first use and refuses a replay', async () => {
		const { data } = await presign();
		expect(typeof data.token).toBe('string');
		expect(data.token.split(':').length).toBe(4); // nonce:expires:user_id:sig

		// First redemption succeeds...
		const first = await delegatedUpload(data.token);
		expect(first.status, JSON.stringify(first.body)).toBe(201);

		// ...and the SAME token can never be used again (the replayed ~15-min hole).
		const replay = await delegatedUpload(data.token);
		expect(replay.status).toBe(401);
		expect(replay.body.success).toBe(false);
		expect(replay.body.code).toBe('UNAUTHORIZED');
	});

	it('refuses a token whose user binding has been tampered with', async () => {
		const { data } = await presign();
		const [nonce, exp, , sig] = data.token.split(':');
		// Swap the bound user id — the HMAC no longer matches, so it is refused
		// before the ledger is ever touched (this is what "binds the user id" means).
		const forged = `${nonce}:${exp}:11111111-1111-4111-8111-111111111111:${sig}`;
		const res = await delegatedUpload(forged);
		expect(res.status).toBe(401);
		expect(res.body.code).toBe('UNAUTHORIZED');

		// The untouched token is still redeemable — the tamper attempt consumed nothing.
		const ok = await delegatedUpload(data.token);
		expect(ok.status, JSON.stringify(ok.body)).toBe(201);
	});

	it('serves a stored asset ANONYMOUSLY — the capability-URL contract (by design)', async () => {
		// Upload via the single-use token, then fetch the asset with NO credentials.
		const { data } = await presign();
		const uploaded = await delegatedUpload(data.token);
		expect(uploaded.status).toBe(201);
		const asset = uploaded.body.data as { key: string; url: string };

		const anonymous = await SELF.fetch(`${BASE_URL}${asset.url}`);
		expect(anonymous.status).toBe(200);
		expect(await anonymous.text()).toBe('hello media');

		// An unknown key is a plain 404 — the contract never leaks existence by auth.
		const missing = await SELF.fetch(`${BASE_URL}/api/media/definitely-not-a-real-key`);
		expect(missing.status).toBe(404);
	});

	it('serves the library list to an authenticated non-admin author (Studio gallery)', async () => {
		const email = 'media-nonadmin@test.local';
		const password = 'media-nonadmin-pass';
		const created = await SELF.fetch(`${BASE_URL}/api/users`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ email, password, full_name: 'Media Non-Admin Probe' }),
		});
		const createdBody = (await created.json()) as Envelope<unknown>;
		expect(created.status, createdBody.error ?? '').toBe(201);

		const login = await SELF.fetch(`${BASE_URL}/api/auth/login`, {
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify({ email, password }),
		});
		expect(login.status).toBe(200);
		const token = ((await login.json()) as Envelope<{ token: string }>).data.token;

		const list = await SELF.fetch(`${BASE_URL}/api/media`, { headers: { Authorization: `Bearer ${token}` } });
		expect(list.status).toBe(200);

		// And still refuses an anonymous caller (the list is authenticated).
		const anon = await SELF.fetch(`${BASE_URL}/api/media`);
		expect(anon.status).toBe(401);
	});

	it('keeps delete restricted to an admin (mutating routes stay least-privilege)', async () => {
		const anon = await SELF.fetch(`${BASE_URL}/api/media/some-key`, { method: 'DELETE' });
		expect(anon.status).toBe(401);
	});
});
