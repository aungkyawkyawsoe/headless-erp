/**
 * headless collection — create and manage entity collections via the REST API.
 *
 * Collections are created through POST /api/entities (table lifecycle is
 * API/CLI-only by design — no UI schema builder). This command wraps that API:
 *
 *   headless collection create Blog --template blog
 *   headless collection create Products --field title:text:required --field price:currency
 *   headless collection list
 *   headless collection delete products        # destructive — requires confirmation
 */

import type { Command } from 'commander';
import pc from 'picocolors';
import { printTable } from '../utils/format.js';
import { api, baseUrl } from '../utils/api.js';
import { guideConfirm } from '../utils/prompt.js';

// ─── Templates (API-first starter collections) ───────────

const VALID_TYPES = new Set([
	'text',
	'longtext',
	'text_editor',
	'number',
	'integer',
	'currency',
	'percent',
	'boolean',
	'datetime',
	'timestamp',
	'select',
	'tags',
	'email',
	'url',
	'phone',
	'color',
	'rating',
	'json',
	'slug',
	'uuid',
	'file',
	'image',
	'markdown',
	'code',
]);

/** Parse "name:type[:required]" → { name, type, required }. */
function parseField(spec: string): { name: string; type: string; required?: boolean } | string {
	const parts = spec.split(':');
	const name = parts[0]?.trim();
	const type = parts[1]?.trim();
	if (!name || !/^[a-z][a-z0-9_]*$/.test(name))
		return `Invalid field name "${parts[0]}": use lowercase letters, digits, underscores (start with a letter)`;
	if (!type || !VALID_TYPES.has(type)) return `Invalid field type "${type}" for "${name}". Valid: ${[...VALID_TYPES].join(', ')}`;
	return { name, type, required: parts[2] === 'required' };
}

// ─── Templates (API-first starter collections) ───────────

const TEMPLATES: Record<
	string,
	{ name: string; description: string; fields: Array<{ name: string; type: string; required?: boolean; options?: string[] }> }
> = {
	blog: {
		name: 'Blog',
		description: 'Blog posts with status workflow',
		fields: [
			{ name: 'title', type: 'text', required: true },
			{ name: 'slug', type: 'slug' },
			{ name: 'excerpt', type: 'longtext' },
			{ name: 'body', type: 'text_editor' },
			{ name: 'status', type: 'select', options: ['draft', 'published', 'archived'], required: true },
			{ name: 'author', type: 'text' },
			{ name: 'published_at', type: 'datetime' },
			{ name: 'tags', type: 'tags' },
		],
	},
	products: {
		name: 'Products',
		description: 'E-commerce / inventory catalog',
		fields: [
			{ name: 'title', type: 'text', required: true },
			{ name: 'sku', type: 'text', required: true },
			{ name: 'price', type: 'currency', required: true },
			{ name: 'cost', type: 'currency' },
			{ name: 'stock', type: 'integer' },
			{ name: 'status', type: 'select', options: ['active', 'archived', 'draft'] },
			{ name: 'description', type: 'longtext' },
			{ name: 'image', type: 'file' },
		],
	},
	crm: {
		name: 'CRM',
		description: 'Contacts and pipeline',
		fields: [
			{ name: 'full_name', type: 'text', required: true },
			{ name: 'email', type: 'email' },
			{ name: 'phone', type: 'phone' },
			{ name: 'company', type: 'text' },
			{ name: 'status', type: 'select', options: ['lead', 'prospect', 'customer'] },
			{ name: 'notes', type: 'longtext' },
			{ name: 'tags', type: 'tags' },
		],
	},
	inventory: {
		name: 'Inventory',
		description: 'Stock items with reorder tracking',
		fields: [
			{ name: 'sku', type: 'text', required: true },
			{ name: 'name', type: 'text', required: true },
			{ name: 'quantity', type: 'integer' },
			{ name: 'reorder_level', type: 'integer' },
			{ name: 'unit', type: 'text' },
			{ name: 'location', type: 'text' },
			{ name: 'status', type: 'select', options: ['in_stock', 'low', 'out_of_stock'] },
			{ name: 'cost', type: 'currency' },
		],
	},
	projects: {
		name: 'Projects',
		description: 'Project / task tracking',
		fields: [
			{ name: 'title', type: 'text', required: true },
			{ name: 'status', type: 'select', options: ['planned', 'in_progress', 'on_hold', 'completed'] },
			{ name: 'priority', type: 'select', options: ['low', 'medium', 'high'] },
			{ name: 'owner', type: 'text' },
			{ name: 'due_date', type: 'datetime' },
			{ name: 'description', type: 'longtext' },
		],
	},
};

// ─── Commands ─────────────────────────────────────────────

/** headless collection create <name> [--field ...] [--template ...] */
async function collectionCreate(
	name: string,
	options: { slug?: string; description?: string; field?: string[]; template?: string },
): Promise<void> {
	let fields: Array<{ name: string; type: string; required?: boolean; options?: string[] }>;
	let slug = options.slug?.trim();
	let description = options.description?.trim();

	if (options.template) {
		const tpl = TEMPLATES[options.template];
		if (!tpl) {
			console.error(pc.red(`Unknown template "${options.template}". Available: ${Object.keys(TEMPLATES).join(', ')}`));
			process.exit(1);
		}
		fields = tpl.fields;
		if (!description) description = tpl.description;
	} else {
		const specs = options.field ?? [];
		if (specs.length === 0) {
			console.error(pc.red('No fields provided. Pass --field name:type[:required] (repeatable) or use --template <id>.'));
			console.log(pc.dim(`  Templates: ${Object.keys(TEMPLATES).join(', ')}`));
			process.exit(1);
		}
		const parsed = specs.map(parseField);
		const firstError = parsed.find((x): x is string => typeof x === 'string');
		if (firstError) {
			console.error(pc.red(firstError));
			process.exit(1);
		}
		fields = parsed as Array<{ name: string; type: string; required?: boolean }>;
	}

	// Backend rule: a field is required (NOT NULL) unless `required: false` is
	// explicit — normalize so only fields marked ':required' are mandatory.
	fields = fields.map((f) => ({ ...f, required: f.required ?? false }));

	if (!slug) {
		slug = name
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '');
	}

	console.log(pc.cyan(`→ Creating collection "${name}" (${slug}) via POST /api/collections …`));
	const created = await api<{ slug: string }>('/api/collections', {
		method: 'POST',
		body: { name, slug, description, fields },
	});

	console.log(pc.green(`✓ Collection "${name}" created → ${created.slug}`));
	console.log('');
	console.log(pc.bold('What you got for free:'));
	console.log(`  • CRUD API:        GET/POST/PUT/DELETE ${baseUrl()}/api/entities/${created.slug}`);
	console.log(`  • Admin pages:     browse ${created.slug} in the admin UI (Content tab)`);
	console.log(`  • Auth, validation, search, filters, pagination, audit`);
	console.log('');
	console.log(pc.dim('Add data:'));
	console.log(`  curl -X POST ${baseUrl()}/api/entities/${created.slug} \\`);
	console.log(`    -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \\`);
	console.log(`    -d '${sampleBody(fields)}'`);
}

/** headless collection list */
async function collectionList(): Promise<void> {
	const rows = await api<Array<Record<string, unknown>>>('/api/collections');
	if (!rows.length) {
		console.log(pc.dim('  No collections yet. Create one: headless collection create <name> --template blog'));
		return;
	}
	printTable(
		rows.map((r) => ({
			Name: String(r.name ?? ''),
			Slug: String(r.slug ?? ''),
			Description: r.description ? String(r.description) : '',
			Updated: String(r.updated_at ?? '').slice(0, 10),
		})),
		['Name', 'Slug', 'Description', 'Updated'],
	);
}

/** headless collection delete <slug> (destructive — requires --force) */
async function collectionDelete(slug: string, options: { force?: boolean }): Promise<void> {
	const confirmed =
		options.force || (await guideConfirm(`Delete collection "${slug}" and ALL its data? This cannot be undone.`, false)) === true;
	if (!confirmed) {
		console.log(pc.yellow('  Aborted.'));
		return;
	}
	await api<{ deleted: boolean }>(`/api/collections/${encodeURIComponent(slug)}`, { method: 'DELETE' });
	console.log(pc.green(`✓ Collection "${slug}" deleted.`));
}

function sampleBody(fields: Array<{ name: string; type: string }>): string {
	const obj: Record<string, string> = {};
	for (const f of fields.slice(0, 3)) {
		obj[f.name] =
			f.type === 'boolean'
				? 'true'
				: f.type === 'integer' || f.type === 'number' || f.type === 'currency'
					? '0'
					: f.type === 'select'
						? '<pick>'
						: 'value';
	}
	return JSON.stringify(obj);
}

// ─── Register ─────────────────────────────────────────────

export function registerCollectionCommands(program: Command): void {
	const collection = program
		.command('collection')
		.description('Create and manage entity collections via the REST API (API-first table lifecycle)');

	collection
		.command('create <name>')
		.description('Create a collection via POST /api/entities (fields from --field flags or a --template)')
		.option('-s, --slug <slug>', 'Collection slug (default: derived from name)')
		.option('-d, --description <text>', 'Collection description')
		.option('-f, --field <spec>', 'Field as name:type[:required] — repeatable', collectFields, [] as string[])
		.option('-t, --template <id>', `Use a starter template: ${Object.keys(TEMPLATES).join(', ')}`)
		.action(async (name: string, options: { slug?: string; description?: string; field: string[]; template?: string }) => {
			try {
				await collectionCreate(name, options);
			} catch (err) {
				console.error(pc.red('Error:'), err instanceof Error ? err.message : err);
				process.exit(1);
			}
		});

	collection
		.command('list')
		.description('List collections')
		.action(async () => {
			try {
				await collectionList();
			} catch (err) {
				console.error(pc.red('Error:'), err instanceof Error ? err.message : err);
				process.exit(1);
			}
		});

	collection
		.command('delete <slug>')
		.description('Delete a collection and its table (DESTRUCTIVE — requires --force or confirmation)')
		.option('-f, --force', 'Skip confirmation')
		.action(async (slug: string, options: { force?: boolean }) => {
			try {
				await collectionDelete(slug, options);
			} catch (err) {
				console.error(pc.red('Error:'), err instanceof Error ? err.message : err);
				process.exit(1);
			}
		});
}

/** Collect repeated --field flags into an array. */
function collectFields(value: string, previous: string[]): string[] {
	return [...previous, value];
}
