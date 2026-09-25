import type { Command } from 'commander';
import pc from 'picocolors';
import { printTable, printDetail, getFormatContext } from '../../utils/format.js';
import { apiFetch, wranglerD1, formatRows, type EntityLike } from './shared.js';

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

// ── Register Subcommands ──────────────────────────────────

export function registerInspectCommands(db: Command): void {
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
}
