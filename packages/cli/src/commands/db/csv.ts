import type { Command } from 'commander';
import pc from 'picocolors';
import * as fs from 'node:fs';
import { isConnectionError } from '../../utils/api.js';
import { API_BASE, apiFetch, apiPost, pickCollection } from './shared.js';

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

export function registerCsvCommands(db: Command): void {
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
