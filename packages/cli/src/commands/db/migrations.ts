import type { Command } from 'commander';
import pc from 'picocolors';
import { MIGRATION_NAMES } from '@mmbix/core';
import { getFormatContext, printTable } from '../../utils/format.js';
import { guideConfirm, isInteractive } from '../../utils/prompt.js';
import { wranglerD1, formatDate } from './shared.js';
import { backupDb, restoreDb } from './backup.js';

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

// ── Register Subcommands ──────────────────────────────────

export function registerMigrationCommands(db: Command): void {
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
}
