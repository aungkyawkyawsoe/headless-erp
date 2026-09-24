import type { Command } from 'commander';
import pc from 'picocolors';
import { token, baseUrl } from '../utils/api.js';
import * as fs from 'node:fs';

// Base URL + token come from the shared single source of truth (utils/api.ts).
const API_BASE = baseUrl();

type TranslationMap = Record<string, Record<string, Record<string, string>>>;

interface ApiResult<T = unknown> {
	success?: boolean;
	data?: T;
	error?: string;
	translations?: TranslationMap;
}

interface EntitySummary {
	slug: string;
	name?: string;
}

interface SchemaField {
	name?: string;
	hidden?: boolean;
	label?: string;
	type?: string;
	options?: Array<string | { label?: string; value?: string }>;
}

interface EntityDetail {
	schema_json?: string | { fields?: SchemaField[] };
}

interface ImportResult {
	imported?: number;
	skipped?: number;
}

interface BuildResult {
	languages_built?: number;
}

interface TranslationsData {
	translations?: TranslationMap;
}

async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
	const bearer = await token();
	const resp = await fetch(`${API_BASE}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${bearer}`,
			'Content-Type': 'application/json',
			...(init?.headers as Record<string, string> | undefined),
		},
	});
	const body = await resp.json().catch(() => ({}) as Record<string, unknown>);
	if (!resp.ok) throw new Error(`API error ${resp.status}: ${(body as { error?: string })?.error || resp.statusText}`);
	return body as ApiResult<T>;
}

// ─── translate scan ────────────────────────────────────────
async function translateScan(options: { module?: string; lang?: string }) {
	const lang = options.lang || 'en';
	console.log(pc.cyan('\n◆ Scanning translatable strings\n'));

	// Fetch all entity schemas
	const entities = await apiFetch<EntitySummary[]>('/api/collections?limit=200');
	if (!entities.success) {
		console.error(pc.red('Failed to fetch entities'));
		process.exit(1);
	}

	const allRows: Array<Record<string, string>> = [];
	let scanned = 0;

	for (const entity of entities.data || []) {
		const slug = entity.slug;
		if (options.module && slug === options.module) continue;
		const detail = await apiFetch<EntityDetail>(`/api/collections/${slug}`);
		if (!detail.success) continue;

		const raw = detail.data?.schema_json;
		const schema = typeof raw === 'string' ? (JSON.parse(raw) as { fields?: SchemaField[] }) : raw;
		const fields = schema?.fields || [];

		// Entity label
		const entityLabel = entity.name || slug;
		allRows.push({
			module_id: options.module || slug.split('_')[0] || 'core',
			language: lang,
			key: entityLabel,
			value: '',
			context: 'entity_label',
			collection: slug,
		});

		// Field labels
		for (const f of fields) {
			if (!f.name || f.name.startsWith('_') || f.hidden) continue;
			const label = f.label || f.name.replace(/_/g, ' ');
			allRows.push({
				module_id: options.module || slug.split('_')[0] || 'core',
				language: lang,
				key: label,
				value: '',
				context: 'field_label',
				collection: slug,
				field: f.name,
			});

			// Select options
			if (f.type === 'select' && Array.isArray(f.options)) {
				for (const opt of f.options) {
					const optLabel = typeof opt === 'string' ? opt : opt.label || opt.value || '';
					allRows.push({
						module_id: options.module || slug.split('_')[0] || 'core',
						language: lang,
						key: optLabel,
						value: '',
						context: 'field_option',
						collection: slug,
						field: f.name,
					});
				}
			}
		}
		scanned++;
	}

	// Import scan results (only new keys will be inserted)
	if (allRows.length > 0) {
		const result = await apiFetch<ImportResult>('/api/translations/import', {
			method: 'POST',
			body: JSON.stringify({ data: allRows, overwrite: false }),
		});
		if (result.success) {
			const d: ImportResult = result.data || {};
			console.log(pc.green(`✓ Scanned ${scanned} entities`));
			console.log(`  Found ${allRows.length} translatable keys`);
			console.log(`  New: ${d.imported} · Skipped (existing): ${d.skipped}`);
		}
	} else {
		console.log(pc.yellow('No translatable strings found.'));
	}

	// Show coverage
	await translateStatus(options);
}

// ─── translate export ──────────────────────────────────────
async function translateExport(options: { lang: string; module?: string; format?: string; output?: string }) {
	const lang = options.lang || 'my';
	const moduleFilter = options.module || '';
	const format = options.format || 'csv';

	console.log(pc.cyan(`\n◆ Exporting translations for "${lang}"\n`));

	const params = new URLSearchParams({ lang });
	if (moduleFilter) params.set('module', moduleFilter);
	const result = await apiFetch<TranslationsData>(`/api/translations?${params}`);
	const data = result.success ? result.data || result : result;
	const translations: TranslationMap = data.translations || ({} as TranslationMap);

	if (format === 'csv') {
		const csvLines: string[] = ['module_id,language,key,value,context,collection,field'];
		for (const mod of Object.keys(translations)) {
			for (const ctx of Object.keys(translations[mod] || {})) {
				const vals = translations[mod][ctx] as Record<string, string>;
				for (const [k, v] of Object.entries(vals)) {
					// Escape CSV fields
					const esc = (s: string) => (s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s);
					csvLines.push(`${esc(mod)},${esc(lang)},${esc(k)},${esc(v)},${esc(ctx)},,`);
				}
			}
		}

		const csv = csvLines.join('\n');
		if (options.output) {
			fs.writeFileSync(options.output, csv, 'utf-8');
			console.log(pc.green(`✓ Exported ${csvLines.length - 1} translations to ${options.output}`));
		} else {
			console.log(csv);
		}
	} else {
		console.log(JSON.stringify(translations, null, 2));
	}
}

// ─── translate import ──────────────────────────────────────
async function translateImport(file: string, options: { overwrite?: boolean; stdin?: boolean }) {
	console.log(pc.cyan('\n◆ Importing translations\n'));

	let csvText: string;
	if (options.stdin) {
		csvText = fs.readFileSync('/dev/stdin', 'utf-8');
	} else {
		if (!fs.existsSync(file)) {
			console.error(pc.red(`File not found: ${file}`));
			process.exit(1);
		}
		csvText = fs.readFileSync(file, 'utf-8');
	}

	// Parse CSV (header: module_id,language,key,value,context,collection,field)
	const lines = csvText.trim().split('\n');
	if (lines.length < 2) {
		console.error(pc.red('CSV must have header + at least 1 row'));
		process.exit(1);
	}

	const headers = parseCsvLine(lines[0]);
	const rows = [];
	for (let i = 1; i < lines.length; i++) {
		const vals = parseCsvLine(lines[i]);
		const obj: Record<string, string> = {};
		headers.forEach((h, j) => {
			obj[h] = vals[j] || '';
		});
		if (obj.key && obj.value) rows.push(obj);
	}

	if (rows.length === 0) {
		console.log(pc.yellow('No rows with key + value found.'));
		return;
	}

	console.log(pc.dim(`  ${rows.length} rows from CSV`));

	const result = await apiFetch<ImportResult>('/api/translations/import', {
		method: 'POST',
		body: JSON.stringify({ data: rows, overwrite: options.overwrite || false }),
	});

	if (result.success) {
		const d: ImportResult = result.data || {};
		console.log(pc.green('✓ Import complete!'));
		console.log(`  Imported: ${d.imported} · Skipped: ${d.skipped}`);
	} else {
		console.error(pc.red(`Import failed: ${result.error || '?'}`));
	}
}

// ─── translate status ──────────────────────────────────────
async function translateStatus(options: { module?: string }) {
	const languages = ['en', 'my', 'th']; // common languages — extend as needed
	const moduleFilter = options.module || '';

	console.log(pc.cyan('\n◆ Translation Coverage\n'));

	const results: Array<{ module: string; lang: string; total: number; translated: number }> = [];

	for (const lang of languages) {
		const params = new URLSearchParams({ lang });
		if (moduleFilter) params.set('module', moduleFilter);
		try {
			const result = await apiFetch<TranslationsData>(`/api/translations?${params}`);
			const data = result.success ? result.data || result : result;
			const translations: TranslationMap = data.translations || ({} as TranslationMap);

			for (const mod of Object.keys(translations)) {
				if (moduleFilter && mod !== moduleFilter) continue;
				let total = 0,
					translated = 0;
				for (const ctx of Object.keys(translations[mod] || {})) {
					const vals = translations[mod][ctx] as Record<string, string>;
					total += Object.keys(vals).length;
					for (const v of Object.values(vals)) {
						if (v && v.trim()) translated++;
					}
				}
				if (total > 0) results.push({ module: mod, lang, total, translated });
			}
		} catch {
			/* skip unreachable API */
		}
	}

	if (results.length === 0) {
		console.log(pc.yellow('No translations found. Run `headless translate scan` first.'));
		return;
	}

	console.log(pc.bold('  Module        Lang  Total   Done   Coverage'));
	console.log(pc.dim('  ────────────  ────  ─────  ─────  ────────'));
	for (const r of results) {
		const pct = r.total > 0 ? Math.round((r.translated / r.total) * 100) : 0;
		const bar = pct >= 90 ? pc.green(`${pct}%`) : pct >= 50 ? pc.yellow(`${pct}%`) : pc.red(`${pct}%`);
		console.log(`  ${r.module.padEnd(12)}  ${r.lang.padEnd(4)}  ${String(r.total).padEnd(5)}  ${String(r.translated).padEnd(5)}  ${bar}`);
	}
	console.log('');
}

// ─── translate build ───────────────────────────────────────
async function translateBuild() {
	console.log(pc.cyan('\n◆ Building translation bundles (D1 → R2)\n'));
	const result = await apiFetch<BuildResult>('/api/translations/build', { method: 'POST' });
	if (result.success) {
		const d: BuildResult = result.data || {};
		console.log(pc.green(`✓ Built ${d.languages_built} language bundle(s) into R2`));
		console.log(pc.dim('  Frontend will now receive compiled JSON from R2 cache.'));
	} else {
		console.error(pc.red(`Build failed: ${result.error || '?'}`));
	}
}

// ─── CSV parser (inline, zero-dep) ─────────────────────────
function parseCsvLine(line: string): string[] {
	const fields: string[] = [];
	let current = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
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

// ─── Registration ──────────────────────────────────────────

export function registerTranslateCommands(program: Command): void {
	const translateCmd = program.command('translate').description('Manage translations and i18n localization');

	translateCmd
		.command('scan')
		.description('Scan entity schemas and discover translatable strings')
		.option('-m, --module <id>', 'Scope to a specific module')
		.option('-l, --lang <code>', 'Target language code (default: "en")', 'en')
		.action(async (opts: { module?: string; lang?: string }) => {
			try {
				await translateScan(opts);
			} catch (err) {
				console.error(pc.red(String(err)));
				process.exit(1);
			}
		});

	translateCmd
		.command('export')
		.description('Export translations (CSV to stdout, or --output file)')
		.option('-l, --lang <code>', 'Language code', 'my')
		.option('-m, --module <id>', 'Scope to a specific module')
		.option('-f, --format <type>', 'csv or json', 'csv')
		.option('-o, --output <file>', 'Write to file (default: stdout)')
		.action(async (opts: { lang: string; module?: string; format?: string; output?: string }) => {
			try {
				await translateExport(opts);
			} catch (err) {
				console.error(pc.red(String(err)));
				process.exit(1);
			}
		});

	translateCmd
		.command('import')
		.description('Import translations from CSV file')
		.argument('<file>', 'CSV file path')
		.option('--overwrite', 'Overwrite existing translations')
		.option('--stdin', 'Read CSV from stdin')
		.action(async (file: string, opts: { overwrite?: boolean; stdin?: boolean }) => {
			try {
				await translateImport(file, opts);
			} catch (err) {
				console.error(pc.red(String(err)));
				process.exit(1);
			}
		});

	translateCmd
		.command('status')
		.description('Show translation coverage per module per language')
		.option('-m, --module <id>', 'Filter by module')
		.action(async (opts: { module?: string }) => {
			try {
				await translateStatus(opts);
			} catch (err) {
				console.error(pc.red(String(err)));
				process.exit(1);
			}
		});

	translateCmd
		.command('build')
		.description('Compile translations from D1 into R2 bundles (for production)')
		.action(async () => {
			try {
				await translateBuild();
			} catch (err) {
				console.error(pc.red(String(err)));
				process.exit(1);
			}
		});
}
