/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * `/auth/me` role-access freshness.
 *
 * The mini-app gates its launcher tiles and in-page panels on the `apps` +
 * `granted_collections` this endpoint returns (`isAppAllowed`). Those values are
 * derived from `_roles.app_access` / `_role_permissions`, both of which only
 * change on rare admin actions — the tempting thing is to cache the composition
 * per role. That is exactly what must NOT happen: `CacheLayer` is per-isolate and
 * a write served by one isolate cannot purge another's entry, so a cached summary
 * makes a grant look broken on reload ("I gave the role access but the app still
 * won't show") for a whole cache window.
 *
 * These tests write the grants DIRECTLY to D1 — bypassing the service layer, so
 * nothing invalidates anything — which is exactly what a change applied from a
 * different isolate (or by hand) looks like. The next `/auth/me` must already
 * reflect it. If a cache is ever reintroduced around `roleAuthSummary`, the
 * "reflects … directly" cases fail.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface Me {
	role_name: string;
	apps: string[] | null;
	granted_collections: string[] | '*' | null;
}

async function me(token: string): Promise<Me> {
	const res = await SELF.fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
	expect(res.status).toBe(200);
	return ((await res.json()) as { data: Me }).data;
}

describe('/auth/me reflects role access changes without a cache window', () => {
	const EMAIL = 'freshness@test.local';
	const PASSWORD = 'freshness-pass';
	let token = '';
	let roleId = '';

	beforeAll(async () => {
		const roleRes = await SELF.fetch(`${BASE_URL}/api/users/roles`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ name: 'FreshnessRole', description: 'test', app_access: ['attendance'] }),
		});
		expect(roleRes.status).toBe(201);
		roleId = ((await roleRes.json()) as { data: { id: string } }).data.id;

		const userRes = await SELF.fetch(`${BASE_URL}/api/users`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ email: EMAIL, password: PASSWORD, full_name: 'Freshness User', role_id: roleId }),
		});
		expect(userRes.status).toBe(201);

		const loginRes = await SELF.fetch(`${BASE_URL}/api/auth/login`, {
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
		});
		expect(loginRes.status).toBe(200);
		token = ((await loginRes.json()) as { data: { token: string } }).data.token;
	});

	it('reports the role baseline', async () => {
		const baseline = await me(token);
		expect(baseline.role_name).toBe('FreshnessRole');
		expect(baseline.apps).toEqual(['attendance']);
		expect(baseline.granted_collections).toEqual([]);
	});

	it('reflects a read grant written directly to the DB on the very next call', async () => {
		await me(token); // warm anything that would cache the summary

		await env.DB.prepare('INSERT INTO _role_permissions (id, role_id, collection_slug, can_read) VALUES (?, ?, ?, 1)')
			.bind(crypto.randomUUID(), roleId, 'projects')
			.run();

		const after = await me(token);
		expect(after.granted_collections).toContain('projects');
	});

	it('reflects an app_access change written directly to the DB on the very next call', async () => {
		await me(token);

		await env.DB.prepare('UPDATE _roles SET app_access = ? WHERE id = ?')
			.bind(JSON.stringify(['attendance', 'projects']), roleId)
			.run();

		const after = await me(token);
		expect(after.apps).toEqual(['attendance', 'projects']);
	});
});
