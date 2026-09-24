import type { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import Handlebars from 'handlebars';
import path from 'node:path';
import fs from 'node:fs';
import {
	writeFile,
	readFile,
	listDir,
	listDirs,
	readTemplate,
	getPluginsDir,
	getWorkerAppDir,
	getAppsDir,
	getGatewayWranglerPath,
	getApiDir,
	discoverPlugins,
	listWorkerApps,
	getNextWorkerPort,
	copyDir,
} from '../utils/file.js';
import { guideSelect, isInteractive } from '../utils/prompt.js';

// ── Helpers ─────────────────────────────────────────────

/** Turn "my-feature" into "My Feature" */
function kebabToTitle(str: string): string {
	return str
		.split('-')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

/** Detect a plugin-<name> worker app (module create convention): has wrangler.jsonc + a TS entry point */
function isPluginWorkerApp(dir: string): boolean {
	if (!path.basename(dir).startsWith('plugin-')) return false;
	const wrangler = readJsonc(path.join(dir, 'wrangler.jsonc'));
	if (!wrangler) return false;
	// main field (src/index.ts) OR worker/index.ts convention
	const main = (wrangler as Record<string, unknown> | null)?.['main'] as string | undefined;
	if (main && fs.existsSync(path.join(dir, main))) return true;
	return fs.existsSync(path.join(dir, 'worker', 'index.ts'));
}

/** Generate a factory function name from a kebab-case plugin id: "my-plugin" → "myPluginPlugin" */
function pluginIdToFactory(id: string): string {
	return id.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase()) + 'Plugin';
}

/** Read JSONC file as JSON (strips comments and trailing commas) */
function readJsonc(filePath: string): Record<string, unknown> | null {
	const raw = readFile(filePath);
	if (!raw) return null;
	// Strip single-line comments and trailing commas
	const cleaned = raw
		.replace(/\/\/.*$/gm, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/,\s*([}\]])/g, '$1');
	try {
		return JSON.parse(cleaned) as Record<string, unknown>;
	} catch {
		return null;
	}
}

/** Write a JSONC config with comments preserved via template approach */
function writeWranglerJsonc(filePath: string, config: Record<string, unknown>): void {
	const lines: string[] = ['{'];
	const indent = '  ';

	// name
	lines.push(`${indent}"name": "${config.name}",`);
	// main
	lines.push(`${indent}"main": "${config.main}",`);
	// compatibility_date
	lines.push(`${indent}"compatibility_date": "${config.compatibilityDate}",`);

	// services
	const services = config.services as Array<Record<string, string>> | undefined;
	if (services && services.length > 0) {
		lines.push(`${indent}"services": [`);
		services.forEach((s, i) => {
			const comma = i < services.length - 1 ? ',' : '';
			lines.push(`${indent}${indent}{ "binding": "${s.binding}", "service": "${s.service}" }${comma}`);
		});
		lines.push(`${indent}],`);
	}

	// d1_databases
	const d1Databases = config.d1Databases as Array<Record<string, string>> | undefined;
	if (d1Databases && d1Databases.length > 0) {
		lines.push(`${indent}"d1_databases": [`);
		d1Databases.forEach((db, i) => {
			const comma = i < d1Databases.length - 1 ? ',' : '';
			lines.push(
				`${indent}${indent}{ "binding": "${db.binding}", "database_name": "${db.database_name}", "database_id": "${db.database_id}" }${comma}`,
			);
		});
		lines.push(`${indent}],`);
	}

	// r2_buckets
	lines.push(`${indent}"r2_buckets": [],`);

	// vars
	const vars = config.vars as Record<string, string>;
	lines.push(`${indent}"vars": {`);
	const varKeys = Object.keys(vars);
	varKeys.forEach((k, i) => {
		const comma = i < varKeys.length - 1 ? ',' : '';
		lines.push(`${indent}${indent}"${k}": "${vars[k]}"${comma}`);
	});
	lines.push(`${indent}}`);

	lines.push('}');
	writeFile(filePath, lines.join('\n') + '\n');
}

// ── worker:create ──────────────────────────────────────

async function createWorker(): Promise<void> {
	console.log('');
	p.intro(pc.bgCyan(pc.black('  Create Domain Worker  ')));

	// ── Step 1: Discover available plugins ──────────────
	const s = p.spinner();
	s.start('Discovering plugins...');
	const allPlugins = discoverPlugins();
	const workerApps = listWorkerApps();
	s.stop(`Found ${allPlugins.length} plugins, ${workerApps.length} existing workers`);

	// Build plugin options with assignment info
	const pluginOptions = allPlugins.map((plugin) => {
		const isAssigned = plugin.workerGroup !== 'gateway';
		const prefix = isAssigned ? '✅ ' : '○ ';
		const suffix = isAssigned ? pc.dim(` (→ ${plugin.workerGroup})`) : '';
		return {
			value: plugin.id,
			label: `${prefix}${plugin.name}${suffix}`,
			hint: plugin.description || `id: ${plugin.id}`,
		};
	});

	if (allPlugins.length === 0) {
		console.log(pc.yellow('No plugins found. Run `headless plugin:create` first.'));
		return;
	}

	// ── Step 2: Worker name ─────────────────────────────
	const workerName = (await p.text({
		message: 'Worker name (kebab-case)',
		placeholder: 'finance',
		validate(value) {
			if (!value) return 'Worker name is required';
			if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(value)) return 'Must be kebab-case (e.g. "finance", "sales-api")';
			// Check for existing worker app
			const existing = workerApps.includes(`${value}-worker`);
			if (existing) return `Worker "${value}-worker" already exists`;
		},
	})) as string | symbol;
	if (p.isCancel(workerName)) {
		p.cancel('Cancelled');
		return;
	}

	// ── Step 3: Display name ────────────────────────────
	const defaultDisplay = kebabToTitle(workerName as string);
	const displayName = (await p.text({
		message: 'Display name',
		placeholder: defaultDisplay,
		defaultValue: defaultDisplay,
		validate(value) {
			if (!value) return 'Display name is required';
		},
	})) as string | symbol;
	if (p.isCancel(displayName)) {
		p.cancel('Cancelled');
		return;
	}

	// ── Step 4: Description ─────────────────────────────
	const description = (await p.text({
		message: 'Description (optional)',
		placeholder: `${displayName} domain worker`,
	})) as string | symbol;
	if (p.isCancel(description)) {
		p.cancel('Cancelled');
		return;
	}

	// ── Step 5: Select plugins ──────────────────────────
	const selectedPlugins = (await p.multiselect({
		message: 'Select plugins to assign (space to toggle, enter to confirm)',
		options: pluginOptions,
		required: false,
	})) as string[] | symbol;
	if (p.isCancel(selectedPlugins)) {
		p.cancel('Cancelled');
		return;
	}

	const plugins = (selectedPlugins as string[]) || [];

	// ── Step 6: Worker port ─────────────────────────────
	const autoPort = getNextWorkerPort();
	const port = (await p.text({
		message: 'Dev server port',
		placeholder: String(autoPort),
		defaultValue: String(autoPort),
		validate(value) {
			const n = Number(value);
			if (isNaN(n) || n < 1024 || n > 65535) return 'Must be between 1024 and 65535';
		},
	})) as string | symbol;
	if (p.isCancel(port)) {
		p.cancel('Cancelled');
		return;
	}

	// ── Step 7: Summary ─────────────────────────────────
	const selectedInfo = plugins.map((id) => {
		const pInfo = allPlugins.find((p) => p.id === id);
		return pInfo ? `  ${pc.cyan('●')} ${pInfo.name} ${pc.dim(`(${id})`)}` : `  ${pc.cyan('●')} ${id}`;
	});

	console.log('');
	console.log(pc.cyan('  ── Summary ──'));
	console.log(`  Worker:      ${pc.bold(displayName as string)} ${pc.dim(`(${workerName}-worker)`)}`);
	console.log(`  Directory:   ${pc.dim(`apps/${workerName}-worker/`)}`);
	console.log(`  Port:        ${pc.yellow(port)}`);
	if (plugins.length > 0) {
		console.log(`  Plugins:     ${pc.bold(String(plugins.length))}`);
		selectedInfo.forEach((line) => console.log(line));
	} else {
		console.log(`  Plugins:     ${pc.dim('none selected')}`);
	}
	console.log('');

	const confirmed = (await p.confirm({
		message: 'Create this worker?',
		initialValue: true,
	})) as boolean | symbol;
	if (p.isCancel(confirmed) || !confirmed) {
		p.cancel('Cancelled');
		return;
	}

	// ── Step 8: Generate ────────────────────────────────
	const spinner = p.spinner();
	spinner.start('Generating worker application...');

	try {
		const workerAppDir = getWorkerAppDir(workerName as string);
		const pluginIds = plugins;

		// Build plugin metadata
		const pluginMetaList = pluginIds.map((id) => {
			const info = allPlugins.find((p) => p.id === id);
			return {
				id,
				factory: pluginIdToFactory(id),
				dir: id,
				description: info?.description || '',
				name: info?.name || id,
			};
		});

		// Build service bindings: gateway + any other workers referenced by plugins
		const serviceBindingSet = new Set<string>(['gateway']);
		for (const plugin of allPlugins) {
			if (plugin.workerGroup !== 'gateway' && plugin.workerGroup !== workerName) {
				serviceBindingSet.add(plugin.workerGroup);
			}
		}
		const serviceBindings = Array.from(serviceBindingSet);

		// Build plugin descriptions map
		const pluginDescriptions: Record<string, string> = {};
		for (const m of pluginMetaList) {
			pluginDescriptions[m.id] = m.description || m.name;
		}

		// Estimated bundle size (rough: 10KB base + 3KB per plugin)
		const estimatedSize = 10 + pluginIds.length * 3;

		// ── Generate package.json ─────────────────────────
		const pkgTpl = Handlebars.compile(readTemplate('worker-app/package.json.hbs'));
		writeFile(path.join(workerAppDir, 'package.json'), pkgTpl({ workerName }));

		// ── Generate tsconfig.json ────────────────────────
		const tsconfigTpl = Handlebars.compile(readTemplate('worker-app/tsconfig.json.hbs'));
		writeFile(path.join(workerAppDir, 'tsconfig.json'), tsconfigTpl({}));

		// ── Generate wrangler.jsonc ───────────────────────
		writeWranglerJsonc(path.join(workerAppDir, 'wrangler.jsonc'), {
			name: `${workerName}-worker`,
			main: 'src/index.ts',
			compatibilityDate: '2026-07-31',
			services: serviceBindings.map((s) => ({ binding: s.toUpperCase(), service: `${s}-worker` })),
			d1Databases: [
				{
					binding: 'DB',
					database_name: `headless-${workerName}`,
					database_id: '<YOUR_DATABASE_ID>',
				},
			],
			vars: {
				ADMIN_PASSWORD: '{{ADMIN_PASSWORD}}',
				JWT_SECRET: '{{JWT_SECRET}}',
				WORKER_GROUP: workerName as string,
			},
		});

		// ── Generate src/index.ts ─────────────────────────
		const indexTpl = Handlebars.compile(readTemplate('worker-app/src/index.ts.hbs'));
		writeFile(
			path.join(workerAppDir, 'src', 'index.ts'),
			indexTpl({
				workerName,
				displayName,
				description: (description as string) || `${displayName} domain worker`,
				pluginIds,
				pluginImports: pluginMetaList,
				pluginDescriptions,
				serviceBindings,
				estimatedSize,
			}),
		);

		// ── Generate src/plugins/.gitkeep ─────────────────
		writeFile(path.join(workerAppDir, 'src', 'plugins', '.gitkeep'), '');

		// ── Copy selected plugin source files ─────────────
		const pluginsDir = getPluginsDir();
		for (const pluginId of pluginIds) {
			const srcPluginDir = path.join(pluginsDir, pluginId);
			const destPluginDir = path.join(workerAppDir, 'src', 'plugins', pluginId);

			if (fs.existsSync(srcPluginDir)) {
				spinner.message(`Copying plugin: ${pluginId}...`);
				copyDir(srcPluginDir, destPluginDir);

				// Update manifest workerGroup
				const manifestPath = path.join(destPluginDir, 'manifest.ts');
				let manifestContent = readFile(manifestPath);
				if (manifestContent) {
					manifestContent = manifestContent.replace(/workerGroup:\s*'[^']*'/, `workerGroup: '${workerName}'`);
					writeFile(manifestPath, manifestContent);
				}
			}
		}

		// ── Update gateway wrangler.jsonc ─────────────────
		const gwWranglerPath = getGatewayWranglerPath();
		const bindingEntry = { binding: (workerName as string).toUpperCase(), service: `${workerName}-worker` };

		if (fs.existsSync(gwWranglerPath)) {
			let gwContent = readFile(gwWranglerPath);
			if (gwContent) {
				const bindingJson = `{ "binding": "${bindingEntry.binding}", "service": "${bindingEntry.service}" }`;
				// Check if binding already exists
				if (!gwContent.includes(bindingEntry.binding) && !gwContent.includes(bindingEntry.service)) {
					// Add to services array
					if (gwContent.includes('"services"')) {
						// Find the last entry in the services array
						const servicesMatch = gwContent.match(/"services"\s*:\s*\[([\s\S]*?)\]/);
						if (servicesMatch) {
							const existingServices = servicesMatch[1].trim();
							const newServices = existingServices ? `${existingServices}\n    ${bindingJson}` : `\n    ${bindingJson}\n  `;
							gwContent = gwContent.replace(/"services"\s*:\s*\[[\s\S]*?\]/, `"services": [${newServices}]`);
						} else {
							// Add services array after main
							gwContent = gwContent.replace(/("main"\s*:\s*"[^"]+")/, `$1,\n  "services": [\n    ${bindingJson}\n  ]`);
						}
					} else {
						// No services array, add one
						gwContent = gwContent.replace(/("main"\s*:\s*"[^"]+")/, `$1,\n  "services": [\n    ${bindingJson}\n  ]`);
					}
					writeFile(gwWranglerPath, gwContent);
				}
			}
		} else {
			// Create a default wrangler.jsonc for the gateway
			writeWranglerJsonc(gwWranglerPath, {
				name: 'headless-api',
				main: 'src/index.ts',
				compatibilityDate: '2026-07-31',
				services: [bindingEntry],
				d1Databases: [
					{
						binding: 'DB',
						database_name: 'headless',
						database_id: '<YOUR_DATABASE_ID>',
					},
				],
				vars: {
					ADMIN_PASSWORD: '{{ADMIN_PASSWORD}}',
					JWT_SECRET: '{{JWT_SECRET}}',
				},
			});
		}

		// ── Update gateway index.ts for service binding route ──
		const apiIndexPath = path.join(getApiDir(), 'src', 'index.ts');
		let apiIndex = readFile(apiIndexPath);
		if (apiIndex) {
			const routeLine = `\n// Service binding: ${workerName} worker (auto-generated by headless worker create)\napp.all('/api/${workerName}/*', (c) => (c.env as Record<string, Fetcher>).${bindingEntry.binding}.fetch(c.req.raw));`;
			// Check if route already exists
			if (!apiIndex.includes(bindingEntry.binding)) {
				// Add before export default or before error handling section
				if (apiIndex.includes('// ─── Error Handling')) {
					apiIndex = apiIndex.replace('// ─── Error Handling', `${routeLine}\n\n// ─── Error Handling`);
				} else if (apiIndex.includes('export default app')) {
					apiIndex = apiIndex.replace('export default app', `${routeLine}\n\nexport default app`);
				} else {
					apiIndex += routeLine;
				}
				writeFile(apiIndexPath, apiIndex);
			}
		}

		spinner.stop(pc.green('Worker application created successfully!'));

		// ── Success output ─────────────────────────────────
		console.log('');
		console.log(pc.green('✓ Created worker app:'));
		console.log(`  ${pc.cyan(`apps/${workerName}-worker/`)}`);
		console.log('');
		console.log(pc.dim('  Files generated:'));
		console.log(pc.dim(`    apps/${workerName}-worker/package.json`));
		console.log(pc.dim(`    apps/${workerName}-worker/tsconfig.json`));
		console.log(pc.dim(`    apps/${workerName}-worker/wrangler.jsonc`));
		console.log(pc.dim(`    apps/${workerName}-worker/src/index.ts`));
		if (plugins.length > 0) {
			for (const pluginId of plugins) {
				console.log(pc.dim(`    apps/${workerName}-worker/src/plugins/${pluginId}/`));
			}
		}
		console.log('');

		if (plugins.length > 0) {
			console.log(pc.green('📦 Copied plugins:'));
			for (const pluginId of plugins) {
				const info = allPlugins.find((p) => p.id === pluginId);
				console.log(`  ${pc.cyan('●')} ${info?.name ?? pluginId} ${pc.dim(`→ apps/${workerName}-worker/src/plugins/${pluginId}/`)}`);
			}
			console.log('');
		}

		if (fs.existsSync(gwWranglerPath)) {
			console.log(pc.green('🔗 Gateway binding added:'));
			console.log(pc.dim(`  ${bindingEntry.binding} → ${bindingEntry.service}`));
			console.log('');
		}

		console.log(pc.bold('Next steps:'));
		console.log(`  ${pc.cyan(`cd apps/${workerName}-worker`)}`);
		console.log(`  ${pc.cyan('pnpm install')}`);
		console.log(`  ${pc.cyan('pnpm dev')}`);
		if (plugins.length > 0) {
			console.log('');
			console.log(pc.dim('  After deploying, set up your D1 database:'));
			console.log(pc.dim(`  npx wrangler d1 create headless-${workerName}`));
		}
		console.log('');
	} catch (err) {
		spinner.stop(pc.red('Failed to generate worker'));
		console.error(pc.red(String(err)));
		if (err instanceof Error) console.error(pc.dim(err.stack ?? ''));
		// Rethrow so the command wrapper exits nonzero — CI must see failures
		throw err;
	}
}

// ── worker:list ────────────────────────────────────────

async function listWorkersCmd(): Promise<void> {
	const appsDir = getAppsDir();
	const allDirs = listDirs(appsDir);
	// Detect BOTH conventions:
	//   1. <name>-worker (legacy worker-app format)
	//   2. plugin-<name> (module create convention — has wrangler.jsonc + worker/index.ts)
	const workerDirs = allDirs.filter((d) => d.endsWith('-worker') || isPluginWorkerApp(path.join(appsDir, d)));

	if (workerDirs.length === 0) {
		// Fall back to legacy workers in apps/api/src/workers/
		const legacyDir = path.join(getApiDir(), 'src', 'workers');
		if (fs.existsSync(legacyDir)) {
			const legacyWorkers = listDir(legacyDir);
			if (legacyWorkers.length > 0) {
				console.log(pc.yellow('Legacy workers found in apps/api/src/workers/'));
				console.log(pc.dim('  (pre-worker-app format — these are entry points only)'));
				console.log('');
				for (const w of legacyWorkers) {
					console.log(`  ${pc.yellow('○')} ${pc.bold(w)} ${pc.dim('(legacy)')}`);
				}
				console.log('');
				console.log(pc.dim('  Run `headless worker create` to generate full worker apps.'));
				return;
			}
		}
		console.log(pc.yellow('No workers found. Run `headless worker create` to create one.'));
		return;
	}

	console.log(pc.cyan(`\n◆ Workers (${workerDirs.length})\n`));

	for (const workerDirName of workerDirs) {
		const workerName = workerDirName.replace(/-worker$/, '').replace(/^plugin-/, '');
		const workerAppDir = path.join(appsDir, workerDirName);

		// Read package.json
		const pkg = readJsonc(path.join(workerAppDir, 'package.json'));
		const pkgName = (pkg?.name as string) ?? workerDirName;

		// Find plugins in src/plugins/
		const pluginsPath = path.join(workerAppDir, 'src', 'plugins');
		const installedPlugins = fs.existsSync(pluginsPath) ? listDir(pluginsPath).filter((d) => d !== '.gitkeep') : [];

		// Read wrangler.jsonc for port
		const wrangler = readJsonc(path.join(workerAppDir, 'wrangler.jsonc'));
		const port = String((wrangler as Record<string, unknown> | null)?.['port'] ?? '—');

		console.log(`  ${pc.green('●')} ${pc.bold(workerName)} ${pc.dim(`(${pkgName})`)}`);
		console.log(`    Port: ${pc.yellow(port)}`);
		console.log(`    Plugins: ${installedPlugins.length > 0 ? pc.cyan(installedPlugins.join(', ')) : pc.dim('none')}`);
		console.log('');
	}
}

// ── worker:assign ──────────────────────────────────────

async function assignWorkerCmd(): Promise<void> {
	const appsDir = getAppsDir();
	const workerDirs = listDirs(appsDir).filter((d) => d.endsWith('-worker'));

	if (workerDirs.length === 0) {
		console.log(pc.yellow('No workers found. Run `headless worker create` first.'));
		return;
	}

	const allPlugins = discoverPlugins();
	const unassignedPlugins = allPlugins.filter((p) => p.workerGroup === 'gateway');

	if (unassignedPlugins.length === 0) {
		console.log(pc.yellow('All plugins are already assigned to workers.'));
		return;
	}

	console.log(pc.cyan('\n◆ Assign plugin to worker\n'));

	const workerOptions = workerDirs.map((d) => ({
		value: d.replace(/-worker$/, ''),
		label: d.replace(/-worker$/, ''),
	}));

	const worker = (await p.select({
		message: 'Select worker',
		options: workerOptions,
	})) as string | symbol;
	if (p.isCancel(worker)) {
		p.cancel('Cancelled');
		return;
	}

	const pluginOptions = unassignedPlugins.map((plugin) => ({
		value: plugin.id,
		label: plugin.name,
		hint: plugin.description || `id: ${plugin.id}`,
	}));

	const plugin = (await p.select({
		message: 'Select plugin to assign',
		options: pluginOptions,
	})) as string | symbol;
	if (p.isCancel(plugin)) {
		p.cancel('Cancelled');
		return;
	}

	const s = p.spinner();
	s.start(`Assigning ${plugin} to ${worker}...`);

	try {
		const workerAppDir = getWorkerAppDir(worker as string);
		const pluginsDir = getPluginsDir();
		const srcPluginDir = path.join(pluginsDir, plugin as string);
		const destPluginDir = path.join(workerAppDir, 'src', 'plugins', plugin as string);

		// Copy plugin source
		if (fs.existsSync(srcPluginDir)) {
			copyDir(srcPluginDir, destPluginDir);

			// Update manifest workerGroup
			const manifestPath = path.join(destPluginDir, 'manifest.ts');
			let manifestContent = readFile(manifestPath);
			if (manifestContent) {
				manifestContent = manifestContent.replace(/workerGroup:\s*'[^']*'/, `workerGroup: '${worker}'`);
				writeFile(manifestPath, manifestContent);
			}
		}

		// Update worker entry point — add import and route
		const indexPath = path.join(workerAppDir, 'src', 'index.ts');
		let indexContent = readFile(indexPath);

		if (indexContent) {
			const factory = pluginIdToFactory(plugin as string);
			const importLine = `import { ${factory} } from './plugins/${plugin}/plugin';`;
			const routeLine = `app.route('/api/${plugin}', ${factory}Routes);`;
			const descLine = `// ${plugin}: auto-assigned plugin`;

			// Add import if not present
			if (!indexContent.includes(importLine)) {
				// Find the last import from './plugins/'
				const lastPluginImport = indexContent.lastIndexOf(`from './plugins/`);
				if (lastPluginImport > -1) {
					const afterLine = indexContent.indexOf('\n', lastPluginImport);
					if (afterLine > -1) {
						indexContent = indexContent.slice(0, afterLine + 1) + importLine + '\n' + indexContent.slice(afterLine + 1);
					}
				} else {
					// Insert after the last @mmbix import
					const lastMmbixImport = indexContent.lastIndexOf(`from '@mmbix/`);
					if (lastMmbixImport > -1) {
						const afterLine = indexContent.indexOf('\n', lastMmbixImport);
						if (afterLine > -1) {
							indexContent = indexContent.slice(0, afterLine + 1) + importLine + '\n' + indexContent.slice(afterLine + 1);
						}
					} else {
						indexContent = importLine + '\n' + indexContent;
					}
				}
			}

			// Add route if not present
			if (!indexContent.includes(`'/api/${plugin}'`)) {
				if (indexContent.includes('// ── Plugins')) {
					indexContent = indexContent.replace(
						'// ── Plugins' + ' ──────────────────────────────────────────',
						'// ── Plugins ──────────────────────────────────────────\n' + descLine + '\n' + routeLine,
					);
				} else if (indexContent.includes(`app.get('/health'`)) {
					indexContent = indexContent.replace("app.get('/health'", descLine + '\n' + routeLine + "\n\napp.get('/health'");
				}
			}

			writeFile(indexPath, indexContent);
		}

		s.stop(pc.green(`Assigned "${plugin}" to "${worker}".`));
		console.log(`  📦 Copied to: ${pc.cyan(`apps/${worker}-worker/src/plugins/${plugin}/`)}`);
		console.log(`  📝 Updated: ${pc.cyan(`apps/${worker}-worker/src/index.ts`)}`);
	} catch (err) {
		s.stop(pc.red('Failed to assign plugin'));
		console.error(pc.red(String(err)));
	}
}

// ── worker:info ────────────────────────────────────────

async function infoWorker(name: string): Promise<void> {
	// Resolve worker dir: try <name>-worker first, then plugin-<name>
	let workerAppDir = getWorkerAppDir(name);
	if (!fs.existsSync(workerAppDir)) {
		const pluginDir = path.join(getAppsDir(), `plugin-${name}`);
		if (fs.existsSync(pluginDir)) workerAppDir = pluginDir;
	}

	if (!fs.existsSync(workerAppDir)) {
		console.error(pc.red(`Worker "${name}" not found at apps/${name}-worker/ or apps/plugin-${name}/`));
		process.exit(1);
	}

	console.log(pc.cyan(`\n◆ Worker: ${name}\n`));

	// package.json
	const pkgPath = path.join(workerAppDir, 'package.json');
	if (fs.existsSync(pkgPath)) {
		console.log(pc.bold('package.json'));
		console.log(readFile(pkgPath) ?? '');
		console.log('');
	}

	// wrangler.jsonc
	const wranglerPath = path.join(workerAppDir, 'wrangler.jsonc');
	if (fs.existsSync(wranglerPath)) {
		console.log(pc.bold('wrangler.jsonc'));
		console.log(readFile(wranglerPath) ?? '');
		console.log('');
	}

	// Entry point: src/index.ts OR worker/index.ts
	const indexPath = path.join(workerAppDir, 'src', 'index.ts');
	const altIndexPath = path.join(workerAppDir, 'worker', 'index.ts');
	const entryPath = fs.existsSync(indexPath) ? indexPath : fs.existsSync(altIndexPath) ? altIndexPath : null;
	if (entryPath) {
		console.log(pc.bold(path.relative(workerAppDir, entryPath)));
		console.log(readFile(entryPath) ?? '');
		console.log('');
	}

	// Plugins
	const pluginsPath = path.join(workerAppDir, 'src', 'plugins');
	if (fs.existsSync(pluginsPath)) {
		const pluginDirs = listDir(pluginsPath).filter((d) => d !== '.gitkeep');
		if (pluginDirs.length > 0) {
			console.log(pc.bold(`Plugins (${pluginDirs.length})`));
			for (const pDir of pluginDirs) {
				console.log(`  ${pc.cyan(pDir)}`);
			}
			console.log('');
		}
	}
}

// ── Register subcommands ──────────────────────────────

export function registerWorkerCommands(program: Command): void {
	const workerCmd = program.command('worker').description('Manage domain workers');

	workerCmd
		.command('create')
		.description('Create a new full-stack domain worker application under apps/')
		.action(async () => {
			try {
				await createWorker();
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	workerCmd
		.command('list')
		.description('List all worker applications')
		.action(async () => {
			try {
				await listWorkersCmd();
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	workerCmd
		.command('assign')
		.description('Assign an unassigned plugin to an existing worker')
		.action(async () => {
			try {
				await assignWorkerCmd();
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	workerCmd
		.command('info [name]')
		.description('Show worker details — guided when run without arguments')
		.action(async (name?: string) => {
			let workerName = name;
			if (!workerName && isInteractive()) {
				const appsDir = getAppsDir();
				const dirs = listDirs(appsDir).filter((d) => d !== 'api' && d !== 'miniapp' && (d.startsWith('plugin-') || d.endsWith('-worker')));
				if (dirs.length === 0) {
					console.log(pc.yellow('  No worker apps found under apps/'));
					return;
				}
				workerName =
					(await guideSelect(
						'Which worker?',
						dirs.map((d) => ({ value: d, label: d })),
					)) ?? undefined;
			}
			if (!workerName) {
				if (!isInteractive()) console.error(pc.red('Usage: headless worker info <worker-name>'));
				return;
			}
			try {
				await infoWorker(workerName);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});
}
