/**
 * headless init — scaffold a fresh project from the starter template.
 *
 * Usage:
 *   headless init my-saas                 # scaffold a nested project
 *   headless init .                       # initialize the current directory in place
 *   headless init                         # inside a cloned template: initializes that folder
 *   headless init my-saas --template <git-url-or-path>   # from a template source
 *   headless init my-saas --skip-install  # don't run pnpm install
 *   headless init my-saas --yes           # non-interactive
 *
 * Guided mode (run without flags) also asks for the bootstrap superadmin:
 * email + display name + password — written to apps/api/.dev.vars so the
 * first `pnpm dev` creates that admin automatically (ADMIN_NAME supported
 * by the API since 0.9.0).
 *
 * The starter template is a clean, production-ready monorepo (API worker +
 * mini app with Tailwind v4 + core system) with NO business
 * modules pre-installed. After init, scaffold what you need (Strapi/Frappe style):
 *   headless module create          # guided: entities + mini app plugin
 *   headless collection create Blog --template blog
 *   headless create                 # unified wizard (plugin / hook / worker / collection)
 */

import type { Command } from 'commander';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execSync, spawnSync } from 'node:child_process';
import { monorepoRoot, ensureDir, readFile, writeFile, writeSecretFile, listDir } from '../utils/file.js';

// ─── Constants ────────────────────────────────────────────

/** Paths never copied into a fresh project. */
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', '.turbo', '.wrangler', '.playwright-mcp', '.cache', 'tmp']);
const EXCLUDED_FILES = new Set(['.DS_Store', 'tsconfig.tsbuildinfo', '*.tsbuildinfo']);

interface AdminCredentials {
	email: string;
	name: string;
	password: string;
}

// ─── Helpers ──────────────────────────────────────────────

function validateProjectName(name: string): string | null {
	if (!name || name.trim().length === 0) return 'Project name is required';
	const clean = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '');
	// Case-sensitive: uppercase names pass the lowercased comparison but produce
	// invalid Cloudflare resource names (workers/buckets/queues must be lowercase).
	if (clean !== name.trim()) return `Project name must be kebab-case (e.g. "my-saas") — got "${name}"`;
	if (!/^[a-z][a-z0-9-]*$/.test(clean)) return 'Project name must start with a letter and use only lowercase letters, numbers, dashes';
	return null;
}

/** Sanitize any string into a valid lowercase kebab-case project name. */
function projectNameClean(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DB_NAME_RE = /^[a-z0-9-]+$/;

/**
 * Validate a `--template` source before it touches the shell.
 *
 * Allowed (no shell, ever):
 *   - https://… / http://… / git://… URLs
 *   - git@host:path scp-style SCP URLs
 *   - plain GitHub shorthand `owner/repo`
 * Anything else (spaces, semicolons, flags, env assignments…) is rejected.
 */
function isValidTemplateSource(value: string): boolean {
	if (/^(https?:|git:\/\/)\S+$/i.test(value)) return true;
	if (/^git@[\w.-]+:[\w./-]+$/.test(value)) return true;
	if (/^[\w.-]+\/[\w.-]+$/.test(value)) return true;
	return false;
}

/** Whether dir is inside an existing git work tree (walk up looking for .git). */
function isInsideGitWorkTree(dir: string): boolean {
	let cur = path.resolve(dir);
	for (;;) {
		if (fs.existsSync(path.join(cur, '.git'))) return true;
		const parent = path.dirname(cur);
		if (parent === cur) return false;
		cur = parent;
	}
}

/** Recursively copy the template, skipping build artifacts and local state.
 * Never descends into the destination directory — scaffolding from inside the
 * template root (e.g. `headless init my-saas` run from the repo itself) would
 * otherwise copy the new project into itself forever.
 */
function copyTemplate(srcRoot: string, destRoot: string): void {
	ensureDir(destRoot);
	const entries = fs.readdirSync(srcRoot, { withFileTypes: true });
	for (const entry of entries) {
		if (EXCLUDED_DIRS.has(entry.name)) continue;
		if (EXCLUDED_FILES.has(entry.name) || entry.name.endsWith('.tsbuildinfo')) continue;
		const src = path.join(srcRoot, entry.name);
		const dest = path.join(destRoot, entry.name);
		// Skip the output directory itself when it lives inside the source tree.
		if (destRoot === src || destRoot.startsWith(src + path.sep)) continue;
		if (entry.isDirectory()) {
			copyTemplate(src, dest);
		} else {
			fs.copyFileSync(src, dest);
		}
	}
}

/** Rename the root package + lockfile header so the project is its own package. */
function personalizeProject(destRoot: string, projectName: string): void {
	// Root package.json
	const pkgPath = path.join(destRoot, 'package.json');
	const pkgRaw = readFile(pkgPath);
	if (pkgRaw) {
		try {
			const pkg = JSON.parse(pkgRaw) as { name?: string; description?: string };
			if (pkg.name === 'headless-cms') pkg.name = projectName;
			pkg.description = `Headless entity engine starter — ${projectName}`;
			writeFile(pkgPath, JSON.stringify(pkg, null, '\t') + '\n');
		} catch {
			/* leave as-is */
		}
	}
}

/** Strong random secret (URL-safe). */
function randomSecret(bytes = 32): string {
	return randomBytes(bytes).toString('base64url');
}

/** Strong random password (18 chars, URL-safe so it survives .env files). */
function randomPassword(): string {
	return randomBytes(18).toString('base64url');
}

/**
 * Quote a value for .dev.vars / .env files.
 * Unquoted values are truncated at `#` by dotenv-style parsers (wrangler
 * included), so any value that may contain special characters must be quoted.
 */
function envQuote(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Resolve the D1 database name.
 * Guided mode (TTY): prompt with a sensible default (<project>-db).
 * Flags or CI: use --db-name or fall back to <project>-db.
 */
async function resolveDbName(opts: { dbName?: string }, projectName: string): Promise<string> {
	const isTTY = Boolean(process.stdout.isTTY);

	let dbName = opts.dbName?.trim();
	if (isTTY && !dbName) {
		console.log(pc.cyan('\n  ── Database ─────────────────────────────────────────────'));
		const prompted = (await p.text({
			message: 'D1 database name?',
			initialValue: `${projectName}-db`,
			validate: (v) => (DB_NAME_RE.test((v ?? '').trim()) ? undefined : 'Use only lowercase letters, digits and hyphens'),
		})) as string;
		if (p.isCancel(prompted)) process.exit(0);
		dbName = prompted.trim();
	}

	dbName = dbName || `${projectName}-db`;
	if (!DB_NAME_RE.test(dbName)) {
		console.error(pc.red(`DB name may only contain lowercase letters, digits and hyphens — got "${dbName}"`));
		process.exit(1);
	}
	return dbName;
}

/**
 * Personalize Cloudflare resource names in the scaffolded project so it never
 * inherits the template's D1/R2/queue/worker names. Deploying a raw clone as-is
 * would attach to the starter author's production resources, so every resource
 * is renamed to <project>-<resource> and the real D1 ids are blanked.
 */
function writeWranglerConfig(destRoot: string, projectName: string, dbName: string): void {
	const apiPath = path.join(destRoot, 'apps', 'api', 'wrangler.jsonc');
	const fePath = path.join(destRoot, 'apps', 'miniapp', 'wrangler.jsonc');
	const placeholderId = '00000000-0000-0000-0000-000000000000';
	// Cloudflare resource names must be lowercase — never trust the raw input.
	const safe = projectName.toLowerCase();

	const api = readFile(apiPath);
	if (api) {
		// Name-agnostic: the source config may ship with the template's base names
		// (headless-cms-*) OR already be personalized (e.g. this repo). Every name
		// value is rewritten regardless. `"name"` matches the FIRST occurrence only —
		// the top-level worker name (DO bindings use `"name"` too, but they appear
		// later in the file and their binding names must be preserved).
		const out = api
			.replace(/"name"\s*:\s*"[^"]*"/, `"name": "${safe}-api"`)
			.replace(/"database_name"\s*:\s*"[^"]*"/, `"database_name": "${dbName}"`)
			.replace(/"database_id"\s*:\s*"[^"]*"/, `"database_id": "${placeholderId}"`)
			.replace(/"preview_database_id"\s*:\s*"[^"]*"/, `"preview_database_id": "${placeholderId}"`)
			.replace(/"bucket_name"\s*:\s*"[^"]*"/, `"bucket_name": "${safe}-media"`)
			.replace(/"queue"\s*:\s*"[^"]*"/g, `"queue": "${safe}-webhook-delivery"`)
			.replace(/"dead_letter_queue"\s*:\s*"[^"]*"/, `"dead_letter_queue": "${safe}-webhook-dlq"`)
			.replace(/"dataset"\s*:\s*"[^"]*"/, `"dataset": "${safe}_api_requests"`);
		writeFile(apiPath, out);
	}

	const fe = readFile(fePath);
	if (fe) {
		const out = fe
			.replace(/"name"\s*:\s*"[^"]*"/, `"name": "${safe}-miniapp"`)
			.replace(/"service"\s*:\s*"[^"]*"/g, `"service": "${safe}-api"`);
		writeFile(fePath, out);
	}
}

/**
 * Resolve the bootstrap superadmin credentials.
 * Guided mode (TTY): prompt for email / name / password (+ confirm).
 * Flags or CI: use provided values; fall back to generated defaults.
 */
async function resolveAdmin(
	opts: { adminEmail?: string; adminName?: string; adminPassword?: string },
	projectName: string,
): Promise<AdminCredentials> {
	const isTTY = Boolean(process.stdout.isTTY);

	let email = opts.adminEmail?.trim();
	let name = opts.adminName?.trim();
	let password = opts.adminPassword;

	if (isTTY && (!email || !password)) {
		console.log(pc.cyan('\n  ── Bootstrap superadmin ──────────────────────────────'));
		if (!email) {
			const prompted = (await p.text({
				message: 'Admin email (superadmin login)?',
				placeholder: `admin@${projectName}.local`,
				validate: (v) => (EMAIL_RE.test((v ?? '').trim()) ? undefined : 'Enter a valid email address'),
			})) as string;
			if (p.isCancel(prompted)) process.exit(0);
			email = prompted.trim();
		}
		if (!name) {
			const prompted = (await p.text({
				message: 'Admin display name?',
				initialValue: 'Administrator',
				placeholder: 'Administrator',
			})) as string;
			if (p.isCancel(prompted)) process.exit(0);
			name = prompted.trim() || 'Administrator';
		}
		if (!password) {
			password = (await p.password({
				message: 'Admin password (min 8 chars)?',
				validate: (v) => ((v ?? '').length >= 8 ? undefined : 'Password must be at least 8 characters'),
			})) as string;
			if (p.isCancel(password)) process.exit(0);
			const confirm = (await p.password({ message: 'Confirm password?' })) as string;
			if (p.isCancel(confirm)) process.exit(0);
			if (confirm !== password) {
				console.error(pc.red('Passwords do not match — aborting.'));
				process.exit(1);
			}
		}
	}

	// Non-interactive fallbacks
	email = email || `admin@${projectName}.local`;
	name = name || 'Administrator';
	if (!password) {
		password = randomPassword();
		console.log(
			pc.yellow(
				`  ⚠️  No --admin-password provided — generated: ${pc.bold(password)}\n     Save it now; it is also written to apps/api/.dev.vars (git-ignored).`,
			),
		);
	}
	if (password.length < 8) {
		console.error(pc.red('Admin password must be at least 8 characters.'));
		process.exit(1);
	}
	return { email, name, password };
}

/**
 * Write apps/api/.dev.vars (git-ignored) with the bootstrap admin credentials,
 * and rewrite wrangler.jsonc vars.ADMIN_USERNAME so the deployed var matches.
 */
function writeAdminEnv(destRoot: string, admin: AdminCredentials): void {
	const apiDir = path.join(destRoot, 'apps', 'api');
	const devVarsPath = path.join(apiDir, '.dev.vars');
	const devVars = [
		'# Generated by `headless init` — local dev secrets (git-ignored), NEVER commit.',
		'# Production: npx wrangler secret put ADMIN_PASSWORD / JWT_SECRET',
		`ADMIN_USERNAME=${envQuote(admin.email)}`,
		`ADMIN_PASSWORD=${envQuote(admin.password)}`,
		`ADMIN_NAME=${envQuote(admin.name)}`,
		`JWT_SECRET=${envQuote(randomSecret())}`,
		'# LOCAL-ONLY dev mode (enables the publicly-known dev-token). Never set in production vars.',
		'IS_DEV=true',
		'',
	].join('\n');
	writeSecretFile(devVarsPath, devVars);

	// Keep the tracked wrangler var in sync with the chosen admin email
	const wranglerPath = path.join(apiDir, 'wrangler.jsonc');
	const wranglerRaw = readFile(wranglerPath);
	if (wranglerRaw) {
		writeFile(wranglerPath, wranglerRaw.replace(/"ADMIN_USERNAME"\s*:\s*"[^"]*"/, `"ADMIN_USERNAME": "${admin.email}"`));
	}

	// Append the CLI's login defaults so `headless module create` etc. work immediately
	// (the CLI auto-loads .env.local from the project root on every command). Both
	// files hold plaintext secrets (ADMIN_PASSWORD / JWT_SECRET) — owner-only (0600).
	const cliEnvPath = path.join(destRoot, '.env.local');
	writeSecretFile(
		cliEnvPath,
		'# Generated by `headless init` — local CLI login defaults (git-ignored)\n' +
			`MMBIX_ADMIN_EMAIL=${envQuote(admin.email)}\n` +
			`MMBIX_ADMIN_PASSWORD=${envQuote(admin.password)}\n`,
	);
}

// ─── Commands ─────────────────────────────────────────────

export async function initProject(
	name: string | undefined,
	opts: {
		template?: string;
		skipInstall?: boolean;
		yes?: boolean;
		adminEmail?: string;
		adminName?: string;
		adminPassword?: string;
		dbName?: string;
	},
): Promise<void> {
	const { template, skipInstall } = opts;

	// Resolve template source
	let srcRoot = monorepoRoot;
	if (template) {
		if (fs.existsSync(template)) {
			srcRoot = path.resolve(template);
		} else if (isValidTemplateSource(template)) {
			console.log(pc.cyan(`→ Cloning template ${template} …`));
			const tmp = path.join(process.cwd(), '.headless-init-tmp');
			fs.rmSync(tmp, { recursive: true, force: true });
			// Args array + no shell: the template string can never inject into the
			// command line (e.g. `--upload-pack`, `; rm -rf …`).
			const clone = spawnSync('git', ['clone', '--depth', '1', template, tmp], { stdio: 'inherit' });
			if (clone.status !== 0) {
				throw new Error(`Failed to clone template "${template}" (git exited with ${clone.status ?? 'signal'})`);
			}
			srcRoot = tmp;
		} else {
			throw new Error(
				`Template source not found or invalid: "${template}". Use a directory path, a git URL (https://, git://, git@host:path), or GitHub shorthand owner/repo.`,
			);
		}
	}

	// Resolve target: `headless init <name>` scaffolds a nested project;
	// `headless init` (inside a cloned template) or `headless init .` initializes
	// the CURRENT directory in place — one folder = one project, no double nesting.
	const cwd = process.cwd();
	const cwdIsSrc = path.resolve(cwd) === path.resolve(srcRoot);

	let projectName: string;
	let destRoot: string;
	let inPlace = false;

	if (name && name !== '.') {
		const validationError = validateProjectName(name);
		if (validationError) {
			console.error(pc.red(validationError));
			process.exit(1);
		}
		projectName = name;
		destRoot = path.resolve(cwd, name);
	} else if (name === '.') {
		inPlace = true;
		const folderName = path.basename(cwd);
		projectName = projectNameClean(folderName) || 'app';
		if (projectName !== folderName) {
			console.log(pc.yellow(`  Note: folder "${folderName}" → project name "${projectName}" (Cloudflare names must be lowercase).`));
		}
		destRoot = cwd;
	} else if (cwdIsSrc) {
		// No name inside the template root → initialize the clone itself
		inPlace = true;
		const folderName = path.basename(cwd);
		projectName = projectNameClean(folderName) || 'app';
		if (projectName !== folderName) {
			console.log(pc.yellow(`  Note: folder "${folderName}" → project name "${projectName}" (Cloudflare names must be lowercase).`));
		}
		destRoot = cwd;
	} else if (process.stdout.isTTY) {
		// No name elsewhere → guided project-name flow (nested scaffold)
		const prompted = (await p.text({
			message: 'Project name (kebab-case):',
			placeholder: 'my-saas',
			validate: (v) => validateProjectName(v ?? '') ?? undefined,
		})) as string;
		if (p.isCancel(prompted)) process.exit(0);
		projectName = prompted;
		destRoot = path.resolve(cwd, projectName);
	} else {
		console.error(
			pc.red('Project name required — usage: headless init <name> (or run inside a cloned template to initialize the current directory).'),
		);
		process.exit(1);
	}

	if (inPlace) {
		const validationError = validateProjectName(projectName);
		if (validationError) {
			console.error(pc.red(`Cannot initialize current directory as "${projectName}": ${validationError}`));
			process.exit(1);
		}
		// Mutating a fresh clone in place — confirm unless --yes
		if (cwdIsSrc && process.stdout.isTTY && !opts.yes) {
			const ok = (await p.confirm({
				message: `Initialize current directory "${projectName}" in place? (personalizes config, keeps git history)`,
				initialValue: true,
			})) as boolean | symbol;
			if (p.isCancel(ok) || ok === false) process.exit(0);
		}
	}

	// Copy the template (skipped when personalizing the template clone in place)
	if (!(inPlace && cwdIsSrc)) {
		if (fs.existsSync(destRoot) && listDir(destRoot).length > 0) {
			if (opts.yes) {
				fs.rmSync(destRoot, { recursive: true, force: true });
			} else {
				console.error(pc.red(`Directory "${projectName}" already exists and is not empty. Use --yes to overwrite.`));
				process.exit(1);
			}
		}
		console.log(
			pc.cyan(inPlace ? '→ Copying starter template into current directory …' : `→ Scaffolding "${projectName}" from starter template …`),
		);
		copyTemplate(srcRoot, destRoot);

		// Remove the temporary clone if we made one
		if (template && !fs.existsSync(template) && srcRoot.startsWith(process.cwd())) {
			fs.rmSync(srcRoot, { recursive: true, force: true });
		}
	} else {
		console.log(pc.cyan(`→ Initializing current directory "${projectName}" from starter template …`));
	}

	personalizeProject(destRoot, projectName);

	// D1 database name + Cloudflare resource names (never inherit the template's)
	const dbName = await resolveDbName(opts, projectName);
	writeWranglerConfig(destRoot, projectName, dbName);

	// Bootstrap superadmin: email / name / password → apps/api/.dev.vars
	const admin = await resolveAdmin(opts, projectName);
	writeAdminEnv(destRoot, admin);

	// Fresh client registry (no tenants) — flat object keyed by prefix,
	// matching exactly what the `client` commands read/write.
	writeFile(path.join(destRoot, 'clients', 'registry.json'), JSON.stringify({}, null, '\t') + '\n');

	// Version the new project so husky hooks install cleanly on `pnpm install`
	// (skipped when scaffolding inside an existing git work tree, e.g. the template repo)
	if (!isInsideGitWorkTree(destRoot)) {
		console.log(pc.cyan('→ Initializing git repository …'));
		execSync('git init', { cwd: destRoot, stdio: 'inherit' });
	}

	console.log(pc.green(inPlace ? `✓ Initialized ${projectName}/` : `✓ Created ${projectName}/`));

	if (!skipInstall) {
		console.log(pc.cyan('→ Installing dependencies (pnpm install) …'));
		execSync('pnpm install', { cwd: destRoot, stdio: 'inherit' });
	}

	console.log('');
	console.log(pc.bold('Next steps:'));
	if (!inPlace) console.log(`  cd ${projectName}`);
	console.log('  pnpm dev                      # API :8788 · miniapp :5175');
	console.log('  npx headless db seed --confirm    # reset DB to a clean slate (optional)');
	console.log('  npx headless module create      # generate a module (entities + plugin)');
	console.log('  npx headless collection create  # API-first collection with templates');
	console.log('  npx headless client add acme      # onboard a tenant');
	console.log('  npx headless deploy               # ship to Cloudflare');
	console.log('  docs: docs/README.md     # full API reference (architecture, entities, security)');
	console.log(pc.dim('  (npx runs the CLI from this repo — `pnpm cli:link` is optional, for a global `headless` command)'));
	console.log('');
	console.log(pc.bold('Bootstrap superadmin (written to apps/api/.dev.vars):'));
	console.log(`  Email:    ${pc.cyan(admin.email)}`);
	console.log(`  Name:     ${pc.cyan(admin.name)}`);
	console.log(`  Password: ${pc.cyan(admin.password)}`);
	console.log(
		pc.dim(
			`  Database: ${dbName} — D1 database_name in apps/api/wrangler.jsonc (run \`npx wrangler d1 create ${dbName}\` before deploying).`,
		),
	);
	console.log(pc.dim('  Login at http://localhost:5173 after `pnpm dev`. Rotate the password in production.'));
	if (inPlace) console.log(pc.dim('  Tip: point git at your own remote — git remote set-url origin <your-repo-url>'));
}

// ─── Register ─────────────────────────────────────────────

export function registerInitCommand(program: Command): void {
	program
		.command('init')
		.description('Scaffold a fresh project from the starter template (like create-next-app)')
		.argument('[name]', 'Project name (kebab-case) — omit or use "." to initialize the current directory')
		.option('-t, --template <source>', 'Template source: a path, git URL, or omit to use the current repo')
		.option('--db-name <name>', 'D1 database name (default: <project>-db)')
		.option('--admin-email <email>', 'Bootstrap superadmin email (skips guided prompt)')
		.option('--admin-name <name>', 'Bootstrap superadmin display name')
		.option('--admin-password <password>', 'Bootstrap superadmin password (min 8 chars)')
		.option('--skip-install', 'Skip pnpm install after scaffolding')
		.option('-y, --yes', 'Non-interactive — overwrite existing directory')
		.action(
			async (
				name: string | undefined,
				opts: {
					template?: string;
					skipInstall?: boolean;
					yes?: boolean;
					adminEmail?: string;
					adminName?: string;
					adminPassword?: string;
					dbName?: string;
				},
			) => {
				try {
					await initProject(name, opts);
				} catch (err) {
					console.error(pc.red('Init failed:'), err instanceof Error ? err.message : err);
					process.exit(1);
				}
			},
		);
}
