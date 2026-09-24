/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * `GET /api/collections/:slug?with=relation_schemas` — the bundled relation read.
 *
 * The Studio's table view resolves each m2o column's display leaf (the field a
 * nested filter targets, and the type its filter UI uses) from the related
 * collection's SCHEMA. Left alone that is one request per relation just to read a
 * few bytes of metadata. This opt-in bundles every m2o target into the focused
 * response in a single batched read.
 *
 * The contract that makes the client's hydration sound: a bundled target is the
 * EXACT object a direct GET returns — same keys, same parsed `schema_json`, same
 * `id → user → system` field order — so it can be cached under the target's own
 * key with no drift. Also pinned: opt-in only (no bundle unless asked), and a
 * dangling/deleted target is skipped rather than failing the read.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

type ApiBody = { success?: boolean; error?: string; data?: Record<string, unknown> };

let seq = 0;
function nextSlug(prefix: string): string {
	seq += 1;
	return `${prefix}_rel_${seq}`;
}

async function createCollection(slug: string, fields: Array<Record<string, unknown>>): Promise<Response> {
	return SELF.fetch(`${BASE_URL}/api/collections`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify({ name: `Rel ${slug}`, slug, fields }),
	});
}

async function getCollection(path: string): Promise<ApiBody> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, { headers: ADMIN });
	expect(res.status).toBe(200);
	return (await res.json()) as ApiBody;
}

function fieldsOf(schema: Record<string, unknown>): Array<Record<string, unknown>> {
	return (schema.schema_json as { fields: Array<Record<string, unknown>> }).fields;
}

async function seedEmployeeWithDepartment(): Promise<{ deptSlug: string; empSlug: string }> {
	const deptSlug = nextSlug('departments');
	const empSlug = nextSlug('employees');
	expect(
		(
			await createCollection(deptSlug, [
				{ name: 'name', type: 'text' },
				{ name: 'code', type: 'text', required: false },
			])
		).status,
	).toBe(201);
	expect(
		(
			await createCollection(empSlug, [
				{ name: 'name', type: 'text' },
				{ name: 'designation', type: 'm2o', required: false, related_collection: deptSlug },
			])
		).status,
	).toBe(201);
	return { deptSlug, empSlug };
}

describe('GET /api/collections/:slug?with=relation_schemas', () => {
	it('bundles every m2o target, parsed and field-ordered like a direct read', async () => {
		const { deptSlug, empSlug } = await seedEmployeeWithDepartment();

		const focused = await getCollection(`/api/collections/${empSlug}?with=relation_schemas`);
		const related = focused.data?.related_schemas as Record<string, Record<string, unknown>> | undefined;
		expect(related, 'related_schemas present').toBeTruthy();
		expect(Object.keys(related!)).toEqual([deptSlug]);

		// The bundle is the canonical schema row: JSON parsed (not a TEXT column),
		// and the direct GET returns the SAME object — that equality is what lets the
		// client cache it under the target's own key without drift.
		const direct = await getCollection(`/api/collections/${deptSlug}`);
		expect(Array.isArray(fieldsOf(related![deptSlug]))).toBe(true);
		expect(related![deptSlug]).toEqual(direct.data);
	});

	it('is opt-in — no bundle unless the caller asks', async () => {
		const { empSlug } = await seedEmployeeWithDepartment();
		const plain = await getCollection(`/api/collections/${empSlug}`);
		expect(plain.data).not.toHaveProperty('related_schemas');
	});

	it('a collection with no m2o targets carries no related_schemas key', async () => {
		const { deptSlug } = await seedEmployeeWithDepartment();
		const dept = await getCollection(`/api/collections/${deptSlug}?with=relation_schemas`);
		expect(dept.data).not.toHaveProperty('related_schemas');
	});

	it('a dangling target is skipped, never fatal', async () => {
		const empSlug = nextSlug('dangling');
		expect(
			(
				await createCollection(empSlug, [
					{ name: 'name', type: 'text' },
					{ name: 'ghost', type: 'm2o', required: false, related_collection: 'does_not_exist_collection' },
				])
			).status,
		).toBe(201);

		const res = await getCollection(`/api/collections/${empSlug}?with=relation_schemas`);
		expect(res.success).toBe(true);
		// Nothing to bundle — and crucially no error from the missing target.
		expect(res.data).not.toHaveProperty('related_schemas');
	});
});
