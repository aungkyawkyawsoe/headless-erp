/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Default-read projection contract (relations are opt-in):
 *
 *   1. With NO `?fields=` (and no schema `list_fields`) the response carries the
 *      record's OWN data only — m2o relation keys (the scalar FK column) and the
 *      system user-reference columns (_owner, created_by, updated_by,
 *      deleted_by) are HIDDEN. They only appear when the caller projects them.
 *   2. Naming a relation in `?fields=` (bare name or `field.*`) expands it with
 *      ALL of the related row's data; a dangling FK becomes null (never a raw id).
 *   3. `boolean` fields are returned as real true/false (not stored 1/0), on the
 *      root row AND inside resolved relation objects.
 *   4. `fields=*` follows the same rule: it returns the record's OWN data
 *      columns (+ virtual formulas) — never relation FKs or the audit/user
 *      columns. Those are pulled back only by NAMING them next to the wildcard:
 *      `*,department`, `*,superiors.*`, `*,_owner,created_by`.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

let seq = 0;
function nextSlug(prefix: string): string {
	seq += 1;
	return `${prefix}_lean_${seq}`;
}

interface Row {
	id: string;
	[key: string]: unknown;
}

async function createCollection(slug: string, fields: Array<Record<string, unknown>>): Promise<Response> {
	return SELF.fetch(`${BASE_URL}/api/collections`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify({ name: `Lean ${slug}`, slug, fields }),
	});
}

async function createItem(collection: string, body: Record<string, unknown>): Promise<Row> {
	const res = await SELF.fetch(`${BASE_URL}/api/entities/${collection}`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify(body),
	});
	expect(res.status).toBe(201);
	const json = (await res.json()) as { data: Row };
	return json.data;
}

describe('default entity reads are relation-lean', () => {
	it('hides relation FKs + user-reference columns by default; booleans are real booleans', async () => {
		const deptSlug = nextSlug('departments');
		const empSlug = nextSlug('employees');
		expect((await createCollection(deptSlug, [{ name: 'name', type: 'text' }])).status).toBe(201);
		expect(
			(
				await createCollection(empSlug, [
					{ name: 'name', type: 'text' },
					{ name: 'is_active', type: 'boolean', required: false },
					{ name: 'department', type: 'm2o', required: false, related_collection: deptSlug },
				])
			).status,
		).toBe(201);

		const dept = await createItem(deptSlug, { name: 'Vehicle' });
		const emp = await createItem(empSlug, { name: 'Zaw', department: dept.id, is_active: true });

		// List — no ?fields=
		const listRes = await SELF.fetch(`${BASE_URL}/api/entities/${empSlug}?limit=5`, { headers: ADMIN });
		expect(listRes.status).toBe(200);
		const list = ((await listRes.json()) as { data: Row[] }).data;
		expect(list.length).toBeGreaterThan(0);
		const listRow = list.find((r) => r.id === emp.id)!;
		expect(listRow).toBeDefined();
		expect(listRow.name).toBe('Zaw');
		expect(listRow.is_active).toBe(true); // NOT 1
		expect(listRow).not.toHaveProperty('department'); // m2o FK key hidden
		expect(listRow).not.toHaveProperty('_owner');
		expect(listRow).not.toHaveProperty('created_by');
		expect(listRow).not.toHaveProperty('updated_by');
		expect(listRow).not.toHaveProperty('deleted_by');
		expect(typeof listRow.created_at).toBe('string'); // timestamps stay

		// Detail — no ?fields= (same semantics as list)
		const detailRes = await SELF.fetch(`${BASE_URL}/api/entities/${empSlug}/${emp.id}`, { headers: ADMIN });
		expect(detailRes.status).toBe(200);
		const detail = ((await detailRes.json()) as { data: Row }).data;
		expect(detail.is_active).toBe(true);
		expect(detail).not.toHaveProperty('department');
		expect(detail).not.toHaveProperty('created_by');
		expect(detail).not.toHaveProperty('_owner');
	});

	it('naming a relation expands it with all its data (bare name = field.*); dangling FK → null', async () => {
		const deptSlug = nextSlug('departments');
		const empSlug = nextSlug('employees');
		expect(
			(
				await createCollection(deptSlug, [
					{ name: 'name', type: 'text' },
					{ name: 'is_internal', type: 'boolean', required: false },
				])
			).status,
		).toBe(201);
		expect(
			(
				await createCollection(empSlug, [
					{ name: 'name', type: 'text' },
					{ name: 'is_active', type: 'boolean', required: false },
					{ name: 'department', type: 'm2o', required: false, related_collection: deptSlug },
				])
			).status,
		).toBe(201);

		const dept = await createItem(deptSlug, { name: 'Vehicle', is_internal: false });
		const _emp = await createItem(empSlug, { name: 'Zaw', department: dept.id, is_active: true });

		// Bare relation name → the related object with ALL columns + a decoded boolean.
		const bare = await SELF.fetch(`${BASE_URL}/api/entities/${empSlug}?fields=name,department&limit=5`, { headers: ADMIN });
		expect(bare.status).toBe(200);
		const bareRow = ((await bare.json()) as { data: Row[] }).data[0];
		expect(bareRow.name).toBe('Zaw');
		expect(typeof bareRow.department).toBe('object');
		const depObj = bareRow.department as Row;
		expect(depObj.id).toBe(dept.id);
		expect(depObj.name).toBe('Vehicle');
		expect(depObj.is_internal).toBe(false); // boolean decoded INSIDE the relation too

		// field.* → identical (all columns of the related row)
		const star = await SELF.fetch(`${BASE_URL}/api/entities/${empSlug}?fields=department.*&limit=5`, { headers: ADMIN });
		const starRow = ((await star.json()) as { data: Row[] }).data[0];
		expect((starRow.department as Row).name).toBe('Vehicle');

		// Pruned path → only id + requested column
		const pruned = await SELF.fetch(`${BASE_URL}/api/entities/${empSlug}?fields=department.name&limit=5`, { headers: ADMIN });
		const prunedRow = ((await pruned.json()) as { data: Row[] }).data[0];
		expect(prunedRow.department).toEqual({ id: dept.id, name: 'Vehicle' });

		// '*' on a collection WITH relations: data columns only — no FK scalar,
		// no audit columns.
		const starOnly = await SELF.fetch(`${BASE_URL}/api/entities/${empSlug}?fields=*&limit=5`, { headers: ADMIN });
		const starOnlyRow = ((await starOnly.json()) as { data: Row[] }).data[0];
		expect(starOnlyRow.name).toBe('Zaw');
		expect(starOnlyRow.is_active).toBe(true);
		expect(starOnlyRow).not.toHaveProperty('department');
		expect(starOnlyRow).not.toHaveProperty('_owner');
		expect(starOnlyRow).not.toHaveProperty('created_by');

		// '*,<relation>' adds ONLY that relation (all of its data) — the syntax the
		// user asked for (e.g. *,superiors.*).
		const starPlusRel = await SELF.fetch(`${BASE_URL}/api/entities/${empSlug}?fields=*,department&limit=5`, { headers: ADMIN });
		const starPlusRelRow = ((await starPlusRel.json()) as { data: Row[] }).data[0];
		expect(starPlusRelRow.name).toBe('Zaw');
		expect((starPlusRelRow.department as Row).name).toBe('Vehicle');
		expect(starPlusRelRow).not.toHaveProperty('created_by');

		// Dangling FK → null (never the raw scalar id) when the relation is requested.
		const ghost = await createItem(empSlug, { name: 'Ghost', department: '00000000-0000-4000-8000-000000000000' });
		const ghostRes = await SELF.fetch(`${BASE_URL}/api/entities/${empSlug}/${ghost.id}?fields=name,department`, { headers: ADMIN });
		const ghostRow = ((await ghostRes.json()) as { data: Row }).data;
		expect(ghostRow.department).toBeNull();
	});

	it('explicit projections can re-include the hidden columns (named system cols and *)', async () => {
		const empSlug = nextSlug('employees');
		expect(
			(
				await createCollection(empSlug, [
					{ name: 'name', type: 'text' },
					{ name: 'is_active', type: 'boolean', required: false },
				])
			).status,
		).toBe(201);
		const emp = await createItem(empSlug, { name: 'Zaw', is_active: true });

		// Named system/user-reference columns come back as scalars.
		const named = await SELF.fetch(
			`${BASE_URL}/api/entities/${empSlug}/${emp.id}?fields=name,is_active,created_by,_owner,updated_by,deleted_by`,
			{ headers: ADMIN },
		);
		const namedRow = ((await named.json()) as { data: Row }).data;
		expect(namedRow).toHaveProperty('created_by');
		expect(namedRow).toHaveProperty('_owner');
		expect(namedRow).toHaveProperty('updated_by');
		expect(namedRow).toHaveProperty('deleted_by');
		expect(namedRow.is_active).toBe(true);

		// '*' returns the record's own data columns ONLY — audit/user-reference
		// columns and relation keys stay hidden until named (booleans decoded).
		const all = await SELF.fetch(`${BASE_URL}/api/entities/${empSlug}/${emp.id}?fields=*`, { headers: ADMIN });
		const allRow = ((await all.json()) as { data: Row }).data;
		expect(allRow.name).toBe('Zaw');
		expect(allRow.is_active).toBe(true);
		expect(allRow).not.toHaveProperty('created_by');
		expect(allRow).not.toHaveProperty('_owner');
		expect(allRow).not.toHaveProperty('updated_by');
		expect(allRow).not.toHaveProperty('deleted_by');

		// Adding the audit columns by name next to '*' brings them back.
		const allNamed = await SELF.fetch(`${BASE_URL}/api/entities/${empSlug}/${emp.id}?fields=*,_owner,created_by`, { headers: ADMIN });
		const allNamedRow = ((await allNamed.json()) as { data: Row }).data;
		expect(allNamedRow).toHaveProperty('created_by');
		expect(allNamedRow).toHaveProperty('_owner');
		expect(allNamedRow.is_active).toBe(true);
	});
});
