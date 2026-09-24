/**
 * Scheduled Maintenance — retention + cleanup tasks that run on the cron
 * trigger alongside the nightly backup (see the `scheduled` handler in
 * src/index.ts).
 *
 * Audit-log retention: `_audit_log` grows unbounded with every create/update/
 * delete. This prunes rows older than AUDIT_RETENTION_DAYS (default 180) in
 * bounded chunks so a single cron invocation stays within D1/CPU limits.
 */

import { D1Client, QueryBuilder } from '@mmbix/core';

/** Default age cutoff for audit entries (configurable via AUDIT_RETENTION_DAYS). */
const DEFAULT_AUDIT_RETENTION_DAYS = 180;

/** Rows deleted per statement — keeps each D1 call small. */
const DELETE_CHUNK = 500;

/** Upper bound on total rows pruned per run (protects cron CPU budget). */
const MAX_TOTAL_DELETES = 50_000;

/**
 * Prune audit log rows older than AUDIT_RETENTION_DAYS.
 *
 * @returns number of rows deleted, 0 when there is nothing to prune
 */
export async function runAuditRetention(env: Record<string, unknown>): Promise<number> {
	const db = new D1Client(env.DB as D1Database);
	const days = Number(env.AUDIT_RETENTION_DAYS) || DEFAULT_AUDIT_RETENTION_DAYS;
	const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

	// A cron tick can land before the first request runs core migrations — skip
	// gracefully (and no-op) when the audit table doesn't exist yet. Probing the
	// table directly (a `LIMIT 1` point read) beats `SELECT … FROM sqlite_master`,
	// which cannot use an index and scans the whole schema catalogue.
	try {
		await db.first(QueryBuilder.raw('SELECT 1 FROM _audit_log LIMIT 1'));
	} catch {
		return 0;
	}

	let total = 0;
	// Chunked delete loop: DELETE ... LIMIT until a chunk comes back short or the
	// per-run cap is hit. `idx_audit_timestamp` keeps the scans cheap.
	for (let i = 0; i < MAX_TOTAL_DELETES / DELETE_CHUNK; i++) {
		const res = await db.run(QueryBuilder.raw('DELETE FROM _audit_log WHERE timestamp < ?1 LIMIT ?2', [cutoff, DELETE_CHUNK]));
		const affected = res.meta?.changes ?? 0;
		total += affected;
		if (affected < DELETE_CHUNK) break;
	}
	return total;
}
