import type { Command } from 'commander';
import pc from 'picocolors';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MIGRATION_NAMES } from '@mmbix/core';
import { getApiDir } from '../utils/file.js';
import { printTable, printDetail, getFormatContext } from '../utils/format.js';
import { guideConfirm, guideSelect, isInteractive } from '../utils/prompt.js';
import { baseUrl, token, isConnectionError } from '../utils/api.js';
import { restoreSchemasIdempotent } from '../utils/restore.js';

// ── Shared types ─────────────────────────────────────────

/** A collection/entity as returned by the API (fields may be nested in schema_json). */
interface EntityLike {
	name?: unknown;
	slug?: unknown;
	table_name?: unknown;
	updated_at?: unknown;
	fields?: unknown;
	schema?: { fields?: unknown };
	schema_json?: { fields?: unknown };
}

/** A field definition inside a schema — untyped JSON, access props via casts. */
interface FieldLike {
	name?: string;
	type?: string;
	foreign_key?: string;
}

/** Shape of a `headless db backup` JSON file. */
interface BackupFile {
	schemas?: Record<string, unknown>[];
	collections?: Record<string, unknown[]>;
	system_tables?: Record<string, unknown[]>;
}

/** Collection shape consumed by the ER-diagram generator. */
interface ErCollectionLike {
	name: string;
	slug: string;
	table_name?: string;
	fields?: Array<{ name: string; type: string; required?: boolean }>;
}

// ── Config ────────────────────────────────────────────────

// Resolve API base from the shared single source of truth (utils/api.ts).
const API_BASE = baseUrl();

async function apiFetch(path: string, init?: RequestInit): Promise<{ success: boolean; data?: unknown; error?: string }> {
	const bearer = await token();
	const resp = await fetch(`${API_BASE}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${bearer}`,
			...(init?.body ? { 'Content-Type': 'application/json' } : {}),
			...(init?.headers as Record<string, string> | undefined),
		},
	});
	const body = (await resp.json().catch(() => ({}))) as { success: boolean; data?: unknown; error?: string };
	if (!resp.ok) {
		throw new Error(`API error ${resp.status}: ${body?.error || resp.statusText}`);
	}
	return body;
}

function wranglerD1(sql: string, remote = false): { results?: Array<{ columns: string[]; rows: unknown[][] }> } | null {
	const args = ['wrangler', 'd1', 'execute', 'DB', '--command', sql, '--json'];
	// Local dev targets the miniflare state that `wrangler dev` uses; pass
	// --remote to run against the deployed D1 database instead.
	if (!remote) args.push('--local');
	const result = spawnSync('npx', args, {
		cwd: getApiDir(),
		encoding: 'utf-8',
		timeout: 15000,
	});
	if (result.error) {
		console.error(pc.yellow('  wrangler not available — some stats may be missing'));
		return null;
	}
	try {
		const parsed = JSON.parse(result.stdout);
		// wrangler d1 execute --json returns an array of statement results:
		//   [{ results: [{col: val, ...}], success, meta }]
		const arr = Array.isArray(parsed) ? parsed : [parsed];
		const normalized = arr
			.filter((stmt: { success?: boolean }) => stmt && stmt.success !== false)
			.map((stmt: { success?: boolean; results?: Record<string, unknown>[] }) => {
				const rowsArr: Record<string, unknown>[] = stmt.results ?? [];
				const columns = rowsArr.length > 0 ? Object.keys(rowsArr[0]) : [];
				const rows = rowsArr.map((r) => columns.map((c) => r[c]));
				return { columns, rows };
			})
			.filter((s) => s.rows.length > 0);
		return normalized.length > 0 ? { results: normalized } : { results: [] };
	} catch {
		return null;
	}
}

function formatRows(columns: string[], rows: unknown[][]): Record<string, unknown>[] {
	return rows.map((row) => {
		const obj: Record<string, unknown> = {};
		columns.forEach((col, i) => {
			obj[col] = row[i];
		});
		return obj;
	});
}

function formatDate(v: unknown): string {
	if (!v) return '-';
	const d = new Date(v as string | number | Date);
	return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 19).replace('T', ' ');
}

// ── listCollections ───────────────────────────────────────

// ── Guided pickers ────────────────────────────────────────

/** Fetch collection slugs (via API) and guide the user to pick one. */
async function pickCollection(message = 'Which collection?'): Promise<string | null> {
	const resp = await apiFetch('/api/collections');
	const collections = (resp.data ?? []) as EntityLike[];
	if (collections.length === 0) {
		console.log(pc.yellow('  No collections found. Create one first: headless collection create <name> --template blog'));
		return null;
	}
	// Non-interactive: pick the first (deterministic), matching the documented CI behavior.
	if (!isInteractive()) {
		return String(collections[0].slug ?? collections[0].name ?? '');
	}
	const picked = await guideSelect(
		message,
		collections.map((c) => ({ value: String(c.slug ?? c.name ?? ''), label: String(c.name ?? c.slug ?? '') })),
	);
	return picked ?? null;
}

/** Guide the user to pick an existing backup file from the current directory. */
async function pickBackupFile(): Promise<string | null> {
	let files: string[];
	try {
		files = fs
			.readdirSync(process.cwd())
			.filter((f) => /^(backup|snapshot)-.*\.json$/.test(f))
			.sort()
			.reverse();
	} catch {
		files = [];
	}

	if (files.length === 0) {
		console.error(pc.red('  No backup files found in the current directory.'));
		console.log(pc.yellow('  Create one first: headless db backup  →   then: headless db restore'));
		return null;
	}
	if (!isInteractive()) {
		return files[0];
	}
	const picked = await guideSelect(
		'Which backup to restore?',
		files.map((f) => ({
			value: f,
			label: f,
			hint: `${(fs.statSync(f).size / 1024).toFixed(0)} KB`,
		})),
	);
	return picked ?? null;
}

async function listCollections(): Promise<void> {
	try {
		const resp = await apiFetch('/api/collections');
		const collections: EntityLike[] = (resp.data ?? []) as EntityLike[];

		if (collections.length === 0) {
			console.log(pc.yellow('No collections found.'));
			return;
		}

		// Try to get row counts via wrangler
		const counts: Record<string, number> = {};
		const wResult = wranglerD1(
			`SELECT table_name, (SELECT COUNT(*) FROM "entities" WHERE "entities".table_name = t.table_name) AS cnt FROM (SELECT table_name FROM _entity_schemas) t`,
		);

		// Fallback: individual COUNT queries
		if (!wResult) {
			for (const col of collections) {
				const table = col.table_name || col.slug;
				const r = wranglerD1(`SELECT COUNT(*) AS cnt FROM "${table}" WHERE deleted_at IS NULL`);
				if (r?.results?.[0]?.rows?.[0]) {
					counts[col.slug as string] = r.results[0].rows[0][0] as number;
				}
			}
		} else if (wResult.results?.[0]?.rows) {
			for (const row of wResult.results[0].rows) {
				// Map table_name back to slug via collections array
				const tableName = row[0] as string;
				const cnt = row[1] as number;
				const col = collections.find((c) => (c.table_name || c.slug) === tableName);
				if (col) counts[col.slug as string] = cnt ?? 0;
			}
		}

		const rows = collections.map((col) => ({
			Name: col.name,
			Slug: col.slug,
			Rows: counts[col.slug as string] !== undefined ? String(counts[col.slug as string]) : '?',
			'Last Updated': formatDate(col.updated_at),
		}));

		printTable(rows, ['Name', 'Slug', 'Rows', 'Last Updated']);
	} catch (err) {
		if (isConnectionError(err)) {
			console.error(pc.red('Cannot connect to the API.'));
			console.log(pc.dim('  Make sure the dev server is running:'));
			console.log(pc.dim('    npx headless dev'));
			console.log(pc.dim(`  Or set MMBIX_API_URL env (default: ${API_BASE})`));
		} else {
			console.error(pc.red(String(err)));
		}
	}
}

// ── showSchema ────────────────────────────────────────────

async function showSchema(slug: string): Promise<void> {
	const ctx = getFormatContext();

	try {
		const resp = await apiFetch(`/api/collections/${slug}`);
		const entity = resp.data as
			{ name: string; slug: string; description?: string; schema_json?: string | Record<string, unknown> } | undefined;

		if (!entity) {
			console.error(pc.red(`Collection not found: ${slug}`));
			process.exitCode = 1;
			return;
		}

		const schema = (typeof entity.schema_json === 'string' ? JSON.parse(entity.schema_json) : entity.schema_json) as
			{ fields?: unknown } | undefined;
		const fields: Array<Record<string, unknown>> = (schema?.fields ?? []) as Array<Record<string, unknown>>;

		if (ctx.json) {
			// JSON mode: output full field array
			console.log(JSON.stringify({ success: true, data: fields }, null, 2));
			return;
		}

		console.log(pc.cyan(`\n◆ Schema: ${entity.name} (${entity.slug})\n`));
		if (entity.description) {
			console.log(pc.dim(`  ${entity.description}\n`));
		}

		const rows = fields.map((f) => {
			const rules: string[] = [];
			if (f.required) rules.push('required');
			if (f.unique) rules.push('unique');
			if (f.min !== undefined) rules.push(`min: ${f.min}`);
			if (f.max !== undefined) rules.push(`max: ${f.max}`);
			if (f.pattern) rules.push(`pattern: ${f.pattern}`);
			if (f.options && Array.isArray(f.options)) {
				rules.push(`options: [${f.options.join(', ')}]`);
			}
			if (f.validation) {
				if (typeof f.validation === 'string') {
					rules.push(f.validation);
				} else if (Array.isArray(f.validation)) {
					rules.push(...f.validation.map((v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))));
				}
			}

			return {
				Field: f.name,
				Type: f.type || '-',
				Required: f.required ? 'yes' : 'no',
				Default: f.default ?? f.dflt ?? '-',
				Validation: rules.length > 0 ? rules.join(', ') : '-',
			};
		});

		printTable(rows, ['Field', 'Type', 'Required', 'Default', 'Validation']);
		console.log('');
		console.log(pc.dim(`  ${fields.length} fields`));
		console.log('');
	} catch (err) {
		if (isConnectionError(err)) {
			console.error(pc.red('Cannot connect to the API.'));
			console.log(pc.dim('  Make sure the dev server is running (npx headless dev)'));
		} else if (err instanceof Error && err.message.includes('404')) {
			console.error(pc.red(`Collection not found: ${slug}`));
		} else {
			console.error(pc.red(String(err)));
		}
		process.exitCode = 1;
	}
}

// ── runQuery ──────────────────────────────────────────────

async function runQuery(sql: string, options: { write?: boolean; remote?: boolean }): Promise<void> {
	const ctx = getFormatContext();
	const upper = sql.trim().toUpperCase();

	// Read-only check
	const isReadOnly =
		upper.startsWith('SELECT') ||
		upper.startsWith('PRAGMA') ||
		upper.startsWith('EXPLAIN') ||
		upper.startsWith('DESCRIBE') ||
		upper.startsWith('SHOW');

	if (!isReadOnly && !options.write) {
		console.error(pc.red('Write operations require --write flag.'));
		console.log(pc.dim('  Add --write to allow INSERT, UPDATE, DELETE, DROP, ALTER, etc.'));
		process.exitCode = 1;
		return;
	}

	if (!isReadOnly && options.write) {
		console.log(pc.yellow('⚠ Write operation — executing:'));
		console.log(pc.dim(`  ${sql}`));
	}

	// Dry-run: preview without executing
	const ctxDryRun = getFormatContext().dryRun;
	if (ctxDryRun) {
		console.log(pc.yellow('\n  ⚡ DRY RUN — no changes will be made'));
		if (isReadOnly) {
			console.log(pc.dim('  Query is read-only — would execute as-is:'));
			console.log(pc.dim(`  ${sql}`));
		} else {
			console.log(pc.dim('  Write operation previewed — nothing executed'));
		}
		console.log('');
		return;
	}

	const result = wranglerD1(sql, options.remote);

	if (!result) {
		console.error(pc.red('Query failed. Ensure wrangler is properly configured.'));
		process.exitCode = 1;
		return;
	}

	if (result.results && result.results.length > 0) {
		for (const r of result.results) {
			if (r.columns && r.rows) {
				const formatted = formatRows(r.columns, r.rows);
				if (ctx.json) {
					console.log(JSON.stringify({ success: true, data: formatted }, null, 2));
				} else {
					printTable(formatted);
				}
			}
		}
	} else {
		console.log(pc.dim('  (query executed, no results)'));
	}
}

// ── showStats ─────────────────────────────────────────────

async function showStats(): Promise<void> {
	const ctx = getFormatContext();

	try {
		// Try to get collections count via API
		const resp = await apiFetch('/api/entities');
		const collections: EntityLike[] = (resp.data ?? []) as EntityLike[];

		// Get DB stats via wrangler
		const pageCountResult = wranglerD1('PRAGMA page_count');
		const pageSizeResult = wranglerD1('PRAGMA page_size');
		const dbstatResult = wranglerD1('SELECT name, pgsize FROM dbstat ORDER BY pgsize DESC LIMIT 20');

		const pageCount = pageCountResult?.results?.[0]?.rows?.[0]?.[0] ?? 0;
		const pageSize = pageSizeResult?.results?.[0]?.rows?.[0]?.[0] ?? 0;
		const dbSizeBytes = Number(pageCount) * Number(pageSize);
		const dbSizeMB = (dbSizeBytes / (1024 * 1024)).toFixed(2);

		if (ctx.json) {
			const stats: Record<string, unknown> = {
				database_size_mb: parseFloat(dbSizeMB),
				database_size_bytes: dbSizeBytes,
				page_count: Number(pageCount),
				page_size: Number(pageSize),
				total_collections: collections.length,
				collection_names: collections.map((c) => c.slug),
			};
			// Add table sizes if available
			if (dbstatResult?.results?.[0]?.rows) {
				const tableSizes: Record<string, number> = {};
				for (const row of dbstatResult.results[0].rows) {
					tableSizes[String(row[0])] = Number(row[1]);
				}
				stats.table_sizes = tableSizes;
			}
			console.log(JSON.stringify({ success: true, data: stats }, null, 2));
			return;
		}

		console.log(pc.cyan('\n◆ Database Statistics\n'));

		const detailData: Record<string, string> = {
			'Database Size': `${dbSizeMB} MB`,
			'Page Count': String(pageCount),
			'Page Size': `${pageSize} bytes`,
			'Total Collections': String(collections.length),
		};
		printDetail(detailData);

		// Table sizes from dbstat
		if (dbstatResult?.results?.[0]?.rows && dbstatResult.results[0].rows.length > 0) {
			console.log('');
			console.log(pc.bold('  Table Sizes (pages):'));
			const tableRows = dbstatResult.results[0].rows
				.filter((row: unknown[]) => !String(row[0]).startsWith('sqlite_') && !String(row[0]).startsWith('_'))
				.slice(0, 15)
				.map((row: unknown[]) => ({
					Table: String(row[0]),
					Pages: String(row[1]),
				}));
			printTable(tableRows, ['Table', 'Pages']);
		}

		console.log('');
	} catch (err) {
		console.error(pc.red(String(err)));
		process.exitCode = 1;
	}
}

// ── seedDemo ──────────────────────────────────────────────

async function seedDemo(): Promise<void> {
	const ctx = getFormatContext();

	if (ctx.dryRun) {
		console.log(pc.yellow('\n  ⚡ DRY RUN — no changes will be made'));
		console.log(pc.dim('  Would call GET /api/seed — this drops all tables and re-runs migrations'));
		console.log(pc.dim('  (the starter template ships with NO demo data — the DB resets to a clean slate)'));
		console.log('');
		return;
	}

	console.log(pc.cyan('\n◆ Resetting database...\n'));

	// Simple spinner using interval
	let dots = 0;
	const spinner = setInterval(() => {
		dots = (dots + 1) % 4;
		process.stdout.write(`\r  ${pc.cyan('⏳')} Resetting${'.'.repeat(dots)}   `);
	}, 300);

	try {
		const resp = await apiFetch('/api/seed');
		clearInterval(spinner);
		process.stdout.write('\r\x1b[K'); // clear line

		if (resp.success) {
			const data = resp.data as { log?: string[]; applied?: number } | undefined;
			console.log(pc.green('✔ Database reset complete (clean slate, no demo data)'));
			console.log('');

			if (data?.log && data.log.length > 0) {
				console.log(pc.bold('  Created:'));
				for (const entry of data.log) {
					console.log(`    ${pc.cyan('•')} ${entry}`);
				}
			}
			if (data?.applied !== undefined) {
				console.log('');
				console.log(pc.dim(`  Total: ${data.applied} items`));
			}
			console.log('');
		} else {
			console.log(pc.red('✖ Seed failed'));
			if (resp.error) console.error(pc.red(`  ${resp.error}`));
			process.exitCode = 1;
		}
	} catch (err) {
		clearInterval(spinner);
		process.stdout.write('\r\x1b[K');
		if (isConnectionError(err)) {
			console.error(pc.red('Cannot connect to the API.'));
			console.log(pc.dim('  Make sure the dev server is running (npx headless dev)'));
		} else {
			console.error(pc.red(String(err)));
		}
		process.exitCode = 1;
	}
}

// ── shell (interactive SQL REPL) ──────────────────────────

async function shell(): Promise<void> {
	console.log(pc.cyan('\n◆ Headless SQL Shell'));
	console.log(pc.dim('  Type SQL statements (end with ;) or .help for commands'));
	console.log(pc.dim('  Press Ctrl+C or type .exit to quit'));
	console.log('');

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: pc.cyan('sql> '),
		historySize: 100,
	});

	let buffer = '';

	rl.prompt();

	rl.on('line', async (line) => {
		const trimmed = line.trim();

		// Dot-commands
		if (trimmed.startsWith('.')) {
			const cmd = trimmed.toLowerCase();

			if (cmd === '.exit' || cmd === '.quit') {
				console.log(pc.dim('\n  Goodbye!'));
				rl.close();
				return;
			}

			if (cmd === '.help') {
				console.log('');
				console.log(pc.bold('  Commands:'));
				console.log(`    ${pc.cyan('.help')}   — Show this help`);
				console.log(`    ${pc.cyan('.tables')} — List all tables`);
				console.log(`    ${pc.cyan('.schema')} — Show schema of a table (e.g. .schema articles)`);
				console.log(`    ${pc.cyan('.exit')}   — Exit the shell`);
				console.log('');
				rl.prompt();
				return;
			}

			if (cmd === '.tables') {
				const result = wranglerD1("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
				if (result?.results?.[0]?.rows) {
					const tables = result.results[0].rows.map((r: unknown[]) => String(r[0]));
					console.log('');
					for (const t of tables) {
						console.log(`  ${pc.cyan('•')} ${t}`);
					}
					console.log('');
				} else {
					console.log(pc.yellow('  No tables found or wrangler unavailable.'));
				}
				rl.prompt();
				return;
			}

			if (cmd.startsWith('.schema')) {
				const tableName = trimmed.slice(8).trim();
				if (!tableName) {
					console.log(pc.yellow('  Usage: .schema <table_name>'));
				} else {
					const result = wranglerD1(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${tableName.replace(/'/g, "''")}'`);
					if (result?.results?.[0]?.rows?.[0]) {
						console.log('');
						console.log(pc.dim(String(result.results[0].rows[0][0])));
						console.log('');
					} else {
						console.log(pc.yellow(`  Table not found: ${tableName}`));
					}
				}
				rl.prompt();
				return;
			}

			console.log(pc.yellow(`  Unknown command: ${trimmed}. Type .help for available commands.`));
			rl.prompt();
			return;
		}

		// Accumulate SQL
		buffer += (buffer ? ' ' : '') + trimmed;

		// Execute when semicolon found
		if (trimmed.endsWith(';') || /;\s*$/.test(buffer)) {
			const sql = buffer.replace(/;\s*$/, '').trim();

			if (sql) {
				const upper = sql.toUpperCase();
				const isReadOnly = upper.startsWith('SELECT') || upper.startsWith('PRAGMA') || upper.startsWith('EXPLAIN');

				// Warn on writes
				if (!isReadOnly) {
					console.log(pc.yellow(`  ⚠ Write operation`));
				}

				const result = wranglerD1(sql);

				if (result?.results) {
					for (const r of result.results) {
						if (r.columns && r.rows) {
							const formatted = formatRows(r.columns, r.rows);
							console.log('');
							printTable(formatted);
							console.log(pc.dim(`  ${r.rows.length} row(s)`));
						}
					}
				}
			}

			buffer = '';
			rl.prompt();
		} else {
			// Continue multiline
			(rl as unknown as { _prompt: string })._prompt = pc.dim(' ...  ');
			rl.prompt();
		}
	});

	rl.on('close', () => {
		console.log('');
		process.exit(0);
	});

	// Restore prompt after each prompt call
	rl.on('SIGINT', () => {
		if (buffer) {
			console.log(pc.dim('\n  (query cancelled)'));
			buffer = '';
			(rl as unknown as { _prompt: string })._prompt = pc.cyan('sql> ');
			rl.prompt();
		} else {
			console.log(pc.dim('\n  Goodbye!'));
			rl.close();
		}
	});
}

// ── Spinner Helper ───────────────────────────────────────

function startSpinner(text: string): ReturnType<typeof setInterval> {
	let dots = 0;
	const spinner = setInterval(() => {
		dots = (dots + 1) % 4;
		process.stdout.write(`\r  ${pc.cyan('⏳')} ${text}${'.'.repeat(dots)}   `);
	}, 300);
	return spinner;
}

function stopSpinner(spinner: ReturnType<typeof setInterval>): void {
	clearInterval(spinner);
	process.stdout.write('\r\x1b[K');
}

function fileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function apiPost(urlPath: string, body?: unknown): Promise<{ success: boolean; data?: unknown; error?: string }> {
	const bearer = await token();
	const resp = await fetch(`${API_BASE}${urlPath}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${bearer}`,
			'Content-Type': 'application/json',
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const respBody = (await resp.json().catch(() => ({}))) as { success: boolean; data?: unknown; error?: string };
	if (!resp.ok) {
		throw new Error(`API error ${resp.status}: ${respBody?.error || resp.statusText}`);
	}
	return respBody;
}

// ── DB Config ────────────────────────────────────────────

// ── backupDb ─────────────────────────────────────────────

/** System tables that hold users/RBAC/audit — snapshotted alongside collections so
 *  a CLI backup no longer silently misses them (restored via the scheduled backup's
 *  SQL dump — see restoreDb). */
const SYSTEM_TABLES = [
	'_users',
	'_roles',
	'_role_permissions',
	'_audit_log',
	'_pages',
	'_webhooks',
	'_idempotency',
	'_entity_schemas',
	'_media',
	'_migrations',
];

/** Cap rows per system table so a single backup stays fast (mirrors the scheduled
 *  backup's per-table bound). */
const SYSTEM_TABLE_MAX_ROWS = 100_000;

async function backupDb(): Promise<string | void> {
	const ctx = getFormatContext();
	const spinner = startSpinner('Exporting database');

	try {
		// 1. Export schemas
		const schemaResp = await apiFetch('/api/export/schema');
		const schemas: Record<string, unknown>[] = (schemaResp.data ?? []) as Record<string, unknown>[];

		// 2. Export each collection's data
		const collections: Record<string, unknown[]> = {};
		let totalRows = 0;

		for (const schema of schemas) {
			const slug = (schema.slug || schema.name) as string;
			try {
				const dataResp = await apiFetch(`/api/export/${slug}`);
				const rows: unknown[] = (dataResp.data ?? []) as unknown[];
				collections[slug] = rows;
				totalRows += rows.length;
			} catch {
				collections[slug] = [];
			}
		}

		// 3. Snapshot system tables (users/RBAC/audit) directly from D1 — the export
		//    API only exposes collection data, so query the system tables via wrangler.
		const systemTables: Record<string, unknown[]> = {};
		let systemRows = 0;
		let wranglerUnavailable = false;
		for (const table of SYSTEM_TABLES) {
			const result = wranglerD1(`SELECT * FROM ${table} LIMIT ${SYSTEM_TABLE_MAX_ROWS}`);
			if (!result) {
				wranglerUnavailable = true;
				systemTables[table] = [];
				continue;
			}
			const stmt = result.results?.[0];
			const rows = stmt ? formatRows(stmt.columns, stmt.rows) : [];
			systemTables[table] = rows;
			systemRows += rows.length;
		}

		// 4. Build backup payload
		const backup = {
			version: '1.0',
			exported_at: new Date().toISOString(),
			schemas,
			collections,
			// System tables (users/roles/permissions/audit/…) — captured so restore no
			// longer loses users/RBAC. Restored via `wrangler d1 import` of the
			// scheduled backup's SQL dump (db restore only restores collections).
			system_tables: systemTables,
			system_table_count: SYSTEM_TABLES.length,
			collection_count: schemas.length,
			total_rows: totalRows,
		};

		// 5. Write to file
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		const filename = `backup-${timestamp}.json`;
		const content = JSON.stringify(backup, null, 2);
		fs.writeFileSync(filename, content, 'utf-8');
		const size = Buffer.byteLength(content);

		stopSpinner(spinner);

		if (wranglerUnavailable) {
			console.log(pc.yellow('  ⚠ System tables NOT snapshotted — wrangler d1 unavailable. This backup is missing users/RBAC/audit.'));
		}

		if (ctx.json) {
			console.log(
				JSON.stringify(
					{
						success: true,
						filename,
						size_bytes: size,
						size: fileSize(size),
						collection_count: schemas.length,
						total_rows: totalRows,
						system_table_count: SYSTEM_TABLES.length,
						system_rows: systemRows,
					},
					null,
					2,
				),
			);
		} else {
			console.log(pc.green('✔ Backup complete!'));
			console.log('');
			console.log(`  ${pc.bold('File:')}      ${filename}`);
			console.log(`  ${pc.bold('Size:')}      ${fileSize(size)}`);
			console.log(`  ${pc.bold('Collections:')} ${schemas.length}`);
			console.log(`  ${pc.bold('Total rows:')} ${totalRows}`);
			console.log(`  ${pc.bold('System tables:')} ${SYSTEM_TABLES.length} (${systemRows} rows — users/RBAC/audit)`);
			console.log('');
		}
		return filename;
	} catch (err) {
		stopSpinner(spinner);
		if (isConnectionError(err)) {
			console.error(pc.red('Cannot connect to the API.'));
			console.log(pc.dim('  Make sure the dev server is running (npx headless dev)'));
		} else {
			console.error(pc.red(String(err)));
		}
		process.exitCode = 1;
	}
}

// ── restoreDb ────────────────────────────────────────────

/**
 * Convert a backup schema entry into a create-collection payload.
 * Backup stores fields inside `schema_json` (string or object) — unwrap into `fields`.
 * The `id` field is auto-added by the API — strip it and other system fields.
 */
function unwrapSchemaForCreate(schema: Record<string, unknown>): Record<string, unknown> {
	const { _schema_version, schema_json, ...meta } = schema;
	let rawFields: unknown[] = [];
	if (typeof schema_json === 'string') {
		try {
			const parsed = JSON.parse(schema_json);
			rawFields = Array.isArray(parsed?.fields) ? parsed.fields : [];
		} catch {
			rawFields = [];
		}
	} else if (schema_json && typeof schema_json === 'object') {
		const parsed = schema_json as Record<string, unknown>;
		rawFields = Array.isArray(parsed.fields) ? (parsed.fields as unknown[]) : [];
	}
	// Strip auto-managed system fields (API adds them) — keep only user-defined fields
	const SYSTEM = new Set([
		'id',
		'_meta',
		'created_at',
		'updated_at',
		'doc_status',
		'display_number',
		'_owner',
		'deleted_at',
		'created_by',
		'updated_by',
		'deleted_by',
	]);
	const fields = (rawFields as Array<Record<string, unknown>>).filter((f) => !SYSTEM.has(f?.name as string));
	return { ...meta, fields };
}

async function restoreDb(file: string, options: { yes?: boolean; dryRun?: boolean }): Promise<void> {
	const ctx = getFormatContext();
	const isDryRun = options.dryRun ?? ctx.dryRun ?? false;

	// Read backup file
	let backup: BackupFile;
	try {
		const content = fs.readFileSync(file, 'utf-8');
		backup = JSON.parse(content);
	} catch {
		console.error(pc.red(`Cannot read backup file: ${file}`));
		process.exitCode = 1;
		return;
	}

	const schemas: Record<string, unknown>[] = backup.schemas ?? [];
	const collections: Record<string, unknown[]> = backup.collections ?? {};
	const collectionSlugs = Object.keys(collections);
	// System tables (users/RBAC/audit) are captured by `db backup` but NOT restored
	// here — this command only recreates collections. See the notice below.
	const systemTables: Record<string, unknown[]> = backup.system_tables ?? {};
	const hasSystemTables = Object.keys(systemTables).length > 0;
	const systemRowsTotal = Object.values(systemTables).reduce((n, rows) => n + rows.length, 0);

	if (!isDryRun && !options.yes) {
		console.error(pc.red('Restore is a destructive operation.'));
		console.log(pc.yellow('  Use --yes to confirm, or --dry-run to preview.'));
		process.exitCode = 1;
		return;
	}

	if (isDryRun) {
		console.log(pc.yellow('\n  ⚡ DRY RUN — no changes will be made\n'));
		console.log(pc.bold('  Would restore:'));
		console.log(`    ${pc.cyan('•')} ${schemas.length} schemas`);
		for (const slug of collectionSlugs) {
			console.log(`    ${pc.cyan('•')} ${slug}: ${collections[slug].length} rows`);
		}
		if (hasSystemTables) {
			console.log(
				`    ${pc.cyan('•')} ${Object.keys(systemTables).length} system tables (${systemRowsTotal} rows) — NOT restored by this command`,
			);
		}
		console.log('');
		return;
	}

	console.log(pc.cyan('\n◆ Restoring database...\n'));

	// 1. Restore schemas first — create only collections that don't already
	//    exist (idempotent + non-destructive). Never deletes an existing
	//    collection: if a create fails (e.g. a field the API rejects) the old
	//    code had already deleted the collection — losing all its data.
	const schemaResult = await restoreSchemasIdempotent(schemas, unwrapSchemaForCreate, {
		exists: async (slug) => {
			try {
				await apiFetch(`/api/entities/detail/${encodeURIComponent(slug)}`);
				return true;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return !(msg.includes('404') || /not found/i.test(msg));
			}
		},
		create: async (payload) => {
			await apiPost('/api/entities', payload);
		},
	});
	const restoredSchemas = schemaResult.created;
	const existedSchemas = schemaResult.kept;
	for (const f of schemaResult.failed) {
		console.log(pc.yellow(`  ⚠ Skipped schema "${f.slug}" (create failed): ${f.error}`));
	}

	// 2. Restore data
	let restoredCollections = 0;
	let totalRestoredRows = 0;

	for (let i = 0; i < collectionSlugs.length; i++) {
		const slug = collectionSlugs[i];
		const rows = collections[slug];

		if (rows.length === 0) {
			restoredCollections++;
			continue;
		}

		try {
			// Import expects { data: rows } — send with on_conflict overwrite for idempotent re-import
			await apiPost(`/api/export/${slug}/import`, { data: rows, on_conflict: 'overwrite' });
			restoredCollections++;
			totalRestoredRows += rows.length;
		} catch (err) {
			console.log(pc.yellow(`  ⚠ Failed to restore "${slug}": ${String(err)}`));
		}

		// Progress indicator
		process.stdout.write(`\r  ${pc.dim(`Restored ${restoredCollections} of ${collectionSlugs.length} collections...`)}`);
	}
	process.stdout.write('\r\x1b[K');

	console.log('');
	console.log(pc.green('✔ Restore complete!'));
	console.log(`  ${pc.bold('Schemas created:')}   ${restoredSchemas}`);
	console.log(`  ${pc.bold('Schemas kept:')}      ${existedSchemas} (already present — not deleted)`);
	console.log(`  ${pc.bold('Collections data:')} ${restoredCollections}/${collectionSlugs.length}`);
	console.log(`  ${pc.bold('Rows:')}             ${totalRestoredRows}`);
	if (hasSystemTables) {
		console.log('');
		console.log(
			pc.yellow(`⚠ ${Object.keys(systemTables).length} system tables (${systemRowsTotal} rows) captured in this backup were NOT restored.`),
		);
		console.log(pc.dim('  db restore only recreates collections. Restore users/RBAC/audit from the'));
		console.log(pc.dim('  scheduled backup SQL dump:  npx wrangler d1 import DB --file backups/<date>/<stamp>.sql'));
	}
	console.log('');
}

// ── downloadBackup ───────────────────────────────────────

async function downloadBackup(): Promise<void> {
	const spinner = startSpinner('Downloading backup');

	try {
		const resp = await apiFetch('/api/export/backup');
		const backup = resp.data ?? resp;

		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		const filename = `backup-${timestamp}.json`;
		const content = JSON.stringify(backup, null, 2);
		fs.writeFileSync(filename, content, 'utf-8');
		const size = Buffer.byteLength(content);

		stopSpinner(spinner);

		console.log(pc.green('✔ Backup downloaded!'));
		console.log('');
		console.log(`  ${pc.bold('File:')} ${filename}`);
		console.log(`  ${pc.bold('Size:')} ${fileSize(size)}`);
		console.log('');
	} catch (err) {
		stopSpinner(spinner);
		if (isConnectionError(err)) {
			console.error(pc.red('Cannot connect to the API.'));
		} else {
			console.error(pc.red(String(err)));
		}
		process.exitCode = 1;
	}
}

// ── Migration helpers ────────────────────────────────────────

/** Query the _migrations table directly via wrangler d1 execute */
function getAppliedMigrationsFromD1(): Array<{ name: string; applied_at: string }> {
	const result = wranglerD1('SELECT name, applied_at FROM _migrations ORDER BY applied_at, id');
	if (!result?.results?.length) return [];
	const first = result.results[0];
	if (!first.rows?.length) return [];
	return first.rows.map((r) => ({ name: String(r[0] ?? ''), applied_at: String(r[1] ?? '-') }));
}

// ── runMigrations ────────────────────────────────────────

async function runMigrations(options: { dryRun?: boolean }): Promise<void> {
	const ctx = getFormatContext();
	const isDryRun = options.dryRun ?? ctx.dryRun ?? false;

	// This project uses code-based migrations (MigrationRunner in packages/core).
	// They auto-run at worker cold start — there is nothing to manually apply.
	const applied = getAppliedMigrationsFromD1();
	const appliedNames = new Set(applied.map((m) => m.name));
	const pending = MIGRATION_NAMES.filter((m) => !appliedNames.has(m));

	if (isDryRun) {
		if (pending.length === 0) {
			console.log(pc.dim('  No pending migrations. All code migrations are applied.'));
		} else {
			console.log(pc.yellow('\n  ⚡ DRY RUN — pending code migrations (auto-run on cold start)\n'));
			for (const name of pending) {
				console.log(pc.dim(`  ── ${name} ──`));
			}
			console.log(pc.yellow(`\n  ${pending.length} pending — they will apply automatically on the next worker cold start\n`));
		}
		return;
	}

	if (pending.length === 0) {
		console.log(pc.green('✔ All migrations are applied.'));
		console.log(pc.dim(`  ${applied.length} code migrations in _migrations table`));
		console.log(pc.dim('  Migrations auto-run on worker cold start — no manual step needed.'));
		return;
	}

	console.log(pc.yellow(`⚠ ${pending.length} migration(s) pending:`));
	for (const name of pending) {
		console.log(pc.dim(`  • ${name}`));
	}
	console.log(pc.dim('  Restart the dev server (or redeploy) to apply them automatically.'));
	console.log(pc.dim('  Or run: npx wrangler dev --local  (cold start applies them)'));
	console.log('');
}

// ── migrationStatus ──────────────────────────────────────

async function migrationStatus(): Promise<void> {
	const ctx = getFormatContext();
	const applied = getAppliedMigrationsFromD1();
	const appliedNames = new Set(applied.map((m) => m.name));
	const pending = MIGRATION_NAMES.filter((m) => !appliedNames.has(m));

	console.log(pc.cyan('\n◆ Migration Status\n'));

	const rows = [
		...applied.map((m) => ({
			Name: m.name,
			'Applied At': m.applied_at === '-' ? '-' : formatDate(m.applied_at),
			Status: 'applied',
		})),
		...pending.map((name) => ({
			Name: name,
			'Applied At': '-',
			Status: 'pending',
		})),
	];

	if (rows.length === 0) {
		console.log(pc.dim('  No migrations recorded yet. Start the dev server once to run them.'));
	} else {
		const tableRows = rows.map((r) => ({
			Name: r.Name,
			'Applied At': r['Applied At'],
			Status: r.Status === 'applied' ? pc.green(r.Status) : pc.yellow(r.Status),
		}));
		if (ctx.json) {
			console.log(JSON.stringify({ success: true, data: rows }, null, 2));
		} else {
			printTable(tableRows, ['Name', 'Applied At', 'Status']);
		}
	}
	console.log('');
}

// ── migrationDryRun ──────────────────────────────────────

async function migrationDryRun(): Promise<void> {
	const applied = getAppliedMigrationsFromD1();
	const appliedNames = new Set(applied.map((m) => m.name));
	const pending = MIGRATION_NAMES.filter((m) => !appliedNames.has(m));

	if (pending.length === 0) {
		console.log(pc.dim('  No pending migrations. All code migrations are applied.'));
		return;
	}

	console.log(pc.cyan('\n◆ Pending Migrations (dry run)\n'));

	for (const name of pending) {
		console.log(pc.bold(`  ── ${name} ──`));
		console.log(pc.dim('  (code migration — defined in packages/core/src/db/migrations.ts)'));
		console.log('');
	}

	console.log(pc.yellow(`  ⚡ ${pending.length} pending code migration(s) — they auto-run on worker cold start`));
	console.log('');
}

// ── rollbackMigration ────────────────────────────────────

/**
 * Snapshot-rollback for the last applied migration.
 *
 * D1/SQLite code-migrations have no per-migration `down`, but there is a real
 * safe undo path that reuses existing machinery: 1) take a fresh `db backup`
 * (the rollback point), 2) `db restore` it. This is the recommended (safe)
 * approach the design chose over authoring ~24 reverse-DDL `down` functions
 * (high data-loss risk on data-shaping migrations).
 */
async function rollbackMigration(options: { yes?: boolean } = {}): Promise<void> {
	const applied = getAppliedMigrationsFromD1();

	if (applied.length === 0) {
		console.log(pc.dim('  No migrations have been applied.'));
		return;
	}

	const last = applied[applied.length - 1];

	console.log(pc.yellow('\n◆ Rollback'));
	console.log(pc.yellow(`  Last migration: ${last.name}`));
	console.log(pc.yellow(`  Applied at:     ${last.applied_at}`));
	console.log('');

	if (!options.yes && isInteractive()) {
		const ok = await guideConfirm('This will take a fresh backup, then restore the DB to that point (destructive). Continue?', false);
		if (!ok) {
			console.log(pc.yellow('  Skipped — no changes made.'));
			return;
		}
	}

	// 1. Take a fresh backup (the rollback point).
	const filename = await backupDb();
	if (!filename) {
		console.error(pc.red('  Backup failed — rollback aborted. Nothing was changed.'));
		process.exitCode = 1;
		return;
	}
	console.log(pc.dim(`  Rollback point saved to: ${filename}`));

	// 2. Restore from that backup (collection+schema state at backup time).
	await restoreDb(filename, { yes: true });

	console.log(pc.dim('  Note: users/RBAC/audit (system tables) are NOT restored by db restore.'));
	console.log(pc.dim('  To fully revert a migration that changed system tables, restore the'));
	console.log(pc.dim('  scheduled backup SQL dump: npx wrangler d1 import DB --file backups/<date>/<stamp>.sql'));
	console.log('');
}

// ── schemaDiff ───────────────────────────────────────────

async function schemaDiff(snapshotFile?: string): Promise<void> {
	const ctx = getFormatContext();

	// Fetch current schema from API
	const spinner = startSpinner('Computing diff');
	let current: Record<string, unknown>;
	try {
		const currentResp = await apiFetch('/api/snapshot/export');
		current = (currentResp.data ?? currentResp) as Record<string, unknown>;
	} catch (err) {
		stopSpinner(spinner);
		if (isConnectionError(err)) {
			console.error(pc.red('Cannot connect to the API.'));
			console.log(pc.dim('  Make sure the dev server is running (npx headless dev)'));
		} else {
			console.error(pc.red(String(err)));
		}
		process.exitCode = 1;
		return;
	}

	// Load snapshot (from file or auto-detect)
	let snapshot: Record<string, unknown>;
	if (snapshotFile) {
		try {
			snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf-8'));
		} catch {
			stopSpinner(spinner);
			console.error(pc.red(`Cannot read snapshot file: ${snapshotFile}`));
			process.exitCode = 1;
			return;
		}
	} else {
		// Auto-detect last saved snapshot in api dir
		const apiDir = getApiDir();
		let snapshotFiles: string[] = [];
		try {
			snapshotFiles = fs
				.readdirSync(apiDir)
				.filter((f) => f.startsWith('snapshot-') && f.endsWith('.json'))
				.sort()
				.reverse();
		} catch {
			/* no files */
		}
		if (snapshotFiles.length > 0) {
			snapshot = JSON.parse(fs.readFileSync(path.join(apiDir, snapshotFiles[0]), 'utf-8'));
		} else {
			stopSpinner(spinner);
			console.error(pc.red('No snapshot file found and no file specified.'));
			console.log(pc.dim('  Run "db schema:export" first to create a snapshot, or specify a file.'));
			process.exitCode = 1;
			return;
		}
	}

	stopSpinner(spinner);

	// Normalize entities from current and snapshot
	const currentEntities: Array<{ name: string; slug: string; fields: unknown[] }> = (
		(current.entities || current.schemas || current.collections || []) as unknown[]
	).map((e) => {
		const ent = e as EntityLike;
		return {
			name: (ent.name || ent.slug || '') as string,
			slug: (ent.slug || ent.name || '') as string,
			fields: (ent.fields || ent.schema?.fields || ent.schema_json?.fields || []) as unknown[],
		};
	});

	const snapshotEntities: Array<{ name: string; slug: string; fields: unknown[] }> = (
		(snapshot.entities || snapshot.schemas || snapshot.collections || []) as unknown[]
	).map((e) => {
		const ent = e as EntityLike;
		return {
			name: (ent.name || ent.slug || '') as string,
			slug: (ent.slug || ent.name || '') as string,
			fields: (ent.fields || ent.schema?.fields || ent.schema_json?.fields || []) as unknown[],
		};
	});

	const currentSlugs = new Set(currentEntities.map((e) => e.slug));
	const snapshotSlugs = new Set(snapshotEntities.map((e) => e.slug));

	const added = currentEntities.filter((e) => !snapshotSlugs.has(e.slug));
	const removed = snapshotEntities.filter((e) => !currentSlugs.has(e.slug));

	// Compute modified (field-level changes)
	const modified: Array<{
		slug: string;
		name: string;
		added: string[];
		removed: string[];
		changed: string[];
	}> = [];

	for (const curr of currentEntities) {
		const snap = snapshotEntities.find((s) => s.slug === curr.slug);
		if (!snap) continue;

		const currFieldNames = new Set((curr.fields || []).map((f) => (f as FieldLike).name));
		const snapFieldNames = new Set((snap.fields || []).map((f) => (f as FieldLike).name));

		const fieldsAdded = (curr.fields || [])
			.filter((f) => !snapFieldNames.has((f as FieldLike).name))
			.map((f) => (f as FieldLike).name as string);

		const fieldsRemoved = (snap.fields || [])
			.filter((f) => !currFieldNames.has((f as FieldLike).name))
			.map((f) => (f as FieldLike).name as string);

		// Fields with same name but different type
		const fieldsChanged: string[] = [];
		for (const cfRaw of curr.fields || []) {
			const cf = cfRaw as FieldLike;
			const sf = (snap.fields || []).find((f) => (f as FieldLike).name === cf.name);
			if (sf && cf.type !== (sf as FieldLike).type) {
				fieldsChanged.push(`${cf.name}: ${(sf as FieldLike).type} → ${cf.type}`);
			}
		}

		if (fieldsAdded.length > 0 || fieldsRemoved.length > 0 || fieldsChanged.length > 0) {
			modified.push({
				slug: curr.slug,
				name: curr.name,
				added: fieldsAdded,
				removed: fieldsRemoved,
				changed: fieldsChanged,
			});
		}
	}

	const hasChanges = added.length > 0 || removed.length > 0 || modified.length > 0;

	if (ctx.json) {
		console.log(
			JSON.stringify(
				{
					has_changes: hasChanges,
					added: added.map((e) => e.slug),
					removed: removed.map((e) => e.slug),
					modified,
				},
				null,
				2,
			),
		);
		return;
	}

	if (!hasChanges) {
		console.log(pc.green('✔ No changes detected — schema is in sync.'));
		console.log('');
		return;
	}

	console.log(pc.cyan('\n◆ Schema Diff\n'));

	// Added collections: green
	if (added.length > 0) {
		console.log(pc.green('  + Added collections:'));
		for (const e of added) {
			console.log(pc.green(`    + ${e.name} (${e.slug})`));
		}
		console.log('');
	}

	// Removed collections: red bold (breaking)
	if (removed.length > 0) {
		console.log(pc.bold(pc.red('  - Removed collections (BREAKING):')));
		for (const e of removed) {
			console.log(pc.bold(pc.red(`    - ${e.name} (${e.slug})`)));
		}
		console.log('');
	}

	// Modified collections: yellow
	if (modified.length > 0) {
		console.log(pc.yellow('  ~ Modified collections:'));
		for (const m of modified) {
			console.log(pc.yellow(`    ~ ${m.name} (${m.slug})`));
			for (const fa of m.added) {
				console.log(pc.green(`      + ${fa}`));
			}
			for (const fr of m.removed) {
				console.log(pc.bold(pc.red(`      - ${fr}`)));
			}
			for (const fc of m.changed) {
				console.log(pc.yellow(`      ~ ${fc}`));
			}
		}
		console.log('');
	}

	console.log(
		pc.dim(
			`  ${currentEntities.length} collections total | ${added.length} added | ${removed.length} removed | ${modified.length} modified`,
		),
	);
	console.log('');
}

// ── exportSchema ─────────────────────────────────────────

async function exportSchema(outputFile?: string): Promise<void> {
	const spinner = startSpinner('Exporting schema');

	try {
		const resp = await apiFetch('/api/snapshot/export');
		const schema = (resp.data ?? resp) as Record<string, unknown>;

		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		const filename = outputFile || `snapshot-${timestamp}.json`;
		const content = JSON.stringify(schema, null, 2);
		fs.writeFileSync(filename, content, 'utf-8');

		const entities = (schema.entities || schema.schemas || schema.collections || []) as unknown[];
		const relations = (schema.relations || []) as unknown[];

		stopSpinner(spinner);

		console.log(pc.green('✔ Schema exported!'));
		console.log('');
		console.log(`  ${pc.bold('File:')}        ${filename}`);
		console.log(`  ${pc.bold('Collections:')} ${entities.length}`);
		console.log(`  ${pc.bold('Relations:')}  ${relations.length}`);
		console.log('');
	} catch (err) {
		stopSpinner(spinner);
		if (isConnectionError(err)) {
			console.error(pc.red('Cannot connect to the API.'));
		} else {
			console.error(pc.red(String(err)));
		}
		process.exitCode = 1;
	}
}

// ── Watch Mode ─────────────────────────────────────────────────

async function watchSchema(options: { snapshot?: string; interval?: string; once?: boolean }): Promise<void> {
	const ctx = getFormatContext();
	const intervalSec = parseInt(options.interval || '10', 10);
	const once = options.once || false;

	// Load snapshot if provided
	let snapshotEntities: Array<{ slug: string; name: string; fields: unknown[] }> = [];
	if (options.snapshot) {
		try {
			const raw = JSON.parse(fs.readFileSync(options.snapshot, 'utf-8'));
			snapshotEntities = (raw.entities || raw.schemas || raw.collections || []).map((e: EntityLike) => ({
				slug: (e.slug || e.name || '') as string,
				name: (e.name || e.slug || '') as string,
				fields: (e.fields || e.schema?.fields || e.schema_json?.fields || []) as unknown[],
			}));
		} catch {
			console.error(pc.red(`Cannot read snapshot file: ${options.snapshot}`));
			process.exit(1);
		}
	}

	// Fetch helper
	const fetchCollections = async (): Promise<Array<{ slug: string; name: string; fields: unknown[] }>> => {
		const resp = await apiFetch('/api/entities');
		const collections: unknown[] = (resp.data ?? []) as unknown[];
		return collections.map((c) => {
			const ent = c as EntityLike;
			return {
				slug: ent.slug as string,
				name: ent.name as string,
				fields: (ent.fields || ent.schema?.fields || ent.schema_json?.fields || []) as unknown[],
			};
		});
	};

	// Diff helper
	const computeDiff = (
		current: Array<{ slug: string; name: string; fields: unknown[] }>,
		snapshot: Array<{ slug: string; name: string; fields: unknown[] }>,
	) => {
		const curSlugs = new Set(current.map((e) => e.slug));
		const snapSlugs = new Set(snapshot.map((e) => e.slug));
		const added = current.filter((e) => !snapSlugs.has(e.slug));
		const removed = snapshot.filter((e) => !curSlugs.has(e.slug));
		const modified: Array<{ slug: string; name: string; added: string[]; removed: string[]; changed: string[] }> = [];
		for (const cur of current) {
			const snap = snapshot.find((s) => s.slug === cur.slug);
			if (!snap) continue;
			const curFields = new Set(cur.fields.map((f) => (f as FieldLike).name));
			const snapFields = new Set(snap.fields.map((f) => (f as FieldLike).name));
			const fa = cur.fields.filter((f) => !snapFields.has((f as FieldLike).name)).map((f) => (f as FieldLike).name as string);
			const fr = snap.fields.filter((f) => !curFields.has((f as FieldLike).name)).map((f) => (f as FieldLike).name as string);
			const fc: string[] = [];
			for (const cfRaw of cur.fields) {
				const cf = cfRaw as FieldLike;
				const sf = snap.fields.find((f) => (f as FieldLike).name === cf.name);
				if (sf && cf.type !== (sf as FieldLike).type) fc.push(`${cf.name}: ${(sf as FieldLike).type} → ${cf.type}`);
			}
			if (fa.length || fr.length || fc.length) modified.push({ slug: cur.slug, name: cur.name, added: fa, removed: fr, changed: fc });
		}
		return { added, removed, modified };
	};

	let previousState = snapshotEntities.length > 0 ? snapshotEntities : await fetchCollections();

	const check = async () => {
		try {
			const current = await fetchCollections();
			const diff = computeDiff(current, previousState);
			const hasChange = diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0;

			const ts = new Date().toLocaleTimeString();

			if (ctx.json) {
				console.log(JSON.stringify({ timestamp: new Date().toISOString(), changed: hasChange, ...diff }, null, 2));
			} else if (hasChange) {
				console.log(pc.yellow(`\n[${ts}] ⚠ Schema drift detected!`));
				for (const a of diff.added) console.log(pc.green(`  + ${a.name} (${a.slug})`));
				for (const r of diff.removed) console.log(pc.bold(pc.red(`  - ${r.name} (${r.slug})`)));
				for (const m of diff.modified) {
					console.log(pc.yellow(`  ~ ${m.name} (${m.slug})`));
					for (const fa of m.added) console.log(pc.green(`    + ${fa}`));
					for (const fr of m.removed) console.log(pc.bold(pc.red(`    - ${fr}`)));
					for (const fc of m.changed) console.log(pc.yellow(`    ~ ${fc}`));
				}
			} else {
				console.log(pc.green(`[${ts}] ✔ In sync — ${current.length} collections`));
			}

			previousState = current;
		} catch (err) {
			if (isConnectionError(err)) {
				console.log(pc.yellow(`[${new Date().toLocaleTimeString()}] ⚠ Connection lost — retrying...`));
			} else {
				console.error(pc.red(`[${new Date().toLocaleTimeString()}] Error: ${String(err)}`));
			}
		}
	};

	// First check
	await check();

	if (once) {
		process.exit(0);
	}

	// Watch loop
	const spinner: ReturnType<typeof setInterval> | null = null;
	console.log(pc.dim(`\nWatching for schema changes every ${intervalSec}s (Ctrl+C to stop)\n`));

	const timer = setInterval(check, intervalSec * 1000);

	const cleanup = () => {
		clearInterval(timer);
		if (spinner) clearInterval(spinner);
		console.log(pc.dim('\nWatch stopped.'));
		process.exit(0);
	};

	process.on('SIGINT', cleanup);
	process.on('SIGTERM', cleanup);
}

// ── Performance Advisor ───────────────────────────────────────

interface AdvisorFinding {
	severity: 'critical' | 'warning' | 'info';
	category: string;
	description: string;
	recommendation: string;
}

async function runAdvisor(options: { json?: boolean; fix?: boolean }): Promise<void> {
	const ctx = getFormatContext();
	const findings: AdvisorFinding[] = [];
	const spinner = startSpinner('Analyzing database');

	// 1. Fetch collections from API
	let collections: EntityLike[] = [];
	try {
		const colResp = await apiFetch('/api/entities');
		collections = (colResp.data ?? []) as EntityLike[];
	} catch (err) {
		stopSpinner(spinner);
		if (isConnectionError(err)) {
			console.error(pc.red('Cannot connect to the API.'));
			console.log(pc.dim('  Make sure the dev server is running (npx headless dev)'));
		} else {
			console.error(pc.red(String(err)));
		}
		process.exitCode = 1;
		return;
	}

	// 2. Get D1 stats via wrangler (batched — minimize spawn overhead)
	let dbSizeBytes = 0;
	let pageCount = 0;
	let pageSize = 4096;
	const tableSizes: Record<string, number> = {};
	const tableIndexes: Record<string, string[]> = {};

	// One call: all table sizes from dbstat
	const sizesResult = wranglerD1('SELECT name, SUM(pgsize) AS size FROM dbstat GROUP BY name ORDER BY size DESC');
	if (sizesResult?.results?.[0]?.rows) {
		for (const row of sizesResult.results[0].rows) {
			tableSizes[String(row[0])] = Number(row[1]);
		}
	}

	// One call: all indexes (name + owning table)
	const idxResult = wranglerD1("SELECT name, tbl_name FROM sqlite_master WHERE type='index'");
	if (idxResult?.results?.[0]?.rows) {
		for (const row of idxResult.results[0].rows) {
			const tbl = String(row[1]);
			const idx = String(row[0]);
			if (!tableIndexes[tbl]) tableIndexes[tbl] = [];
			tableIndexes[tbl].push(idx);
		}
	}

	// One call: page_count + page_size (two statements, batched)
	const dbStats = wranglerD1('PRAGMA page_count; PRAGMA page_size');
	if (dbStats?.results) {
		for (const stmt of dbStats.results) {
			const first = stmt.rows?.[0]?.[0];
			if (first === undefined) continue;
			// PRAGMA page_count returns one row; page_size the same
			if (pageCount === 0) pageCount = Number(first);
			else if (pageSize === 4096) pageSize = Number(first);
		}
	}
	if (pageCount === 0) {
		const pcRes = wranglerD1('PRAGMA page_count');
		pageCount = Number(pcRes?.results?.[0]?.rows?.[0]?.[0]) || 0;
	}
	if (pageSize === 4096) {
		const psRes = wranglerD1('PRAGMA page_size');
		pageSize = Number(psRes?.results?.[0]?.rows?.[0]?.[0]) || 4096;
	}
	dbSizeBytes = pageCount * pageSize;
	const dbSizeMB = Math.round((dbSizeBytes / (1024 * 1024)) * 100) / 100;

	// 3. Analyze each collection
	const D1_COLUMN_LIMIT = 100;
	const D1_SIZE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
	const FTS5_SUFFIXES = ['fts', 'fts_data', 'fts_idx', 'fts_docsize', 'fts_config'];

	// Batch all row counts into a single UNION ALL query
	const countParts: string[] = [];
	const countTables: string[] = [];
	for (const col of collections) {
		const tableName = (col.table_name || col.slug) as string;
		const safe = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
		countParts.push(`SELECT '${safe}' AS tbl, COUNT(*) AS cnt FROM "${safe}"`);
		countTables.push(safe);
	}
	const rowCounts: Record<string, number> = {};
	if (countParts.length > 0) {
		const countsResult = wranglerD1(countParts.join(' UNION ALL '));
		if (countsResult?.results?.[0]?.rows) {
			for (const row of countsResult.results[0].rows) {
				rowCounts[String(row[0])] = Number(row[1]);
			}
		}
	}

	for (const col of collections) {
		const tableName = (col.table_name || col.slug) as string;
		const fields: unknown[] = (col.fields || col.schema?.fields || col.schema_json?.fields || []) as unknown[];
		const userFields = fields.filter(
			(f) =>
				!['id', '_meta', 'doc_status', 'display_number', 'deleted_at', 'created_at', 'updated_at'].includes(
					(f as FieldLike).name as string,
				),
		) as FieldLike[];
		const totalFieldCount = fields.length + 7; // system fields

		// 3a. Column limit check
		if (totalFieldCount >= 90) {
			findings.push({
				severity: totalFieldCount >= 100 ? 'critical' : 'warning',
				category: 'column-limit',
				description: `Table "${tableName}" has ${totalFieldCount} columns (D1 limit: ${D1_COLUMN_LIMIT})`,
				recommendation: 'Consider splitting into multiple collections or using child tables to reduce column count.',
			});
		}

		// 3b. Missing indexes on m2o fields
		const indexes = tableIndexes[tableName] || [];
		const m2oFields = userFields.filter((f) => f.type === 'm2o');
		for (const field of m2oFields) {
			const fkCol = field.foreign_key || `${field.name}_id`;
			const hasIndex = indexes.some((idx) => idx.toLowerCase().includes(fkCol.toLowerCase()));
			if (!hasIndex) {
				findings.push({
					severity: 'warning',
					category: 'missing-index',
					description: `Missing index on foreign key column "${fkCol}" in "${tableName}" (m2o field: ${field.name})`,
					recommendation: `CREATE INDEX idx_${tableName}_${fkCol} ON "${tableName}"("${fkCol}")`,
				});
			}
		}

		// 3c. Large table check (row count from batched UNION ALL query)
		const rowCount = rowCounts[tableName] ?? 0;
		if (rowCount > 100000) {
			findings.push({
				severity: 'warning',
				category: 'large-table',
				description: `Collection "${col.name || col.slug}" has ${rowCount.toLocaleString()} rows — may need archiving`,
				recommendation: `Consider archiving older records or using D1's upcoming read replicas for large datasets.`,
			});
		} else if (rowCount > 50000) {
			findings.push({
				severity: 'info',
				category: 'large-table',
				description: `Collection "${col.name || col.slug}" has ${rowCount.toLocaleString()} rows — monitor growth`,
				recommendation: `Monitor row growth; consider archiving at 100K+ rows.`,
			});
		}

		// 3d. Missing FTS5 indexes for text/searchable fields
		const textFields = userFields.filter((f) => ['text', 'long_text', 'richtext', 'markdown', 'string'].includes(f.type ?? ''));
		if (textFields.length > 0) {
			const hasFts = indexes.some((idx) => FTS5_SUFFIXES.some((suffix) => idx.toLowerCase().endsWith(`_${suffix}`)));
			if (!hasFts) {
				findings.push({
					severity: 'info',
					category: 'missing-fts',
					description: `Table "${tableName}" has ${textFields.length} text field(s) but no FTS5 index`,
					recommendation: `CREATE VIRTUAL TABLE "${tableName}_fts" USING fts5(content, tokenize='porter unicode61')`,
				});
			}
		}

		// 3e. Tables without any indexes (excluding system tables)
		if (!tableName.startsWith('_') && indexes.length === 0 && userFields.length > 0) {
			findings.push({
				severity: 'warning',
				category: 'no-indexes',
				description: `Table "${tableName}" has no indexes — full table scans on all queries`,
				recommendation: 'Add indexes on frequently filtered/sorted columns. At minimum, index `deleted_at` for soft-delete queries.',
			});
		}
	}

	// 4. DB size approaching limit
	if (dbSizeBytes > 8 * 1024 * 1024 * 1024) {
		findings.push({
			severity: 'critical',
			category: 'db-size',
			description: `Database size is ${dbSizeMB.toFixed(0)} MB (D1 limit: ${(D1_SIZE_LIMIT_BYTES / (1024 * 1024 * 1024)).toFixed(0)} GB)`,
			recommendation: 'Reduce data, archive old records, or split across multiple D1 databases.',
		});
	} else if (dbSizeBytes > 5 * 1024 * 1024 * 1024) {
		findings.push({
			severity: 'warning',
			category: 'db-size',
			description: `Database size is ${dbSizeMB.toFixed(0)} MB — approaching D1 limit`,
			recommendation: 'Monitor growth and prepare an archiving strategy before reaching the 10 GB limit.',
		});
	}

	stopSpinner(spinner);

	// Output
	if (options.json || ctx.json) {
		console.log(
			JSON.stringify(
				{ findings, meta: { total_findings: findings.length, db_size_mb: dbSizeMB.toFixed(2), collections_analyzed: collections.length } },
				null,
				2,
			),
		);
		return;
	}

	console.log(pc.cyan('\n◆ Performance Advisor Report\n'));
	console.log(pc.dim(`  Database: ${dbSizeMB.toFixed(1)} MB | Collections: ${collections.length} | Findings: ${findings.length}\n`));

	if (findings.length === 0) {
		console.log(pc.green('  🟢 No issues found — database looks healthy!'));
		console.log('');
		return;
	}

	const bySeverity = {
		critical: findings.filter((f) => f.severity === 'critical'),
		warning: findings.filter((f) => f.severity === 'warning'),
		info: findings.filter((f) => f.severity === 'info'),
	};

	if (bySeverity.critical.length > 0) {
		console.log(pc.bold(pc.red('  🔴 Critical Issues')));
		for (const f of bySeverity.critical) {
			console.log(pc.red(`    [${f.category}] ${f.description}`));
			console.log(pc.dim(`      → ${f.recommendation}`));
		}
		console.log('');
	}

	if (bySeverity.warning.length > 0) {
		console.log(pc.bold(pc.yellow('  🟡 Suggestions')));
		for (const f of bySeverity.warning) {
			console.log(pc.yellow(`    [${f.category}] ${f.description}`));
			console.log(pc.dim(`      → ${f.recommendation}`));
		}
		console.log('');
	}

	if (bySeverity.info.length > 0) {
		console.log(pc.bold(pc.blue('  🔵 Info')));
		for (const f of bySeverity.info) {
			console.log(pc.blue(`    [${f.category}] ${f.description}`));
			console.log(pc.dim(`      → ${f.recommendation}`));
		}
		console.log('');
	}

	// --fix: attempt auto-fix for missing indexes
	if (options.fix) {
		const indexFixes = findings.filter((f) => f.category === 'missing-index');
		if (indexFixes.length > 0) {
			console.log(pc.cyan('  🔧 Auto-fixing missing indexes...\n'));
			for (const f of indexFixes) {
				const sql = f.recommendation;
				if (sql.startsWith('CREATE INDEX')) {
					console.log(pc.dim(`  Running: ${sql}`));
					const result = wranglerD1(sql);
					if (result) {
						console.log(pc.green(`    ✔ Created`));
					} else {
						console.log(pc.red(`    ✖ Failed`));
					}
				}
			}
			console.log('');
		} else {
			console.log(pc.dim('  No auto-fixable issues found.\n'));
		}
	}
}

// ── ER Diagram ────────────────────────────────────────────────

interface ErRelation {
	source: string;
	field: string;
	target: string;
	type: string;
}

function cardinalityMarker(relType: string, isSource: boolean): string {
	// Mermaid ER diagram markers
	// ||--o{ = one-to-many
	// }o--|| = many-to-one
	// ||--|| = one-to-one
	// }o--o{ = many-to-many
	switch (relType) {
		case 'm2o':
			return isSource ? '}o--||' : '||--o{';
		case 'o2m':
			return isSource ? '||--o{' : '}o--||';
		case 'm2m':
			return '}o--o{';
		default:
			return '||--o{';
	}
}

function relationLabel(relType: string): string {
	switch (relType) {
		case 'm2o':
			return '"belongs to"';
		case 'o2m':
			return '"has many"';
		case 'm2m':
			return '"many-to-many"';
		default:
			return '"related"';
	}
}

function mermaidSafeId(s: string): string {
	return s.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '');
}

async function generateErDiagram(options: { output?: string; format?: string; collections?: string }): Promise<void> {
	const outputFormat = options.format || 'mermaid';
	const filterSlugs = options.collections ? options.collections.split(',').map((s) => s.trim()) : [];

	const spinner = startSpinner('Fetching schema');

	let collections: ErCollectionLike[] = [];
	let relations: ErRelation[] = [];

	try {
		const resp = await apiFetch('/api/snapshot/export');
		const data = (resp.data ?? resp) as Record<string, unknown>;
		collections = (data.collections || data.entities || []) as ErCollectionLike[];
		relations = (data.relations || []) as ErRelation[];
	} catch (err) {
		stopSpinner(spinner);
		if (isConnectionError(err)) {
			console.error(pc.red('Cannot connect to the API.'));
			console.log(pc.dim('  Make sure the dev server is running (npx headless dev)'));
		} else {
			console.error(pc.red(String(err)));
		}
		process.exitCode = 1;
		return;
	}

	stopSpinner(spinner);

	// Filter collections if specified
	if (filterSlugs.length > 0) {
		const slugSet = new Set(filterSlugs);
		collections = collections.filter((c) => slugSet.has(c.slug));
		relations = relations.filter((r) => slugSet.has(r.source) && slugSet.has(r.target));
	}

	if (collections.length === 0) {
		console.log(pc.yellow('No collections found.'));
		return;
	}

	const slugSet = new Set(collections.map((c) => c.slug));
	const filteredRelations = relations.filter((r) => slugSet.has(r.source) && slugSet.has(r.target));

	if (outputFormat === 'json') {
		const output: {
			entities: Array<{
				name: string;
				slug: string;
				table_name?: string;
				fields: Array<{ name: string; type: string; required: boolean }>;
			}>;
			relations: ErRelation[];
		} = {
			entities: collections.map((c) => ({
				name: c.name,
				slug: c.slug,
				table_name: c.table_name,
				fields: (c.fields || []).map((f) => ({
					name: f.name,
					type: f.type,
					required: f.required || false,
				})),
			})),
			relations: filteredRelations,
		};
		const jsonOutput = JSON.stringify(output, null, 2);
		if (options.output) {
			fs.writeFileSync(options.output, jsonOutput, 'utf-8');
			console.log(pc.green(`✔ ER diagram (JSON) saved to ${options.output}`));
		} else {
			console.log(jsonOutput);
		}
		return;
	}

	if (outputFormat === 'ascii') {
		const lines: string[] = [];
		lines.push('');
		lines.push(pc.cyan('◆ ER Diagram (ASCII)'));
		lines.push('');

		for (const col of collections) {
			const fields = col.fields || [];
			const maxNameLen = Math.max('Column'.length, ...fields.map((f) => f.name.length));
			const maxTypeLen = Math.max('Type'.length, ...fields.map((f) => f.type.length));
			const totalWidth = maxNameLen + maxTypeLen + 5;

			lines.push(`  ┌${'─'.repeat(totalWidth)}┐`);
			lines.push(`  │ ${pc.bold(col.name.padEnd(totalWidth - 2))} │`);
			lines.push(`  ├${'─'.repeat(maxNameLen + 1)}┬${'─'.repeat(maxTypeLen + 1)}┤`);
			lines.push(`  │ ${'Column'.padEnd(maxNameLen)} │ ${'Type'.padEnd(maxTypeLen)} │`);
			lines.push(`  ├${'─'.repeat(maxNameLen + 1)}┼${'─'.repeat(maxTypeLen + 1)}┤`);
			for (const f of fields) {
				const rq = f.required ? '*' : ' ';
				lines.push(`  │ ${rq}${f.name.padEnd(maxNameLen - 1)} │ ${f.type.padEnd(maxTypeLen)} │`);
			}
			lines.push(`  └${'─'.repeat(maxNameLen + 1)}┴${'─'.repeat(maxTypeLen + 1)}┘`);
			lines.push('');
		}

		if (filteredRelations.length > 0) {
			lines.push(pc.cyan('  Relations:'));
			for (const r of filteredRelations) {
				lines.push(`    ${r.source}.${r.field} → ${r.target}  [${r.type}]`);
			}
			lines.push('');
		}

		const asciiOutput = lines.join('\n');
		if (options.output) {
			// Strip ANSI for file output
			fs.writeFileSync(options.output, asciiOutput.replace(/\x1b\[[0-9;]*m/g, ''), 'utf-8');
			console.log(pc.green(`✔ ER diagram (ASCII) saved to ${options.output}`));
		} else {
			console.log(asciiOutput);
		}
		return;
	}

	// Mermaid format
	const mermaidLines: string[] = [];
	mermaidLines.push('```mermaid');
	mermaidLines.push('erDiagram');

	const drawnRels = new Set<string>();

	for (const r of filteredRelations) {
		const key = [r.source, r.target].sort().join('|');
		if (drawnRels.has(key)) continue;
		drawnRels.add(key);

		const sourceId = mermaidSafeId(r.source);
		const targetId = mermaidSafeId(r.target);
		const marker = cardinalityMarker(r.type, true);
		const label = relationLabel(r.type);
		mermaidLines.push(`  ${sourceId} ${marker} ${targetId} : ${label}`);
	}

	// Definitions for each entity
	for (const col of collections) {
		const id = mermaidSafeId(col.slug);
		const fields = col.fields || [];
		mermaidLines.push(`  ${id} {`);
		for (const f of fields) {
			const type = f.type || 'string';
			mermaidLines.push(`    ${type} ${f.name}${f.required ? ' PK' : ''}`);
		}
		mermaidLines.push(`  }`);
	}

	mermaidLines.push('```');

	const mermaidOutput = mermaidLines.join('\n');

	if (options.output) {
		fs.writeFileSync(options.output, mermaidOutput, 'utf-8');
		console.log(pc.green(`✔ ER diagram saved to ${options.output}`));
		console.log(pc.dim(`  ${collections.length} entities, ${drawnRels.size} relations`));
	} else {
		console.log('');
		console.log(pc.cyan('◆ ER Diagram (Mermaid)'));
		console.log(pc.dim(`  ${collections.length} entities, ${drawnRels.size} relations`));
		console.log('');
		console.log(mermaidOutput);
	}
}

// ── CSV Helpers ────────────────────────────────────────────

/** Split a single CSV line into fields, handling quoted values */
function parseCsvLine(line: string): string[] {
	const fields: string[] = [];
	let current = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			// Handle escaped quote: "" inside a quoted field
			if (inQuotes && line[i + 1] === '"') {
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (ch === ',' && !inQuotes) {
			fields.push(current.trim());
			current = '';
		} else {
			current += ch;
		}
	}
	fields.push(current.trim());
	return fields;
}

/** Parse CSV text into headers + array of records */
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
	const lines = text.trim().split('\n');
	if (lines.length < 2) return { headers: [], rows: [] };

	const headers = parseCsvLine(lines[0]);
	const rows: Record<string, string>[] = [];

	for (let i = 1; i < lines.length; i++) {
		const values = parseCsvLine(lines[i]);
		const record: Record<string, string> = {};
		headers.forEach((h, idx) => {
			if (idx < values.length) record[h] = values[idx];
		});
		rows.push(record);
	}

	return { headers, rows };
}

/** Convert an array of records to CSV string */
function toCsv(records: Record<string, unknown>[]): string {
	if (records.length === 0) return '';

	const headers = Object.keys(records[0]);
	const escapeField = (v: unknown): string => {
		const s = v === null || v === undefined ? '' : String(v);
		if (s.includes(',') || s.includes('\n') || s.includes('"')) {
			return `"${s.replace(/"/g, '""')}"`;
		}
		return s;
	};

	const headerLine = headers.map((h) => escapeField(h)).join(',');
	const dataLines = records.map((row) => headers.map((h) => escapeField(row[h])).join(','));

	return [headerLine, ...dataLines].join('\n') + '\n';
}

async function csvExport(collection: string, options: { output?: string; fields?: string }): Promise<void> {
	const limit = 10000; // high limit — API caps to its own max

	// Build query params
	const params = new URLSearchParams();
	params.set('limit', String(limit));
	if (options.fields) {
		params.set('fields', options.fields);
	}

	const resp = await apiFetch(`/api/export/${collection}?${params.toString()}`);
	const data = (resp.data ?? []) as Record<string, unknown>[];

	if (!Array.isArray(data) || data.length === 0) {
		if (options.output) {
			fs.writeFileSync(options.output, '', 'utf-8');
			console.log(pc.green(`✔ Exported 0 rows to ${options.output}`));
		} else {
			console.log(pc.yellow('No records found.'));
		}
		return;
	}

	const csv = toCsv(data);

	if (options.output) {
		fs.writeFileSync(options.output, csv, 'utf-8');
		console.log(pc.green(`✔ Exported ${data.length} rows to ${options.output}`));
	} else {
		// stdout — output CSV directly
		process.stdout.write(csv);
	}
}

async function csvImport(collection: string, fileOrStdin: string, options: { stdin?: boolean; onConflict?: string }): Promise<void> {
	let csvText: string;

	if (options.stdin) {
		// Read all of stdin synchronously (blocking)
		const chunks: Buffer[] = [];
		// Read from fd 0 without node:fs read overhead
		const fd = 0;
		const bufSize = 64 * 1024;
		while (true) {
			const buf = Buffer.alloc(bufSize);
			try {
				// Use posix read via fs.readSync
				const bytesRead = require('fs').readSync(fd, buf, 0, bufSize, null);
				if (bytesRead === 0) break;
				chunks.push(buf.subarray(0, bytesRead));
			} catch {
				break;
			}
		}
		csvText = Buffer.concat(chunks).toString('utf-8');
	} else {
		const filePath = fileOrStdin;
		if (!fs.existsSync(filePath)) {
			console.error(pc.red(`File not found: ${filePath}`));
			process.exitCode = 1;
			return;
		}
		csvText = fs.readFileSync(filePath, 'utf-8');
	}

	const { rows } = parseCsv(csvText);

	if (rows.length === 0) {
		console.log(pc.yellow('No data rows found in CSV.'));
		return;
	}

	const onConflict = (options.onConflict || 'skip') as 'skip' | 'overwrite' | 'error';
	console.log(pc.cyan(`\n◆ Importing ${rows.length} rows into "${collection}" (on_conflict: ${onConflict})…\n`));

	try {
		const resp = await apiPost(`/api/export/${collection}/import`, {
			data: rows,
			on_conflict: onConflict,
		});

		const result = (resp.data ?? resp) as { imported?: number; skipped?: number; errors?: Array<{ row?: number; error?: string }> };
		const imported = typeof result.imported === 'number' ? result.imported : rows.length;
		const skipped = typeof result.skipped === 'number' ? result.skipped : 0;
		const errors = Array.isArray(result.errors) ? result.errors : [];

		console.log(pc.green(`✔ Import complete!`));
		console.log(`  ${pc.bold('Imported:')} ${imported}`);
		if (skipped > 0) console.log(`  ${pc.bold('Skipped:')}  ${skipped}`);
		if (errors.length > 0) {
			console.log(`  ${pc.bold('Errors:')}   ${errors.length}`);
			for (const e of errors.slice(0, 10)) {
				console.log(pc.yellow(`    Row ${e.row}: ${e.error}`));
			}
		}
		console.log('');
	} catch (err) {
		console.error(pc.red(`Import failed: ${String(err)}`));
		process.exitCode = 1;
	}
}

// ── Register Subcommands ──────────────────────────────────

export function registerDbCommands(program: Command): void {
	const db = program.command('db').description('Database operations — schema, data, migrations, backup/restore, diff');

	// ── Collections & Schema ────────────────────────────

	db.command('collections')
		.description('List all collections with row counts')
		.action(async () => {
			try {
				await listCollections();
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	db.command('schema')
		.description('Show detailed schema for a collection')
		.argument('[slug]', 'Collection slug (omit to pick interactively)')
		.action(async (slug: string) => {
			try {
				const resolved = slug ?? (await pickCollection());
				if (!resolved) return;
				await showSchema(resolved);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	// ── Schema Export / Diff ────────────────────────────

	db.command('schema:export')
		.description('Export current DB schema to a JSON snapshot file')
		.argument('[file]', 'Output filename (default: snapshot-<timestamp>.json)')
		.action(async (file?: string) => {
			try {
				await exportSchema(file);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	db.command('diff')
		.description('Compare current DB schema vs saved snapshot (colored output)')
		.argument('[snapshot-file]', 'Path to snapshot JSON file (auto-detects latest if omitted)')
		.action(async (snapshotFile?: string) => {
			try {
				await schemaDiff(snapshotFile);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	// ── Backup / Restore ────────────────────────────────

	db.command('backup')
		.description('Full database backup (schema + all collections → JSON file)')
		.action(async () => {
			try {
				await backupDb();
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	db.command('backup:download')
		.description('Download backup from API endpoint')
		.action(async () => {
			try {
				await downloadBackup();
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	db.command('restore')
		.description('Restore database from backup file (destructive; [file] omitted → pick from existing backups)')
		.argument('[file]', 'Path to backup JSON file')
		.option('--confirm', 'Confirm destructive restore operation')
		.option('--dry-run', 'Preview what would be restored without executing')
		.action(async (file: string | undefined, options: { confirm?: boolean; dryRun?: boolean }) => {
			try {
				const resolved = file ?? (await pickBackupFile());
				if (!resolved) {
					process.exitCode = 1;
					return;
				}
				// Guided mode: no --confirm and interactive → ask before a destructive restore
				let yes = options.confirm;
				if (!yes && !options.dryRun && isInteractive()) {
					yes = (await guideConfirm(`Restoring ${resolved} is DESTRUCTIVE — continue?`, false)) ?? false;
				}
				await restoreDb(resolved, { yes, dryRun: options.dryRun });
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	// ── Migrations ──────────────────────────────────────

	db.command('migrate')
		.description('Run pending D1 migrations')
		.option('--dry-run', 'Preview migrations without executing')
		.action(async (options: { dryRun?: boolean }) => {
			try {
				if (options.dryRun) {
					await runMigrations(options);
					return;
				}
				// Guided mode: confirm before applying migrations
				if (isInteractive()) {
					const ok = await guideConfirm('Run pending D1 migrations?', true);
					if (ok === false) {
						console.log(pc.dim('  Skipped — no migrations applied.'));
						return;
					}
				}
				await runMigrations(options);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	db.command('migrate:status')
		.description('Show migration status — applied and pending')
		.action(async () => {
			try {
				await migrationStatus();
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	db.command('migrate:dry-run')
		.description('Show SQL for pending migrations without executing')
		.action(async () => {
			try {
				await migrationDryRun();
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	db.command('migrate:rollback')
		.description('Snapshot-rollback the last applied migration (backup + restore the DB to that point)')
		.option('-y, --yes', 'Skip confirmation')
		.action(async (options: { yes?: boolean }) => {
			try {
				await rollbackMigration(options);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	// ── Query & Utilities ───────────────────────────────

	db.command('query')
		.description('Run read-only SQL query (local miniflare DB by default)')
		.argument('<sql>', 'SQL query string')
		.option('--write', 'Allow write operations')
		.option('--remote', 'Run against the deployed (remote) D1 database instead of local')
		.action(async (sql: string, options: { write?: boolean; remote?: boolean }) => {
			try {
				await runQuery(sql, options);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	db.command('stats')
		.description('Database statistics — size, table sizes, index sizes')
		.action(async () => {
			try {
				await showStats();
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	db.command('seed')
		.description('Reset database (⚠ DESTRUCTIVE — wipes all tables and re-migrates)')
		.option('--confirm', 'Confirm destructive seed operation')
		.action(async (options: { confirm?: boolean }) => {
			let ok = options.confirm;
			if (!ok && isInteractive()) {
				ok = (await guideConfirm('Seed drops ALL tables and re-runs migrations — continue?', false)) === true;
			}
			if (!ok) {
				console.error(pc.red('Seed is a DESTRUCTIVE operation — it drops ALL tables and re-runs migrations.'));
				console.log(pc.yellow('  Use --confirm to proceed, or make a backup first: headless db backup'));
				process.exitCode = 1;
				return;
			}
			try {
				await seedDemo();
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	db.command('shell')
		.description('Interactive SQL REPL')
		.action(async () => {
			try {
				await shell();
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	// ── Watch Mode ──────────────────────────────────────

	db.command('watch')
		.description('Watch schema for changes and auto-detect drift')
		.option('--interval <seconds>', 'Polling interval in seconds', '10')
		.option('--snapshot <file>', 'Compare against a specific snapshot file')
		.option('--once', 'Check once and exit (for CI/CD)')
		.action(async (options: { interval?: string; snapshot?: string; once?: boolean }) => {
			try {
				await watchSchema(options);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	// ── Performance Advisor ─────────────────────────────

	db.command('advisor')
		.description('Analyze database for performance issues')
		.option('--json', 'Output findings as JSON')
		.option('--fix', 'Attempt to auto-fix simple issues (e.g. create missing indexes)')
		.action(async (options: { json?: boolean; fix?: boolean }) => {
			try {
				await runAdvisor(options);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	// ── ER Diagram ─────────────────────────────────────

	db.command('er-diagram')
		.description('Generate Mermaid ER diagram from database schema')
		.option('--output <file>', 'Save to file (default: stdout)')
		.option('--format <type>', 'Output format: mermaid, ascii, or json', 'mermaid')
		.option('--collections <slugs>', 'Filter specific collections (comma-separated)')
		.action(async (options: { output?: string; format?: string; collections?: string }) => {
			try {
				await generateErDiagram(options);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	// ── CSV Export / Import ──────────────────────────────

	db.command('export')
		.description('Export a collection as CSV (omit collection to pick interactively)')
		.argument('[collection]', 'Collection slug')
		.option('-o, --output <file>', 'Write to file (default: stdout)')
		.option('--fields <fields>', 'Comma-separated field list')
		.action(async (collection: string | undefined, options: { output?: string; fields?: string }) => {
			try {
				const resolved = collection ?? (await pickCollection());
				if (!resolved) return;
				await csvExport(resolved, options);
			} catch (err) {
				if (isConnectionError(err)) {
					console.error(pc.red('Cannot connect to the API.'));
					console.log(pc.dim('  Make sure the dev server is running:'));
					console.log(pc.dim('    npx headless dev'));
					console.log(pc.dim(`  Or set MMBIX_API_URL env (default: ${API_BASE})`));
				} else {
					console.error(pc.red(String(err)));
				}
				process.exit(1);
			}
		});

	db.command('import')
		.description('Import a CSV file into a collection ([collection] omitted → pick interactively)')
		.argument('[collection]', 'Collection slug')
		.argument('<file>', 'CSV file path (use --stdin for stdin)')
		.option('--stdin', 'Read from stdin instead of file')
		.option('--on-conflict <mode>', 'skip, overwrite, or error', 'skip')
		.action(async (collection: string | undefined, file: string, options: { stdin?: boolean; onConflict?: string }) => {
			try {
				const resolved = collection ?? (await pickCollection());
				if (!resolved) return;
				await csvImport(resolved, file, options);
			} catch (err) {
				if (isConnectionError(err)) {
					console.error(pc.red('Cannot connect to the API.'));
					console.log(pc.dim('  Make sure the dev server is running:'));
					console.log(pc.dim('    npx headless dev'));
					console.log(pc.dim(`  Or set MMBIX_API_URL env (default: ${API_BASE})`));
				} else {
					console.error(pc.red(String(err)));
				}
				process.exit(1);
			}
		});
}
