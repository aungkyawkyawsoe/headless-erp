/**
 * Unified Create Wizard — Guided Step-by-Step Scaffolding
 *
 * Single command: `headless create`
 * No subcommands to remember — just follow the prompts.
 *
 * Flow:
 *   1. What do you want to create? (Plugin / Hook / Worker / Collection)
 *   2. Depends on #1 → select domain, plugin, collection, event, etc.
 *   3. Depends on #2 → configure options (sample code, priority, timeout...)
 *   4. Generate → files created, manifest updated, worker entry updated
 *
 * Uses @clack/prompts for beautiful interactive prompts.
 */

import * as p from '@clack/prompts';
import pc from 'picocolors';
import path from 'node:path';
import Handlebars from 'handlebars';
import { injectHook } from '../commands/hook.js';
import {
	ensureDir,
	readTemplate,
	writeFile,
	readFile,
	listPlugins,
	discoverPlugins,
	PLUGINS_DIR,
	WORKERS_DIR,
	ROOT,
	getWorkerAppDir,
	copyDir,
} from '../utils/file.js';
import fs from 'node:fs';

// ─── Types for wizard state ────────────────────────────

type WizardCategory = 'plugin' | 'hook' | 'worker' | 'collection';
type WorkerGroup = 'gateway' | 'finance' | 'sales' | 'hr' | 'messaging' | 'reports';
/**
 * Code-hook lifecycle events the wizard may inject. The canonical catalog is
 * `LIFECYCLE_EVENTS` in `@mmbix/types` (`hooks.ts`) — this package keeps the
 * list inline deliberately (it takes no runtime dependency on the types
 * package), so keep it in sync when the catalog gains an event.
 */
type HookEvent =
	| 'validate'
	| 'before_insert'
	| 'after_insert'
	| 'before_update'
	| 'after_update'
	| 'before_delete'
	| 'after_delete'
	| 'after_restore'
	| 'on_change';

interface WizardState {
	category: WizardCategory;

	// Plugin
	pluginId?: string;
	pluginName?: string;
	pluginDesc?: string;
	workerGroup?: WorkerGroup;
	withSampleHooks?: boolean;
	selectedHookEvents?: HookEvent[];

	// Hook
	targetPlugin?: string;
	hookCollection?: string;
	hookEvent?: HookEvent;
	hookPriority?: number;
	hookTimeoutMs?: number;
	hookDescription?: string;

	// Worker
	workerName?: string;
	workerDescription?: string;
	workerPlugins?: string[];
}

// ─── Event descriptions for the select prompt ─────────

/** "my-plugin" → "myPluginPlugin" (valid JS identifier for the factory fn) */
function pluginIdToFactory(id: string): string {
	return id.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase()) + 'Plugin';
}

const EVENT_CHOICES: { value: HookEvent; label: string; hint: string }[] = [
	{ value: 'validate', label: 'validate', hint: 'Can abort — runs before DB write' },
	{ value: 'before_insert', label: 'before_insert', hint: 'Can abort + mutate — runs pre-insert' },
	{ value: 'after_insert', label: 'after_insert', hint: 'Fire-and-forget — runs after insert' },
	{ value: 'before_update', label: 'before_update', hint: 'Can abort + mutate — runs pre-update' },
	{ value: 'after_update', label: 'after_update', hint: 'Fire-and-forget — runs after update' },
	{ value: 'before_delete', label: 'before_delete', hint: 'Can abort — runs before soft-delete' },
	{ value: 'after_delete', label: 'after_delete', hint: 'Fire-and-forget — runs after a soft or hard delete' },
	{ value: 'after_restore', label: 'after_restore', hint: 'Fire-and-forget — runs after a trashed row is restored' },
	{ value: 'on_change', label: 'on_change', hint: 'Fire-and-forget — runs on status/field change' },
];

const GROUP_CHOICES: { value: WorkerGroup; label: string; hint: string }[] = [
	{ value: 'gateway', label: 'gateway', hint: 'Runs inline in main API worker (200KB, 5ms cold start)' },
	{ value: 'finance', label: 'finance', hint: 'Finance Worker — accounting, payroll, tax, budgeting' },
	{ value: 'sales', label: 'sales', hint: 'Sales Worker — CRM, pipeline, quotations' },
	{ value: 'hr', label: 'hr', hint: 'HR Worker — employees, recruitment, leave' },
	{ value: 'messaging', label: 'messaging', hint: 'Messaging Worker — email, SMS, notifications' },
	{ value: 'reports', label: 'reports', hint: 'Reports Worker — analytics, export, dashboard' },
];

// ─── Main Wizard ───────────────────────────────────────

export async function createWizard(): Promise<void> {
	console.log('');
	p.intro(pc.bgGreen(pc.black('  Headless Create Wizard  ')));

	const state: WizardState = {} as WizardState;

	// ── Step 1: What to create? ─────────────────────────
	const category = await p.select({
		message: 'What do you want to create?',
		options: [
			{ value: 'plugin', label: '🧩 Plugin', hint: 'A new business module (e.g. accounting, CRM, payroll)' },
			{ value: 'hook', label: '🪝 Hook', hint: 'Add lifecycle hook to an existing plugin' },
			{ value: 'worker', label: '⚡ Worker Group', hint: 'A new domain worker for scaling plugins' },
			{ value: 'collection', label: '📋 Collection', hint: 'A new entity/data model with fields' },
		],
	});
	if (p.isCancel(category)) {
		p.cancel('Cancelled');
		return;
	}
	state.category = category as WizardCategory;

	// ── Route to the right sub-wizard ───────────────────
	switch (state.category) {
		case 'plugin':
			await wizardPlugin(state);
			break;
		case 'hook':
			await wizardHook(state);
			break;
		case 'worker':
			await wizardWorker(state);
			break;
		case 'collection':
			await wizardCollection(state);
			break;
	}

	// ── Summary & Generate ──────────────────────────────
	await generate(state);
}

// ─── Sub-Wizard: Plugin ────────────────────────────────

async function wizardPlugin(state: WizardState): Promise<void> {
	// Step 2: Basic info
	const pluginId = await p.text({
		message: 'Plugin ID (kebab-case, e.g. "my-payroll"):',
		placeholder: 'my-feature',
		validate(value) {
			if (!value) return 'Plugin ID is required';
			if (!/^[a-z][a-z0-9-]*$/.test(value)) return 'Use kebab-case (lowercase letters, numbers, hyphens)';
		},
	});
	if (p.isCancel(pluginId)) {
		p.cancel('Cancelled');
		return;
	}
	state.pluginId = pluginId;

	const pluginName = await p.text({
		message: 'Display name:',
		placeholder: 'My Feature',
		defaultValue: pluginId
			.split('-')
			.map((w) => w[0].toUpperCase() + w.slice(1))
			.join(' '),
	});
	if (p.isCancel(pluginName)) {
		p.cancel('Cancelled');
		return;
	}
	state.pluginName = pluginName;

	const pluginDesc = await p.text({
		message: 'Description (optional):',
		placeholder: 'What does this plugin do?',
	});
	if (p.isCancel(pluginDesc)) {
		p.cancel('Cancelled');
		return;
	}
	state.pluginDesc = pluginDesc || '';

	// Step 3: Worker group
	const group = (await p.select({
		message: 'Which worker group does this plugin belong to?',
		options: GROUP_CHOICES,
	})) as WorkerGroup;
	if (p.isCancel(group)) {
		p.cancel('Cancelled');
		return;
	}
	state.workerGroup = group;

	// Step 4: Sample hooks?
	const withHooks = await p.confirm({
		message: 'Generate sample lifecycle hooks?',
		initialValue: true,
	});
	if (p.isCancel(withHooks)) {
		p.cancel('Cancelled');
		return;
	}
	state.withSampleHooks = withHooks;

	if (withHooks) {
		const events = await p.multiselect({
			message: 'Which lifecycle events do you need? (space to select, enter to confirm)',
			options: EVENT_CHOICES,
			required: false,
		});
		if (p.isCancel(events)) {
			p.cancel('Cancelled');
			return;
		}
		state.selectedHookEvents = (events as HookEvent[]) || [];
	}
}

// ─── Sub-Wizard: Hook ──────────────────────────────────

async function wizardHook(state: WizardState): Promise<void> {
	// Step 2: Which plugin?
	const plugins = listPlugins();
	const pluginOpts = plugins.map((p) => ({ value: p.id, label: p.id, hint: p.name || `Group: ${p.group}` }));
	if (pluginOpts.length === 0) {
		p.log.error('No plugins found. Run "headless plugin create" first.');
		return;
	}

	const plugin = await p.select({
		message: 'Which plugin should this hook belong to?',
		options: pluginOpts,
	});
	if (p.isCancel(plugin)) {
		p.cancel('Cancelled');
		return;
	}
	state.targetPlugin = plugin as string;

	// Step 3: Collection
	const collection = await p.text({
		message: 'Collection slug (e.g. "invoices", "products"):',
		placeholder: 'invoices',
		validate(value) {
			if (!value) return 'Collection slug is required';
		},
	});
	if (p.isCancel(collection)) {
		p.cancel('Cancelled');
		return;
	}
	state.hookCollection = collection;

	// Step 4: Event type
	const event = (await p.select({
		message: 'Lifecycle event:',
		options: EVENT_CHOICES,
	})) as HookEvent;
	if (p.isCancel(event)) {
		p.cancel('Cancelled');
		return;
	}
	state.hookEvent = event;

	// Step 5: Priority
	const priority = await p.text({
		message: 'Priority (1-99, lower = runs first. Default: 50):',
		placeholder: '50',
		defaultValue: '50',
		validate(value) {
			const n = Number(value);
			if (isNaN(n) || n < 1 || n > 99) return 'Must be between 1 and 99';
		},
	});
	if (p.isCancel(priority)) {
		p.cancel('Cancelled');
		return;
	}
	state.hookPriority = Number(priority) || 50;

	// Step 6: Timeout
	const timeout = await p.text({
		message: 'Timeout in ms (default: 5000):',
		placeholder: '5000',
		defaultValue: '5000',
		validate(value) {
			const n = Number(value);
			if (isNaN(n) || n < 100) return 'Must be at least 100ms';
		},
	});
	if (p.isCancel(timeout)) {
		p.cancel('Cancelled');
		return;
	}
	state.hookTimeoutMs = Number(timeout) || 5000;

	// Step 7: Description
	const desc = await p.text({
		message: 'Hook description:',
		placeholder: 'Auto GL posting on invoice create',
	});
	if (p.isCancel(desc)) {
		p.cancel('Cancelled');
		return;
	}
	state.hookDescription = desc || '';
}

// ─── Sub-Wizard: Worker ────────────────────────────────

async function wizardWorker(state: WizardState): Promise<void> {
	// Step 2: Worker name
	const name = await p.text({
		message: 'Worker name (kebab-case, e.g. "my-service"):',
		placeholder: 'analytics',
		validate(value) {
			if (!value) return 'Worker name is required';
			if (!/^[a-z][a-z0-9-]*$/.test(value)) return 'Use kebab-case';
			// Check for existing worker app
			const existingDir = getWorkerAppDir(value);
			if (fs.existsSync(existingDir)) return `Worker "${value}-worker" already exists`;
		},
	});
	if (p.isCancel(name)) {
		p.cancel('Cancelled');
		return;
	}
	state.workerName = name;

	// Step 3: Display name
	const defaultDisplay = name
		.split('-')
		.map((w: string) => w[0].toUpperCase() + w.slice(1))
		.join(' ');
	const displayName = await p.text({
		message: 'Display name:',
		placeholder: defaultDisplay,
		defaultValue: defaultDisplay,
	});
	if (p.isCancel(displayName)) {
		p.cancel('Cancelled');
		return;
	}
	state.pluginName = displayName; // reuse pluginName for displayName

	// Step 4: Description
	const desc = await p.text({
		message: 'Description (optional):',
		placeholder: `${displayName} domain worker`,
	});
	if (p.isCancel(desc)) {
		p.cancel('Cancelled');
		return;
	}
	state.workerDescription = desc || '';

	// Step 5: Which plugins?
	const allPlugins = discoverPlugins();
	const pluginOpts = allPlugins.map((plugin) => {
		const isAssigned = plugin.workerGroup !== 'gateway';
		const prefix = isAssigned ? '✅ ' : '○ ';
		const suffix: string = isAssigned ? ` (→ ${plugin.workerGroup})` : '';
		return {
			value: plugin.id,
			label: `${prefix}${plugin.name}${suffix}`,
			hint: plugin.description || `id: ${plugin.id}`,
		};
	});

	const selected = await p.multiselect({
		message: 'Select plugins to assign to this worker (space to select, enter to confirm):',
		options: pluginOpts,
		required: false,
	});
	if (p.isCancel(selected)) {
		p.cancel('Cancelled');
		return;
	}
	state.workerPlugins = selected as string[];
}

// ─── Sub-Wizard: Collection ────────────────────────────

async function wizardCollection(state: WizardState): Promise<void> {
	// Step 2: Collection slug
	const slug = await p.text({
		message: 'Collection slug (e.g. "employees", "tasks"):',
		placeholder: 'my_collection',
		validate(value) {
			if (!value) return 'Collection slug is required';
		},
	});
	if (p.isCancel(slug)) {
		p.cancel('Cancelled');
		return;
	}
	state.pluginId = slug; // reuse pluginId for collection slug

	const name = await p.text({
		message: 'Display name:',
		placeholder: 'My Collection',
	});
	if (p.isCancel(name)) {
		p.cancel('Cancelled');
		return;
	}
	state.pluginName = name;

	p.note(
		'Collections are created via the REST API at runtime.\n' + 'Run: POST /api/entities with your field definitions.',
		'Collection Creation',
	);
}

// ─── Generate ──────────────────────────────────────────

async function generate(state: WizardState): Promise<void> {
	switch (state.category) {
		case 'plugin':
			await generatePlugin(state);
			break;
		case 'hook':
			await generateHook(state);
			break;
		case 'worker':
			await generateWorker(state);
			break;
		case 'collection':
			await generateCollectionNote(state);
			break;
	}
}

async function generatePlugin(state: WizardState): Promise<void> {
	const { pluginId, pluginName, pluginDesc, workerGroup, withSampleHooks, selectedHookEvents } = state;
	const dir = path.join(PLUGINS_DIR, pluginId!);
	ensureDir(dir);
	ensureDir(path.join(dir, 'services'));

	const hookDetails = (selectedHookEvents || []).map((e) => ({
		collection: 'your_collection',
		event: e,
		priority: 50,
		timeoutMs: 5000,
		description: `Sample hook for ${e}`,
	}));

	// 1. manifest.ts
	const manifestTpl = Handlebars.compile(readTemplate('plugin/manifest.ts.hbs'));
	const manifestContent = manifestTpl({
		id: pluginId,
		name: pluginName,
		version: '1.0.0',
		description: pluginDesc || `${pluginName} plugin`,
		workerGroup: workerGroup,
		hookDetails,
		routePath: `/api/${pluginId}`,
	});
	writeFile(path.join(dir, 'manifest.ts'), manifestContent);

	// 2. plugin.ts
	const pluginTpl = Handlebars.compile(readTemplate('plugin/plugin.ts.hbs'));
	const pluginContent = pluginTpl({
		id: pluginId,
		name: pluginName,
		description: pluginDesc,
		workerGroup: workerGroup,
		hasHooks: withSampleHooks,
		hookCount: selectedHookEvents?.length || 0,
	});
	writeFile(path.join(dir, 'plugin.ts'), pluginContent);

	// 3. service.ts (dummy)
	const svcTpl = Handlebars.compile(readTemplate('plugin/service.ts.hbs'));
	const serviceContent = svcTpl({
		serviceName:
			pluginId!
				.split('-')
				.map((w) => w[0].toUpperCase() + w.slice(1))
				.join('') + 'Service',
		description: pluginDesc || 'Business logic service',
	});
	writeFile(path.join(dir, 'services', 'index.ts'), serviceContent);

	// 4. If not gateway, update the worker entry point
	if (workerGroup !== 'gateway') {
		const workerDir = path.join(WORKERS_DIR, workerGroup!);
		ensureDir(workerDir);
		const workerFile = path.join(workerDir, 'index.ts');

		let workerContent: string;
		try {
			const fs = await import('node:fs');
			workerContent = fs.readFileSync(workerFile, 'utf-8');
		} catch {
			// Worker entry doesn't exist yet — scaffold from template
			const workerTpl = Handlebars.compile(readTemplate('worker/index.ts.hbs'));
			workerContent = workerTpl({
				workerName: workerGroup,
				displayName: workerGroup![0].toUpperCase() + workerGroup!.slice(1),
				pluginIds: [pluginId],
			});
		}

		// Inject the plugin import + registration
		const importLine = `\nimport { ${pluginIdToFactory(pluginId as string)} } from '@/plugins/${pluginId}/plugin';`;
		const regLine = `  ${pluginIdToFactory(pluginId as string)}(),`;
		const searchPluginList = `const WORKER_PLUGINS = [`;

		if (!workerContent.includes(importLine)) {
			workerContent = importLine + workerContent;
		}
		if (workerContent.includes(searchPluginList)) {
			workerContent = workerContent.replace(searchPluginList, `${searchPluginList}\n${regLine}`);
		}

		writeFile(workerFile, workerContent);
	}

	// 5. Success message
	p.outro(pc.green('Plugin created successfully!'));
	console.log('');
	console.log(pc.cyan('  📁 Files created:'));
	console.log(pc.dim(`    ${path.relative(ROOT, dir)}/manifest.ts`));
	console.log(pc.dim(`    ${path.relative(ROOT, dir)}/plugin.ts`));
	console.log(pc.dim(`    ${path.relative(ROOT, dir)}/services/index.ts`));
	if (workerGroup !== 'gateway') {
		console.log(pc.dim(`    ${path.relative(ROOT, path.join(WORKERS_DIR, workerGroup!, 'index.ts'))} (updated)`));
	}
	console.log('');
	console.log(pc.cyan('  📝 Next steps:'));
	console.log(pc.dim(`    1. Edit ${path.relative(ROOT, dir)}/plugin.ts — add your business logic`));
	console.log(pc.dim(`    2. Run: npx headless create → Hook → to add lifecycle hooks`));
	console.log(pc.dim(`    3. Run: npx headless dev → to start development server`));
	console.log('');
}

async function generateHook(state: WizardState): Promise<void> {
	const { targetPlugin, hookCollection, hookEvent, hookPriority, hookTimeoutMs, hookDescription } = state;

	// Inject hook into the plugin's plugin.ts
	const injected = injectHook(targetPlugin!, hookCollection!, hookEvent!, hookPriority!, hookTimeoutMs!, hookDescription || '');

	if (injected) {
		p.outro(pc.green('Hook added successfully!'));
		console.log('');
		console.log(pc.cyan(`  📁 Hook injected into:`));
		console.log(pc.dim(`    plugins/${targetPlugin}/plugin.ts`));
		console.log('');
		console.log(pc.cyan(`  🪝 Hook details:`));
		console.log(pc.dim(`    Collection: ${hookCollection}`));
		console.log(pc.dim(`    Event:      ${hookEvent}`));
		console.log(pc.dim(`    Priority:   ${hookPriority}`));
		console.log(pc.dim(`    Timeout:    ${hookTimeoutMs}ms`));
		console.log(pc.dim(`    Group:      ${targetPlugin}`));
		console.log('');
	} else {
		p.log.error(`Failed to inject hook. Plugin "${targetPlugin}" not found or plugin.ts not writable.`);
	}
}

async function generateWorker(state: WizardState): Promise<void> {
	const { workerName, workerPlugins, pluginName: displayName, workerDescription } = state;

	if (!workerName) {
		p.log.error('Worker name is required');
		return;
	}

	const workerAppDir = getWorkerAppDir(workerName);
	const pluginIds = workerPlugins || [];
	const allPlugins = discoverPlugins();
	const title =
		displayName ||
		workerName
			.split('-')
			.map((w: string) => w[0].toUpperCase() + w.slice(1))
			.join(' ');

	const pluginMetaList = pluginIds.map((id) => {
		const info = allPlugins.find((p) => p.id === id);
		return {
			id,
			factory: id.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase()) + 'Plugin',
			dir: id,
			description: info?.description || '',
			name: info?.name || id,
		};
	});

	const serviceBindingSet = new Set<string>(['gateway']);
	for (const plugin of allPlugins) {
		if (plugin.workerGroup !== 'gateway' && plugin.workerGroup !== workerName) {
			serviceBindingSet.add(plugin.workerGroup);
		}
	}
	const serviceBindings = Array.from(serviceBindingSet);

	const pluginDescriptions: Record<string, string> = {};
	for (const m of pluginMetaList) {
		pluginDescriptions[m.id] = m.description || m.name;
	}

	const estimatedSize = 10 + pluginIds.length * 3;

	function writeWranglerJsonc(fp: string, config: Record<string, unknown>): void {
		const lines: string[] = ['{'];
		const ind = '  ';
		lines.push(ind + '"name": "' + config.name + '",');
		lines.push(ind + '"main": "' + config.main + '",');
		lines.push(ind + '"compatibility_date": "' + config.compatibilityDate + '",');
		const svcs = config.services as Array<Record<string, string>> | undefined;
		if (svcs && svcs.length > 0) {
			lines.push(ind + '"services": [');
			svcs.forEach((s, si) => {
				lines.push(ind + ind + '{ "binding": "' + s.binding + '", "service": "' + s.service + '" }' + (si < svcs.length - 1 ? ',' : ''));
			});
			lines.push(ind + '],');
		}
		const dbs = config.d1Databases as Array<Record<string, string>> | undefined;
		if (dbs && dbs.length > 0) {
			lines.push(ind + '"d1_databases": [');
			dbs.forEach((db, di) => {
				lines.push(
					ind +
						ind +
						'{ "binding": "' +
						db.binding +
						'", "database_name": "' +
						db.database_name +
						'", "database_id": "' +
						db.database_id +
						'" }' +
						(di < dbs.length - 1 ? ',' : ''),
				);
			});
			lines.push(ind + '],');
		}
		lines.push(ind + '"r2_buckets": [],');
		const vars = config.vars as Record<string, string>;
		const vk = Object.keys(vars);
		lines.push(ind + '"vars": {');
		vk.forEach((k, vi) => {
			lines.push(ind + ind + '"' + k + '": "' + vars[k] + '"' + (vi < vk.length - 1 ? ',' : ''));
		});
		lines.push(ind + '}');
		lines.push('}');
		writeFile(fp, lines.join('\n') + '\n');
	}

	const pkgTpl = Handlebars.compile(readTemplate('worker-app/package.json.hbs'));
	writeFile(path.join(workerAppDir, 'package.json'), pkgTpl({ workerName }));

	const tsconfigTpl = Handlebars.compile(readTemplate('worker-app/tsconfig.json.hbs'));
	writeFile(path.join(workerAppDir, 'tsconfig.json'), tsconfigTpl({}));

	writeWranglerJsonc(path.join(workerAppDir, 'wrangler.jsonc'), {
		name: workerName + '-worker',
		main: 'src/index.ts',
		compatibilityDate: '2026-07-31',
		services: serviceBindings.map((s) => ({ binding: s.toUpperCase(), service: s + '-worker' })),
		d1Databases: [{ binding: 'DB', database_name: 'headless-' + workerName, database_id: '<YOUR_DATABASE_ID>' }],
		vars: { ADMIN_PASSWORD: '{{ADMIN_PASSWORD}}', JWT_SECRET: '{{JWT_SECRET}}', WORKER_GROUP: workerName },
	});

	const indexTpl = Handlebars.compile(readTemplate('worker-app/src/index.ts.hbs'));
	writeFile(
		path.join(workerAppDir, 'src', 'index.ts'),
		indexTpl({
			workerName,
			displayName: title,
			description: workerDescription || title + ' domain worker',
			pluginIds,
			pluginImports: pluginMetaList,
			pluginDescriptions,
			serviceBindings,
			estimatedSize,
		}),
	);

	writeFile(path.join(workerAppDir, 'src', 'plugins', '.gitkeep'), '');

	const pluginsDir = PLUGINS_DIR;
	for (const pluginId of pluginIds) {
		const srcPluginDir = path.join(pluginsDir, pluginId);
		const destPluginDir = path.join(workerAppDir, 'src', 'plugins', pluginId);
		if (fs.existsSync(srcPluginDir)) {
			copyDir(srcPluginDir, destPluginDir);
			const manifestPath = path.join(destPluginDir, 'manifest.ts');
			let manifestContent = readFile(manifestPath);
			if (manifestContent) {
				manifestContent = manifestContent.replace(/workerGroup:\s*'[^']*'/, "workerGroup: '" + workerName + "'");
				writeFile(manifestPath, manifestContent);
			}
		}
	}

	p.outro(pc.green('Worker application created!'));
	console.log('');
	console.log(pc.cyan(`  Apps directory: ${pc.bold('apps/' + workerName + '-worker/')}`));
	console.log(pc.dim('    package.json, tsconfig.json, wrangler.jsonc'));
	console.log(pc.dim('    src/index.ts'));
	if (pluginIds.length > 0) {
		for (const pluginId of pluginIds) {
			console.log(pc.dim('    src/plugins/' + pluginId + '/'));
		}
	}
	console.log('');
	console.log(pc.cyan('  Next steps:'));
	console.log(pc.dim('    cd apps/' + workerName + '-worker && pnpm dev'));
	console.log('');
}

async function generateCollectionNote(state: WizardState): Promise<void> {
	p.outro(pc.yellow('Collection scaffold complete!'));
	console.log('');
	console.log(pc.cyan('  📋 Create via REST:'));
	console.log(pc.dim(`    curl -X POST http://localhost:8788/api/entities \\`));
	console.log(pc.dim(`      -H 'Authorization: Bearer dev-token' \\`));
	console.log(pc.dim(`      -H 'Content-Type: application/json' \\`));
	console.log(pc.dim(`      -d '{"name": "${state.pluginName}", "slug": "${state.pluginId}", "fields": [...]}'`));
	console.log('');
}
