/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * M2M junction-table lifecycle (regression):
 *
 * The engine stores an m2m field's links in a physical junction table shared per
 * (source collection → related collection) pair and named
 * `_jt_{sourceTable}_{targetTable}` (SchemaBuilder.createJunctionTable). This
 * suite pins the invariants that keep schema_json and the physical `_jt_*`
 * tables from silently diverging:
 *
 *   1. creating a collection with m2m fields provisions its junction table;
 *   2. two m2m fields to the SAME related collection are rejected (they would
 *      share one junction table indistinguishably — the legacy `employees`
 *      subordinates/superiors shape can no longer be created);
 *   3. a junction table missing at read time is self-healed by the engine
 *      (drifted collections like `employees` used to die with an opaque 502
 *      D1_ERROR when a list expanded the field — the bug this guards);
 *   4. PUT /api/collections/:slug provisions junctions the new field list
 *      declares and DROPS junctions it no longer declares (column-drop parity);
 *   5. DELETE /api/collections/:slug drops the collection's junction tables
 *      (previously every deleted m2m collection stranded its `_jt_*` tables).
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

let seq = 0;
function nextSlug(prefix: string): string {
	seq += 1;
	return `${prefix}_jt_${seq}`;
}

const tableOf = (slug: string) => `cms_${slug}`;
const junctionOf = (slug: string) => `_jt_cms_${slug}_cms_${slug}`;

async function tableExists(table: string): Promise<boolean> {
	const rows = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(table).all())
		.results as unknown as Array<{
		name: string;
	}>;
	return rows.length > 0;
}

async function createCollection(slug: string, fields: Array<Record<string, unknown>>): Promise<Response> {
	return SELF.fetch(`${BASE_URL}/api/collections`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify({ name: `Junction ${slug}`, slug, fields }),
	});
}

async function getSchemaFields(slug: string): Promise<Array<Record<string, unknown>>> {
	const res = await SELF.fetch(`${BASE_URL}/api/collections/${slug}`, { headers: ADMIN });
	expect(res.status).toBe(200);
	const body = (await res.json()) as { data: { schema_json: { fields: Array<Record<string, unknown>> } } };
	return body.data.schema_json.fields;
}

describe('m2m junction table lifecycle', () => {
	it('provisions the junction table when a collection with an m2m field is created', async () => {
		const slug = nextSlug('prov');
		const res = await createCollection(slug, [
			{ name: 'buddies', type: 'm2m', label: 'Buddies', required: false, related_collection: slug },
		]);
		expect(res.status).toBe(201);

		expect(await tableExists(tableOf(slug))).toBe(true);
		expect(await tableExists(junctionOf(slug))).toBe(true);
	});

	it('rejects two m2m fields to the same related collection (shared-junction guard)', async () => {
		const slug = nextSlug('guard');
		const res = await createCollection(slug, [
			{ name: 'subordinates', type: 'm2m', required: false, related_collection: slug },
			{ name: 'superiors', type: 'm2m', required: false, related_collection: slug },
		]);
		expect(res.status).toBe(400);

		// Nothing was half-created.
		expect(await tableExists(tableOf(slug))).toBe(false);
	});

	it('self-heals a missing junction table on read (legacy drift — the 502 regression)', async () => {
		const slug = nextSlug('heal');
		const fields = [{ name: 'subordinates', type: 'm2m', required: false, related_collection: slug }];
		const created = await createCollection(slug, fields);
		expect(created.status).toBe(201);
		expect(await tableExists(junctionOf(slug))).toBe(true);

		// Simulate legacy drift: the schema declares the m2m field but the
		// physical junction table is gone (pre-heal builds, partial restore, …).
		await env.DB.exec(`DROP TABLE ${junctionOf(slug)}`);
		expect(await tableExists(junctionOf(slug))).toBe(false);

		// The engine must heal the table BEFORE the relation is resolved —
		// expanding the field must not die with an opaque D1_ERROR 502.
		const res = await SELF.fetch(`${BASE_URL}/api/entities/${slug}?limit=25&fields=*.*`, { headers: ADMIN });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: unknown[] };
		expect(Array.isArray(body.data)).toBe(true);
		expect(await tableExists(junctionOf(slug))).toBe(true);
	});

	it('heals a missing junction table on schema update (PUT reconcile)', async () => {
		const slug = nextSlug('putheal');
		const created = await createCollection(slug, [{ name: 'tags', type: 'm2m', required: false, related_collection: slug }]);
		expect(created.status).toBe(201);

		// Materialize the schema once (arms the per-isolate read-heal guard), then
		// drop the junction — the read path is now guaranteed to skip its heal, so
		// the PUT below is the only thing that can restore the table.
		const fieldsBefore = await getSchemaFields(slug);
		expect(fieldsBefore.some((f) => f.name === 'tags')).toBe(true);
		await env.DB.exec(`DROP TABLE ${junctionOf(slug)}`);
		expect(await tableExists(junctionOf(slug))).toBe(false);

		// Touch the schema (label change) — the PUT provisions the declared junction.
		const fields = fieldsBefore.map((f) => (f.name === 'tags' ? { ...f, label: 'Tags v2' } : f));
		const put = await SELF.fetch(`${BASE_URL}/api/collections/${slug}`, {
			method: 'PUT',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ fields }),
		});
		expect(put.status).toBe(200);
		expect(await tableExists(junctionOf(slug))).toBe(true);
	});

	it('drops the junction table when the last m2m field to a pair is removed', async () => {
		const slug = nextSlug('drop');
		const created = await createCollection(slug, [{ name: 'pals', type: 'm2m', required: false, related_collection: slug }]);
		expect(created.status).toBe(201);
		expect(await tableExists(junctionOf(slug))).toBe(true);

		const fields = (await getSchemaFields(slug)).filter((f) => f.name !== 'pals');
		const put = await SELF.fetch(`${BASE_URL}/api/collections/${slug}`, {
			method: 'PUT',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ fields }),
		});
		expect(put.status).toBe(200);

		// Junction dropped (column-drop parity) and reads no longer touch it.
		expect(await tableExists(junctionOf(slug))).toBe(false);
		const list = await SELF.fetch(`${BASE_URL}/api/entities/${slug}?fields=*.*`, { headers: ADMIN });
		expect(list.status).toBe(200);
	});

	it('drops the junction tables when the collection is deleted', async () => {
		const slug = nextSlug('del');
		const created = await createCollection(slug, [{ name: 'mates', type: 'm2m', required: false, related_collection: slug }]);
		expect(created.status).toBe(201);
		expect(await tableExists(junctionOf(slug))).toBe(true);

		const del = await SELF.fetch(`${BASE_URL}/api/collections/${slug}`, { method: 'DELETE', headers: ADMIN });
		expect(del.status).toBe(200);

		expect(await tableExists(tableOf(slug))).toBe(false);
		expect(await tableExists(junctionOf(slug))).toBe(false);
	});
});
