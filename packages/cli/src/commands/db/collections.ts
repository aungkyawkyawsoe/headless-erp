import type { Command } from 'commander';
import pc from 'picocolors';
import { printTable, getFormatContext } from '../../utils/format.js';
import { isConnectionError } from '../../utils/api.js';
import { API_BASE, apiFetch, wranglerD1, formatDate, pickCollection, type EntityLike } from './shared.js';

// ── listCollections ───────────────────────────────────────

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

// ── Register Subcommands ──────────────────────────────────

export function registerCollectionsCommands(db: Command): void {
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
}
