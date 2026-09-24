/**
 * Scheduled Backup — nightly full DB snapshot to R2, encrypted at rest.
 *
 * Runs on the cron trigger (default 02:00 UTC, see wrangler.jsonc `triggers`).
 * Produces TWO artifacts per run under `backups/<date>/`:
 *
 *   1. `<stamp>.sql.enc`  — encrypted full SQLite dump (CREATE TABLE/INDEX/TRIGGER
 *                           + row INSERTs + FTS5 rebuild). Restore:
 *                             a) decrypt the file (header `v1:base64(iv):base64(tag||ct)`,
 *                                AES-256-GCM with the BACKUP_ENCRYPTION_KEY secret) → `.sql`
 *                             b) npx wrangler d1 import <db> --file <stamp>.sql
 *                            or: sqlite3 <file> < dump.sql
 *   2. `<stamp>.json.enc` — encrypted engine-level snapshot (schemas + ALL tables
 *                           incl. system tables). Restore: decrypt, then `headless db restore`.
 *
 * 🔒 Encryption: AES-256-GCM via WebCrypto (`crypto.subtle`), key = the
 * `BACKUP_ENCRYPTION_KEY` secret (hex 64 chars recommended: `openssl rand -hex 32`;
 * `npx wrangler secret put BACKUP_ENCRYPTION_KEY`). If the secret is missing in
 * production the backup FAILS — plaintext PII (password hashes, _api_keys, audit
 * log) must never land in R2. In dev (IS_DEV=true) a warning is logged and
 * plaintext artifacts are written for local ergonomics.
 *
 * Prunes backups older than BACKUP_RETENTION_DAYS (default 7).
 *
 * Test locally:  npx wrangler dev --test-scheduled --ip 0.0.0.0 --port 8788
 *                curl -X POST "http://localhost:8788/cdn-cgi/local/scheduled"
 */
import { D1Client, QueryBuilder } from '@mmbix/core';
import type { EntitySchema } from '@mmbix/types';

/** Number of days to keep backups (configurable via BACKUP_RETENTION_DAYS). */
const DEFAULT_RETENTION_DAYS = 7;

/** Cap rows dumped per table so a single cron invocation stays within CPU limits. */
const MAX_ROWS_PER_TABLE = 100_000;

// ─── Backup encryption (AES-256-GCM via WebCrypto) ───────
// Artifacts are stored as `<stamp>.sql.enc` / `<stamp>.json.enc`, each prefixed
// with `v1:base64(iv):base64(tag||ciphertext)` so a restore can decrypt them.
const BACKUP_ENC_VERSION = 'v1';
const BACKUP_ENC_IV_LENGTH = 12; // AES-GCM standard nonce size

/**
 * Derive the AES-256-GCM key from the BACKUP_ENCRYPTION_KEY secret.
 * A 64-hex-char secret is used as raw 32-byte key material; any other value
 * (shorter passphrase, base64, …) is SHA-256-hashed into a 32-byte key so the
 * secret still works (hex 64 chars is the recommended, strongest form).
 */
async function getBackupKey(env: Record<string, unknown>): Promise<CryptoKey> {
	const secret = env.BACKUP_ENCRYPTION_KEY as string | undefined;
	if (!secret) throw new Error('BACKUP_ENCRYPTION_KEY secret is not set');
	const keyBytes = /^[0-9a-fA-F]{64}$/.test(secret)
		? new Uint8Array(secret.match(/.{2}/g)!.map((b) => parseInt(b, 16)))
		: new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)));
	return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
}

/** Chunked base64 — safe for multi-MB artifacts (no spread call-stack overflow). */
function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/**
 * Encrypt a plaintext artifact → `v1:base64(iv):base64(tag||ciphertext)`.
 * AES-GCM appends the 16-byte auth tag to the ciphertext, so decrypt =
 * `crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, b64decode(tag||ct))`.
 */
async function encryptArtifact(key: CryptoKey, plaintext: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(BACKUP_ENC_IV_LENGTH));
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
	return `${BACKUP_ENC_VERSION}:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

/**
 * Persist the last-run marker read by /api/health (`_backup_status` table).
 * Single 'latest' row, upserted per run — created lazily on the first run so no
 * migration is needed. Best-effort: a marker write failure must not fail the
 * backup itself.
 */
async function persistBackupStatus(db: D1Client, status: { ok: boolean; truncated: boolean; at: string }): Promise<void> {
	try {
		await db.exec(
			`CREATE TABLE IF NOT EXISTS _backup_status (id TEXT PRIMARY KEY, at TEXT NOT NULL, ok INTEGER NOT NULL, truncated INTEGER NOT NULL DEFAULT 0)`,
		);
		await db.run(
			QueryBuilder.raw(
				`INSERT INTO _backup_status (id, at, ok, truncated) VALUES ('latest', ?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET at = excluded.at, ok = excluded.ok, truncated = excluded.truncated`,
				[status.at, status.ok ? 1 : 0, status.truncated ? 1 : 0],
			),
		);
	} catch (err) {
		console.error('[backup] failed to persist last-run marker:', err instanceof Error ? err.message : String(err));
	}
}

interface BackupResult {
	ok: boolean;
	sqlFile?: string;
	jsonFile?: string;
	tables?: number;
	rows?: number;
	sqlBytes?: number;
	jsonBytes?: number;
	error?: string;
	pruned?: string[];
	/** True when at least one table hit MAX_ROWS_PER_TABLE and was truncated. */
	truncated?: boolean;
	truncatedTables?: string[];
	/** True when artifacts were encrypted with BACKUP_ENCRYPTION_KEY (AES-256-GCM). */
	encrypted?: boolean;
	/** Human-readable warning surfaced in the backup result/response. */
	warning?: string;
}

// ─── SQL escaping helpers ────────────────────────────────

function sqlQuote(value: unknown): string {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
	if (typeof value === 'boolean') return value ? '1' : '0';
	return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlIdent(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

interface MasterEntry {
	name: string;
	type: 'table' | 'index' | 'trigger';
	sql: string | null;
}

/**
 * Run a full backup: schema + ALL tables (system + collections) as SQL dump AND
 * JSON snapshot → R2. Also prunes expired backups. Safe from the `scheduled` handler.
 */
export async function runScheduledBackup(env: Record<string, unknown>): Promise<BackupResult> {
	const db = new D1Client(env.DB as D1Database);
	const bucket = env.BUCKET as R2Bucket;

	if (!bucket) {
		const failure: BackupResult = { ok: false, error: 'R2 bucket binding missing (BUCKET)' };
		console.error('[backup] failed:', failure.error);
		await persistBackupStatus(db, { ok: false, truncated: false, at: new Date().toISOString() });
		return failure;
	}

	// 🔒 Encryption gate — fail closed in production when the secret is missing:
	// the dump contains _users password hashes, _api_keys and _audit_log PII, so
	// plaintext artifacts must never reach R2. Dev (IS_DEV=true) falls back to
	// plaintext with a warning for local ergonomics.
	const isDev = env.IS_DEV === 'true';
	let backupKey: CryptoKey | null = null;
	if (env.BACKUP_ENCRYPTION_KEY) {
		backupKey = await getBackupKey(env);
	} else if (!isDev) {
		const failure: BackupResult = {
			ok: false,
			error:
				'BACKUP_ENCRYPTION_KEY secret is missing — refusing to write unencrypted backups (they contain PII). Set it with: npx wrangler secret put BACKUP_ENCRYPTION_KEY',
		};
		console.error('[backup] failed:', failure.error);
		await persistBackupStatus(db, { ok: false, truncated: false, at: new Date().toISOString() });
		return failure;
	} else {
		console.warn(
			'[backup] WARNING: BACKUP_ENCRYPTION_KEY not set — DEV MODE: storing PLAINTEXT backups. Production requires the secret (backups contain PII).',
		);
	}

	try {
		// 1. Enumerate all objects (tables, indexes, triggers)
		const master = await db.all<MasterEntry>(
			QueryBuilder.raw(
				`SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`,
			),
		);

		const tables = master.filter((m) => m.type === 'table');
		const indexes = master.filter((m) => m.type === 'index' && m.sql);
		const triggers = master.filter((m) => m.type === 'trigger' && m.sql);

		// 2. Build the SQL dump
		const lines: string[] = ['PRAGMA foreign_keys = OFF;', 'BEGIN TRANSACTION;', ''];
		const virtualTables: string[] = [];
		let rows = 0;
		const truncatedTables: string[] = [];
		// The JSON snapshot reuses the rows read for the SQL dump below — the export
		// used to scan EVERY table a SECOND time just to re-serialize the same rows,
		// doubling the nightly `rows_read`.
		const tablesData: Record<string, unknown[]> = {};

		for (const t of tables) {
			if (!t.sql) continue;
			lines.push(t.sql.endsWith(';') ? t.sql : t.sql + ';', '');
			const isVirtual = /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(t.sql);
			if (isVirtual) {
				// External-content FTS5 — data lives in content tables; rebuild later
				virtualTables.push(t.name);
				continue;
			}
			try {
				// Fetch one extra row to detect truncation at MAX_ROWS_PER_TABLE without
				// changing what is backed up (same MAX rows as before).
				const data = await db.all<Record<string, unknown>>(
					QueryBuilder.from(t.name)
						.select('*')
						.limit(MAX_ROWS_PER_TABLE + 1)
						.toSelect(),
				);
				if (data.length > MAX_ROWS_PER_TABLE) {
					data.pop();
					truncatedTables.push(t.name);
				}
				rows += data.length;
				tablesData[t.name] = data;
				for (const row of data) {
					const cols = Object.keys(row);
					const values = cols.map((c) => sqlQuote(row[c])).join(', ');
					lines.push(`INSERT INTO ${sqlIdent(t.name)} (${cols.map(sqlIdent).join(', ')}) VALUES (${values});`);
				}
			} catch {
				/* table may be empty or schema changed — skip data */
			}
		}

		for (const ix of indexes) {
			if (!ix.sql) continue;
			lines.push(ix.sql.endsWith(';') ? ix.sql : ix.sql + ';');
		}
		for (const tr of triggers) {
			if (!tr.sql) continue;
			lines.push(tr.sql.endsWith(';') ? tr.sql : tr.sql + ';');
		}

		// Rebuild external-content FTS5 indexes from their content tables
		for (const v of virtualTables) {
			lines.push(`INSERT INTO ${sqlIdent(v)}(${sqlIdent(v)}) VALUES ('rebuild');`);
		}

		lines.push('', 'COMMIT;');
		const sqlDump = lines.join('\n');

		// 3. JSON snapshot — schemas + ALL tables (incl. system tables). Every table's
		// rows — `_entity_schemas` included — were already read for the SQL dump
		// above (`tablesData`), so nothing is re-scanned here. Sorted by name to keep
		// the snapshot's schema order stable.
		const schemasRaw = ((tablesData['_entity_schemas'] ?? []) as unknown as EntitySchema[]).sort((a, b) =>
			(a.name ?? '') < (b.name ?? '') ? -1 : (a.name ?? '') > (b.name ?? '') ? 1 : 0,
		);

		const date = new Date().toISOString().slice(0, 10);
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const sqlFile = `backups/${date}/${stamp}.sql${backupKey ? '.enc' : ''}`;
		const jsonFile = `backups/${date}/${stamp}.json${backupKey ? '.enc' : ''}`;

		// JSON snapshot — flag truncated tables so restores never silently lose rows
		const jsonPayload = JSON.stringify(
			{
				version: 2,
				exported_at: new Date().toISOString(),
				schemas: schemasRaw,
				collections: Object.fromEntries(
					schemasRaw.filter((s) => s.table_name && tablesData[s.table_name]).map((s) => [s.slug, tablesData[s.table_name]]),
				),
				tables: tablesData, // ALL tables — system + collections
				// ⚠️ Truncation metadata — when present, some tables exceeded
				// MAX_ROWS_PER_TABLE and were capped; restore will be incomplete.
				truncated: truncatedTables.length > 0,
				truncated_tables: truncatedTables,
			},
			null,
			2,
		);

		// 🔒 Encrypt both artifacts (AES-256-GCM) — dev-mode plaintext fallback only.
		const sqlBody = backupKey ? await encryptArtifact(backupKey, sqlDump) : sqlDump;
		const jsonBody = backupKey ? await encryptArtifact(backupKey, jsonPayload) : jsonPayload;

		await bucket.put(sqlFile, sqlBody, { httpMetadata: { contentType: backupKey ? 'application/octet-stream' : 'application/sql' } });
		await bucket.put(jsonFile, jsonBody, { httpMetadata: { contentType: backupKey ? 'application/octet-stream' : 'application/json' } });

		// 4. Prune old backups (older than retention days)
		const retention = Number(env.BACKUP_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - retention);
		const pruned: string[] = [];
		try {
			const listed = await bucket.list({ prefix: 'backups/', delimiter: '/' });
			for (const folder of listed.delimitedPrefixes ?? []) {
				const folderDate = folder.replace(/^backups\//, '').replace(/\/$/, '');
				if (folderDate && folderDate < cutoff.toISOString().slice(0, 10)) {
					const inner = await bucket.list({ prefix: folder });
					for (const obj of inner.objects) {
						await bucket.delete(obj.key);
						pruned.push(obj.key);
					}
				}
			}
		} catch {
			/* pruning is best-effort */
		}

		const truncated = truncatedTables.length > 0;
		const warning = truncated
			? `WARNING: backup truncated — ${truncatedTables.length} table(s) exceeded ${MAX_ROWS_PER_TABLE} rows (${truncatedTables.join(', ')}). Restore will be incomplete.`
			: undefined;
		if (truncated) console.warn(`[backup] ${warning}`);

		const result: BackupResult = {
			ok: true,
			sqlFile,
			jsonFile,
			tables: tables.length,
			rows,
			sqlBytes: sqlDump.length,
			jsonBytes: jsonPayload.length,
			pruned,
			truncated,
			truncatedTables,
			encrypted: backupKey !== null,
			warning,
		};
		await persistBackupStatus(db, { ok: true, truncated, at: new Date().toISOString() });
		return result;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[backup] failed:', message);
		const result: BackupResult = { ok: false, error: message };
		await persistBackupStatus(db, { ok: false, truncated: false, at: new Date().toISOString() });
		return result;
	}
}
