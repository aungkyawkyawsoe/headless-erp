import type { Command } from 'commander';
import pc from 'picocolors';
import { getFormatContext } from '../../utils/format.js';
import { isConnectionError } from '../../utils/api.js';
import { apiFetch, wranglerD1, startSpinner, stopSpinner, type EntityLike, type FieldLike } from './shared.js';

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

// ── Register Subcommands ──────────────────────────────────

export function registerAdvisorCommands(db: Command): void {
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
}
