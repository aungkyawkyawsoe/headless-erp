/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * `filter[<m2o>][_null]` — the engine's "this relation is not set" filter.
 *
 * Used by the mini app wherever a nullable relation decides what a screen shows:
 * attendance's open-check-in lookup (`check_out._null`) and the fleets register's
 * "serviceable vehicle" filter (`unit_type._null`).
 *
 * The vehicle-document registers (licenses / insurances) are deliberately
 * VEHICLE-FIRST and do NOT use it: their contract is one card per `vehicles`
 * row — which is the actual "show every car" requirement (#9/#10) — so a document
 * with no vehicle has no truck to appear under. It is left out on purpose rather
 * than surfaced as an "Unassigned" group, because that would cost a second read
 * on EVERY register open to render a state production has zero rows of.
 *
 * So the filter must mean exactly `vehicle IS NULL` on the physical FK column,
 * and `_nnull` its complement. (The m2m sibling of this operator is the
 * documented D1 error; an m2o FK is a real column and must work.)
 *
 * Pinned here because nothing else covers `_null` on a RELATION field, and a
 * regression would silently return an empty set — records vanishing from the
 * screens that DO rely on it.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface Envelope {
	success?: boolean;
	error?: string;
	code?: string;
	data?: unknown;
}

async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: Envelope }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init.headers ?? {}) },
	});
	return { status: res.status, body: ((await res.json().catch(() => null)) ?? {}) as Envelope };
}

async function ensureCollection(slug: string, fields: Array<Record<string, unknown>>): Promise<void> {
	const res = await call('/api/collections', { method: 'POST', body: JSON.stringify({ name: slug, slug, fields }) });
	if (res.status === 201) return;
	const read = await call(`/api/collections/${slug}`);
	expect(read.status).toBe(200);
}

async function createRow(slug: string, body: Record<string, unknown>): Promise<string> {
	const res = await call(`/api/entities/${slug}`, { method: 'POST', body: JSON.stringify(body) });
	expect(res.status).toBe(201);
	return String((res.body.data as { id: string }).id);
}

describe('filter[<m2o>][_null] — an unset relation is a real column test', () => {
	const PARENT = 't_null_parent';
	const CHILD = 't_null_child';
	let linked = '';
	let orphan = '';
	let parentId = '';

	beforeAll(async () => {
		await ensureCollection(PARENT, [{ name: 'name', type: 'text', required: false, label: 'Name' }]);
		// The FK is OPTIONAL — that is the whole point (a required m2o could never be null).
		await ensureCollection(CHILD, [
			{ name: 'name', type: 'text', required: false, label: 'Name' },
			{ name: 'parent', type: 'm2o', required: false, label: 'Parent', related_collection: PARENT },
		]);

		parentId = await createRow(PARENT, { name: 'Parent' });
		linked = await createRow(CHILD, { name: 'Linked', parent: parentId });
		orphan = await createRow(CHILD, { name: 'Orphan' });
	});

	it('_null returns exactly the rows whose FK is absent', async () => {
		const res = await call(`/api/entities/${CHILD}?filter[parent][_null]=true&fields=id&limit=100`);
		expect(res.status).toBe(200);
		const ids = (res.body.data as Array<{ id: string }>).map((row) => row.id);
		expect(ids).toEqual([orphan]);
	});

	it('_nnull is the complement (rows that DO carry the relation)', async () => {
		const res = await call(`/api/entities/${CHILD}?filter[parent][_nnull]=true&fields=id&limit=100`);
		expect(res.status).toBe(200);
		const ids = (res.body.data as Array<{ id: string }>).map((row) => row.id);
		expect(ids).toEqual([linked]);
	});

	it('_eq on the same relation still resolves the FK (the pair must not drift)', async () => {
		const res = await call(`/api/entities/${CHILD}?filter[parent][_eq]=${parentId}&fields=id&limit=100`);
		expect(res.status).toBe(200);
		const ids = (res.body.data as Array<{ id: string }>).map((row) => row.id);
		expect(ids).toEqual([linked]);
	});
});
