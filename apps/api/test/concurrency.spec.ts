/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Optimistic concurrency on schema/policy writes.
 *
 * A client that loaded a collection sends `If-Match: <_schema_version>`; a save
 * from a STALE version is refused 409 (with the current version) instead of
 * silently clobbering another admin's change. An absent header is no check
 * (CLI/SDK keep working).
 *
 * A PUT must carry the FULL field list (including system fields) — the engine
 * diffs it against the stored schema; so the test round-trips the detail read.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const AUTH_JSON = { ...JSON_HEADERS, ...ADMIN };
const SLUG = 'cc_docs';

interface Row {
	_schema_version: number;
	fields: Array<{ name: string; type: string; required?: boolean }>;
	schema_json?: { fields: Array<{ name: string; type: string; required?: boolean }> };
}

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: { data?: T; error?: string } }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, { ...init, headers: { ...AUTH_JSON, ...(init?.headers ?? {}) } });
	const body = (await res.json().catch(() => null)) as { data?: T; error?: string } | null;
	return { status: res.status, body: body ?? {} };
}

describe('optimistic concurrency (If-Match / 409)', () => {
	let version = 0;
	let fields: Row['fields'] = [];

	beforeAll(async () => {
		const res = await call('/api/collections', {
			method: 'POST',
			body: JSON.stringify({ name: 'CC Docs', slug: SLUG, fields: [{ name: 'title', type: 'text', required: false }] }),
		});
		expect([201, 409]).toContain(res.status);
		const detail = await call<Row>(`/api/collections/${SLUG}`);
		version = detail.body.data!._schema_version;
		fields = detail.body.data!.schema_json!.fields;
	});

	it('a write without If-Match proceeds and bumps the version (backward compatible)', async () => {
		const put = await call<Row>(`/api/collections/${SLUG}`, {
			method: 'PUT',
			body: JSON.stringify({ fields: [...fields, { name: 'alpha', type: 'text', required: false }] }),
		});
		expect(put.status).toBe(200);
		expect(put.body.data!._schema_version).toBeGreaterThan(version);
		version = put.body.data!._schema_version;
		fields = put.body.data!.schema_json!.fields;
	});

	it('a STALE If-Match is refused 409 with the current version', async () => {
		const res = await call<{ current_version: number }>(`/api/collections/${SLUG}`, {
			method: 'PUT',
			headers: { 'If-Match': '"1"' }, // long stale
			body: JSON.stringify({ fields: [...fields, { name: 'beta', type: 'text', required: false }] }),
		});
		expect(res.status).toBe(409);
		expect(res.body.data!.current_version).toBe(version);
	});

	it('a matching If-Match proceeds', async () => {
		const res = await call<Row>(`/api/collections/${SLUG}`, {
			method: 'PUT',
			headers: { 'If-Match': `"${version}"` },
			body: JSON.stringify({ fields: [...fields, { name: 'beta', type: 'text', required: false }] }),
		});
		expect(res.status).toBe(200);
		version = res.body.data!._schema_version;
	});

	it('policy writes honour If-Match too', async () => {
		const stale = await call(`/api/collections/${SLUG}/policies`, {
			method: 'PUT',
			headers: { 'If-Match': '"1"' },
			body: JSON.stringify({ cache: { enabled: false } }),
		});
		expect(stale.status).toBe(409);

		const ok = await call(`/api/collections/${SLUG}/policies`, {
			method: 'PUT',
			headers: { 'If-Match': `"${version}"` },
			body: JSON.stringify({ cache: { enabled: false } }),
		});
		expect(ok.status).toBe(200);
	});
});
