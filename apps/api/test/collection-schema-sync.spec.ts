/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Studio ↔ API field sync contract (regression):
 *
 * PUT /api/collections/:slug must keep the PHYSICAL D1 table in sync with
 * schema_json — deleting a field drops its column, updating a field's
 * type/nullability/index/unique rebuilds or alters the table, and record data
 * survives those migrations. This used to be metadata-only: EntityMigrator was
 * add-only, so deleted columns lingered forever and type/required changes never
 * reached the database.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Physical columns of a table: name → { name, type, notnull }. */
async function tableInfo(table: string): Promise<Map<string, { name: string; type: string; notnull: number }>> {
	const rows = (await env.DB.prepare('SELECT name, type, "notnull" FROM pragma_table_info(?)').bind(table).all())
		.results as unknown as Array<{
		name: string;
		type: string;
		notnull: number;
	}>;
	return new Map(rows.map((r) => [r.name, r]));
}

async function indexNames(table: string): Promise<string[]> {
	const rows = (await env.DB.prepare('SELECT name FROM pragma_index_list(?)').bind(table).all()).results as unknown as Array<{
		name: string;
	}>;
	return rows.map((r) => r.name);
}

async function getSchemaFields(slug: string): Promise<Array<Record<string, unknown>>> {
	const res = await SELF.fetch(`${BASE_URL}/api/collections/${slug}`, { headers: ADMIN });
	expect(res.status).toBe(200);
	const body = (await res.json()) as { data: { schema_json: { fields: Array<Record<string, unknown>> } } };
	return body.data.schema_json.fields;
}

/** Full schema_json of a collection. */
async function getSchema(slug: string): Promise<{ fields: Array<Record<string, unknown>>; composite_indexes?: { columns: string[] }[] }> {
	const res = await SELF.fetch(`${BASE_URL}/api/collections/${slug}`, { headers: ADMIN });
	expect(res.status).toBe(200);
	const body = (await res.json()) as {
		data: { schema_json: { fields: Array<Record<string, unknown>>; composite_indexes?: { columns: string[] }[] } };
	};
	return body.data.schema_json;
}

async function putFields(slug: string, fields: Array<Record<string, unknown>>): Promise<Response> {
	return SELF.fetch(`${BASE_URL}/api/collections/${slug}`, {
		method: 'PUT',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify({ fields }),
	});
}

const SLUG = 'sync_mig_test';
const TABLE = 'cms_sync_mig_test';

describe('collection schema field sync (PUT /api/collections/:slug)', () => {
	it('drops the physical column when a field is deleted', async () => {
		const created = await SELF.fetch(`${BASE_URL}/api/collections`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ name: 'Sync Mig Test', slug: SLUG, fields: [{ name: 'name', type: 'text', required: true }] }),
		});
		expect(created.status).toBe(201);

		// Add a field — the ADD path creates the column.
		let fields = await getSchemaFields(SLUG);
		fields.push({ name: 'notes', type: 'longtext', required: false });
		let res = await putFields(SLUG, fields);
		expect(res.status).toBe(200);
		let info = await tableInfo(TABLE);
		expect(info.has('notes')).toBe(true);
		expect(info.get('notes')?.notnull).toBe(0);

		// Delete the field — the column must be DROPPED, not just removed from schema_json.
		fields = (await getSchemaFields(SLUG)).filter((f) => f.name !== 'notes');
		res = await putFields(SLUG, fields);
		expect(res.status).toBe(200);
		info = await tableInfo(TABLE);
		expect(info.has('notes')).toBe(false);
		expect(info.has('name')).toBe(true);

		// schema_json agrees.
		fields = await getSchemaFields(SLUG);
		expect(fields.some((f) => f.name === 'notes')).toBe(false);
	});

	it('rebuilds the table on type/nullability changes and preserves data + indexes', async () => {
		const slug = 'sync_mig_rebuild';
		const table = 'cms_sync_mig_rebuild';
		const created = await SELF.fetch(`${BASE_URL}/api/collections`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({
				name: 'Sync Mig Rebuild',
				slug,
				fields: [
					{ name: 'title', type: 'text', required: true },
					{ name: 'qty', type: 'integer', required: false },
					{ name: 'code', type: 'text', required: false, index: true },
				],
			}),
		});
		expect(created.status).toBe(201);

		// Seed a row so the rebuild's data-copy is exercised.
		const seed = await SELF.fetch(`${BASE_URL}/api/entities/${slug}`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ title: 'Widget', qty: 5 }),
		});
		expect(seed.status).toBe(201);
		const seeded = (await seed.json()) as { data: { id: string } };
		const seededId = seeded.data.id;

		// Update: qty integer → text AND title becomes optional (both require a
		// table rebuild — SQLite has no ALTER COLUMN).
		let fields = await getSchemaFields(slug);
		fields = fields.map((f) => {
			if (f.name === 'qty') return { ...f, type: 'text' };
			if (f.name === 'title') return { ...f, required: false };
			return f;
		});
		const res = await putFields(slug, fields);
		if (res.status !== 200) {
			const body = (await res.json()) as { error?: string };
			throw new Error(`rebuild PUT failed: ${res.status} ${JSON.stringify(body)}`);
		}
		expect(res.status).toBe(200);

		const info = await tableInfo(table);
		expect(info.get('qty')?.type).toBe('TEXT');
		expect(info.get('title')?.notnull).toBe(0);

		// Data survived the rebuild.
		const read = await SELF.fetch(`${BASE_URL}/api/entities/${slug}/${seededId}`, { headers: ADMIN });
		expect(read.status).toBe(200);
		const row = (await read.json()) as { data: { title: string; qty: unknown } };
		expect(row.data.title).toBe('Widget');
		// qty was migrated INTEGER → TEXT; the stored value survives as its text form.
		expect(String(row.data.qty)).toBe('5');

		// Explicit NULL is accepted once the field is optional (required:false).
		const nullRow = await SELF.fetch(`${BASE_URL}/api/entities/${slug}`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ title: null, qty: '7' }),
		});
		expect(nullRow.status).toBe(201);

		// Engine indexes survive the rebuild (cursor index + field indexes).
		const names = await indexNames(table);
		expect(names).toContain(`idx_${table}_deleted_id`);
		expect(names).toContain(`idx_${table}_code`);
	});

	it('creates/drops unique + regular indexes as the field flags change', async () => {
		const slug = 'sync_mig_idx';
		const table = 'cms_sync_mig_idx';
		const created = await SELF.fetch(`${BASE_URL}/api/collections`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ name: 'Sync Mig Idx', slug, fields: [{ name: 'email', type: 'text', required: false }] }),
		});
		expect(created.status).toBe(201);

		// unique + index toggled on → uidx + idx appear.
		let fields = (await getSchemaFields(slug)).map((f) => (f.name === 'email' ? { ...f, unique: true, index: true } : f));
		let res = await putFields(slug, fields);
		expect(res.status).toBe(200);
		let names = await indexNames(table);
		expect(names).toContain(`uidx_${table}_email`);
		expect(names).toContain(`idx_${table}_email`);

		// Both toggled off → indexes disappear (no rebuild needed).
		fields = (await getSchemaFields(slug)).map((f) => (f.name === 'email' ? { ...f, unique: false, index: false } : f));
		res = await putFields(slug, fields);
		expect(res.status).toBe(200);
		names = await indexNames(table);
		expect(names).not.toContain(`uidx_${table}_email`);
		expect(names).not.toContain(`idx_${table}_email`);
	});

	it('keeps the singleton guard across a table rebuild', async () => {
		const slug = 'sync_mig_single';
		const table = 'cms_sync_mig_single';
		const created = await SELF.fetch(`${BASE_URL}/api/collections`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({
				name: 'Sync Mig Single',
				slug,
				is_singleton: true,
				fields: [{ name: 'value', type: 'text', required: false }],
			}),
		});
		expect(created.status).toBe(201);

		const first = await SELF.fetch(`${BASE_URL}/api/entities/${slug}`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ value: 'only' }),
		});
		expect(first.status).toBe(201);

		// Force a rebuild (type change) and confirm the partial UNIQUE index returns.
		const fields = (await getSchemaFields(slug)).map((f) => (f.name === 'value' ? { ...f, type: 'longtext' } : f));
		const res = await putFields(slug, fields);
		expect(res.status).toBe(200);
		const names = await indexNames(table);
		expect(names).toContain(`idx_${table}_singleton`);

		// A second non-deleted row must still be rejected by the DB backstop.
		const second = await SELF.fetch(`${BASE_URL}/api/entities/${slug}`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ value: 'second' }),
		});
		expect(second.status).toBe(400);
	});

	it('keeps declared composite indexes across a table rebuild', async () => {
		const slug = 'sync_mig_comp_rebuild';
		const table = 'cms_sync_mig_comp_rebuild';
		const created = await SELF.fetch(`${BASE_URL}/api/collections`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({
				name: 'Sync Mig Comp Rebuild',
				slug,
				fields: [
					{ name: 'code', type: 'text', required: false },
					{ name: 'qty', type: 'integer', required: false },
				],
				composite_indexes: [{ columns: ['code', 'qty'] }],
			}),
		});
		expect(created.status).toBe(201);
		expect(await indexNames(table)).toContain(`idx_${table}_code_qty`);

		// Type change → full table rebuild. The declared composite index must be
		// recreated on the rebuilt table (regression: rebuilds used to drop it
		// while schema_json kept advertising it).
		const fields = (await getSchemaFields(slug)).map((f) => (f.name === 'qty' ? { ...f, type: 'text' } : f));
		const res = await putFields(slug, fields);
		expect(res.status).toBe(200);

		const names = await indexNames(table);
		expect(names).toContain(`idx_${table}_deleted_id`);
		expect(names).toContain(`idx_${table}_code_qty`);

		// schema_json still declares the composite.
		const schema = await getSchema(slug);
		expect(schema.composite_indexes).toEqual([{ columns: ['code', 'qty'] }]);
	});

	it('drops composite indexes that referenced a removed field (schema + DDL)', async () => {
		const slug = 'sync_mig_comp_drop';
		const table = 'cms_sync_mig_comp_drop';
		const created = await SELF.fetch(`${BASE_URL}/api/collections`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({
				name: 'Sync Mig Comp Drop',
				slug,
				fields: [
					{ name: 'code', type: 'text', required: false },
					{ name: 'qty', type: 'integer', required: false },
				],
				composite_indexes: [{ columns: ['code', 'qty'] }],
			}),
		});
		expect(created.status).toBe(201);

		// Studio-style fields-only PUT removing `code` — the composite declaration
		// referencing it must vanish from BOTH the physical table and schema_json.
		const fields = (await getSchemaFields(slug)).filter((f) => f.name !== 'code');
		const res = await putFields(slug, fields);
		expect(res.status).toBe(200);

		const info = await tableInfo(table);
		expect(info.has('code')).toBe(false);
		expect(info.has('qty')).toBe(true);
		const names = await indexNames(table);
		expect(names).not.toContain(`idx_${table}_code_qty`);

		const schema = await getSchema(slug);
		expect(schema.composite_indexes).toBeUndefined();
	});

	it('refuses to persist schema_json when the DDL fails', async () => {
		const slug = 'sync_mig_fail';
		const created = await SELF.fetch(`${BASE_URL}/api/collections`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ name: 'Sync Mig Fail', slug, fields: [{ name: 'v', type: 'text', required: false }] }),
		});
		expect(created.status).toBe(201);

		// A UNIQUE index cannot be created over duplicate values → the PUT must
		// fail AND leave schema_json untouched (no silent divergence).
		const dup1 = await SELF.fetch(`${BASE_URL}/api/entities/${slug}`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ v: 'same' }),
		});
		const dup2 = await SELF.fetch(`${BASE_URL}/api/entities/${slug}`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ v: 'same' }),
		});
		expect(dup1.status).toBe(201);
		expect(dup2.status).toBe(201);

		const fields = (await getSchemaFields(slug)).map((f) => (f.name === 'v' ? { ...f, unique: true } : f));
		const res = await putFields(slug, fields);
		expect(res.status).toBe(400);

		// schema_json was NOT updated — the engine still sees plain text.
		const after = await getSchemaFields(slug);
		expect(after.find((f) => f.name === 'v')?.unique).toBeFalsy();
	});

	it('rolls back the WHOLE migration when one DDL op fails (no half-altered table)', async () => {
		const slug = 'sync_mig_atomic';
		const table = 'cms_sync_mig_atomic';
		const created = await SELF.fetch(`${BASE_URL}/api/collections`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ name: 'Sync Mig Atomic', slug, fields: [{ name: 'name', type: 'text', required: true }] }),
		});
		expect(created.status).toBe(201);
		const before = await tableInfo(table);

		// Malformed payload WITHOUT the system fields (id is a PRIMARY KEY column):
		// the diff wants to DROP id + every other omitted column — the very first
		// DROP fails and, with a non-atomic apply, the REMAINING drops used to
		// succeed, silently stripping doc_status/_owner/… off the physical table
		// while schema_json still declared them (permanent desync — reads then
		// failed with "no such column" and no later PUT could repair it).
		const res = await putFields(slug, [{ name: 'name', type: 'text', required: true }]);
		expect(res.status).toBe(400);

		// The physical table must be byte-for-byte what it was before the attempt.
		const after = await tableInfo(table);
		expect(after.size).toBe(before.size);
		for (const [col, def] of before) {
			expect(after.get(col)).toEqual(def);
		}

		// And it still serves records (schema + table agree, nothing to repair).
		const fields = await getSchemaFields(slug);
		expect(fields.map((f) => f.name)).toContain('doc_status');
		const list = await SELF.fetch(`${BASE_URL}/api/entities/${slug}?limit=5`, { headers: ADMIN });
		expect(list.status).toBe(200);
	});
});
