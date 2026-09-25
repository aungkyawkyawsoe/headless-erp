import type { Command } from 'commander';
import { registerCollectionsCommands } from './db/collections.js';
import { registerSnapshotCommands } from './db/snapshot.js';
import { registerBackupCommands } from './db/backup.js';
import { registerMigrationCommands } from './db/migrations.js';
import { registerInspectCommands } from './db/inspect.js';
import { registerSeedCommands } from './db/seed.js';
import { registerShellCommand } from './db/shell.js';
import { registerWatchCommand } from './db/watch.js';
import { registerAdvisorCommands } from './db/advisor.js';
import { registerErDiagramCommands } from './db/er-diagram.js';
import { registerCsvCommands } from './db/csv.js';

// ── Register Subcommands ──────────────────────────────────
//
// `db` is a facade over one module per subcommand family (see ./db/). Each
// module owns its handlers AND its command registration, so a subcommand change
// touches exactly one file. The call order below preserves the historical
// `headless db --help` listing order.

export function registerDbCommands(program: Command): void {
	const db = program.command('db').description('Database operations — schema, data, migrations, backup/restore, diff');

	// ── Collections & Schema ────────────────────────────
	registerCollectionsCommands(db);

	// ── Schema Export / Diff ────────────────────────────
	registerSnapshotCommands(db);

	// ── Backup / Restore ────────────────────────────────
	registerBackupCommands(db);

	// ── Migrations ──────────────────────────────────────
	registerMigrationCommands(db);

	// ── Query & Utilities ───────────────────────────────
	registerInspectCommands(db);

	// ── Seed ────────────────────────────────────────────
	registerSeedCommands(db);

	// ── Shell ───────────────────────────────────────────
	registerShellCommand(db);

	// ── Watch Mode ──────────────────────────────────────
	registerWatchCommand(db);

	// ── Performance Advisor ─────────────────────────────
	registerAdvisorCommands(db);

	// ── ER Diagram ─────────────────────────────────────
	registerErDiagramCommands(db);

	// ── CSV Export / Import ──────────────────────────────
	registerCsvCommands(db);
}
