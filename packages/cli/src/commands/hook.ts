import type { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import Handlebars from 'handlebars';
import { writeFile, readFile, listDir, readTemplate, getPluginsDir } from '../utils/file.js';
import path from 'node:path';

// ── hook:add ───────────────────────────────────────────
async function addHook(): Promise<void> {
	console.log(pc.cyan('\n◆ Add a lifecycle hook\n'));

	// 1. Select plugin
	const pluginsDir = getPluginsDir();
	const plugins = listDir(pluginsDir);

	if (plugins.length === 0) {
		console.log(pc.yellow('No plugins found. Run `headless plugin:create` first.'));
		return;
	}

	const pluginId = (await p.select({
		message: 'Which plugin?',
		options: plugins.map((slug) => {
			const manifestPath = path.join(pluginsDir, slug, 'manifest.ts');
			const manifestContent = readFile(manifestPath);
			const nameMatch = manifestContent?.match(/name:\s*'([^']+)'/);
			return {
				value: slug,
				label: nameMatch?.[1] ?? slug,
				hint: `id: ${slug}`,
			};
		}),
	})) as string | symbol;
	if (p.isCancel(pluginId)) return;

	// 2. Collection slug
	const collection = (await p.text({
		message: 'Collection slug',
		placeholder: 'invoices',
		validate(value) {
			if (!value) return 'Collection slug is required';
		},
	})) as string | symbol;
	if (p.isCancel(collection)) return;

	// 3. Event type
	const event = (await p.select({
		message: 'Event type',
		options: [
			{ value: 'validate', label: 'validate', hint: 'before validation runs' },
			{ value: 'before_insert', label: 'before_insert', hint: 'before document is inserted' },
			{ value: 'after_insert', label: 'after_insert', hint: 'after document is inserted' },
			{ value: 'before_update', label: 'before_update', hint: 'before document is updated' },
			{ value: 'after_update', label: 'after_update', hint: 'after document is updated' },
			{ value: 'before_delete', label: 'before_delete', hint: 'before document is deleted' },
			{ value: 'after_delete', label: 'after_delete', hint: 'fire-and-forget — after a soft or hard delete' },
			{ value: 'after_restore', label: 'after_restore', hint: 'fire-and-forget — after a trashed row is restored' },
			{ value: 'on_change', label: 'on_change', hint: 'when any field changes' },
		],
	})) as string | symbol;
	if (p.isCancel(event)) return;

	// 4. Priority
	const priorityStr = (await p.text({
		message: 'Priority (lower = runs first, default 50)',
		placeholder: '50',
		defaultValue: '50',
		validate(value) {
			const n = Number(value);
			if (isNaN(n) || n < 1 || n > 99) return 'Must be a number between 1-99';
		},
	})) as string | symbol;
	if (p.isCancel(priorityStr)) return;
	const priority = Number(priorityStr);

	// 5. Timeout
	const timeoutStr = (await p.text({
		message: 'Timeout (ms, default 5000)',
		placeholder: '5000',
		defaultValue: '5000',
		validate(value) {
			const n = Number(value);
			if (isNaN(n) || n < 1) return 'Must be a positive number';
		},
	})) as string | symbol;
	if (p.isCancel(timeoutStr)) return;
	const timeoutMs = Number(timeoutStr);

	// 6. Description
	const description = (await p.text({
		message: 'Description',
		placeholder: 'Validate invoice totals before save',
		validate(value) {
			if (!value) return 'Description is required';
		},
	})) as string | symbol;
	if (p.isCancel(description)) return;

	// 7. Service init snippet
	const serviceInit = (await p.text({
		message: 'Service init snippet (optional)',
		placeholder: 'const svc = new InvoiceService(db)',
	})) as string | symbol;
	if (p.isCancel(serviceInit)) return;

	// ── Generate hook snippet ──────────────────────────
	const s = p.spinner();
	s.start('Generating hook snippet...');

	try {
		const hookTpl = Handlebars.compile(readTemplate('hook/hook-snippet.ts.hbs'));
		const hookSnippet = hookTpl({
			collection,
			event,
			priority,
			timeoutMs,
			description,
			serviceInit: (serviceInit as string) || '// const svc = new YourService(db)',
		});

		// Inject into plugin.ts after the hooks comment marker
		const pluginPath = path.join(pluginsDir, pluginId as string, 'plugin.ts');
		let pluginContent = readFile(pluginPath);

		if (!pluginContent) {
			s.stop(pc.red('plugin.ts not found'));
			console.error(pc.red(`Expected at: ${pluginPath}`));
			return;
		}

		// Find the hooks marker or register() method body
		const hooksMarker = 'ctx.hooks.on(';
		const registerMarker = 'register(ctx: PluginContext): PluginRegistration {';

		if (pluginContent.includes(hooksMarker)) {
			// Insert after the last existing hook
			const lastHookIdx = pluginContent.lastIndexOf('});');
			const afterHooks = pluginContent.indexOf('\n\n', lastHookIdx);
			if (afterHooks !== -1) {
				pluginContent = pluginContent.slice(0, afterHooks) + '\n\n' + hookSnippet + pluginContent.slice(afterHooks);
			} else {
				pluginContent = pluginContent.slice(0, lastHookIdx + 3) + '\n\n' + hookSnippet + pluginContent.slice(lastHookIdx + 3);
			}
		} else if (pluginContent.includes(registerMarker)) {
			// Insert after the register opening brace
			const braceIdx = pluginContent.indexOf('{', pluginContent.indexOf(registerMarker));
			pluginContent = pluginContent.slice(0, braceIdx + 1) + '\n' + hookSnippet + '\n' + pluginContent.slice(braceIdx + 1);
		} else {
			s.stop(pc.red('Could not find hook injection point in plugin.ts'));
			return;
		}

		writeFile(pluginPath, pluginContent);

		// Also update the manifest if it exists
		const manifestPath = path.join(pluginsDir, pluginId as string, 'manifest.ts');
		let manifestContent = readFile(manifestPath);
		if (manifestContent) {
			const newHookEntry = `{ collection: '${collection}', event: '${event}', priority: ${priority}, timeoutMs: ${timeoutMs}, description: '${description}' }`;

			if (manifestContent.includes('hooks: [')) {
				// Add to existing hooks array
				const hooksOpenIdx = manifestContent.indexOf('hooks: [');
				const insertIdx = manifestContent.indexOf('[', hooksOpenIdx) + 1;
				manifestContent = manifestContent.slice(0, insertIdx) + '\n\t\t' + newHookEntry + ',' + manifestContent.slice(insertIdx);
			} else {
				// Add hooks array after workerGroup
				const workerGroupIdx = manifestContent.indexOf('workerGroup:');
				const lineEnd = manifestContent.indexOf(',', workerGroupIdx);
				manifestContent =
					manifestContent.slice(0, lineEnd + 1) + `\n\thooks: [\n\t\t${newHookEntry},\n\t],` + manifestContent.slice(lineEnd + 1);
			}

			writeFile(manifestPath, manifestContent);
		}

		s.stop(pc.green('Hook added successfully!'));

		console.log('');
		console.log(pc.bold('Generated hook:'));
		console.log(pc.dim('─'.repeat(60)));
		console.log(hookSnippet);
		console.log(pc.dim('─'.repeat(60)));
		console.log('');
		console.log(`  Injected into: ${pc.cyan(`apps/api/src/plugins/${pluginId}/plugin.ts`)}`);
		if (manifestContent) {
			console.log(`  Manifest updated: ${pc.cyan(`apps/api/src/plugins/${pluginId}/manifest.ts`)}`);
		}
		console.log('');
	} catch (err) {
		s.stop(pc.red('Failed to add hook'));
		console.error(pc.red(String(err)));
		// Rethrow so the command wrapper exits nonzero — CI must see failures
		throw err;
	}
}

// ── Register subcommands ──────────────────────────────
export function registerHookCommands(program: Command): void {
	program
		.command('hook:add')
		.description('Add a lifecycle hook to a plugin interactively')
		.action(async () => {
			try {
				await addHook();
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});
}

/**
 * Non-interactive hook injection — called by the unified wizard.
 * Injects a hook snippet into the plugin's plugin.ts and updates its manifest.
 * Returns true on success.
 */
export function injectHook(
	pluginId: string,
	collection: string,
	event: string,
	priority: number,
	timeoutMs: number,
	description: string,
): boolean {
	const pluginsDir = getPluginsDir();
	const pluginDir = path.join(pluginsDir, pluginId);

	// Check that plugin exists
	if (!readFile(path.join(pluginDir, 'plugin.ts'))) return false;

	// Build hook snippet
	const hookTpl = Handlebars.compile(readTemplate('hook/hook-snippet.ts.hbs'));
	const hookSnippet = hookTpl({
		collection,
		event,
		priority,
		timeoutMs,
		description,
		serviceInit: '// const svc = new YourService(db)',
	});

	// Inject into plugin.ts
	const pluginPath = path.join(pluginDir, 'plugin.ts');
	let pluginContent = readFile(pluginPath)!;

	const hooksMarker = 'ctx.hooks.on(';
	const registerMarker = 'register(ctx: PluginContext): PluginRegistration {';

	if (pluginContent.includes(hooksMarker)) {
		const lastHookIdx = pluginContent.lastIndexOf('});');
		const afterHooks = pluginContent.indexOf('\n\n', lastHookIdx);
		if (afterHooks !== -1) {
			pluginContent = pluginContent.slice(0, afterHooks) + '\n\n' + hookSnippet + pluginContent.slice(afterHooks);
		} else {
			pluginContent = pluginContent.slice(0, lastHookIdx + 3) + '\n\n' + hookSnippet + pluginContent.slice(lastHookIdx + 3);
		}
	} else if (pluginContent.includes(registerMarker)) {
		const braceIdx = pluginContent.indexOf('{', pluginContent.indexOf(registerMarker));
		pluginContent = pluginContent.slice(0, braceIdx + 1) + '\n' + hookSnippet + '\n' + pluginContent.slice(braceIdx + 1);
	} else {
		return false;
	}

	writeFile(pluginPath, pluginContent);

	// Update manifest
	const manifestPath = path.join(pluginDir, 'manifest.ts');
	let manifestContent = readFile(manifestPath);
	if (manifestContent) {
		const newHookEntry = `{ collection: '${collection}', event: '${event}', priority: ${priority}, timeoutMs: ${timeoutMs}, description: '${description}' }`;
		if (manifestContent.includes('hooks: [')) {
			const hooksOpenIdx = manifestContent.indexOf('hooks: [');
			const insertIdx = manifestContent.indexOf('[', hooksOpenIdx) + 1;
			manifestContent = manifestContent.slice(0, insertIdx) + '\n\t\t' + newHookEntry + ',' + manifestContent.slice(insertIdx);
		} else {
			const workerGroupIdx = manifestContent.indexOf('workerGroup:');
			const lineEnd = manifestContent.indexOf(',', workerGroupIdx);
			manifestContent =
				manifestContent.slice(0, lineEnd + 1) + `\n\thooks: [\n\t\t${newHookEntry},\n\t],` + manifestContent.slice(lineEnd + 1);
		}
		writeFile(manifestPath, manifestContent);
	}

	return true;
}
