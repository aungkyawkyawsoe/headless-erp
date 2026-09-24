/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * GET /api/collections — the lean schema registry.
 *
 * Regression: the route used to `SELECT *` (schema_json included) and strip the
 * blob in JS, reading every collection's full schema JSON on every Studio mount.
 * It now reads exactly the columns it serializes. Pins that:
 *   - the payload never carries `schema_json` / `system_field_options`;
 *   - it carries the registry fields the Studio reads (slug/name/table_name/…);
 *   - a just-created collection appears on the next read (the summaries cache is
 *     dropped on mutation, not left stale).
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

type ApiBody = { success?: boolean; error?: string; data?: Array<Record<string, unknown>> };

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: ApiBody }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init?.headers ?? {}) },
	});
	return { status: res.status, body: ((await res.json().catch(() => null)) ?? {}) as ApiBody };
}

describe('GET /api/collections is lean and cache-coherent', () => {
	it('lists a freshly created collection without its schema_json blob', async () => {
		const slug = 'zz_registry_lean';
		const created = await api('/api/collections', {
			method: 'POST',
			body: JSON.stringify({ name: 'ZZ Registry Lean', slug, fields: [{ name: 'title', type: 'text', label: 'Title', required: false }] }),
		});
		expect(created.status, 'create collection').toBe(201);

		// Read AFTER the write — the summaries cache must have been invalidated.
		const res = await api('/api/collections');
		expect(res.status).toBe(200);
		const rows = res.body.data ?? [];
		const row = rows.find((r) => r.slug === slug);
		expect(row, 'created collection is listed').toBeTruthy();

		// Lean shape: registry fields present, the two heavy blobs absent.
		expect(row).toHaveProperty('name');
		expect(row).toHaveProperty('table_name');
		expect(row).not.toHaveProperty('schema_json');
		expect(row).not.toHaveProperty('system_field_options');

		// Every row shares the shape (no accidental schema_json leak anywhere).
		for (const r of rows) expect(r).not.toHaveProperty('schema_json');
	});
});
