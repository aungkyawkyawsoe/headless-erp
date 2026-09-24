/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { APP_VERSION, MAX_AGGREGATE_GROUPS } from '@mmbix/config';

const DEV_USER_ID = '00000000-0000-4000-8000-000000000000';
const BASE_URL = 'http://localhost';

describe('API smoke', () => {
	it('GET /api/health is a minimal anonymous liveness probe', async () => {
		const res = await SELF.fetch(`${BASE_URL}/api/health`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.status).toBe('ok');
		expect(typeof body.timestamp).toBe('string');
		// Anonymous callers must NOT leak deployment details.
		expect('version' in body).toBe(false);
		expect('backup_enabled' in body).toBe(false);
		expect('last_backup' in body).toBe(false);
	});

	it('GET /api/health with a dev-token reveals deployment detail', async () => {
		const res = await SELF.fetch(`${BASE_URL}/api/health`, {
			headers: { Authorization: 'Bearer dev-token' },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.status).toBe('ok');
		expect(body.version).toBe(APP_VERSION);
		expect(body.backup_enabled).toBe(false);
		// No backup has ever run in a fresh test DB.
		expect(body.last_backup).toBeNull();
	});

	it('GET /api/meta advertises the platform contract', async () => {
		const res = await SELF.fetch(`${BASE_URL}/api/meta`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };
		expect(body.success).toBe(true);
		expect(body.data.platform).toBe('mmbix-headless');
		expect(body.data.version).toBe(APP_VERSION);
		const pagination = body.data.pagination as Record<string, unknown>;
		expect(typeof pagination.default_page_size).toBe('number');
		expect(typeof pagination.max_page_size).toBe('number');
		expect(pagination.default_page_size).toBeLessThanOrEqual(pagination.max_page_size as number);
		// Grouped reads are NOT page-limited — they carry their own advertised bound.
		const aggregate = body.data.aggregate as Record<string, unknown>;
		expect(aggregate.max_groups).toBe(MAX_AGGREGATE_GROUPS);
		const tiers = body.data.rate_limits as Record<string, unknown>;
		expect(Object.keys(tiers).sort()).toEqual(['admin', 'anonymous', 'authenticated']);
		const errorCodes = body.data.error_codes as unknown[];
		expect(errorCodes.length).toBeGreaterThan(0);
		for (const code of errorCodes) expect(typeof code).toBe('string');
	});

	it('rejects protected routes without credentials', async () => {
		const res = await SELF.fetch(`${BASE_URL}/api/auth/me`);
		expect(res.status).toBe(401);
		const body = (await res.json()) as { success: boolean; code: string; error: string };
		expect(body.success).toBe(false);
		expect(body.code).toBe('UNAUTHORIZED');
		expect(body.error.length).toBeGreaterThan(0);
	});

	it('accepts the dev-token on protected routes', async () => {
		const res = await SELF.fetch(`${BASE_URL}/api/auth/me`, {
			headers: { Authorization: 'Bearer dev-token' },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { success: boolean; data: { user_id: string; is_admin: boolean } };
		expect(body.success).toBe(true);
		expect(body.data.user_id).toBe(DEV_USER_ID);
		expect(body.data.is_admin).toBe(true);
	});

	it('rejects the unsigned dev-user login while a bot token is set', async () => {
		// The test env sets IS_DEV=true AND TELEGRAM_BOT_TOKEN — once a token
		// exists the API refuses the unsigned body.user dev payload (the token IS
		// the HMAC secret), with a message that says why instead of a bare 400.
		const res = await SELF.fetch(`${BASE_URL}/api/auth/telegram`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ user: { id: 1, first_name: 'Dev User' } }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { success: boolean; error: string };
		expect(body.success).toBe(false);
		expect(body.error).toContain('initData is required');
		expect(body.error).toContain('TELEGRAM_BOT_TOKEN');
	});

	it('guards the MRO aggregate routes behind auth', async () => {
		// The item-groups hub + movement screens read RAW /api/mro report routes
		// (never the entity API). Like every /api route they must 401 anonymously.
		for (const path of ['/api/mro/catalog/groups', '/api/mro/movement/groups', '/api/mro/assets/holder']) {
			const res = await SELF.fetch(`${BASE_URL}${path}`);
			expect(res.status, path).toBe(401);
		}
	});

	describe('MRO aggregate reads — provisioned schema', () => {
		// The MRO report routes read real D1 tables that are NOT created by worker
		// migrations — collections are provisioned through the same validated
		// engine API the apply script uses (POST /api/collections; see
		// test/mro-inventory.spec.ts). This nested scope seeds ONLY the two tables
		// the group-directory query joins, so the smoke stays small and green on a
		// fresh test DB (previously this route 500'd "no such table" here).
		const AUTH = { Authorization: 'Bearer dev-token' };
		const POST_JSON = (body: unknown) => ({
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...AUTH },
			body: JSON.stringify(body),
		});

		let groupId = '';
		let emptyGroupId = '';

		beforeAll(async () => {
			// Engine rule: a field is NOT NULL unless `required: false` is explicit.
			const text = (name: string) => ({ name, type: 'text', required: false });
			const provision = async (slug: string, name: string, fields: Array<Record<string, unknown>>) => {
				const res = await SELF.fetch(`${BASE_URL}/api/collections`, POST_JSON({ name, slug, description: null, fields }));
				expect(res.status, `provision ${slug}`).toBe(201);
			};
			await provision('mro_item_name', 'MRO Item Name', [text('name_en'), text('name_mm'), text('tracking')]);
			await provision('mro_item_model', 'MRO Item Model', [
				text('name_en'),
				{ name: 'item_name', type: 'm2o', required: true, related_collection: 'mro_item_name' },
			]);

			// One master WITH a live SKU (must be listed, count 1) + one empty master
			// (must be excluded) — the exact semantics of the group-directory read.
			const group = await SELF.fetch(`${BASE_URL}/api/entities/mro_item_name`, POST_JSON({ name_en: 'Smoke Group' }));
			expect(group.status).toBe(201);
			groupId = ((await group.json()) as { data: { id: string } }).data.id;
			const model = await SELF.fetch(`${BASE_URL}/api/entities/mro_item_model`, POST_JSON({ name_en: 'Smoke Item', item_name: groupId }));
			expect(model.status).toBe(201);
			const empty = await SELF.fetch(`${BASE_URL}/api/entities/mro_item_name`, POST_JSON({ name_en: 'Empty Smoke Group' }));
			expect(empty.status).toBe(201);
			emptyGroupId = ((await empty.json()) as { data: { id: string } }).data.id;
		});

		it('GET /api/mro/catalog/groups lists masters with live SKUs + counts', async () => {
			const res = await SELF.fetch(`${BASE_URL}/api/mro/catalog/groups`, { headers: AUTH });
			expect(res.status).toBe(200);
			const body = (await res.json()) as { success: boolean; data: { rows: Array<Record<string, unknown>> } };
			expect(body.success).toBe(true);
			const rows = body.data.rows;
			expect(Array.isArray(rows)).toBe(true);
			// The seeded master is listed ONCE with its live-SKU count; the SKU-less
			// master is listed TOO (count 0) — the hub is the only place a group is
			// managed, so a freshly created group must not vanish.
			const seeded = rows.filter((row) => row.id === groupId);
			expect(seeded).toHaveLength(1);
			expect(seeded[0]?.name_en).toBe('Smoke Group');
			expect(Number(seeded[0]?.count)).toBe(1);
			const emptyRow = rows.find((row) => row.id === emptyGroupId);
			expect(emptyRow).toBeTruthy();
			expect(Number(emptyRow?.count)).toBe(0);
			for (const row of rows) {
				expect(typeof row.id).toBe('string');
				expect(row).toHaveProperty('name');
				expect(row).toHaveProperty('name_en');
				expect(row).toHaveProperty('name_mm');
				expect(typeof row.count).toBe('number');
				expect((row.count as number) >= 0).toBe(true);
			}
		});
	});
});
