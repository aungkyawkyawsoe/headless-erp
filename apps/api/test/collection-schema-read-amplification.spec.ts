/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { D1Client, cache } from '@mmbix/core';
import { SchemaService } from '@/lib/services/collection-schema.service';
import { RelationResolver } from '@/lib/services/collection-relations.service';
import { parseFieldSelection } from '@/lib/api/query-parser';
import type { FieldDefinition } from '@mmbix/types';

/**
 * Schema reads must not be amplified — regression.
 *
 * `GET /api/collections/:slug` used to call `getCollection()` (existence check +
 * junction heal, which already fetched the row) and then run its OWN uncached
 * `SELECT *` for the very same row. Every schema fetch therefore paid a second
 * D1 read (two on a cold isolate) for bytes the worker was already holding.
 *
 * The fix routes both through ONE raw-row cache (`schema:<slug>:raw`), consulted
 * before `schemas:all` (a superset of every full row) and D1 last. These tests
 * count real `env.DB.prepare()` calls through a proxy so the win cannot silently
 * regress; they also pin that a mutation still drops the raw-row entry.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

let seq = 0;
function nextSlug(prefix: string): string {
	seq += 1;
	return `${prefix}_amp_${seq}`;
}

async function createCollection(slug: string): Promise<void> {
	const res = await SELF.fetch(`${BASE_URL}/api/collections`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify({ name: `Amp ${slug}`, slug, fields: [{ name: 'name', type: 'text' }] }),
	});
	expect(res.status, 'seed collection').toBe(201);
}

/** A D1Database proxy that counts `prepare()` calls (i.e. statements issued). */
function countingDb(): { db: D1Database; reads: () => number; reset: () => void } {
	let reads = 0;
	const proxy = new Proxy(env.DB, {
		get(target, prop, receiver) {
			if (prop === 'prepare') {
				return (sql: string) => {
					reads += 1;
					return target.prepare(sql);
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
	return {
		db: proxy as D1Database,
		reads: () => reads,
		reset: () => {
			reads = 0;
		},
	};
}

async function warmedService(): Promise<{ svc: SchemaService; reads: () => number; reset: () => void }> {
	const counter = countingDb();
	const svc = new SchemaService(new D1Client(counter.db), () => null);
	await svc.ensureMigrations();
	counter.reset();
	return { svc, reads: counter.reads, reset: counter.reset };
}

describe('schema reads are not amplified (D1 statement counts)', () => {
	it('getCollection warms the raw row, so the detail route needs no second read', async () => {
		const slug = nextSlug('detail');
		await createCollection(slug);
		cache.clear();
		const { svc, reads } = await warmedService();

		// Exactly what the route does: heal/existence, then the serialized row.
		await svc.getCollection(slug);
		const coldReads = reads();
		await svc.getCollectionRow(slug);
		expect(reads() - coldReads, 'raw row served from the cache getCollection warmed').toBe(0);

		// A second full pass is entirely cache-served.
		const afterFirst = reads();
		await svc.getCollection(slug);
		await svc.getCollectionRow(slug);
		expect(reads() - afterFirst, 'warm detail read costs zero D1 statements').toBe(0);
	});

	it('a truly cold raw-row read is ONE statement, and repeats are free', async () => {
		const slug = nextSlug('cold');
		await createCollection(slug);
		cache.clear();
		const { svc, reads } = await warmedService();

		await svc.getCollectionRow(slug);
		expect(reads(), 'one SELECT * for the row').toBe(1);
		await svc.getCollectionRow(slug);
		expect(reads(), 'then cached').toBe(1);
	});

	it('batches N relation targets into ONE statement and warms each', async () => {
		const a = nextSlug('departments');
		const b = nextSlug('positions');
		const c = nextSlug('locations');
		await createCollection(a);
		await createCollection(b);
		await createCollection(c);
		cache.clear();
		const { svc, reads } = await warmedService();

		const rows = await svc.getCollectionRows([a, b, c]);
		expect([...rows.keys()].sort()).toEqual([a, b, c].sort());
		expect(reads(), 'one WHERE slug IN (…) for all targets').toBe(1);

		// The bundle warmed each target — a later direct GET is free.
		await svc.getCollectionRow(a);
		expect(reads(), 'bundled target read is cache-served').toBe(1);
	});

	it('serves a raw row from `schemas:all` without touching D1', async () => {
		const slug = nextSlug('fromall');
		await createCollection(slug);
		cache.clear();
		const { svc, reads } = await warmedService();

		await svc.getCollections();
		const afterAll = reads();
		await svc.getCollectionRow(slug);
		expect(reads() - afterAll, 'schemas:all already holds every full row').toBe(0);
	});

	it('a collection mutation drops the raw-row cache entry', async () => {
		const slug = nextSlug('inv');
		await createCollection(slug);
		cache.clear();
		const { svc, reads } = await warmedService();

		await svc.getCollectionRow(slug); // 1 read, now cached
		cache.invalidateCollection(slug);
		await svc.getCollectionRow(slug);
		expect(reads(), 'invalidated ⇒ re-read').toBe(2);
	});

	it('a repeat index-backfill sweep costs ~2 statements, not one per index', async () => {
		// Warm everything: the core migrations AND the first sweep, which creates
		// every index the sweep owns.
		const counter = countingDb();
		const svc = new SchemaService(new D1Client(counter.db), () => null);
		await svc.ensureMigrations();

		// Drop only the per-isolate sweep guard, so the sweep re-runs against a
		// SETTLED database — exactly what a fresh isolate's first request sees.
		cache.clear();
		counter.reset();
		await svc.ensureMigrations();

		// ONE read for the schema set + ONE for the set of indexes that already
		// exist. Blind `CREATE INDEX IF NOT EXISTS` per index (one D1 round trip even
		// when present) would be dozens-to-hundreds here — the multi-second "first
		// call" on every cold isolate.
		expect(counter.reads(), 'settled sweep: schema read + index-name read').toBeLessThanOrEqual(4);
	});

	it('a scalar-only projection never reads every collection schema', async () => {
		let schemaFetches = 0;
		const resolver = new RelationResolver(
			new D1Client(env.DB),
			async () => {
				schemaFetches += 1;
				return [];
			},
			() => null,
		);

		// `?fields=id,plate_no` — no relation, no virtual formula. The resolver used
		// to fetch EVERY collection's schema_json before even looking, so this shape
		// (what the miniapp reads everywhere) paid a large cold read for nothing.
		const scalar: FieldDefinition[] = [
			{ name: 'plate_no', type: 'text' },
			{ name: 'brand', type: 'select' },
		];
		await resolver.resolveRelations([], scalar, 'cms_x', 50, parseFieldSelection(['id', 'plate_no', 'brand']));
		expect(schemaFetches, 'scalar-only ⇒ no schema fetch').toBe(0);

		// A relation name in the projection DOES fetch (so the skip is not blanket).
		const withRelation: FieldDefinition[] = [
			{ name: 'plate_no', type: 'text' },
			{ name: 'vehicle', type: 'm2o', related_collection: 'veh_fleets' },
		];
		await resolver.resolveRelations([], withRelation, 'cms_x', 50, parseFieldSelection(['vehicle']));
		expect(schemaFetches, 'a selected relation ⇒ schema fetch').toBe(1);
	});

	it('persists the sweep marker so a settled database can skip the sweep', async () => {
		const counter = countingDb();
		const svc = new SchemaService(new D1Client(counter.db), () => null);
		await svc.ensureMigrations();

		// The done-state lives in `_maintenance`, NOT only in the per-isolate cache —
		// otherwise every cold isolate re-ran the whole sweep. The stored value is a
		// schema fingerprint, so it changes exactly when the collection set does.
		const marker = await env.DB.prepare("SELECT value FROM _maintenance WHERE name = 'index_backfill'").first<{
			value: string;
		}>();
		expect(marker?.value, 'the sweep recorded its done-marker').toBeTruthy();
	});

	it('sweeps in a single-column index for a field the schema marks index:true', async () => {
		const table = 'cms_idx_sweep_probe';
		// A table that predates the flag: the column exists, the index does not —
		// exactly the state of `hrm_employees.etg_id` (261 rows read per /auth/me).
		await env.DB.prepare(
			`CREATE TABLE IF NOT EXISTS "${table}" (id TEXT PRIMARY KEY, etg_id TEXT, deleted_at TEXT, created_at TEXT)`,
		).run();
		await env.DB.prepare(
			`INSERT INTO _entity_schemas (id, name, slug, table_name, schema_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
			.bind(
				crypto.randomUUID(),
				'Idx Sweep Probe',
				'idx_sweep_probe',
				table,
				JSON.stringify({
					fields: [
						{ name: 'id', type: 'uuid' },
						{ name: 'etg_id', type: 'text', index: true },
					],
				}),
				new Date().toISOString(),
				new Date().toISOString(),
			)
			.run();

		// Drop the per-isolate sweep guard so the sweep actually re-runs; the new
		// collection changes the schema fingerprint, so the persisted marker misses.
		cache.clear();
		const counter = countingDb();
		await new SchemaService(new D1Client(counter.db), () => null).ensureMigrations();

		const names = (
			(await env.DB.prepare('SELECT name FROM pragma_index_list(?)').bind(table).all()).results as unknown as {
				name: string;
			}[]
		).map((r) => r.name);
		expect(names, 'the declared index was swept in').toContain(`idx_${table}_etg_id`);
	});
});
