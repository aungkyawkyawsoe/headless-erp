/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Relation-expansion hygiene regression suite.
 *
 * Guards the two ways expanded relation data used to be unusable on the wire:
 *
 *   1. o2m children carried EVERY column twice (`id` + `id:1`, …) because the
 *      child fetch emitted `SELECT *, *, ROW_NUMBER() …` (QueryBuilder's
 *      default `*` + a selectRaw that repeated it). D1 renames the duplicate
 *      column set with `:1` suffixes, so every child object was doubled.
 *   2. Embedding resolvers returned soft-deleted rows: an unlinked/trashed
 *      child stayed in `subordinates`, a trashed m2o target resolved to the
 *      trashed object, etc. Every other embedder (ChildTableService,
 *      ComputedFieldService) excludes `deleted_at` rows — relation expansion
 *      must mirror the root-list contract.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

let seq = 0;
function nextSlug(prefix: string): string {
	seq += 1;
	return `${prefix}_relh_${seq}`;
}

async function createCollection(slug: string, fields: Array<Record<string, unknown>>): Promise<Response> {
	return SELF.fetch(`${BASE_URL}/api/collections`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify({ name: `RelHygiene ${slug}`, slug, fields }),
	});
}

async function getSchemaFields(slug: string): Promise<Array<Record<string, unknown>>> {
	const res = await SELF.fetch(`${BASE_URL}/api/collections/${slug}`, { headers: ADMIN });
	if (res.status !== 200) throw new Error(`get schema ${slug}: ${res.status}`);
	const body = (await res.json()) as { data: { schema_json: { fields: Array<Record<string, unknown>> } } };
	return body.data.schema_json.fields;
}

async function updateCollection(slug: string, addFields: Array<Record<string, unknown>>): Promise<Response> {
	// Schema updates REPLACE the field list — send the full current list + the new
	// fields (system columns included, or the migrator sees them as removals).
	const fields = await getSchemaFields(slug);
	fields.push(...addFields);
	return SELF.fetch(`${BASE_URL}/api/collections/${slug}`, {
		method: 'PUT',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify({ fields }),
	});
}

async function expectStatus(res: Response, expected: number, label: string): Promise<Response> {
	if (res.status !== expected) {
		const body = await res.text();
		throw new Error(`${label}: expected ${expected}, got ${res.status} — ${body.slice(0, 400)}`);
	}
	return res;
}

async function createItem(collection: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
	const res = await SELF.fetch(`${BASE_URL}/api/entities/${collection}`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify(body),
	});
	expect(res.status).toBe(201);
	return ((await res.json()) as { data: Record<string, unknown> }).data;
}

describe('relation expansion returns usable data', () => {
	it('o2m children are single-column rows (no :1 duplicates) and exclude soft-deleted rows; trashed m2o → null', async () => {
		const deptSlug = nextSlug('departments');
		const empSlug = nextSlug('employees');
		const linkSlug = nextSlug('links');

		// dept must exist before emp's m2o; emp before link's m2o; link before
		// emp's o2m — so the o2m field arrives via a schema PUT (full field list).
		await expectStatus(await createCollection(deptSlug, [{ name: 'name', type: 'text' }]), 201, 'create dept');
		await expectStatus(
			await createCollection(empSlug, [
				{ name: 'name', type: 'text' },
				{ name: 'dept', type: 'm2o', required: false, related_collection: deptSlug },
			]),
			201,
			'create emp',
		);
		await expectStatus(
			await createCollection(linkSlug, [
				{ name: 'subordinate', type: 'm2o', required: false, related_collection: empSlug },
				{ name: 'superior', type: 'm2o', required: false, related_collection: empSlug },
			]),
			201,
			'create link',
		);
		await expectStatus(
			await updateCollection(empSlug, [
				{ name: 'subordinates', type: 'o2m', required: false, related_collection: linkSlug, foreign_key: 'superior' },
			]),
			200,
			'PUT emp o2m',
		);

		const dept = await createItem(deptSlug, { name: 'Ops' });
		const boss = await createItem(empSlug, { name: 'Boss', dept: dept.id });
		const linkA = await createItem(linkSlug, { superior: boss.id });
		const linkB = await createItem(linkSlug, { superior: boss.id });

		// ── 1. o2m children are clean single-column rows — no `:1` duplicates ──
		const res = await SELF.fetch(`${BASE_URL}/api/entities/${empSlug}/${boss.id}?fields=*,subordinates`, { headers: ADMIN });
		expect(res.status).toBe(200);
		const data = ((await res.json()) as { data: Record<string, unknown> }).data;
		const children = data.subordinates as Array<Record<string, unknown>>;
		expect(children.map((c) => c.id).sort()).toEqual([linkA.id, linkB.id].sort());
		for (const child of children) {
			const dupKeys = Object.keys(child).filter((k) => /:\d+$/.test(k));
			expect(dupKeys).toEqual([]);
			expect(typeof child.id).toBe('string');
			expect(child.superior).toBe(boss.id); // m2o children stay scalar at depth 0
		}

		// ── 2. soft-deleted (unlinked) children disappear from the expansion ──
		await expectStatus(
			await SELF.fetch(`${BASE_URL}/api/entities/${linkSlug}/${linkB.id}`, { method: 'DELETE', headers: ADMIN }),
			200,
			'DELETE linkB',
		);
		const after = await SELF.fetch(`${BASE_URL}/api/entities/${empSlug}/${boss.id}?fields=*,subordinates`, { headers: ADMIN });
		const afterData = ((await after.json()) as { data: Record<string, unknown> }).data;
		const remaining = afterData.subordinates as Array<Record<string, unknown>>;
		expect(remaining.map((c) => c.id)).toEqual([linkA.id]);

		// ── 3. a soft-deleted m2o target resolves to null (never the trashed object) ──
		await SELF.fetch(`${BASE_URL}/api/entities/${deptSlug}/${dept.id}`, { method: 'DELETE', headers: ADMIN });
		const m2oRes = await SELF.fetch(`${BASE_URL}/api/entities/${empSlug}/${boss.id}?fields=name,dept`, { headers: ADMIN });
		const m2oData = ((await m2oRes.json()) as { data: Record<string, unknown> }).data;
		expect(m2oData.name).toBe('Boss');
		expect(m2oData.dept).toBeNull();
	});
});
