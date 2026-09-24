/**
 * GDPR / Account Endpoints
 *
 * GET    /api/me/export → the current user's data (GDPR data-portability):
 *                          their `_users` row (minus password_hash), the audit
 *                          entries they authored (last 500), and owned-record
 *                          counts per collection (`_owner = user.id`, count only,
 *                          capped at 100 collections — no heavy row scans).
 * DELETE /api/me         → erase the account (GDPR right-to-be-forgotten):
 *                          soft-deletes the rows the user owns across collections
 *                          (deleted_at/deleted_by — safe, relations stay intact),
 *                          then hard-deletes their audit entries and the `_users`
 *                          row. Returns { deleted: true, collections: n }.
 *
 *                          The erase honours the collection write locks: a
 *                          `writes.mode: 'service'` / `append_only` collection is
 *                          SKIPPED entirely, and a row frozen by `freeze_when`
 *                          (a posted ledger entry, a confirmed receipt) is left
 *                          intact — the user's own drafts and generic records are
 *                          removed, but erasure is never a backdoor around an
 *                          immutable ledger. Those rows are retained under the
 *                          domain service's own retention rules.
 *
 * Both endpoints require a valid bearer token (requireAuth) — no admin role
 * needed: a user may only export/erase their own data.
 */

import { Hono } from 'hono';
import { D1Client, QueryBuilder, cache } from '@mmbix/core';
import { requireAuth } from './auth';
import { success } from '@/lib/api/response';

const app = new Hono<{
	Bindings: { DB: D1Database };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
}>();
app.use('*', requireAuth);

/** Cap on audit entries returned by the export (most recent first). */
const AUDIT_EXPORT_LIMIT = 500;
/** Cap on collections scanned for owned-record counts / soft-delete. */
const COLLECTION_SCAN_LIMIT = 100;
/** Rows soft-deleted per UPDATE chunk (keeps each D1 call bounded). */
const SOFT_DELETE_CHUNK = 500;
/** Upper bound on chunk iterations per collection. */
const SOFT_DELETE_MAX_ITERS = 200;

interface SchemaRow {
	slug: string;
	table_name: string;
	schema_json: string | null;
}

/** Allow-list table names before interpolating into SQL (defense in depth). */
function sanitizeTableName(name: string): string {
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : '';
}

/** True when the collection is maintained ONLY by its domain service — erasure
 *  must not become a generic-write backdoor around that lock. */
function isEraseExempt(schemaJson: string | null): boolean {
	try {
		const parsed = JSON.parse(schemaJson ?? '{}') as { policies?: { writes?: { mode?: unknown; append_only?: unknown } } };
		const writes = parsed.policies?.writes;
		return writes?.mode === 'service' || writes?.append_only === true;
	} catch {
		return false;
	}
}

/** Extra `WHERE` fragment excluding rows frozen by `writes.freeze_when` (a posted
 *  document must be reversed, never erased). Field/value identifiers are
 *  allow-listed / escaped before interpolation. */
function frozenExclusion(schemaJson: string | null): string {
	try {
		const parsed = JSON.parse(schemaJson ?? '{}') as {
			policies?: { writes?: { freeze_when?: { field?: unknown; values?: unknown } } };
		};
		const freeze = parsed.policies?.writes?.freeze_when;
		const field = typeof freeze?.field === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(freeze.field) ? freeze.field : '';
		const values = Array.isArray(freeze?.values)
			? freeze.values.filter((v): v is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof v))
			: [];
		if (!field || values.length === 0) return '';
		const list = values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(', ');
		return ` AND (${field} IS NULL OR ${field} NOT IN (${list}))`;
	} catch {
		return '';
	}
}

/** List user collection tables (capped) from _entity_schemas. */
async function listCollections(db: D1Client): Promise<SchemaRow[]> {
	return db.all<SchemaRow>(
		QueryBuilder.from('_entity_schemas').select('slug', 'table_name', 'schema_json').limit(COLLECTION_SCAN_LIMIT).toSelect(),
	);
}

// ─── GET /api/me/export ────────────────────────────────

app.get('/export', async (c) => {
	const db = new D1Client(c.env.DB);
	const auth = c.get('auth');

	// 1. Their _users row — every column except password_hash.
	const user = await db.first<Record<string, unknown>>(
		QueryBuilder.raw('SELECT id, email, full_name, role_id, status, last_login, created_at, updated_at FROM _users WHERE id = ?1', [
			auth.user_id,
		]),
	);

	// 2. Audit entries they authored (most recent 500, no snapshot payloads).
	const audit = await db.all<Record<string, unknown>>(
		QueryBuilder.raw(
			'SELECT id, collection_slug, document_id, action, timestamp FROM _audit_log WHERE user_id = ?1 ORDER BY timestamp DESC LIMIT ?2',
			[auth.user_id, AUDIT_EXPORT_LIMIT],
		),
	);

	// 3. Owned-record counts per collection — COUNT only, never row data.
	const ownedRecords: Record<string, number> = {};
	for (const col of await listCollections(db)) {
		const table = sanitizeTableName(col.table_name);
		if (!table) continue;
		try {
			const row = await db.first<{ n: number }>(QueryBuilder.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE _owner = ?1`, [auth.user_id]));
			if (row && row.n > 0) ownedRecords[col.slug] = row.n;
		} catch {
			/* collection may predate the _owner column — skip it */
		}
	}

	return success(c, { user, audit, owned_records: ownedRecords });
});

// ─── DELETE /api/me ────────────────────────────────────

app.delete('/', async (c) => {
	const db = new D1Client(c.env.DB);
	const auth = c.get('auth');
	const userId = auth.user_id;
	const now = new Date().toISOString();

	// 1. Soft-delete owned rows across collections (bounded chunk loop per table).
	//    Locked collections are skipped whole; locked ROWS (freeze_when) are
	//    excluded from the UPDATE — erasure never overrides a write lock.
	let collections = 0;
	for (const col of await listCollections(db)) {
		const table = sanitizeTableName(col.table_name);
		if (!table) continue;
		if (isEraseExempt(col.schema_json)) continue;
		const freeze = frozenExclusion(col.schema_json);
		try {
			let affected = SOFT_DELETE_CHUNK;
			for (let i = 0; i < SOFT_DELETE_MAX_ITERS && affected >= SOFT_DELETE_CHUNK; i++) {
				const res = await db.run(
					QueryBuilder.raw(
						`UPDATE ${table} SET deleted_at = ?1, deleted_by = ?2, updated_at = ?1 WHERE _owner = ?3 AND deleted_at IS NULL${freeze} LIMIT ${SOFT_DELETE_CHUNK}`,
						[now, userId, userId],
					),
				);
				affected = res.meta?.changes ?? 0;
			}
			collections++;
		} catch {
			/* table lacks _owner/deleted_at — skip */
		}
	}

	// 2. Hard-delete their audit trail + the user row (owned rows stay as
	//    soft-deleted so relations/references are not orphaned).
	await db.run(QueryBuilder.raw('DELETE FROM _audit_log WHERE user_id = ?1', [userId]));
	await db.run(QueryBuilder.raw('DELETE FROM _users WHERE id = ?1', [userId]));
	// 🔒 Token revocation: drop the auth snapshot cache so a JWT minted for this
	// account stops verifying IMMEDIATELY instead of riding out the 60s TTL (and
	// never verifies again — the fresh read finds no row).
	cache.delete(`user:${userId}`);

	return success(c, { deleted: true, collections });
});

export { app as meRoutes };
