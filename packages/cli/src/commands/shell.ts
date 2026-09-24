import type { Command } from 'commander';
import * as readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import pc from 'picocolors';
import { getApiDir } from '../utils/file.js';
import { baseUrl } from '../utils/api.js';
import fs from 'node:fs';

// ─── SQL keyword set ──────────────────────────────────
const KEYWORDS = new Set([
	'SELECT',
	'FROM',
	'WHERE',
	'INSERT',
	'UPDATE',
	'DELETE',
	'CREATE',
	'ALTER',
	'DROP',
	'INDEX',
	'TABLE',
	'INTO',
	'VALUES',
	'SET',
	'JOIN',
	'LEFT',
	'RIGHT',
	'INNER',
	'ON',
	'GROUP',
	'BY',
	'ORDER',
	'ASC',
	'DESC',
	'LIMIT',
	'OFFSET',
	'AND',
	'OR',
	'NOT',
	'NULL',
	'IS',
	'IN',
	'LIKE',
	'BETWEEN',
	'COUNT',
	'SUM',
	'AVG',
	'MIN',
	'MAX',
	'AS',
	'DISTINCT',
	'UNION',
	'ALL',
	'CASE',
	'WHEN',
	'THEN',
	'ELSE',
	'END',
	'BEGIN',
	'COMMIT',
	'ROLLBACK',
	'PRAGMA',
	'EXPLAIN',
]);

const STRING_COLOR = pc.green;
const NUMBER_COLOR = pc.yellow;
const KEYWORD_COLOR = (s: string) => pc.cyan(pc.bold(s));
const ERROR_COLOR = pc.red;
const META_COLOR = pc.dim;

// ─── Query type detection ─────────────────────────────
function isWriteQuery(sql: string): boolean {
	const trimmed = sql.trim().toUpperCase();
	return (
		trimmed.startsWith('INSERT') ||
		trimmed.startsWith('UPDATE') ||
		trimmed.startsWith('DELETE') ||
		trimmed.startsWith('DROP') ||
		trimmed.startsWith('ALTER') ||
		trimmed.startsWith('CREATE')
	);
}

// ─── Tokenizer / highlighter ──────────────────────────
function highlightSQL(line: string): string {
	const tokens: string[] = [];
	let i = 0;

	while (i < line.length) {
		// Single-quoted string
		if (line[i] === "'") {
			let j = i + 1;
			while (j < line.length) {
				if (line[j] === "'" && line[j + 1] === "'") {
					j += 2;
					continue;
				}
				if (line[j] === "'") {
					j++;
					break;
				}
				j++;
			}
			tokens.push(STRING_COLOR(line.slice(i, j)));
			i = j;
			continue;
		}
		// Number
		if (/\d/.test(line[i]) && (i === 0 || /\s|[(),=<>!+\-*/]/.test(line[i - 1]))) {
			let j = i;
			while (j < line.length && /[\d.]/.test(line[j])) j++;
			tokens.push(NUMBER_COLOR(line.slice(i, j)));
			i = j;
			continue;
		}
		// Word (keyword or identifier)
		if (/[a-zA-Z_]/.test(line[i])) {
			let j = i;
			while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++;
			const word = line.slice(i, j);
			tokens.push(KEYWORDS.has(word.toUpperCase()) ? KEYWORD_COLOR(word) : word);
			i = j;
			continue;
		}
		// Everything else
		tokens.push(line[i]);
		i++;
	}

	return tokens.join('');
}

// ─── Table formatter ──────────────────────────────────
function formatTable(columns: string[], rows: Record<string, unknown>[]): string {
	if (rows.length === 0) return '';

	// Calculate column widths
	const widths: number[] = columns.map((col) => {
		const headerLen = col.length;
		const maxDataLen = rows.reduce((max, row) => {
			const val = String(row[col] ?? 'NULL');
			return Math.max(max, val.length);
		}, 0);
		return Math.max(headerLen, maxDataLen, 4);
	});

	// Separator line
	const sep = '├' + widths.map((w) => '─'.repeat(w + 2)).join('┼') + '┤';
	const topBorder = '┌' + widths.map((w) => '─'.repeat(w + 2)).join('┬') + '┐';
	const bottomBorder = '└' + widths.map((w) => '─'.repeat(w + 2)).join('┴') + '┘';

	const lines: string[] = [];

	// Header
	const headerLine = '│ ' + columns.map((col, i) => pc.bold(col.padEnd(widths[i]))).join(' │ ') + ' │';

	lines.push(topBorder);
	lines.push(headerLine);
	lines.push(sep);

	// Rows
	for (const row of rows) {
		const rowLine =
			'│ ' +
			columns
				.map((col, i) => {
					const val = row[col];
					const str = val === null || val === undefined ? pc.dim('NULL') : String(val);
					return str.padEnd(widths[i]);
				})
				.join(' │ ') +
			' │';
		lines.push(rowLine);
	}

	lines.push(bottomBorder);

	return lines.join('\n');
}

// ─── Query execution via REST API ─────────────────────
async function executeViaApi(
	apiUrl: string,
	authToken: string,
	sql: string,
): Promise<{ columns: string[]; rows: Record<string, unknown>[] } | null> {
	const trimmed = sql.trim();
	const upper = trimmed.toUpperCase();

	// PRAGMA queries — not supported via REST
	if (upper.startsWith('PRAGMA')) return null;

	// .tables — use PRAGMA table_list via d1 fallback
	if (upper === '.TABLES' || trimmed === '.tables') return null;

	// SELECT from cms_entities or specific collection
	const selectMatch = trimmed.match(/^SELECT\s+.+?\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
	if (!selectMatch) return null;

	const tableName = selectMatch[1].toLowerCase();

	// For system tables (sqlite_*, _cf_*), use d1 fallback
	if (tableName.startsWith('sqlite_') || tableName.startsWith('_cf_')) return null;

	// Map table name to collection slug
	let collectionSlug: string;
	if (tableName.startsWith('cms_')) {
		collectionSlug = tableName.slice(4);
	} else {
		collectionSlug = tableName;
	}

	// Build REST API query
	try {
		const params = new URLSearchParams();

		// Parse LIMIT
		const limitMatch = trimmed.match(/LIMIT\s+(\d+)/i);
		if (limitMatch) params.set('limit', limitMatch[1]);

		// Parse ORDER BY
		const orderMatch = trimmed.match(/ORDER\s+BY\s+(\w+)\s*(ASC|DESC)?/i);
		if (orderMatch) {
			const dir = orderMatch[2]?.toUpperCase() === 'DESC' ? '-' : '';
			params.set('sort', `${dir}${orderMatch[1]}`);
		}

		const queryString = params.toString();
		const url = `${apiUrl}/api/entities/${collectionSlug}${queryString ? '?' + queryString : ''}`;

		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${authToken}` },
		});

		if (!res.ok) return null;

		const json = (await res.json()) as { data?: Record<string, unknown>[]; meta?: unknown };
		const data = json.data ?? [];

		if (data.length === 0) return { columns: [], rows: [] };

		const columns = Object.keys(data[0]);
		return { columns, rows: data };
	} catch {
		return null;
	}
}

// ─── Query execution via wrangler d1 ──────────────────
function executeViaWrangler(sql: string, apiDir: string): { columns: string[]; rows: Record<string, unknown>[] } {
	// Args array + no shell: the SQL string can never inject into the command line.
	const result = spawnSync('npx', ['wrangler', 'd1', 'execute', 'headless-db', '--command', sql, '--json'], {
		cwd: apiDir,
		encoding: 'utf-8',
		stdio: ['pipe', 'pipe', 'pipe'],
		timeout: 30000,
	});

	if (result.status !== 0 || !result.stdout) {
		const stderr = (result.stderr ?? '').toString().trim();
		throw new Error(stderr || `wrangler d1 execute failed (exit ${result.status ?? 'signal'})`);
	}

	// wrangler d1 execute --json returns an array of result sets
	const parsed = JSON.parse(result.stdout) as Array<{
		results?: { columns?: string[]; rows?: unknown[][] } | Array<Record<string, unknown>>;
	}>;

	if (!Array.isArray(parsed) || parsed.length === 0) {
		return { columns: [], rows: [] };
	}

	const first = parsed[0];
	if (!first || !first.results) {
		return { columns: [], rows: [] };
	}

	// results can be { columns, rows } or array of objects
	if (Array.isArray(first.results)) {
		const rows = first.results as Record<string, unknown>[];
		const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
		return { columns, rows };
	}

	const res = first.results as { columns?: string[]; rows?: unknown[][] };
	return {
		columns: res.columns ?? [],
		rows: (res.rows ?? []).map((row) => {
			const obj: Record<string, unknown> = {};
			(res.columns ?? []).forEach((col, idx) => {
				obj[col] = row[idx];
			});
			return obj;
		}),
	};
}

// ─── Special command handlers ─────────────────────────
function handleSpecialCommand(cmd: string, apiDir: string, history: string[]): { handled: true; exit?: boolean } | { handled: false } {
	const parts = cmd.trim().split(/\s+/);
	const verb = parts[0].toLowerCase();

	switch (verb) {
		case '.exit':
		case '.quit':
			return { handled: true, exit: true };

		case '.help':
			console.log('');
			console.log(pc.bold('  Special Commands'));
			console.log(pc.dim('  ──────────────────────────────'));
			console.log(`  ${pc.cyan('.tables')}          List all tables`);
			console.log(`  ${pc.cyan('.schema')}          Show CREATE statements for all tables`);
			console.log(`  ${pc.cyan('.schema <table>')} Show CREATE statement for a table`);
			console.log(`  ${pc.cyan('.help')}           Show this help`);
			console.log(`  ${pc.cyan('.exit')} / ${pc.cyan('.quit')}     Exit the shell`);
			console.log(`  ${pc.cyan('.clear')}          Clear the screen`);
			console.log(`  ${pc.cyan('.history')}        Show command history`);
			console.log('');
			console.log(pc.dim('  Tip: Type SQL directly. End with ; or press Enter on an empty'));
			console.log(pc.dim('       line to execute. Ctrl+C cancels the current query.'));
			console.log(`  Tip: Use ${pc.cyan('\\timing')} to toggle query timing display.`);
			console.log('');
			return { handled: true };

		case '.clear':
			console.clear();
			return { handled: true };

		case '.tables':
			try {
				const { rows } = executeViaWrangler(
					"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' ORDER BY name",
					apiDir,
				);
				if (rows.length > 0) {
					console.log('');
					const names = rows.map((r) => String(r.name ?? ''));
					// Display in columns
					const maxLen = Math.max(...names.map((n) => n.length));
					const cols = Math.max(1, Math.floor((process.stdout.columns || 80) / (maxLen + 3)));
					for (let i = 0; i < names.length; i += cols) {
						console.log(
							'  ' +
								names
									.slice(i, i + cols)
									.map((n) => n.padEnd(maxLen + 2))
									.join(''),
						);
					}
					console.log('');
				} else {
					console.log(pc.dim('\n  (no tables)\n'));
				}
			} catch (err) {
				console.error(ERROR_COLOR(`Error: ${err instanceof Error ? err.message : String(err)}`));
			}
			return { handled: true };

		case '.schema': {
			const table = parts[1];
			const query = table
				? `SELECT sql FROM sqlite_master WHERE type='table' AND name='${table.replace(/'/g, "''")}'`
				: "SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL";
			try {
				const { rows } = executeViaWrangler(query, apiDir);
				if (rows.length === 0) {
					console.log(pc.dim(table ? `\n  Table "${table}" not found\n` : '\n  (no tables)\n'));
				} else {
					console.log('');
					for (const row of rows) {
						const sql = String(row.sql ?? '');
						console.log(highlightSQL(sql) + ';');
						console.log('');
					}
				}
			} catch (err) {
				console.error(ERROR_COLOR(`Error: ${err instanceof Error ? err.message : String(err)}`));
			}
			return { handled: true };
		}

		case '.history':
			console.log('');
			if (history.length === 0) {
				console.log(pc.dim('  (no history)'));
			} else {
				history.forEach((h, i) => {
					console.log(pc.dim(`  ${String(i + 1).padStart(3)}  `) + h);
				});
			}
			console.log('');
			return { handled: true };

		default:
			return { handled: false };
	}
}

// ─── Shell state ──────────────────────────────────────
interface ShellState {
	apiUrl: string;
	authToken: string;
	apiDir: string;
	showTiming: boolean;
	history: string[];
}

// ─── Main shell function ──────────────────────────────
export async function startShell(apiUrl: string, authToken: string): Promise<void> {
	const apiDir = getApiDir();

	// Verify apiDir exists
	if (!fs.existsSync(apiDir)) {
		console.error(ERROR_COLOR(`API directory not found: ${apiDir}`));
		console.error(ERROR_COLOR('Make sure you are in the headless monorepo.'));
		process.exit(1);
	}

	const state: ShellState = {
		apiUrl: apiUrl.replace(/\/$/, ''),
		authToken,
		apiDir,
		showTiming: true,
		history: [],
	};

	// ── Welcome banner ────────────────────────────────
	console.log('');
	console.log(pc.cyan(pc.bold('  ⚡ Headless SQL Shell')));
	console.log(pc.dim('  ───────────────────────────────────────────────'));
	console.log(`  API URL  : ${pc.green(state.apiUrl)}`);
	console.log(`  Auth     : ${pc.dim(state.authToken.slice(0, 12) + '...')}`);
	console.log(`  Database : ${pc.yellow('headless-db')} ${pc.dim('(D1 / SQLite)')}`);
	console.log(pc.dim('  ───────────────────────────────────────────────'));
	console.log(`  Type ${pc.cyan('.help')} for commands, ${pc.cyan('.exit')} to quit.`);
	console.log(`  Type SQL directly. End with ${pc.cyan(';')} or empty line to execute.`);
	console.log('');

	// ── Create readline interface ─────────────────────
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: '',
		terminal: true,
	});

	let multilineBuffer: string[] = [];
	const promptStr = () => pc.green(multilineBuffer.length === 0 ? 'headless> ' : '     ...> ');

	// Set initial prompt
	process.stdout.write(promptStr());

	// ── Line handler ──────────────────────────────────
	rl.on('line', async (line: string) => {
		const trimmed = line.trim();

		// Add to history for readline (not empty lines)
		if (trimmed) {
			state.history.push(trimmed);
		}

		// Handle special commands
		if (trimmed.startsWith('.')) {
			// Flush any multiline buffer first
			if (multilineBuffer.length > 0) {
				const fullSQL = multilineBuffer.join('\n');
				multilineBuffer = [];
				await executeQuery(state, fullSQL);
			}

			const result = handleSpecialCommand(trimmed, state.apiDir, state.history);
			if (result.handled) {
				if (result.exit) {
					console.log(pc.dim('\n  Goodbye!\n'));
					rl.close();
					return;
				}
				process.stdout.write(promptStr());
				return;
			}
		}

		// Handle \timing toggle
		if (trimmed === '\\timing') {
			state.showTiming = !state.showTiming;
			console.log(pc.dim(`  Timing display: ${state.showTiming ? pc.green('ON') : pc.red('OFF')}`));
			process.stdout.write(promptStr());
			return;
		}

		// Check for execution triggers:
		// 1. Semicolon at end of line
		// 2. Empty line after content
		const endsWithSemicolon = trimmed.endsWith(';');

		if (trimmed === '') {
			// Empty line — execute buffer if not empty
			if (multilineBuffer.length > 0) {
				const fullSQL = multilineBuffer.join('\n');
				multilineBuffer = [];
				await executeQuery(state, fullSQL);
			}
			process.stdout.write(promptStr());
			return;
		}

		if (endsWithSemicolon) {
			// Semicolon — execute everything including this line
			multilineBuffer.push(trimmed.slice(0, -1).trim()); // strip trailing semicolon
			const fullSQL = multilineBuffer.join('\n');
			multilineBuffer = [];
			await executeQuery(state, fullSQL);
			process.stdout.write(promptStr());
			return;
		}

		// Otherwise, add to multiline buffer
		multilineBuffer.push(trimmed);
		process.stdout.write(pc.green('     ...> '));
	});

	// ── Handle Ctrl+C ─────────────────────────────────
	rl.on('SIGINT', () => {
		if (multilineBuffer.length > 0) {
			// Cancel current query
			console.log(pc.yellow('\n  Query cancelled.\n'));
			multilineBuffer = [];
			process.stdout.write(promptStr());
		} else {
			// No query in progress — offer exit
			console.log(pc.dim('\n  Press .exit or Ctrl+D to quit.\n'));
			process.stdout.write(promptStr());
		}
	});

	// ── Handle close ──────────────────────────────────
	rl.on('close', () => {
		console.log(pc.dim('\n  Goodbye!\n'));
		process.exit(0);
	});
}

// ─── Execute a query ──────────────────────────────────
async function executeQuery(state: ShellState, sql: string): Promise<void> {
	const trimmed = sql.trim();
	if (!trimmed) return;

	// Highlight and echo the query
	console.log('');
	console.log(META_COLOR('  ── Executing ──'));

	// Write query confirmation
	if (isWriteQuery(trimmed)) {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		const answer = await new Promise<string>((resolve) => {
			rl.question(pc.yellow(`  ⚠  Write query detected. Execute? (yes/no): `), resolve);
		});
		rl.close();
		if (answer.trim().toLowerCase() !== 'yes') {
			console.log(pc.dim('  Cancelled.\n'));
			return;
		}
	}

	const startTime = Date.now();

	try {
		// Try REST API first for SELECT queries
		let result: { columns: string[]; rows: Record<string, unknown>[] } | null = null;

		if (!isWriteQuery(trimmed)) {
			result = await executeViaApi(state.apiUrl, state.authToken, trimmed);
		}

		// Fallback to wrangler d1 execute
		if (result === null) {
			result = executeViaWrangler(trimmed, state.apiDir);
		}

		const elapsed = Date.now() - startTime;

		// Display results
		if (result.rows.length === 0) {
			console.log(pc.green('  Query OK'));
			if (state.showTiming) {
				console.log(META_COLOR(`  ${formatTiming(0, elapsed)}`));
			}
			console.log('');
			return;
		}

		// Determine columns
		const columns = result.columns.length > 0 ? result.columns : Object.keys(result.rows[0]);

		// Render table
		console.log(formatTable(columns, result.rows));

		// Timing info
		if (state.showTiming) {
			console.log(META_COLOR(`  ${formatTiming(result.rows.length, elapsed)}`));
		}
		console.log('');
	} catch (err) {
		const elapsed = Date.now() - startTime;
		const message = err instanceof Error ? err.message : String(err);

		console.log(ERROR_COLOR(`  Error: ${message}`));
		if (state.showTiming) {
			console.log(META_COLOR(`  ${formatTiming(0, elapsed)}`));
		}
		console.log('');
	}
}

function formatTiming(rowCount: number, elapsedMs: number): string {
	const timeStr = elapsedMs < 1000 ? `${elapsedMs}ms` : `${(elapsedMs / 1000).toFixed(2)}s`;

	return `Query returned ${pc.yellow(String(rowCount))} row${rowCount === 1 ? '' : 's'} in ${pc.yellow(timeStr)}`;
}

// ─── Register command ─────────────────────────────────
export function registerShellCommand(program: Command): void {
	program
		.command('shell')
		.description('Start an interactive SQL REPL shell')
		.option('-u, --url <url>', 'API base URL (default: from .headlessrc apiUrl, else http://localhost:8788)')
		.option('-t, --token <token>', 'Auth token (dev: dev-token)', 'dev-token')
		.action(async (options: { url?: string; token: string }) => {
			const url = options.url ?? baseUrl();
			await startShell(url, options.token);
		});
}
