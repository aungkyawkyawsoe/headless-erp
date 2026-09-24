/**
 * Client Commands — Software Factory multi-tenant onboarding
 *
 * `headless client add`       → Guided wizard: company → prefix → resources → save
 * `headless client list`      → Show all registered clients
 * `headless client deploy`    → Deploy all workers for a client with prefix
 * `headless client status`    → Show a client's resource naming map
 * `headless client destroy`   → Tear down a client (workers, D1, R2, local files)
 *
 * Each client gets a `clients/<prefix>/` folder holding its .env (prefix,
 * account ids, tokens) and a registry entry in `clients/registry.json`.
 *
 * Naming convention (all resources are account-global, so prefix is required):
 *   worker   → {prefix}-headless-cms | {prefix}-miniapp
 *   D1       → {prefix}-cms-db
 *   R2       → {prefix}-cms-media
 *   KV       → {prefix}-cms-kv
 *   tables   → {prefix}_{table}
 */
import type { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { projectRoot, ensureDir, writeFile, readFile, getApiDir, cliVersion } from '../utils/file.js';
import { printTable } from '../utils/format.js';
import { guideSelect, guideMultiselect, guideConfirm, isInteractive } from '../utils/prompt.js';

// ─── Paths ──────────────────────────────────────────────

function clientsDir(): string {
	// Project-scoped (CWD upward) — the registry lives in the project the user
	// is working in, not in the CLI's own repo.
	return path.join(projectRoot(), 'clients');
}

function registryPath(): string {
	return path.join(clientsDir(), 'registry.json');
}

function clientDir(prefix: string): string {
	return path.join(clientsDir(), prefix);
}

// ─── Registry ───────────────────────────────────────────

interface ClientRecord {
	prefix: string;
	company: string;
	accountStrategy: 'shared' | 'dedicated';
	accountId?: string;
	domains?: { app?: string; api?: string };
	resources: {
		api_worker: string;
		frontend_worker: string;
		d1: string;
		r2: string;
		kv: string;
		table_prefix: string;
	};
	created: string;
	version: string;
}

function readRegistry(): Record<string, ClientRecord> {
	const raw = readFile(registryPath());
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		// Accept BOTH shapes: the canonical `{ version, clients: {} }` envelope
		// (written by `headless init` / `writeRegistry`) and a legacy flat
		// `{ prefix: record }` map. Guard against stray scalar entries.
		const clientsVal = parsed.clients;
		if (clientsVal && typeof clientsVal === 'object' && !Array.isArray(clientsVal)) {
			return clientsVal as Record<string, unknown> as Record<string, ClientRecord>;
		}
		// Legacy flat map — keep only entries that look like a client record.
		const out: Record<string, ClientRecord> = {};
		for (const [prefix, value] of Object.entries(parsed)) {
			if (value && typeof value === 'object' && typeof (value as ClientRecord).prefix === 'string') {
				out[prefix] = value as ClientRecord;
			}
		}
		return out;
	} catch {
		return {};
	}
}

function writeRegistry(registry: Record<string, ClientRecord>): void {
	ensureDir(clientsDir());
	// Preserve the canonical `{ version, clients }` envelope (the shape
	// `headless init` writes). `readRegistry` accepts both the envelope and the
	// flat map, but writes must stay stable so the file isn't reshaped by a add/destroy.
	writeFile(registryPath(), JSON.stringify({ version: '0.8.0', clients: registry }, null, 2) + '\n');
}

/**
 * Remove a top-level property (and its value) from a JSONC string by brace
 * matching. Robust where a regex can't be: walks the text, finds the key, then
 * scans past the matching close brace for `{` / `[` values while skipping
 * quoted strings, so nested objects/arrays and comments don't break it.
 */
function stripTopLevelKey(jsonc: string, targetKey: string): string {
	// Find the top-level `"key" :` occurrence (only match at brace/paren depth 0
	// so a nested `queues` under another object — e.g. inside `bindings` — is left
	// alone; a factory's `"queues"` is a top-level key).
	let depth = 0;
	let i = 0;
	const keyTok = `"${targetKey}"`;
	const n = jsonc.length;
	while (i < n) {
		const ch = jsonc[i];
		// A quoted TOKEN. Check first whether it is the target top-level KEY
		// (a string directly under the root object followed by `:`), so the
		// generic string-skip below doesn't swallow it.
		if (ch === '"' && depth === 1 && jsonc.startsWith(keyTok, i) && /^\s*:/.test(jsonc.slice(i + keyTok.length))) {
			let k = i + keyTok.length;
			while (k < n && /\s/.test(jsonc[k])) k++;
			if (jsonc[k] === ':') k++;
			while (k < n && /\s/.test(jsonc[k])) k++;
			const val = jsonc[k];
			let end = k;
			if (val === '{' || val === '[') {
				let d = 0;
				for (; end < n; end++) {
					const c = jsonc[end];
					if (c === '"') {
						end = skipString(jsonc, end);
						continue;
					}
					if (c === '{' || c === '[') d++;
					else if (c === '}' || c === ']') {
						d--;
						if (d === 0) {
							end++;
							break;
						}
					}
				}
			} else {
				while (end < n && jsonc[end] !== ',' && jsonc[end] !== '\n') end++;
			}
			// Consume the comma that terminated this key's value (it now dangles
			// since the value is being removed) plus any trailing whitespace.
			while (end < n && /\s/.test(jsonc[end])) end++;
			if (jsonc[end] === ',') end++;
			while (end < n && /\s/.test(jsonc[end])) end++;
			const removed = jsonc.slice(0, i) + jsonc.slice(end);
			return removed;
		}
		if (ch === '"') {
			i = skipString(jsonc, i);
			continue;
		}
		if (ch === '/' && jsonc[i + 1] === '/') {
			const nl = jsonc.indexOf('\n', i);
			i = nl === -1 ? n : nl;
			continue;
		}
		if (ch === '/' && jsonc[i + 1] === '*') {
			const end = jsonc.indexOf('*/', i + 2);
			i = end === -1 ? n : end + 2;
			continue;
		}
		if (ch === '{' || ch === '[') {
			depth++;
			i++;
			continue;
		}
		if (ch === '}' || ch === ']') {
			depth--;
			i++;
			continue;
		}
		// (legacy fallback path — depth-1 keys are handled above)
		i++;
	}
	return jsonc;
}

/** Skip a double-quoted string (handling escaped quotes) from index `i` of `"`. Returns index after the closing quote. */
function skipString(s: string, i: number): number {
	let j = i + 1;
	while (j < s.length) {
		if (s[j] === '\\') {
			j += 2;
			continue;
		}
		if (s[j] === '"') return j + 1;
		j++;
	}
	return s.length;
}

// ─── Naming Helpers ─────────────────────────────────────

/** "Acme Corp" → "acme" · "Global Tech Solutions Ltd" → "global-tech" */
export function companyToPrefix(company: string): string {
	return (
		company
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^[-]+|[-]+$/g, '')
			.slice(0, 24) || 'client'
	);
}

function buildResources(prefix: string) {
	return {
		api_worker: `${prefix}-cms`,
		frontend_worker: `${prefix}-miniapp`,
		d1: `${prefix}-cms-db`,
		r2: `${prefix}-cms-media`,
		kv: `${prefix}-cms-kv`,
		table_prefix: `${prefix}_`,
	};
}

// ─── Wizard: headless client add ────────────────────────

async function wizardClientAdd(): Promise<void> {
	if (!process.stdout.isTTY) {
		console.error(pc.red('  Interactive wizard requires a TTY. Use: headless client add --company "<name>" -y'));
		process.exit(1);
	}
	p.intro(pc.bold('🏢 New Client Onboarding'));

	// 1. Company name
	const company = (await p.text({
		message: 'Company / client name?',
		placeholder: 'e.g. Acme Corp, Global Tech Ltd',
		validate: (v) => ((v ?? '').trim().length < 2 ? 'Company name is required' : undefined),
	})) as string;
	if (p.isCancel(company)) return p.cancel('Cancelled');

	// 2. Client prefix (auto-derived, editable)
	const autoPrefix = companyToPrefix(company);
	const prefix = (await p.text({
		message: 'Client prefix (used for ALL resource names)?',
		placeholder: autoPrefix,
		initialValue: autoPrefix,
		validate: (v) => {
			if (!v || !/^[a-z0-9][a-z0-9-]{1,23}$/.test(v)) return 'Lowercase letters, numbers, dashes (2-24 chars)';
			return undefined;
		},
	})) as string;
	if (p.isCancel(prefix)) return p.cancel('Cancelled');

	// 3. Account strategy
	const strategy = (await p.select({
		message: 'Account strategy?',
		options: [
			{ value: 'shared', label: 'Shared factory account', hint: 'One Cloudflare account — names are prefixed' },
			{ value: 'dedicated', label: 'Dedicated account (production)', hint: 'Per-client account — clean names, separate billing' },
		],
	})) as 'shared' | 'dedicated';
	if (p.isCancel(strategy)) return p.cancel('Cancelled');

	// 4. Cloudflare account id (optional — used for wrangler)
	const accountId = (await p.text({
		message: 'Cloudflare account ID (optional — paste from dashboard)?',
		placeholder: 'skip for now',
	})) as string;
	if (p.isCancel(accountId)) return p.cancel('Cancelled');

	// 5. Domains (optional)
	const domain = (await p.text({
		message: 'Primary app domain (optional)?',
		placeholder: 'e.g. app.acme.com',
	})) as string;
	if (p.isCancel(domain)) return p.cancel('Cancelled');

	await saveClient({ company, prefix, strategy, accountId, domain });
}

/**
 * Non-interactive add — used by --company/--prefix flags (scriptable factory onboarding).
 */
export async function addClientFlags(opts: {
	company?: string;
	prefix?: string;
	strategy?: string;
	account?: string;
	domain?: string;
	yes?: boolean;
}): Promise<void> {
	const company = opts.company;
	if (!company) {
		console.error(pc.red('  --company <name> is required for non-interactive add'));
		process.exit(1);
	}
	const prefix = opts.prefix ?? companyToPrefix(company);
	const strategy = (opts.strategy === 'dedicated' ? 'dedicated' : 'shared') as 'shared' | 'dedicated';

	const record = buildClientRecord({
		company,
		prefix,
		strategy,
		accountId: opts.account ?? '',
		domain: opts.domain ?? '',
	});

	const isTTY = Boolean(process.stdout.isTTY);
	if (!opts.yes && isTTY) {
		const ok = await p.confirm({ message: `Save client "${company}" (${prefix})?` });
		if (p.isCancel(ok) || !ok) return p.cancel('Not saved');
	}
	persistClient(record, isTTY && opts.yes !== true);
	if (!isTTY) {
		// Non-interactive: plain output (clack needs a TTY)
		console.log(pc.green(`✅ Client "${company}" (${prefix}) saved. Deploy with: headless client deploy ${prefix}`));
	} else if (opts.yes) {
		console.log(pc.green(`✅ Client "${company}" (${prefix}) saved. Deploy with: headless client deploy ${prefix}`));
	} else {
		p.outro(pc.green(`✅ Client "${company}" (${prefix}) saved. Deploy with: headless client deploy ${prefix}`));
	}
}

// ─── Record building + persistence ──────────────────────

function buildClientRecord(input: {
	company: string;
	prefix: string;
	strategy: 'shared' | 'dedicated';
	accountId?: string;
	domain?: string;
}): ClientRecord {
	const resources = buildResources(input.prefix);
	return {
		prefix: input.prefix,
		company: input.company,
		accountStrategy: input.strategy,
		accountId: input.accountId?.trim() || undefined,
		domains: input.domain?.trim() ? { app: input.domain.trim() } : undefined,
		resources,
		created: new Date().toISOString(),
		version: cliVersion(),
	};
}

function persistClient(record: ClientRecord, interactive = true): void {
	const registry = readRegistry();
	if (registry[record.prefix]) {
		if (interactive) {
			p.cancel(`Client "${record.prefix}" already exists in registry.`);
		} else {
			console.error(pc.red(`  Client "${record.prefix}" already exists in registry.`));
			process.exit(1);
		}
		return;
	}
	registry[record.prefix] = record;
	writeRegistry(registry);

	// Write clients/<prefix>/.env
	const clientEnv = [
		'# Auto-generated by `headless client add`',
		`CLIENT_PREFIX=${record.prefix}`,
		`CLIENT_COMPANY=${record.company}`,
		record.accountId ? `CLOUDFLARE_ACCOUNT_ID=${record.accountId}` : '# CLOUDFLARE_ACCOUNT_ID=<account-id>',
		'# CLOUDFLARE_API_TOKEN=<token>',
		'',
	].join('\n');
	writeFile(path.join(clientDir(record.prefix), '.env'), clientEnv);

	// Write clients/<prefix>/README.md
	const readme = [
		`# ${record.company}`,
		'',
		`**Client prefix:** \`${record.prefix}\``,
		`**Account strategy:** ${record.accountStrategy}`,
		'',
		'## Resources',
		...Object.entries(record.resources).map(([k, v]) => `- \`${k}\`: \`${v}\``),
		'',
		'## Deploy',
		'```sh',
		`headless client deploy ${record.prefix}`,
		'```',
		'',
	].join('\n');
	writeFile(path.join(clientDir(record.prefix), 'README.md'), readme);
}

async function saveClient(input: {
	company: string;
	prefix: string;
	strategy: 'shared' | 'dedicated';
	accountId?: string;
	domain?: string;
}): Promise<void> {
	const record = buildClientRecord(input);

	p.note(
		[
			pc.bold('Resource naming map:'),
			`  Worker API        ${pc.cyan(record.resources.api_worker)}`,
			`  Worker MiniApp     ${pc.cyan(record.resources.frontend_worker)}`,
			`  D1                ${pc.cyan(record.resources.d1)}`,
			`  R2                ${pc.cyan(record.resources.r2)}`,
			`  KV                ${pc.cyan(record.resources.kv)}`,
			`  DB tables         ${pc.cyan(`${record.prefix}_users ...`)}`,
			record.accountStrategy === 'dedicated'
				? pc.green('\n  Dedicated account — names stay clean')
				: pc.yellow('\n  Shared account — prefixes avoid collisions'),
		].join('\n'),
		'📦 Generated resources',
	);

	const confirm = (await p.confirm({ message: 'Save this client?' })) as boolean;
	if (p.isCancel(confirm)) return p.cancel('Cancelled');
	if (!confirm) return p.cancel('Not saved');

	persistClient(record);
	p.outro(pc.green(`✅ Client "${input.company}" (${input.prefix}) saved. Deploy with: headless client deploy ${input.prefix}`));
}

// ─── headless client list ───────────────────────────────

async function listClients(): Promise<void> {
	const registry = readRegistry();
	const entries = Object.values(registry);
	if (entries.length === 0) {
		console.log(pc.dim('  No clients yet — run `headless client add`'));
		return;
	}
	printTable(
		entries.map((e) => ({
			prefix: e.prefix,
			company: e.company,
			strategy: e.accountStrategy,
			d1: e.resources.d1,
			worker: e.resources.api_worker,
			created: e.created.slice(0, 10),
		})),
	);
}

// ─── headless client deploy <prefix> ────────────────────

export function deployClient(prefix: string, target?: string | string[], prod?: boolean): void {
	const registry = readRegistry();
	const client = registry[prefix];
	if (!client) {
		console.error(pc.red(`  Client "${prefix}" not found. Run \`headless client add\` first.`));
		process.exit(1);
	}

	// Load client .env into process env (credentials only — prefix comes from arg)
	const envPath = path.join(clientDir(prefix), '.env');
	const envRaw = readFile(envPath);
	if (envRaw) {
		for (const line of envRaw.split('\n')) {
			const m = line.match(/^([A-Z_]+)=(.*)$/);
			if (m && !process.env[m[1]] && !m[1].startsWith('CLIENT_')) process.env[m[1]] = m[2];
		}
	}

	// Ensure the client has its OWN D1 database + R2 bucket (multi-tenant isolation).
	// Without this, a fresh client would bind to the factory's shared D1.
	const d1Id = ensureClientResources(prefix);
	if (d1Id) process.env.D1_DATABASE_ID = d1Id;

	const apps = path.join(projectRoot(), 'apps');
	const targets: Array<{ name: string; dir: string; build?: string[] }> = [
		{ name: 'api', dir: path.join(apps, 'api') },
		{ name: 'miniapp', dir: path.join(apps, 'miniapp'), build: ['pnpm', 'build'] },
	];

	// Resolve the selection: array → those in order; string 'all' → everything; string name → one
	const selected = Array.isArray(target)
		? targets.filter((t) => target.includes(t.name))
		: target && target !== 'all'
			? targets.filter((t) => t.name === target)
			: targets;
	if (selected.length === 0) {
		console.error(pc.red(`  No deployable targets selected. Options: api, miniapp, all`));
		process.exit(1);
	}

	console.log(pc.bold(`\n  🚀 Deploying client "${prefix}" (${client.company}) — ${selected.map((t) => t.name).join(', ')}`));
	if (prod) console.log(pc.dim('  ℹ️  Production mode: IS_DEV=false'));
	for (const t of selected) {
		deployOne(t, prefix, prod);
		if (t.name === 'api') ensureClientSecrets(prefix, prod);
	}
}

/**
 * Ensure the client's D1 database + R2 bucket exist on Cloudflare (factory DX).
 * Creates them if missing, then persists D1_DATABASE_ID into the client .env.
 * Returns the D1 database id (or null when unavailable).
 */
function ensureClientResources(prefix: string): string | null {
	const resources = buildResources(prefix);
	const d1Name = resources.d1;
	const r2Name = resources.r2;

	// ── D1: create if missing, else look up by name ─────────────
	const run = (args: string[]): { status: number; stdout: string } => {
		const res = spawnSync('npx', ['wrangler', ...args], { cwd: getApiDir(), encoding: 'utf-8', env: process.env });
		return { status: res.status ?? -1, stdout: res.stdout ?? '' };
	};

	let d1Id: string | null = null;
	// `wrangler d1 create` has no --json flag — parse the toml snippet it prints
	const created = run(['d1', 'create', d1Name]);
	const idMatch = created.stdout.match(/database_id\s*=\s*"([^"]+)"/);
	if (created.status === 0 && idMatch) {
		d1Id = idMatch[1];
		console.log(pc.green(`  ✅ D1 created: ${d1Name} (${d1Id.slice(0, 8)}…)`));
	} else {
		// Already exists or creation failed — look it up
		const listed = run(['d1', 'list', '--json']);
		if (listed.status === 0) {
			try {
				const rows = JSON.parse(listed.stdout);
				const found = (Array.isArray(rows) ? rows : (rows?.result ?? [])).find((r: { name?: string }) => r.name === d1Name);
				d1Id = found?.database_id ?? found?.uuid ?? null;
				if (d1Id) console.log(pc.dim(`  D1 exists: ${d1Name} (${d1Id.slice(0, 8)}…)`));
			} catch {
				/* ignore */
			}
		}
	}

	// ── R2 bucket: create if missing ────────────────────────────
	const r2 = run(['r2', 'bucket', 'create', r2Name]);
	if (r2.status === 0) {
		console.log(pc.green(`  ✅ R2 bucket created: ${r2Name}`));
	} else {
		console.log(pc.dim(`  R2 bucket (exists or skipped): ${r2Name}`));
	}

	// ── Persist D1 id so future deploys reuse it ────────────────
	if (d1Id) {
		const envPath = path.join(clientDir(prefix), '.env');
		const envRaw = readFile(envPath) ?? '';
		if (!envRaw.includes('D1_DATABASE_ID=')) {
			writeFile(envPath, envRaw.trimEnd() + `\nD1_DATABASE_ID=${d1Id}\n`);
		} else {
			writeFile(envPath, envRaw.replace(/^D1_DATABASE_ID=.*$/m, `D1_DATABASE_ID=${d1Id}`));
		}
	}
	return d1Id;
}

/**
 * Provision per-client secrets (ADMIN_PASSWORD + JWT_SECRET) on the deployed
 * api worker via `wrangler secret put`, and persist them in clients/<prefix>/.env.
 * Generates strong random values on first run; reuses saved values afterwards.
 */
function ensureClientSecrets(prefix: string, prod = false): void {
	const envPath = path.join(clientDir(prefix), '.env');
	const envRaw = readFile(envPath) ?? '';
	const genPath = path.join(getApiDir(), `wrangler.${prefix}.jsonc`);
	if (!fs.existsSync(genPath)) {
		console.log(pc.yellow('  ⚠️  Generated api config not found — skipping secret provisioning.'));
		return;
	}

	const read = (key: string): string | null => envRaw.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1] ?? null;
	const random = (bytes: number): string => crypto.randomBytes(bytes).toString('base64url');

	let adminPassword = read('ADMIN_PASSWORD');
	let jwtSecret = read('JWT_SECRET');
	const isNew = !adminPassword || !jwtSecret;
	// Production hardening: >= 16 char password (24 random bytes → 32 base64url chars).
	if (!adminPassword) adminPassword = prod ? crypto.randomBytes(24).toString('base64url') : random(18);
	if (!jwtSecret) jwtSecret = random(32);

	// Production hardening: warn when reusing a weak stored password.
	if (prod && !isNew && adminPassword.length < 16) {
		console.log(
			pc.yellow(`  ⚠️  ADMIN_PASSWORD for ${prefix} is shorter than 16 chars — rotate it for production (edit clients/${prefix}/.env).`),
		);
	}

	// Persist to clients/<prefix>/.env (git-ignored)
	let next = envRaw.trimEnd();
	next = next.includes('ADMIN_PASSWORD=')
		? next.replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${adminPassword}`)
		: next + `\nADMIN_PASSWORD=${adminPassword}`;
	next = next.includes('JWT_SECRET=') ? next.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${jwtSecret}`) : next + `\nJWT_SECRET=${jwtSecret}`;
	writeFile(envPath, next + '\n');

	// Set on the deployed worker (only when newly generated or always to be safe)
	const setSecret = (name: string, value: string): void => {
		const res = spawnSync('npx', ['wrangler', 'secret', 'put', name, '--config', genPath], {
			cwd: getApiDir(),
			input: value,
			encoding: 'utf-8',
			env: process.env,
		});
		if (res.status === 0) {
			console.log(pc.dim(`  🔑 secret set: ${name}`));
		} else {
			console.error(pc.red(`  ✘ failed to set secret ${name} (exit ${res.status})`));
		}
	};

	if (isNew) {
		console.log(pc.dim(`  🔐 Generating client secrets for ${prefix} …`));
		setSecret('ADMIN_PASSWORD', adminPassword);
		setSecret('JWT_SECRET', jwtSecret);
		console.log(pc.dim(`  Saved to clients/${prefix}/.env (git-ignored).`));
	} else {
		console.log(pc.dim(`  Secrets already provisioned for ${prefix} (reuse from clients/${prefix}/.env).`));
	}
}

/**
 * Generate a per-client wrangler config (wrangler has no ${VAR} interpolation),
 * then run `wrangler deploy --config <generated>`. Generated files live next to
 * the app config so relative paths (main, $schema) stay valid, and are git-ignored.
 */
function deployOne(t: { name: string; dir: string; build?: string[] }, prefix: string, prod = false): void {
	console.log(pc.dim(`\n  ── ${t.name} (${prefix}) ──`));

	if (t.build) {
		const build = spawnSync(t.build[0], t.build.slice(1), { cwd: t.dir, stdio: 'inherit' });
		if (build.status !== 0) {
			console.error(pc.red(`  ✘ ${t.name} build failed — aborting`));
			process.exit(1);
		}
	}

	// 1. Read the app's wrangler.jsonc (with JSONC comments stripped by wrangler —
	//    we keep it simple: parse as-is with comments via a tolerant regex pass).
	const cfgPath = path.join(t.dir, 'wrangler.jsonc');
	const cfgRaw = readFile(cfgPath);
	if (!cfgRaw) {
		console.error(pc.red(`  ✘ No wrangler.jsonc in ${t.dir}`));
		process.exit(1);
	}

	// 2. Substitute names for this client.
	//    Base names: headless-cms / miniapp (worker), headless-cms-db (D1),
	//    headless-cms-media (R2). Matched name-agnostically so pre-personalized
	//    source configs (e.g. a factory repo that already deployed) are renamed
	//    too. `"name"` matches the FIRST occurrence only = the top-level worker
	//    name (DO bindings use `"name"` too but come later and must be kept).
	const workerName = t.name === 'miniapp' ? `${prefix}-miniapp` : `${prefix}-cms`;
	let cfg = cfgRaw
		.replace(/"name"\s*:\s*"[^"]*"/, `"name": "${workerName}"`)
		.replace(/"service"\s*:\s*"[^"]*"/g, `"service": "${prefix}-cms"`)
		.replace(/"database_name"\s*:\s*"[^"]*"/, `"database_name": "${prefix}-cms-db"`)
		.replace(/"bucket_name"\s*:\s*"[^"]*"/, `"bucket_name": "${prefix}-cms-media"`)
		.replace(/"TABLE_PREFIX"\s*:\s*"cms_"/, `"TABLE_PREFIX": "${prefix}_"`)
		.replace(/"CLIENT_ID"/, '"CLIENT_ID"')
		.replace(/("vars"\s*:\s*\{[^}]*?)"IS_DEV"/, `$1"CLIENT_ID": "${prefix}", "IS_DEV"`);

	// ── Tenant isolation: strip the FACTORY's shared integrations ─────────
	// A client is an isolated stack, so it must NOT inherit the factory's
	// shared Cloudflare Queues (queue names are per-account, not per-worker —
	// a tenant registering a consumer on the factory's own live queue collides
	// with the factory worker: Cloudflare error 11004 'already has a
	// consumer'). It also must not write analytics into the factory's shared
	// dataset. Own names only.
	cfg = stripTopLevelKey(cfg, 'queues');
	const analyticsDataset = `${prefix}_api_requests`;
	cfg = cfg.replace(/"dataset"\s*:\s*"[^"]*"/, `"dataset": "${analyticsDataset}"`);

	// Production hardening: base configs ship IS_DEV="true" — force it off.
	if (prod) {
		cfg = cfg.replace(/"IS_DEV": "true"/, '"IS_DEV": "false"');
	}

	// 3. Point D1 bindings at the CLIENT's own database (multi-tenant isolation).
	//    Wrangler has no ${VAR} interpolation, so inject the id into the generated config.
	const d1Id = process.env.D1_DATABASE_ID;
	if (d1Id) {
		cfg = cfg
			.replace(/"database_id"\s*:\s*"[^"]*"/, `"database_id": "${d1Id}"`)
			.replace(/"preview_database_id"\s*:\s*"[^"]*"/, `"preview_database_id": "${d1Id}"`);
	} else {
		console.log(
			pc.yellow(
				`  ⚠️  D1_DATABASE_ID not set — client will bind to the factory D1. Run \`headless client deploy ${prefix}\` again after ensuring resources.`,
			),
		);
	}

	// 4. Write generated config next to app config (relative paths stay valid)
	const genPath = path.join(t.dir, `wrangler.${prefix}.jsonc`);
	writeFile(genPath, cfg);

	// 5. Deploy with the generated config
	const deploy = spawnSync('npx', ['wrangler', 'deploy', '--config', genPath], {
		cwd: t.dir,
		stdio: 'inherit',
		env: process.env,
	});

	if (deploy.status === 0) {
		console.log(pc.green(`  ✅ ${t.name} deployed (${prefix}-${t.name})`));
	} else {
		console.error(pc.red(`  ✘ ${t.name} deploy failed (exit ${deploy.status})`));
		process.exit(1);
	}
}

// ─── headless client status <prefix> ────────────────────

function statusClient(prefix: string): void {
	const registry = readRegistry();
	const client = registry[prefix];
	if (!client) {
		console.error(pc.red(`  Client "${prefix}" not found.`));
		process.exit(1);
	}
	console.log(pc.bold(`\n  ${client.company} (${client.prefix})`));
	console.log(
		pc.dim(
			`  Created: ${client.created.slice(0, 10)} · Strategy: ${client.accountStrategy}${client.domains?.app ? ` · ${client.domains.app}` : ''}`,
		),
	);
	printTable(
		Object.entries(client.resources).map(([k, v]) => ({ resource: k, name: v })),
		['resource', 'name'],
	);
}

// ─── headless client destroy <prefix> ───────────────────

async function destroyClient(prefix: string, opts: { yes?: boolean }): Promise<void> {
	// a. Load the client record from the registry
	const registry = readRegistry();
	const client = registry[prefix];
	if (!client) {
		console.error(pc.red(`  Client "${prefix}" not found in registry.`));
		process.exit(1);
	}

	// b. Confirm destruction (unless -y)
	if (!opts.yes) {
		const ok = await guideConfirm(`Destroying "${prefix}" deletes ALL its workers, D1 and R2 on Cloudflare. Continue?`, false);
		if (ok === null) {
			if (!isInteractive()) {
				console.error(pc.red('  Aborted — pass -y to confirm'));
				process.exit(1);
			}
			return; // interactive cancel (guideConfirm already printed "Cancelled")
		}
		if (!ok) {
			p.cancel('Aborted');
			return;
		}
	}

	const resources = buildResources(prefix);
	const workers = [resources.api_worker, resources.frontend_worker];
	const d1Name = resources.d1;
	const r2Name = resources.r2;

	console.log(pc.bold(`\n  🗑️  Destroying client "${prefix}" (${client.company}) …`));

	// c. Delete workers (ignore failures — a worker may not exist)
	for (const name of workers) {
		const res = spawnSync('npx', ['wrangler', 'delete', '--name', name, '--force'], {
			cwd: getApiDir(),
			env: process.env,
			stdio: 'inherit',
		});
		if (res.status === 0) {
			console.log(pc.green(`  ✅ worker removed: ${name}`));
		} else {
			console.log(pc.dim(`  — worker not found / already removed: ${name}`));
		}
	}

	// d. Delete D1 (ignore "not found"). `wrangler d1 delete` does NOT accept
	//    --force (that's a worker-delete flag) — passing it made wrangler error
	//    and leak the database. It auto-confirms in non-interactive runs.
	const d1 = spawnSync('npx', ['wrangler', 'd1', 'delete', d1Name], {
		cwd: getApiDir(),
		env: process.env,
		stdio: 'inherit',
	});
	if (d1.status === 0) {
		console.log(pc.green(`  ✅ D1 removed: ${d1Name}`));
	} else {
		console.log(pc.dim(`  — D1 not found / already removed: ${d1Name}`));
	}

	// e. Delete R2 bucket (ignore not-found errors). No --force flag exists on
	//    `wrangler r2 bucket delete` — empty (fresh-tenant) buckets delete cleanly.
	const r2 = spawnSync('npx', ['wrangler', 'r2', 'bucket', 'delete', r2Name], {
		cwd: getApiDir(),
		env: process.env,
		stdio: 'inherit',
	});
	if (r2.status === 0) {
		console.log(pc.green(`  ✅ R2 removed: ${r2Name}`));
	} else {
		console.log(pc.dim(`  — R2 not found / already removed: ${r2Name}`));
	}

	// f. Remove the registry entry + clients/<prefix> directory
	delete registry[prefix];
	writeRegistry(registry);
	fs.rmSync(clientDir(prefix), { recursive: true, force: true });

	// g. Summary
	console.log(pc.green(`\n  ✅ Client "${prefix}" destroyed.`));
	console.log(
		pc.dim(
			[
				'  Removed:',
				`  • Workers: ${workers.join(', ')}`,
				`  • D1: ${d1Name}`,
				`  • R2: ${r2Name}`,
				`  • Registry entry + clients/${prefix}/ (env + README)`,
			].join('\n'),
		),
	);
}

// ─── Guided selection: pick a client from the registry (TTY only) ──

async function promptClientSelect(message: string): Promise<string | null> {
	const registry = readRegistry();
	const entries = Object.values(registry);
	if (entries.length === 0) {
		console.error(pc.red(`  No clients yet — run \`headless client add\` first.`));
		return null;
	}
	const picked = await guideSelect(
		message,
		entries.map((e) => ({ value: e.prefix, label: `${e.prefix}  (${e.company})` })),
	);
	return picked;
}

// ─── Registration ───────────────────────────────────────

export function registerClientCommands(program: Command): void {
	const client = program.command('client').description('Software factory — manage client (company) deployments');

	client
		.command('add')
		.description('Guided wizard: company → prefix → resources → save')
		.option('--company <name>', 'Company/client name (skips prompts)')
		.option('--prefix <prefix>', 'Client prefix (default: auto from company)')
		.option('--strategy <shared|dedicated>', 'Account strategy')
		.option('--account <id>', 'Cloudflare account ID')
		.option('--domain <domain>', 'Primary app domain')
		.option('-y, --yes', 'Skip confirmation (non-interactive)')
		.action((opts: { company?: string; prefix?: string; strategy?: string; account?: string; domain?: string; yes?: boolean }) => {
			if (opts.company) {
				void addClientFlags(opts);
			} else {
				void wizardClientAdd();
			}
		});

	client
		.command('list')
		.description('Show all registered clients')
		.action(() => listClients());

	client
		.command('deploy')
		.description('Deploy a client — guided when run without arguments')
		.argument('[prefix]', 'Client prefix (e.g. acme). Omit for guided selection')
		.option('-t, --target <name>', 'Deploy only: api | miniapp | all', 'all')
		.option('--prod', 'Production deploy: IS_DEV=false + strong password policy')
		.action(async (prefix: string | undefined, opts: { target: string; prod?: boolean }, command: Command) => {
			let pfx = prefix;
			// Guided mode: no prefix → pick a client; then pick targets (multiselect)
			if (!pfx) {
				pfx = (await promptClientSelect('Which client do you want to deploy?')) ?? undefined;
				if (!pfx) {
					if (!isInteractive()) console.error(pc.red('  Usage: headless client deploy <prefix> [--target api|miniapp|all]'));
					return;
				}
				const explicitlyPassedTarget =
					(command as unknown as { getOptionValue?: (k: string) => unknown }).getOptionValue?.('target') !== 'all';
				if (!explicitlyPassedTarget) {
					const picked = await guideMultiselect(
						'Which workers should we deploy? (space to toggle, enter to confirm)',
						[
							{ value: 'api', label: 'api', hint: 'core API worker (D1/R2/secrets auto-provisioned)' },
							{ value: 'miniapp', label: 'miniapp', hint: 'Telegram Mini App SPA + BFF (builds first)' },
						],
						{ required: true },
					);
					if (picked.length === 0) return;
					deployClient(pfx, picked, opts.prod);
					return;
				}
			}
			if (!pfx) return;
			deployClient(pfx, opts.target, opts.prod);
		});

	client
		.command('status')
		.description('Show a client resource naming map — guided when run without arguments')
		.argument('[prefix]', 'Client prefix')
		.action(async (prefix?: string) => {
			let pfx = prefix;
			if (!pfx) {
				pfx = (await promptClientSelect('Which client?')) ?? undefined;
				if (!pfx) {
					if (!isInteractive()) console.error(pc.red('  Usage: headless client status <prefix>'));
					return;
				}
			}
			statusClient(pfx);
		});

	client
		.command('destroy')
		.description('Destroy a client — deletes its workers, D1, R2 and local files')
		.argument('[prefix]', 'Client prefix. Omit for guided selection')
		.option('-y, --yes', 'Skip confirmation (non-interactive)')
		.action(async (prefix: string | undefined, opts: { yes?: boolean }) => {
			let pfx = prefix;
			if (!pfx) {
				pfx = (await promptClientSelect('Which client do you want to destroy?')) ?? undefined;
				if (!pfx) {
					if (!isInteractive()) console.error(pc.red('  Usage: headless client destroy <prefix>'));
					return;
				}
			}
			// The global `-y, --yes` flag (top-level program) shadows the per-command
			// short flag, so `opts.yes` can be undefined in non-interactive runs.
			// Consult the program-level value as a fallback so `destroy -y` works in CI.
			const globalYes = Boolean((program.opts() as { yes?: boolean }).yes);
			await destroyClient(pfx, { yes: opts.yes || globalYes });
		});
}
