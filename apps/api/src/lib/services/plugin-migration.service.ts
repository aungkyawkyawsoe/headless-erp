/**
 * Plugin Migration Service
 *
 * Plugins may declare D1 migrations via the `migrations` field on the Plugin
 * interface (see packages/types/src/plugin.ts). These were previously stashed
 * on the registration context but never executed — this service actually runs
 * them, tracking each migration by name in the `_migrations` table (same
 * convention as the core MigrationRunner) so they apply exactly once.
 *
 * Usage: run once per isolate on the first request (cheap — guarded by a
 * global flag and short-circuited once applied). Like the core MigrationRunner,
 * the guard probes `sqlite_master` so a reset/wiped database (tests reset D1
 * per test while the isolate persists) re-runs the pending migrations instead
 * of leaving plugin tables missing.
 */

import { D1Client, invalidateDbLiveness, markDbVerified } from '@mmbix/core';
import type { PluginMigration } from '@mmbix/types/worker';

const GUARD = '__PLUGIN_MIGRATIONS_INIT__';
const GUARD_RUN = '__PLUGIN_MIGRATIONS_RUN__';

// Matches the core MigrationRunner's _migrations DDL (id, name, applied_at)
const ENSURES = `CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, name TEXT, applied_at TEXT DEFAULT CURRENT_TIMESTAMP);`;

// ALTER TABLE ... ADD COLUMN has no IF NOT EXISTS in SQLite. Probe the column
// so a wiped/partially-migrated database re-runs cleanly instead of crashing
// with "duplicate column name" (idempotency under crash-recovery + concurrency).
const ALTER_ADD_COLUMN = /^ALTER\s+TABLE\s+(\S+)\s+ADD\s+COLUMN\s+(\S+)/i;

export class PluginMigrationService {
	constructor(private readonly migrations: PluginMigration[]) {}

	/** Apply any pending plugin migrations. Returns the names that were applied. */
	async runPending(db: D1Client): Promise<string[]> {
		if (this.migrations.length === 0) return [];

		const g = globalThis as unknown as Record<string, boolean | Promise<string[]>>;
		// Serialize concurrent first-request migrations. Hono middleware can fire
		// in parallel (and D1 has no advisory locks); without this, two requests
		// that both pass the guard would re-apply ALTER ADD COLUMN and crash.
		const inflight = g[GUARD_RUN];
		if (typeof inflight === 'object' && inflight !== null) return inflight;
		const run = this.#runPending(db);
		g[GUARD_RUN] = run;
		try {
			return await run;
		} finally {
			delete g[GUARD_RUN];
		}
	}

	async #runPending(db: D1Client): Promise<string[]> {
		const g = globalThis as unknown as Record<string, boolean>;

		// Per-isolate fast path with a DB-reset probe (mirrors the core
		// MigrationRunner): when a marker table is gone the database was wiped
		// (tests reset D1 per test while the isolate persists) — clear the guard so
		// plugin tables are recreated on the fresh DB.
		//
		// The probe reads the marker tables DIRECTLY, not `sqlite_master`. A
		// `SELECT COUNT(*) FROM sqlite_master WHERE name = ?` cannot use an index —
		// sqlite_master has none on `name` — so it scans the whole schema catalogue
		// (106 tables + 407 indexes = 513 rows on the live DB) TWICE, every time the
		// dedupe window lapses. Querying `_migrations`/`_entity_schemas` with
		// `LIMIT 1` is a bounded point read, and a MISSING table raises
		// "no such table" — which is exactly the wiped-database signal.
		if (g[GUARD]) {
			try {
				await db.first<{ m: number | null; e: number | null }>({
					sql: 'SELECT (SELECT 1 FROM _migrations LIMIT 1) AS m, (SELECT 1 FROM _entity_schemas LIMIT 1) AS e',
					bindings: [],
				});
				// Reached only when BOTH marker tables exist (either would have thrown).
				markDbVerified();
				return [];
			} catch {
				// A marker table is missing — wiped (or partially wiped) database.
				// Clear BOTH guards so the plugin AND core migrations re-run.
				g[GUARD] = false;
				invalidateDbLiveness();
			}
		}

		await db.exec(ENSURES);
		const rows = await db.all<{ name: string }>({ sql: 'SELECT name FROM _migrations', bindings: [] });
		const applied = new Set(rows.map((r) => r.name));

		const run: string[] = [];
		for (const migration of this.migrations) {
			if (applied.has(migration.name)) continue;
			for (const stmt of migration.up) {
				const alter = ALTER_ADD_COLUMN.exec(stmt.sql);
				if (alter) {
					const cols = await db.all<{ name: string }>({ sql: `PRAGMA table_info(${alter[1]})`, bindings: [] });
					if (cols.some((c) => c.name === alter[2])) continue; // column already present
				}
				await db.run({ sql: stmt.sql, bindings: stmt.bindings ?? [] });
			}
			await db.run({
				sql: 'INSERT INTO _migrations (id, name) VALUES (?, ?)',
				bindings: [crypto.randomUUID(), migration.name],
			});
			run.push(migration.name);
		}

		g[GUARD] = true;
		if (run.length > 0) console.error(`[plugin-migration] applied: ${run.join(', ')}`);
		return run;
	}
}
