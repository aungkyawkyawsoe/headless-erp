/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { D1Client, MigrationRunner } from '@mmbix/core';

/**
 * Unique fields are SOFT-DELETE-AWARE — regression.
 *
 * Uniqueness means "unique among LIVE rows", exactly like every read and the
 * engine's uniqueness pre-check. A full-column unique index (the old inline
 * `UNIQUE` constraint, or an old non-partial `uidx_`) also fired on
 * soft-deleted rows, so a deleted record squatted its identity value forever:
 * re-creating it passed the pre-check and then blew up as a raw D1 error — a
 * 502 AFTER a 400 was the correct answer.
 *
 * The canonical shape is now a single PARTIAL index,
 * `uidx_<table>_<col> ON (<col>) WHERE deleted_at IS NULL`, emitted by the
 * create path, the migrator (in-place + rebuild) and the schema sweep alike.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

type IxRow = { name: string; origin: string; unique: number; partial: number };
type ApiBody = { success?: boolean; error?: string; code?: string; data?: Record<string, unknown> };

async function indexRows(table: string): Promise<IxRow[]> {
	const r = await env.DB.prepare('SELECT name, origin, "unique", "partial" FROM pragma_index_list(?)').bind(table).all();
	return (r.results ?? []) as unknown as IxRow[];
}

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: ApiBody }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init?.headers ?? {}) },
	});
	return { status: res.status, body: ((await res.json().catch(() => null)) ?? {}) as ApiBody };
}

async function createCollection(slug: string, fields: Array<Record<string, unknown>>) {
	const res = await api('/api/collections', {
		method: 'POST',
		body: JSON.stringify({ name: slug, slug, fields }),
	});
	expect(res.status, `create ${slug}`).toBe(201);
}

describe('unique fields are soft-delete-aware', () => {
	// MUST be the first request in this file: the schema sweep is per-isolate and
	// TTL-guarded, so it can only normalize a legacy table while still unarmed.
	it('normalizes a legacy inline UNIQUE constraint into the canonical partial index', async () => {
		const table = 'cms_zz_legacy_uniq';
		// Materialize the engine tables WITHOUT running the schema sweep, so the
		// per-isolate backfill guard stays unarmed for the request below.
		await new MigrationRunner(new D1Client(env.DB)).runPending();
		// A pre-fix table: `code` carries an inline UNIQUE — an origin-'u'
		// constraint-owned auto-index that SQLite cannot drop in place.
		await env.DB.prepare(
			`CREATE TABLE ${table} ("id" TEXT NOT NULL PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "deleted_at" TEXT, "_meta" TEXT, ` +
				'"created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
		).run();
		const schema = JSON.stringify({
			fields: [
				{ name: 'id', type: 'uuid', label: 'ID', required: true },
				{ name: 'code', type: 'text', label: 'Code', required: true, unique: true },
				{ name: 'deleted_at', type: 'timestamp', label: 'Deleted At' },
				{ name: 'created_at', type: 'timestamp', label: 'Created At' },
				{ name: 'updated_at', type: 'timestamp', label: 'Updated At' },
			],
		});
		await env.DB.prepare(
			`INSERT INTO _entity_schemas (id, name, slug, table_name, schema_json, created_at, updated_at) ` +
				`VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		)
			.bind('zz000000-0000-4000-8000-000000000001', 'ZZ Legacy Uniq', 'zz_legacy_uniq', table, schema)
			.run();

		// Any API read runs ensureMigrations() → the sweep.
		const res = await api('/api/collections');
		expect(res.status).toBe(200);

		const rows = await indexRows(table);
		expect(
			rows.find((r) => r.origin === 'u'),
			'inline UNIQUE auto-index is gone',
		).toBeUndefined();
		const uidx = rows.find((r) => r.name === `uidx_${table}_code`);
		expect(uidx?.origin).toBe('c');
		expect(uidx?.partial).toBe(1);
	});

	it('creates the canonical partial index and lets a soft-deleted value be re-created', async () => {
		const slug = 'zz_uniq_soft';
		const table = 'cms_zz_uniq_soft';
		await createCollection(slug, [{ name: 'code', type: 'text', required: true, unique: true }]);

		// Physical shape: one explicit PARTIAL unique index, no inline constraint.
		const rows = await indexRows(table);
		expect(rows.some((r) => r.origin === 'u')).toBe(false);
		const uidx = rows.find((r) => r.name === `uidx_${table}_code`);
		expect(uidx?.origin).toBe('c');
		expect(uidx?.partial).toBe(1);

		const first = await api(`/api/entities/${slug}`, { method: 'POST', body: JSON.stringify({ code: 'AAA' }) });
		expect(first.status).toBe(201);

		// Duplicate against a LIVE row → the engine's pre-check, a clean 400.
		const dup = await api(`/api/entities/${slug}`, { method: 'POST', body: JSON.stringify({ code: 'AAA' }) });
		expect(dup.status).toBe(400);
		expect(dup.body.code).toBe('VALIDATION_ERROR');
		expect(dup.body.error).toContain('AAA');

		// Soft-delete, then re-create the SAME value → allowed (this used to be a 502).
		const id = String(first.body.data?.id);
		const del = await api(`/api/entities/${slug}/${id}`, { method: 'DELETE' });
		expect(del.status).toBe(200);
		const again = await api(`/api/entities/${slug}`, { method: 'POST', body: JSON.stringify({ code: 'AAA' }) });
		expect(again.status, again.body.error).toBe(201);
	});

	it('maps a restore that would duplicate a live value to a 400, never a 502', async () => {
		const slug = 'zz_uniq_restore';
		const table = 'cms_zz_uniq_restore';
		await createCollection(slug, [{ name: 'code', type: 'text', required: true, unique: true }]);

		const first = await api(`/api/entities/${slug}`, { method: 'POST', body: JSON.stringify({ code: 'BBB' }) });
		expect(first.status).toBe(201);
		const id = String(first.body.data?.id);

		// Trash it, then take the value with a new live row (now allowed).
		const del = await api(`/api/entities/${slug}/${id}`, { method: 'DELETE' });
		expect(del.status).toBe(200);
		const replacement = await api(`/api/entities/${slug}`, { method: 'POST', body: JSON.stringify({ code: 'BBB' }) });
		expect(replacement.status).toBe(201);

		// Restore has no uniqueness pre-check, so this is the RAW D1 path — it must
		// surface as a 400 ValidationError, not a 502 Database error.
		const restore = await api(`/api/entities/${slug}/${id}/restore`, { method: 'POST' });
		expect(restore.status, restore.body.error).toBe(400);
		expect(restore.body.code).toBe('VALIDATION_ERROR');
		expect(restore.body.error).toContain('code');

		// The trashed row is untouched.
		const still = await env.DB.prepare(`SELECT deleted_at FROM ${table} WHERE id = ?`).bind(id).first<{ deleted_at: string | null }>();
		expect(still?.deleted_at).not.toBeNull();
	});
});
