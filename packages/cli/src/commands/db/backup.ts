import type { Command } from 'commander';
import pc from 'picocolors';
import * as fs from 'node:fs';
import { getFormatContext } from '../../utils/format.js';
import { guideConfirm, guideSelect, isInteractive } from '../../utils/prompt.js';
import { isConnectionError } from '../../utils/api.js';
import { restoreSchemasIdempotent } from '../../utils/restore.js';
import { apiFetch, apiPost, wranglerD1, formatRows, startSpinner, stopSpinner, fileSize } from './shared.js';

/** Shape of a `headless db backup` JSON file. */
interface BackupFile {
	schemas?: Record<string, unknown>[];
	collections?: Record<string, unknown[]>;
	system_tables?: Record<string, unknown[]>;
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

export async function backupDb(): Promise<string | void> {
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

export async function restoreDb(file: string, options: { yes?: boolean; dryRun?: boolean }): Promise<void> {
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

// ── Register Subcommands ──────────────────────────────────

export function registerBackupCommands(db: Command): void {
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
}
