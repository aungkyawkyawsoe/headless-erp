import type { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import Handlebars from 'handlebars';
import { writeFile, readFile, readTemplate, projectRoot, getNextWorkerPort } from '../utils/file.js';
import { api } from '../utils/api.js';
import path from 'node:path';
import fs from 'node:fs';

// ─── Helpers ─────────────────────────────────────────────

function kebabToTitle(id: string): string {
	return id
		.split('-')
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join(' ');
}

/** Create one entity collection via the API. */
async function apiCreateEntity(name: string, slug: string, fields: Array<Record<string, unknown>>): Promise<void> {
	try {
		await api<{ slug?: string }>('/api/collections', {
			method: 'POST',
			body: { name, slug, fields, timestamps: true, soft_delete: true },
		});
		console.log(pc.green(`  ✅ entity "${slug}" created`));
	} catch (err) {
		// Collection may already exist — treat as non-fatal
		console.log(pc.yellow(`  ⚠️  ${slug}: ${err instanceof Error ? err.message : String(err)}`));
	}
}

/**
 * Register the module in the backend (`_modules` table — the same endpoint the
 * mini app dock reads via GET /api/modules). This replaces the old
 * `apps/miniapp/src/plugins.ts` barrel-file append: the mini app is now
 * DB-driven, so a module shows up in the sidebar once it exists here.
 */
async function apiCreateModule(data: {
	name: string;
	slug: string;
	icon: string;
	description?: string;
	version?: string;
	sortOrder?: number;
}): Promise<void> {
	try {
		await api<{ success?: boolean }>('/api/modules', {
			method: 'POST',
			body: {
				name: data.name,
				slug: data.slug,
				icon: data.icon.startsWith('lucide:') ? data.icon : `lucide:${data.icon}`,
				description: data.description,
				version: data.version,
			},
		});
		console.log(pc.green(`  ✅ module "${data.slug}" registered in the backend`));
	} catch (err) {
		// A duplicate slug is non-fatal (module may already exist from a prior run)
		console.log(pc.yellow(`  ⚠️  module "${data.slug}": ${err instanceof Error ? err.message : String(err)}`));
		return;
	}

	// sort_order isn't accepted at create-time — set it via PUT so the sidebar
	// order matches the requested sortOrder.
	if (data.sortOrder !== undefined) {
		await api<unknown>(`/api/modules/${encodeURIComponent(data.slug)}`, { method: 'PUT', body: { sort_order: data.sortOrder } }).catch(
			() => undefined,
		); // best-effort — ordering is cosmetic
	}
}

/**
 * Resolve the project's API worker name from apps/api/wrangler.jsonc.
 * Falls back to the starter template's convention (`<project>-api` after
 * `headless init` renames it, otherwise `headless-cms`).
 */
function apiWorkerName(): string {
	const wranglerRaw = readFile(path.resolve(projectRoot(), 'apps', 'api', 'wrangler.jsonc'));
	const nameMatch = wranglerRaw?.match(/"name"\s*:\s*"([^"]+)"/);
	return nameMatch?.[1] ?? 'headless-cms';
}

// ─── Field type shorthands ──────────────────────────────

interface FieldSpec {
	name: string;
	type: string;
	label: string;
	required?: boolean;
	related_collection?: string;
	options?: string[];
}

const F = {
	text(name: string, label?: string, required?: boolean): FieldSpec {
		return { name, type: 'text', label: label ?? kebabToTitle(name), required };
	},
	longtext(name: string, label?: string): FieldSpec {
		return { name, type: 'longtext', label: label ?? kebabToTitle(name) };
	},
	number(name: string, label?: string, required?: boolean): FieldSpec {
		return { name, type: 'number', label: label ?? kebabToTitle(name), required };
	},
	currency(name: string, label?: string, required?: boolean): FieldSpec {
		return { name, type: 'currency', label: label ?? kebabToTitle(name), required };
	},
	boolean(name: string, label?: string): FieldSpec {
		return { name, type: 'boolean', label: label ?? kebabToTitle(name) };
	},
	datetime(name: string, label?: string, required?: boolean): FieldSpec {
		return { name, type: 'datetime', label: label ?? kebabToTitle(name), required };
	},
	select(name: string, options: string[], label?: string): FieldSpec {
		return { name, type: 'select', label: label ?? kebabToTitle(name), options };
	},
	m2o(name: string, collection: string, label?: string, required?: boolean): FieldSpec {
		return { name, type: 'm2o', related_collection: collection, label: label ?? kebabToTitle(name), required };
	},
};

function toApiField(f: FieldSpec): Record<string, unknown> {
	const out: Record<string, unknown> = { name: f.name, type: f.type, label: f.label };
	// Backend rule: a field is required (NOT NULL) unless `required: false` is
	// explicit — always send it so optional fields stay nullable.
	out.required = f.required ?? false;
	if (f.related_collection) out.related_collection = f.related_collection;
	if (f.options) out.options = f.options.map((o) => ({ label: o, value: o }));
	return out;
}

// ─── Built-in module templates ──────────────────────────

interface ModuleTemplate {
	id: string;
	label: string;
	description: string;
	moduleSwitcher: string;
	icon: string;
	/** List of entity definitions keyed by kebab slug. */
	entities: Record<string, { name: string; fields: FieldSpec[] }>;
}

const TEMPLATES: Record<string, ModuleTemplate> = {
	cms: {
		id: 'cms',
		label: 'Content Management',
		description: 'Categories, posts, pages',
		moduleSwitcher: 'CMS',
		icon: 'FileText',
		entities: {
			categories: {
				name: 'Categories',
				fields: [
					F.text('name', 'Name', true),
					F.text('slug', 'Slug'),
					F.m2o('parent', 'categories', 'Parent Category'),
					F.boolean('is_group', 'Is Group'),
					F.text('color', 'Color'),
				],
			},
			posts: {
				name: 'Posts',
				fields: [
					F.text('title', 'Title', true),
					F.text('slug', 'Slug'),
					F.m2o('category', 'categories', 'Category'),
					F.text('author', 'Author'),
					F.select('status', ['draft', 'published', 'archived'], 'Status'),
					F.number('views', 'Views'),
					F.datetime('published_at', 'Published At'),
					F.longtext('excerpt', 'Excerpt'),
				],
			},
			pages: {
				name: 'Pages',
				fields: [
					F.text('title', 'Title', true),
					F.text('slug', 'Slug'),
					F.select('status', ['draft', 'published'], 'Status'),
					F.datetime('published_at', 'Published At'),
					F.longtext('content', 'Content'),
				],
			},
		},
	},
};

// ── module:create ──────────────────────────────────────

async function createModule(opts?: { template?: string; worker?: boolean }): Promise<void> {
	console.log(pc.cyan('\n◆ Create a new module (entities + frontend plugin)\n'));

	let templateChoice: string | symbol;
	if (opts?.template) {
		if (!TEMPLATES[opts.template]) {
			console.error(pc.red(`Unknown template: "${opts.template}". Available: ${Object.keys(TEMPLATES).join(', ')}`));
			process.exit(1);
		}
		templateChoice = opts.template;
	} else {
		templateChoice = (await p.select({
			message: 'Start from a template or blank?',
			options: [
				...Object.entries(TEMPLATES).map(([id, t]) => ({ value: id, label: t.label, hint: t.description })),
				{ value: 'blank', label: 'Blank module', hint: 'define entities yourself' },
			],
		})) as string | symbol;
		if (p.isCancel(templateChoice)) return;
	}

	let id: string;
	let name: string;
	let moduleName: string;
	let sortOrder: number;
	let icon = 'Boxes';
	let idRaw: string | symbol;
	let nameRaw: string | symbol;
	let moduleNameRaw: string | symbol;

	if (templateChoice !== 'blank') {
		const tpl = TEMPLATES[templateChoice as string];
		id = tpl.id;
		name = tpl.label;
		moduleName = tpl.moduleSwitcher;
		icon = tpl.icon;
		console.log(pc.dim(`  Using template: ${tpl.description}`));
		// Templates auto-pick the next sort order once the backend answers
		// (see the module-registration step below) — start at 1 here.
		sortOrder = 1;
	} else {
		idRaw = (await p.text({
			message: 'Module ID (kebab-case)',
			placeholder: 'inventory',
			validate(value) {
				if (!value) return 'Module ID is required';
				if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(value)) return 'Must be kebab-case (e.g. "inventory")';
			},
		})) as string | symbol;
		if (p.isCancel(idRaw)) return;
		id = idRaw as string;

		nameRaw = (await p.text({ message: 'Display name', placeholder: 'Inventory Management' })) as string | symbol;
		if (p.isCancel(nameRaw)) return;
		name = nameRaw as string;

		moduleNameRaw = (await p.text({ message: 'Module switcher label', placeholder: 'Inventory' })) as string | symbol;
		if (p.isCancel(moduleNameRaw)) return;
		moduleName = moduleNameRaw as string;

		const order = (await p.text({
			message: 'Sort order in sidebar',
			placeholder: '5',
			validate(v) {
				if (!v || !/^\d+$/.test(v)) return 'Must be a number';
			},
		})) as string | symbol;
		if (p.isCancel(order)) return;
		sortOrder = Number(order);
	}

	const createEntities = opts?.template
		? true
		: ((await p.confirm({
				message: 'Create entity collections in the backend?',
				initialValue: templateChoice !== 'blank',
			})) as boolean | symbol);
	if (p.isCancel(createEntities)) return;

	const withWorker = opts?.template
		? (opts?.worker ?? false)
		: ((await p.confirm({
				message: 'Also scaffold a plugin worker (microservice) for this module?',
				initialValue: false,
			})) as boolean | symbol);
	if (p.isCancel(withWorker)) return;

	// Non-interactive mode (--template): plain logging instead of clack spinner
	const isNonInteractive = Boolean(opts?.template);
	const s = isNonInteractive ? null : p.spinner();
	s?.start('Creating module...');

	try {
		const pluginDir = path.resolve(projectRoot(), 'apps', 'miniapp', 'src', 'plugins', id as string);
		fs.mkdirSync(pluginDir, { recursive: true });

		// ── 1. Create entities via API ──
		if (createEntities) {
			console.log(pc.dim('\n  Creating entities via API...'));
			const tpl = templateChoice !== 'blank' ? TEMPLATES[templateChoice as string] : null;
			const entities = tpl?.entities ?? {};
			if (Object.keys(entities).length > 0) {
				for (const [slug, def] of Object.entries(entities)) {
					await apiCreateEntity(
						def.name,
						slug,
						def.fields.map((f) => toApiField(f)),
					);
				}
			} else {
				console.log(pc.yellow('  (no entities defined — add fields to the generated manifest later)'));
			}
		}

		// ── 2. Generate frontend plugin ──
		// Template prepends `/${id}` to each url — pass slugs WITHOUT the module prefix
		const navItems = Object.entries(templateChoice !== 'blank' ? TEMPLATES[templateChoice as string].entities : {}).map(([slug]) => ({
			title: kebabToTitle(slug),
			url: `/${slug}`,
			icon,
		}));
		const entityMap = Object.keys(templateChoice !== 'blank' ? TEMPLATES[templateChoice as string].entities : {}).map((slug) => ({
			key: slug,
			value: slug.replace(/-/g, '_'),
		}));

		const manifestTpl = Handlebars.compile(readTemplate('plugin-frontend/manifest.ts.hbs'));
		writeFile(
			path.join(pluginDir, 'manifest.ts'),
			manifestTpl({
				id,
				name,
				moduleName,
				sortOrder,
				moduleIcon: icon,
				iconImports: [icon],
				navItems: navItems.length > 0 ? navItems : [{ title: kebabToTitle(id as string), url: '', icon }],
				entityMap,
				hasPages: false,
				serviceBinding: withWorker,
			}),
		);

		const pluginTpl = Handlebars.compile(readTemplate('plugin-frontend/plugin.tsx.hbs'));
		writeFile(path.join(pluginDir, 'plugin.tsx'), pluginTpl({ id }));

		// ── 3. Register the module in the backend (DB-driven dock) ──
		// The mini app sidebar reads GET /api/modules — no plugins.ts barrel
		// file exists (or is read) anymore, so registration happens here.
		if (templateChoice !== 'blank') {
			// Templates auto-pick the next sidebar position from existing modules
			try {
				const data = await api<Array<{ sort_order?: number }>>('/api/modules');
				sortOrder = (data.length > 0 ? Math.max(...data.map((m) => m.sort_order ?? 0)) : 0) + 1;
			} catch {
				// Backend unreachable — keep the default sort order
			}
		}
		await apiCreateModule({
			name,
			slug: id as string,
			icon,
			description: `${name} module`,
			version: '1.0.0',
			sortOrder,
		});

		// ── 4. Scaffold worker (optional) ──
		if (withWorker) {
			const workerDir = path.resolve(projectRoot(), 'apps', `plugin-${id}`);
			fs.mkdirSync(path.join(workerDir, 'worker'), { recursive: true });

			// Collision-safe port allocation shared with `worker create`
			const port = getNextWorkerPort();

			// package.json
			writeFile(
				path.join(workerDir, 'package.json'),
				JSON.stringify(
					{
						name: `@mmbix/plugin-${id}`,
						version: '0.1.0',
						private: true,
						type: 'module',
						scripts: {
							dev: `wrangler dev --port ${port} --inspector-port ${port + 450}`,
							deploy: 'wrangler deploy',
							typecheck: 'tsc --noEmit',
						},
						dependencies: { '@mmbix/core': 'workspace:*', hono: '^4.7.7' },
						// @cloudflare/workers-types is required by the generated tsconfig
						devDependencies: { '@cloudflare/workers-types': '^4.0.0', wrangler: '^4.118.0', typescript: '^5.5.2' },
					},
					null,
					2,
				),
			);

			// wrangler.jsonc — the service binding must point at the project's
			// actual API worker name (init renames it to <project>-api)
			writeFile(
				path.join(workerDir, 'wrangler.jsonc'),
				`{
	"name": "plugin-${id}",
	"main": "worker/index.ts",
	"compatibility_date": "2026-07-31",
	"compatibility_flags": ["nodejs_compat"],
	"services": [{ "binding": "API", "service": "${apiWorkerName()}" }]
}
`,
			);

			// worker/index.ts — Hono microservice with health + ping
			const indexTpl = Handlebars.compile(readTemplate('plugin-worker/src/index.ts.hbs'));
			writeFile(
				path.join(workerDir, 'worker', 'index.ts'),
				indexTpl({
					id,
					name,
					description: `Microservice for the ${name} module`,
				}),
			);

			// tsconfig.json
			writeFile(
				path.join(workerDir, 'tsconfig.json'),
				JSON.stringify(
					{
						compilerOptions: {
							target: 'ES2022',
							module: 'ES2022',
							moduleResolution: 'Bundler',
							lib: ['ES2022'],
							types: ['@cloudflare/workers-types'],
							strict: true,
							skipLibCheck: true,
							noEmit: true,
						},
						include: ['worker/**/*.ts'],
					},
					null,
					2,
				),
			);
		}

		s?.stop(pc.green(`Module "${id}" created!`));
		console.log('');
		console.log(pc.green('✓ Created:'));
		console.log(`  ${pc.cyan(`apps/miniapp/src/plugins/${id}/manifest.ts`)}`);
		console.log(`  ${pc.cyan(`apps/miniapp/src/plugins/${id}/plugin.tsx`)}`);
		console.log(`  ${pc.cyan('Module registered in the backend (GET /api/modules → sidebar dock)')}`);
		if (createEntities && Object.keys(templateChoice !== 'blank' ? TEMPLATES[templateChoice as string].entities : {}).length > 0) {
			console.log(`  ${pc.cyan('Entity collections created in the backend via API')}`);
		}
		if (withWorker) {
			console.log(`  ${pc.cyan(`apps/plugin-${id}/`)}  (microservice worker)`);
		}
		console.log('');
		console.log(pc.bold('Next steps:'));
		console.log(`  1. Edit ${pc.cyan(`apps/miniapp/src/plugins/${id}/manifest.ts`)} — add nav sections + entityMap entries`);
		console.log(`  2. Run ${pc.cyan('pnpm dev')} — the module appears in the sidebar automatically`);
		console.log('');
	} catch (err) {
		s?.stop(pc.red('Failed'));
		console.error(pc.red(String(err)));
		// Rethrow so the command wrapper can exit nonzero — CI must see failures
		throw err;
	}
}

// ─── Register ───────────────────────────────────────────

export function registerModuleCommands(program: Command): void {
	const moduleCmd = program
		.command('module')
		.description('Generate a business module: entities via API + frontend plugin (Strapi/Frappe-style guided scaffold)');

	moduleCmd
		.command('create')
		.description('Create a full module: entities via API + frontend plugin (optional microservice worker)')
		.option('-t, --template <id>', 'Use a built-in template (cms) — non-interactive')
		.option('-w, --worker', 'Also scaffold a plugin worker microservice')
		.action(async (opts: { template?: string; worker?: boolean }) => {
			try {
				await createModule(opts);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});
}
