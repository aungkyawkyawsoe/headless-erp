/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
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
});
