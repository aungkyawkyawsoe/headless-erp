import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { isInteractive } from '../src/utils/prompt.js';
import { registerPluginCommands } from '../src/commands/plugin.js';
import { registerWorkerCommands } from '../src/commands/worker.js';
import { registerModuleCommands } from '../src/commands/module.js';
import { registerOpsCommands } from '../src/commands/ops.js';
import { registerHookCommands } from '../src/commands/hook.js';
import { registerDevCommand } from '../src/commands/dev.js';
import { registerShellCommand } from '../src/commands/shell.js';
import { registerConfigCommands } from '../src/commands/config.js';
import { registerDbCommands } from '../src/commands/db.js';
import { registerTranslateCommands } from '../src/commands/translate.js';
import { registerClientCommands } from '../src/commands/client.js';
import { registerInitCommand } from '../src/commands/init.js';
import { registerMenuCommands } from '../src/commands/menu.js';
import { registerCollectionCommands } from '../src/commands/collection.js';
import { createWizard } from '../src/commands/create.js';
import { setFormatContext } from '../src/utils/format.js';
import { registerCompletionCommand, handleCompletion } from '../src/commands/completion.js';
import { initTelemetry, trackCommand } from '../src/utils/telemetry.js';
import { cliVersion } from '../src/utils/file.js';

const program = new Command();

// ── Project env loader ───────────────────────────────────
// Load .env.local / .env from the project root (CWD upward) into process.env
// WITHOUT overriding existing variables. `headless init` writes MMBIX_* login
// defaults to .env.local so CLI commands authenticate immediately.
function loadProjectEnv(): void {
	let dir = process.cwd();
	while (true) {
		for (const file of ['.env.local', '.env']) {
			const envPath = path.join(dir, file);
			if (!fs.existsSync(envPath)) continue;
			const content = fs.readFileSync(envPath, 'utf-8');
			for (const rawLine of content.split('\n')) {
				const line = rawLine.trim();
				if (!line || line.startsWith('#')) continue;
				const eq = line.indexOf('=');
				if (eq === -1) continue;
				const key = line.slice(0, eq).trim();
				if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue;
				if (process.env[key] !== undefined) continue;
				let value = line.slice(eq + 1).trim();
				if (value.startsWith('"')) {
					const end = value.lastIndexOf('"');
					value = end > 0 ? value.slice(1, end) : value.slice(1);
					value = value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
				} else if (value.startsWith("'")) {
					const end = value.lastIndexOf("'");
					value = end > 0 ? value.slice(1, end) : value.slice(1);
				} else {
					const hash = value.indexOf('#');
					if (hash !== -1) value = value.slice(0, hash);
					value = value.trim();
				}
				process.env[key] = value;
			}
			return; // first env file found wins
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
}
loadProjectEnv();

// Single source of truth: packages/cli/package.json (never hardcode here)
const VERSION = cliVersion();

program.name('headless').description('Headless CMS CLI — scaffold plugins, workers, and hooks').version(VERSION);

// ── Global Flags ────────────────────────────────────────
program
	.option('-p, --profile <name>', 'Profile to use from .headlessrc', 'dev')
	.option('--json', 'Output as JSON (machine-readable)')
	.option('--dry-run', 'Preview without executing')
	.option('-y, --yes', 'Skip confirmation prompts')
	.option('--verbose', 'Show verbose output')
	.option('--no-color', 'Disable colored output')
	.option('--telemetry', 'Enable anonymous usage telemetry')
	.option('--no-telemetry', 'Disable anonymous usage telemetry');

// ── Hook: set format context & init telemetry ──────────
program.hook('preAction', (thisCommand) => {
	const opts = thisCommand.opts<{
		json?: boolean;
		noColor?: boolean;
		dryRun?: boolean;
		verbose?: boolean;
		telemetry?: boolean;
		noTelemetry?: boolean;
	}>();
	setFormatContext({
		json: opts.json ?? false,
		noColor: opts.noColor ?? false,
		dryRun: opts.dryRun ?? false,
		verbose: opts.verbose ?? false,
	});

	// Telemetry: explicit flag overrides persisted config
	const telemetryEnabled = opts.telemetry === true ? true : opts.noTelemetry === true ? false : undefined;
	initTelemetry(telemetryEnabled, undefined, VERSION);

	// Track this command invocation
	const cmdName = thisCommand.name();
	trackCommand(cmdName, opts as Record<string, unknown>);
});

// ── Plugin Commands ─────────────────────────────────────
registerPluginCommands(program);

// ── Worker Commands ─────────────────────────────────────
registerWorkerCommands(program);

// ── Module Commands (entities + frontend plugin) ────────
registerModuleCommands(program);

// ── Menu Commands (module menu trees) ───────────────────
registerMenuCommands(program);

// ── Collection Commands (API-first table lifecycle) ─────
registerCollectionCommands(program);

// ── Hook Commands ───────────────────────────────────────
registerHookCommands(program);

// ── Dev Command ─────────────────────────────────────────
registerDevCommand(program);

// ── Shell Command ───────────────────────────────────────
registerShellCommand(program);

// ── Config Commands ─────────────────────────────────────
registerConfigCommands(program);

// ── DB Commands ─────────────────────────────────────────
registerDbCommands(program);

// ── Ops Commands (deploy, status, logs) ──────────────────
registerOpsCommands(program);

// ── Translate Commands (i18n) ───────────────────────────
registerTranslateCommands(program);

// ── Client Commands (software factory onboarding) ────────
registerClientCommands(program);

// ── Init Command (fresh project from starter template) ────
registerInitCommand(program);

// ── Completion Commands ──────────────────────────────────
registerCompletionCommand(program);

// ── Unified Create Wizard ───────────────────────────────
program
	.command('create')
	.description('Guided step-by-step wizard — create plugins, hooks, workers, or collections')
	.action(async () => {
		await createWizard();
	});

// ── Unified "New App" journey ───────────────────────────
// One guided flow that chains the existing public commands: init (scaffold) →
// optional collection → optional client add + deploy. Reuses the already-
// registered commands by re-invoking the program with their args.
program
	.command('new')
	.description('Start a whole app in one guided journey: init → collection → client → deploy')
	.action(async () => {
		const { newWizard } = await import('../src/commands/new.js');
		await newWizard(program);
	});

// Store the program on globalThis so the completion engine can access it
(globalThis as unknown as { __headlessProgram?: Command }).__headlessProgram = program;

// Hook: intercept --_complete before normal parsing
const args = process.argv;
const completeIdx = args.indexOf('--_complete');
if (completeIdx >= 0 && completeIdx + 2 < args.length) {
	const count = parseInt(args[completeIdx + 1], 10);
	const line = args[completeIdx + 2];
	if (!isNaN(count)) {
		handleCompletion(count, line);
		process.exit(0);
	}
}

// ── Top-level menu: bare `headless` in a TTY → group picker ──
// No command given and a real terminal → show an interactive category menu
// (like `gh` / `create-t3-app`). Non-TTY keeps commander's default help.
const argv0 = process.argv.slice(2)[0];
if (argv0 === undefined && isInteractive()) {
	void (async () => {
		const { guideSelect } = await import('../src/utils/prompt.js');
		const p = await import('@clack/prompts');
		p.intro(pc.green(' headless — build apps from declarative data '));
		const group = await guideSelect('What do you want to do?', [
			{ value: 'new', label: '🚀 New project', hint: 'Scaffold a whole app: init → collection → client → deploy' },
			{ value: 'client', label: '🏢 Tenant / client', hint: 'headless client add · deploy · status · destroy' },
			{ value: 'db', label: '🗄  Database', hint: 'backup · restore · migrate · schema · export/import' },
			{ value: 'scaffold', label: '🔧 Scaffold', hint: 'module · collection · plugin · worker · menu' },
			{ value: 'ops', label: '🛠  Ops', hint: 'deploy · status · logs' },
		]);
		if (!group) {
			p.outro('See you!');
			process.exit(0);
		}
		const sub: Record<string, { cmd: string; flag?: string }> = {
			new: { cmd: 'new' },
			client: { cmd: 'client add' },
			db: { cmd: 'db backup' },
			scaffold: { cmd: 'create' },
			ops: { cmd: 'status' },
		};
		const target = sub[group];
		p.outro(`Running: headless ${target.cmd}`);
		process.argv = [process.argv[0], process.argv[1], ...target.cmd.split(' ')];
		program.parse();
	})().catch((err) => {
		console.error(err);
		process.exit(1);
	});
} else {
	program.parse();
}

// ── Parse ───────────────────────────────────────────────
