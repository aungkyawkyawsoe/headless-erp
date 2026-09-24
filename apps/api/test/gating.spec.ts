/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildConfig } from '@mmbix/config';
import { modulePath, type ModuleManifest } from '@mmbix/types';

/**
 * Platform gating — the factory's two enablement knobs.
 *
 *   - `DOMAIN_MODULES` decides which business verticals mount (a disabled one is
 *     a 404 and registers nothing).
 *   - `PLUGINS` decides which built-in plugins ship (unset ⇒ all; 'none' ⇒ none;
 *     a list ⇒ only those; routes 404 and migrations are skipped otherwise).
 *
 * `buildConfig` is pure, so the env semantics are asserted directly; the routes
 * are asserted through the real worker.
 */

const CREDS = { ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'b', JWT_SECRET: 'c' };

describe('plugin gate (PLUGINS)', () => {
	it('unset ⇒ all plugins enabled (null = no restriction)', () => {
		expect(buildConfig({ ...CREDS }).plugins.enabled).toBeNull();
	});

	it("'none' ⇒ no plugins", () => {
		expect(buildConfig({ ...CREDS, PLUGINS: 'none' }).plugins.enabled).toEqual([]);
	});

	it('a list ⇒ only those ids (trimmed, lowercased)', () => {
		expect(buildConfig({ ...CREDS, PLUGINS: 'workflow, Outbox' }).plugins.enabled).toEqual(['workflow', 'outbox']);
	});
});

describe('module gate (DOMAIN_MODULES)', () => {
	it("'none' ⇒ no domain modules", () => {
		expect(buildConfig({ ...CREDS, DOMAIN_MODULES: 'none' }).modules.enabled).toEqual([]);
	});

	it('a list ⇒ those ids', () => {
		expect(buildConfig({ ...CREDS, DOMAIN_MODULES: 'idp, crm' }).modules.enabled).toEqual(['idp', 'crm']);
	});
});

describe('module manifest path', () => {
	it('defaults to /api/<id>', () => {
		expect(modulePath({ id: 'crm' } as Pick<ModuleManifest, 'id' | 'path'>)).toBe('/api/crm');
	});

	it('honours an explicit path', () => {
		expect(modulePath({ id: 'crm', path: '/api/v1/crm' } as Pick<ModuleManifest, 'id' | 'path'>)).toBe('/api/v1/crm');
	});
});

describe('routes are mounted', () => {
	it('the IDP module route exists and is auth-gated', async () => {
		const res = await SELF.fetch('http://localhost/api/idp/catalog');
		expect(res.status).toBe(401);
	});

	it('an enabled plugin route is mounted (never a 404)', async () => {
		const res = await SELF.fetch('http://localhost/api/flags');
		expect(res.status).not.toBe(404);
	});
});
