/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Referential RESTRICT guard on soft-delete.
 *
 * An m2o that EXPLICITLY declares `cascade_delete: false` is RESTRICT: deleting a
 * parent while live child rows still point at it fails with 409 CONFLICT instead of
 * silently orphaning the reference. The three flag states, pinned here:
 *
 *   - `false`  → RESTRICT (blocks the parent delete, names the child collection)
 *   - absent   → legacy permissive (never blocks — backwards compatible)
 *   - `true`   → cascade (children are soft-deleted with the parent, never blocks)
 *
 * The parent delete is allowed again once the blocking child is itself removed, and
 * the admin-only `/force` hard delete deliberately bypasses the guard.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

let seq = 0;
const nextSlug = (prefix: string): string => {
	seq += 1;
	return `${prefix}_restrict_${seq}`;
};

async function api(
	path: string,
	init?: RequestInit,
): Promise<{ status: number; body: { success?: boolean; error?: string; code?: string; data?: unknown } }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init?.headers ?? {}) },
	});
	return { status: res.status, body: (await res.json().catch(() => null)) ?? {} };
}

const field = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
	name,
	type,
	// Engine rule: a field is NOT NULL unless `required: false` is explicit.
	...(extra.required === undefined ? { required: false } : {}),
	...extra,
});

async function createCollection(slug: string, fields: Array<Record<string, unknown>>): Promise<void> {
	const res = await api('/api/collections', { method: 'POST', body: JSON.stringify({ name: slug, slug, fields }) });
	expect(res.status, `create ${slug}`).toBe(201);
}

async function createItem(collection: string, body: Record<string, unknown>): Promise<string> {
	const res = await api(`/api/entities/${collection}`, { method: 'POST', body: JSON.stringify(body) });
	expect(res.status, `create ${collection} row`).toBe(201);
	return (res.body.data as { id: string }).id;
}

describe('referential RESTRICT guard on delete', () => {
	it('blocks a parent delete while an explicit cascade_delete:false child lives; permissive refs never block; /force bypasses', async () => {
		const parent = nextSlug('rp_parent');
		const restrictChild = nextSlug('rp_restrict');
		const permChild = nextSlug('rp_perm');

		await createCollection(parent, [field('name', 'text')]);
		// Explicit `cascade_delete: false` → RESTRICT.
		await createCollection(restrictChild, [
			field('name', 'text'),
			field('parent', 'm2o', { related_collection: parent, cascade_delete: false }),
		]);
		// No flag → legacy permissive (must NOT block).
		await createCollection(permChild, [field('name', 'text'), field('parent', 'm2o', { related_collection: parent })]);

		const p = await createItem(parent, { name: 'Parent' });
		const r = await createItem(restrictChild, { name: 'Blocking child', parent: p });
		await createItem(permChild, { name: 'Permissive child', parent: p });

		// 1. A live RESTRICT child blocks the parent delete with 409 CONFLICT.
		const blocked = await api(`/api/entities/${parent}/${p}`, { method: 'DELETE' });
		expect(blocked.status, 'blocked delete').toBe(409);
		expect(blocked.body.code).toBe('CONFLICT');
		expect(blocked.body.error).toContain('referenced by');
		// The message names the blocking child collection.
		expect(blocked.body.error).toContain(restrictChild);
		// The parent is untouched (still readable).
		expect((await api(`/api/entities/${parent}/${p}`)).status).toBe(200);

		// 2. Remove the RESTRICT child → the parent delete succeeds (the permissive
		//    reference is ignored, proving the flag scoping).
		expect((await api(`/api/entities/${restrictChild}/${r}`, { method: 'DELETE' })).status).toBe(200);
		expect((await api(`/api/entities/${parent}/${p}`, { method: 'DELETE' })).status).toBe(200);

		// 3. `/force` (admin) bypasses RESTRICT for a deliberate purge.
		const parent2 = nextSlug('rp_parent');
		const child2 = nextSlug('rp_restrict');
		await createCollection(parent2, [field('name', 'text')]);
		await createCollection(child2, [field('name', 'text'), field('parent', 'm2o', { related_collection: parent2, cascade_delete: false })]);
		const p2 = await createItem(parent2, { name: 'Parent 2' });
		await createItem(child2, { name: 'Child 2', parent: p2 });
		expect((await api(`/api/entities/${parent2}/${p2}`, { method: 'DELETE' })).status).toBe(409);
		expect((await api(`/api/entities/${parent2}/${p2}/force`, { method: 'DELETE' })).status).toBe(200);
	});
});
