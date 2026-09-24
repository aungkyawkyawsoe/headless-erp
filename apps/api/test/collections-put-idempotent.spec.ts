/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * PUT /api/collections/:slug — an unchanged schema PUT is a NO-OP.
 *
 * The Studio auto-saves field edits (trailing-debounced) and clients retry
 * writes. The route used to bump `_schema_version` and drop the schema cache on
 * EVERY PUT — even one carrying the exact schema already stored — so the version
 * counter (the staleness signal clients and the cache read) moved without a real
 * change. Pins that:
 *   - re-sending the stored schema leaves `_schema_version` alone;
 *   - a real change still advances it (the signal stays meaningful);
 *   - the no-op still returns the collection (200, success).
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

type ApiBody = {
	success?: boolean;
	error?: string;
	data?: Record<string, unknown> & { _schema_version?: number; schema_json?: { fields?: unknown[] } };
};

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: ApiBody }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init?.headers ?? {}) },
	});
	return { status: res.status, body: ((await res.json().catch(() => null)) ?? {}) as ApiBody };
}

describe('PUT /api/collections/:slug is idempotent for unchanged schemas', () => {
	it('does not bump _schema_version when the payload matches the stored schema', async () => {
		const slug = 'zz_put_idempotent';
		const created = await api('/api/collections', {
			method: 'POST',
			body: JSON.stringify({ name: 'ZZ Put Idempotent', slug, fields: [{ name: 'title', type: 'text', label: 'Title', required: false }] }),
		});
		expect(created.status, 'create collection').toBe(201);

		// Read the stored shape — `fields` come back system-last, exactly what a
		// client round-trips on the next save.
		const before = await api(`/api/collections/${slug}`);
		expect(before.status).toBe(200);
		const fields = before.body.data!.schema_json!.fields;

		// The first PUT may normalize a legacy field order, so take the version AFTER it.
		const first = await api(`/api/collections/${slug}`, { method: 'PUT', body: JSON.stringify({ fields }) });
		expect(first.status, 'first PUT').toBe(200);
		const v1 = first.body.data!._schema_version;
		expect(typeof v1).toBe('number');

		// Second, identical PUT — must be a no-op (no version bump).
		const second = await api(`/api/collections/${slug}`, { method: 'PUT', body: JSON.stringify({ fields }) });
		expect(second.status).toBe(200);
		expect(second.body.success).toBe(true);
		expect(second.body.data!._schema_version, 'identical PUT must not bump the version').toBe(v1);

		// A REAL change still advances the version exactly once.
		const withExtra = [...(fields ?? []), { name: 'note', type: 'text', label: 'Note', required: false }];
		const changed = await api(`/api/collections/${slug}`, { method: 'PUT', body: JSON.stringify({ fields: withExtra }) });
		expect(changed.status).toBe(200);
		expect(changed.body.data!._schema_version).toBe((v1 as number) + 1);

		// And re-sending THAT is a no-op again.
		const again = await api(`/api/collections/${slug}`, { method: 'PUT', body: JSON.stringify({ fields: withExtra }) });
		expect(again.status).toBe(200);
		expect(again.body.data!._schema_version).toBe((v1 as number) + 1);
	});
});
