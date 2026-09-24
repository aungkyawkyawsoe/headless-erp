import type { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import Handlebars from 'handlebars';
import { writeFile, readFile, listDir, readTemplate, getPluginsDir, discoverPlugins } from '../utils/file.js';
import { guideSelect, isInteractive } from '../utils/prompt.js';
import path from 'node:path';
import fs from 'node:fs';

// ── plugin:create (frontend) ────────────────────────────
async function createFrontendPlugin(): Promise<void> {
	console.log(pc.cyan('\n◆ Create a new frontend module plugin\n'));

	const id = (await p.text({
		message: 'Plugin ID (kebab-case)',
		placeholder: 'hrm',
		validate(value) {
			if (!value) return 'Plugin ID is required';
			if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(value)) return 'Must be kebab-case';
		},
	})) as string | symbol;
	if (p.isCancel(id)) return;

	const name = (await p.text({
		message: 'Display name',
		placeholder: 'HR Management',
	})) as string | symbol;
	if (p.isCancel(name)) return;

	const moduleName = (await p.text({
		message: 'Module switcher label',
		placeholder: 'HRM',
	})) as string | symbol;
	if (p.isCancel(moduleName)) return;

	const sortOrder = (await p.text({
		message: 'Sort order in sidebar',
		placeholder: '1',
		validate(v) {
			if (!v || !/^\d+$/.test(v)) return 'Must be a number';
		},
	})) as string | symbol;
	if (p.isCancel(sortOrder)) return;

	const frontendPluginsDir = path.resolve(getPluginsDir(), '..', '..', '..', 'miniapp', 'src', 'plugins');
	const pluginDir = path.join(frontendPluginsDir, id as string);

	const s = p.spinner();
	s.start('Generating frontend plugin...');

	try {
		fs.mkdirSync(pluginDir, { recursive: true });

		const manifestTpl = Handlebars.compile(readTemplate('plugin-frontend/manifest.ts.hbs'));
		writeFile(
			path.join(pluginDir, 'manifest.ts'),
			// Generate with proper template variables
			manifestTpl({
				id,
				name,
				moduleName,
				sortOrder: Number(sortOrder),
				moduleIcon: 'Users',
				iconImports: ['Users'],
				navItems: [{ title: 'Default Page', url: `/${id}`, icon: 'Users' }],
				entityMap: [{ key: 'default', value: id }],
				hasPages: false,
				serviceBinding: false,
			}),
		);

		const pluginTpl = Handlebars.compile(readTemplate('plugin-frontend/plugin.tsx.hbs'));
		writeFile(path.join(pluginDir, 'plugin.tsx'), pluginTpl({ id }));

		s.stop(pc.green('Frontend plugin generated!'));
		console.log('');
		console.log(pc.green('✓ Created files:'));
		console.log(`  ${pc.cyan(`apps/miniapp/src/plugins/${id}/manifest.ts`)}`);
		console.log(`  ${pc.cyan(`apps/miniapp/src/plugins/${id}/plugin.tsx`)}`);
		console.log('');
		console.log(pc.bold('Next steps:'));
		console.log(`  1. Edit ${pc.cyan(`apps/miniapp/src/plugins/${id}/manifest.ts`)} — add nav items + pages`);
		console.log(`  2. Import the plugin in ${pc.cyan('apps/miniapp/src/App.tsx')}`);
		console.log(`  3. Run ${pc.cyan('pnpm dev')} to see your module`);
		console.log('');
	} catch (err) {
		s.stop(pc.red('Failed'));
		console.error(pc.red(String(err)));
		// Rethrow so the command wrapper exits nonzero — CI must see failures
		throw err;
	}
}

// ── plugin:create ──────────────────────────────────────
async function createPlugin(): Promise<void> {
	console.log(pc.cyan('\n◆ Create a new plugin\n'));

	const id = (await p.text({
		message: 'Plugin ID (kebab-case)',
		placeholder: 'my-feature',
		validate(value) {
			if (!value) return 'Plugin ID is required';
			if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(value)) return 'Must be kebab-case (e.g. "my-feature")';
			// Check for duplicates
			const pluginsDir = getPluginsDir();
			if (listDir(path.join(pluginsDir, value)).length > 0) return `Plugin "${value}" already exists`;
		},
	})) as string | symbol;
	if (p.isCancel(id)) return;

	const name = (await p.text({
		message: 'Display name',
		placeholder: 'My Feature',
		validate(value) {
			if (!value) return 'Display name is required';
		},
	})) as string | symbol;
	if (p.isCancel(name)) return;

	const description = (await p.text({
		message: 'Description (optional)',
		placeholder: 'Handles my-feature business logic',
	})) as string | symbol;
	if (p.isCancel(description)) return;

	const workerGroup = (await p.select({
		message: 'Worker group',
		options: [
			{ value: 'gateway', label: 'Gateway (main API worker)', hint: 'runs inline' },
			{ value: 'finance', label: 'Finance' },
			{ value: 'sales', label: 'Sales' },
			{ value: 'hr', label: 'HR' },
			{ value: 'custom', label: 'Custom' },
		],
	})) as string | symbol;
	if (p.isCancel(workerGroup)) return;

	const hasHooks = (await p.confirm({
		message: 'Generate sample hooks?',
		initialValue: false,
	})) as boolean | symbol;
	if (p.isCancel(hasHooks)) return;

	let eventTypes: string[] = [];
	if (hasHooks) {
		const events = (await p.multiselect({
			message: 'Select event types (space to toggle, enter to confirm)',
			options: [
				{ value: 'validate', label: 'validate', hint: 'before validation runs' },
				{ value: 'before_insert', label: 'before_insert' },
				{ value: 'after_insert', label: 'after_insert' },
				{ value: 'before_update', label: 'before_update' },
				{ value: 'after_update', label: 'after_update' },
				{ value: 'before_delete', label: 'before_delete' },
				{ value: 'after_delete', label: 'after_delete' },
				{ value: 'after_restore', label: 'after_restore' },
				{ value: 'on_change', label: 'on_change' },
			],
			required: false,
		})) as string[] | symbol;
		if (p.isCancel(events)) return;
		eventTypes = events;
	}

	// ── Generate ──────────────────────────────────────
	const s = p.spinner();
	s.start('Generating plugin...');

	try {
		const pluginDir = path.join(getPluginsDir(), id as string);
		const hookDetails = eventTypes.map((evt) => ({
			collection: 'your_collection_slug',
			event: evt,
			priority: 50,
			timeoutMs: 5000,
			description: `${name as string} ${evt} hook`,
		}));

		// manifest.ts
		const manifestTpl = Handlebars.compile(readTemplate('plugin/manifest.ts.hbs'));
		writeFile(
			path.join(pluginDir, 'manifest.ts'),
			manifestTpl({
				id,
				name,
				version: '1.0.0',
				description: (description as string) || `${name} plugin`,
				workerGroup,
				author: '',
				license: 'MIT',
				hookDetails,
				routePath: `/api/${id}`,
			}),
		);

		// plugin.ts
		const pluginTpl = Handlebars.compile(readTemplate('plugin/plugin.ts.hbs'));
		writeFile(
			path.join(pluginDir, 'plugin.ts'),
			pluginTpl({
				id,
				name,
				description: (description as string) || `${name} plugin`,
				workerGroup,
				hasHooks,
				hookCount: eventTypes.length,
			}),
		);

		// services/ directory with dummy service
		const serviceName = `${id.replace(/(-[a-z])/g, (m: string) => m[1].toUpperCase()).replace(/^[a-z]/, (m: string) => m.toUpperCase())}Service`;
		const serviceTpl = Handlebars.compile(readTemplate('plugin/service.ts.hbs'));
		writeFile(
			path.join(pluginDir, 'services', `${id}.service.ts`),
			serviceTpl({ serviceName, description: (description as string) || `${name} service` }),
		);

		s.stop(pc.green('Plugin generated successfully!'));

		console.log('');
		console.log(pc.green('✓ Created files:'));
		console.log(`  ${pc.cyan(`apps/api/src/plugins/${id}/manifest.ts`)}`);
		console.log(`  ${pc.cyan(`apps/api/src/plugins/${id}/plugin.ts`)}`);
		console.log(`  ${pc.cyan(`apps/api/src/plugins/${id}/services/${id}.service.ts`)}`);
		console.log('');
		console.log(pc.bold('Next steps:'));
		console.log(`  1. Edit ${pc.cyan(`apps/api/src/plugins/${id}/plugin.ts`)} — add your routes & logic`);
		console.log(`  2. Edit ${pc.cyan(`apps/api/src/plugins/${id}/manifest.ts`)} — update hook details`);
		if (hasHooks) {
			console.log(`  3. Run ${pc.cyan(`headless hook:add`)} to add more hooks interactively`);
		}
		if (workerGroup !== 'gateway') {
			console.log(`  4. Run ${pc.cyan('headless worker:create')} to create a domain worker`);
		}
		console.log('');
	} catch (err) {
		s.stop(pc.red('Failed to generate plugin'));
		console.error(pc.red(String(err)));
		// Rethrow so the command wrapper exits nonzero — CI must see failures
		throw err;
	}
}

// ── plugin:list ────────────────────────────────────────
async function listPlugins(): Promise<void> {
	const pluginsDir = getPluginsDir();
	const dirs = listDir(pluginsDir);

	if (dirs.length === 0) {
		console.log(pc.yellow('No plugins found.'));
		return;
	}

	console.log(pc.cyan(`\n◆ Plugins (${dirs.length})\n`));

	for (const dir of dirs) {
		const manifestPath = path.join(pluginsDir, dir, 'manifest.ts');
		const manifestContent = readFile(manifestPath);

		if (manifestContent) {
			// Extract basic info from manifest
			const idMatch = manifestContent.match(/id:\s*'([^']+)'/);
			const nameMatch = manifestContent.match(/name:\s*'([^']+)'/);
			const groupMatch = manifestContent.match(/workerGroup:\s*'([^']+)'/);
			const descMatch = manifestContent.match(/description:\s*'([^']+)'/);

			const id = idMatch?.[1] ?? dir;
			const name = nameMatch?.[1] ?? dir;
			const group = groupMatch?.[1] ?? '?';
			const desc = descMatch?.[1] ?? '';

			console.log(`  ${pc.green('●')} ${pc.bold(name)} ${pc.dim(`(${id})`)}`);
			console.log(`    Group: ${pc.cyan(group)}`);
			if (desc) console.log(`    ${pc.dim(desc)}`);
			console.log('');
		} else {
			console.log(`  ${pc.yellow('○')} ${pc.bold(dir)} ${pc.dim('(no manifest)')}`);
			console.log('');
		}
	}
}

// ── plugin:info ────────────────────────────────────────
async function infoPlugin(slug: string): Promise<void> {
	const pluginsDir = getPluginsDir();
	const pluginDir = path.join(pluginsDir, slug);

	if (!fs.existsSync(pluginDir)) {
		console.error(pc.red(`Plugin "${slug}" not found.`));
		process.exit(1);
	}

	console.log(pc.cyan(`\n◆ Plugin: ${slug}\n`));

	const manifestPath = path.join(pluginDir, 'manifest.ts');
	const manifestContent = readFile(manifestPath);
	if (manifestContent) {
		console.log(pc.bold('manifest.ts'));
		console.log(manifestContent);
		console.log('');
	}

	const pluginPath = path.join(pluginDir, 'plugin.ts');
	const pluginContent = readFile(pluginPath);
	if (pluginContent) {
		console.log(pc.bold('plugin.ts'));
		console.log(pluginContent);
		console.log('');
	}

	// List services
	const servicesDir = path.join(pluginDir, 'services');
	if (fs.existsSync(servicesDir)) {
		const services = listDir(servicesDir).filter((f) => f.endsWith('.ts'));
		if (services.length > 0) {
			console.log(pc.bold('services/'));
			for (const srv of services) {
				console.log(`  ${pc.cyan(srv)}`);
			}
			console.log('');
		}
	}
}

// ── Register subcommands ──────────────────────────────
export function registerPluginCommands(program: Command): void {
	const pluginCmd = program.command('plugin').description('Manage plugins');

	pluginCmd
		.command('create')
		.description('Create a new plugin')
		.option('-f, --frontend', 'Generate a frontend module plugin (instead of backend)')
		.action(async (opts: { frontend?: boolean }) => {
			try {
				if (opts.frontend) {
					await createFrontendPlugin();
				} else {
					await createPlugin();
				}
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	pluginCmd
		.command('list')
		.description('List all plugins')
		.action(async () => {
			try {
				await listPlugins();
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	pluginCmd
		.command('info [slug]')
		.description('Show plugin details — guided when run without arguments')
		.action(async (slug?: string) => {
			let pluginId = slug;
			if (!pluginId && isInteractive()) {
				const plugins = discoverPlugins();
				if (plugins.length === 0) {
					console.log(pc.yellow('  No plugins found under apps/api/src/plugins'));
					return;
				}
				pluginId =
					(await guideSelect(
						'Which plugin?',
						plugins.map((p) => ({ value: p.id, label: p.id, hint: p.name })),
					)) ?? undefined;
			}
			if (!pluginId) {
				if (!isInteractive()) console.error(pc.red('Usage: headless plugin info <plugin-id>'));
				return;
			}
			try {
				await infoPlugin(pluginId);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});
}
