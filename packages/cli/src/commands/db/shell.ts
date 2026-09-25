import type { Command } from 'commander';
import pc from 'picocolors';
import { createInterface } from 'node:readline';
import { printTable } from '../../utils/format.js';
import { wranglerD1, formatRows } from './shared.js';

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

// ── Register Subcommands ──────────────────────────────────

export function registerShellCommand(db: Command): void {
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
}
