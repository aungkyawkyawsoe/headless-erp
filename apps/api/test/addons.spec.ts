/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { resolveAddons } from '@mmbix/types';

/**
 * Add-on registry — runtime install/remove of modules.
 *
 * The route gate is build-allowlist (`DOMAIN_MODULES`) ∩ runtime install state
 * (`_addons`). Uninstalling an add-on 404s its routes with NO redeploy;
 * installing restores them. The catalog resolves the dependency/capability graph.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const AUTH_JSON = { ...JSON_HEADERS, ...ADMIN };

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: { data?: T; error?: string } }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, { ...init, headers: { ...AUTH_JSON, ...(init?.headers ?? {}) } });
	const body = (await res.json().catch(() => null)) as { data?: T; error?: string } | null;
	return { status: res.status, body: body ?? {} };
}

interface Catalog {
	addons: Array<{ id: string; installed: boolean; available: boolean }>;
	issues: Array<{ id: string; issue: string }>;
}

describe('add-on registry', () => {
	it('catalog lists the shipped module as available + installed', async () => {
		const res = await call<Catalog>('/api/addons');
		expect(res.status).toBe(200);
		const idp = res.body.data!.addons.find((a) => a.id === 'idp')!;
		expect(idp.available).toBe(true);
		expect(idp.installed).toBe(true);
		expect(res.body.data!.issues).toEqual([]);
	});

	it('uninstall 404s the module routes and flips its catalog state', async () => {
		const un = await call('/api/addons/idp/uninstall', { method: 'POST' });
		expect(un.status).toBe(200);

		// The module's routes are gone (no redeploy) — a 404, not a 401.
		const gated = await call('/api/idp/catalog');
		expect(gated.status).toBe(404);

		const cat = await call<Catalog>('/api/addons');
		expect(cat.body.data!.addons.find((a) => a.id === 'idp')!.installed).toBe(false);
	});

	it('install restores the module routes', async () => {
		const on = await call('/api/addons/idp/install', { method: 'POST' });
		expect(on.status).toBe(200);
		// Mounted again → the (admin) request reaches the module (200), not a 404.
		const gated = await call('/api/idp/catalog');
		expect(gated.status).not.toBe(404);
		const cat = await call<Catalog>('/api/addons');
		expect(cat.body.data!.addons.find((a) => a.id === 'idp')!.installed).toBe(true);
	});

	it('refuses an unknown add-on', async () => {
		const res = await call('/api/addons/does_not_exist/install', { method: 'POST' });
		expect(res.status).toBe(400);
		expect(res.body.error ?? '').toMatch(/not available|Unknown/);
	});
});

describe('resolveAddons (pure graph resolution)', () => {
	const base = { id: 'a', name: 'A', version: '1', scope: 'domain' as const };
	it('flags a missing dependency and a missing capability on installed add-ons', () => {
		const { issues } = resolveAddons(
			[base, { ...base, id: 'b', depends: ['a'], requires: ['payments'] }],
			new Set(['a', 'b']),
			new Set(['a', 'b']),
		);
		expect(issues.some((i) => i.id === 'b' && /missing capability: payments/.test(i.issue))).toBe(true);
	});

	it('resolves a capability provided by an installed add-on', () => {
		const { issues } = resolveAddons(
			[
				{ ...base, id: 'pay', provides: ['payments'] },
				{ ...base, id: 'b', requires: ['payments'] },
			],
			new Set(['pay', 'b']),
			new Set(['pay', 'b']),
		);
		expect(issues).toEqual([]);
	});

	it('flags an extends target that is not installed', () => {
		const { issues } = resolveAddons([{ ...base, id: 'b', extends: ['a'] }], new Set(['b']), new Set(['b']));
		expect(issues.some((i) => i.id === 'b' && /extends uninstalled/.test(i.issue))).toBe(true);
	});
});
