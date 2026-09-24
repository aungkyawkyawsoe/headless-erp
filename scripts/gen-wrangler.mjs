/**
 * ⚙️ Wrangler config generator — infra/env.* is the SINGLE SOURCE OF TRUTH for
 * every Cloudflare resource name/id; this script renders the committed wrangler
 * configs from it so configs can never drift from the env file.
 *
 *   infra/env.prod   → apps/api/wrangler.jsonc        (prod API worker)
 *                    → apps/tgapp/wrangler.jsonc       (prod miniapp worker)
 *                    → apps/studio/wrangler.jsonc      (prod studio worker)
 *   infra/env.testco → apps/api/wrangler.testco.jsonc (test-only, isolated)
 *
 * Usage:
 *   node scripts/gen-wrangler.mjs               # write prod configs
 *   node scripts/gen-wrangler.mjs --env testco  # write testco config
 *   node scripts/gen-wrangler.mjs --check       # drift gate (CI + husky)
 *   node scripts/gen-wrangler.mjs --env testco --check
 *
 * ⚠️ Secrets never pass through here: the prod config deliberately contains NO
 * ADMIN_PASSWORD / JWT_SECRET / BACKUP_ENCRYPTION_KEY / R2_SQL_TOKEN /
 * TELEGRAM_BOT_TOKEN / ENCRYPTION_KEY — they are `wrangler secret put` only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INFRA_DIR = path.join(ROOT, 'infra');

// ─── dotenv loader (subset: KEY=VALUE / KEY="VALUE", # comments) ───────────
export function loadEnvFile(name) {
	const raw = fs.readFileSync(path.join(INFRA_DIR, `env.${name}`), 'utf8');
	const env = {};
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq <= 0) continue;
		let key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
		if (key.startsWith('export ')) key = key.slice('export '.length).trim();
		env[key] = value;
	}
	return env;
}

// ─── helpers ────────────────────────────────────────────────────────────────
const t = (n, s = '') => '\t'.repeat(n) + s;

/** Renders one JSONC member `"key": value,` — comment line(s) optional. */
function member(n, key, value, ...commentLines) {
	const out = [];
	for (const c of commentLines) out.push(t(n, c));
	out.push(t(n, `"${key}": ${value},`));
	return out;
}

const BANNER = (envFile) => [
	'/**',
	' * ⚠️ GENERATED FILE — do not edit by hand.',
	` * Source of truth: infra/${envFile} → scripts/gen-wrangler.mjs (pnpm gen:infra).`,
	' * CI drift gate: pnpm check:infra',
	' */',
];

const SECRETS_DOC = [
	'/**',
	' * 🔒 SECRETS — NEVER put passwords/tokens in vars (the old committed',
	' * ADMIN_PASSWORD/JWT_SECRET vars were removed — see git history). Set them',
	' * once via `wrangler secret put` — the API fails closed in prod until the',
	' * secrets exist:',
	' *   npx wrangler secret put ADMIN_PASSWORD',
	' *   npx wrangler secret put JWT_SECRET',
	' *   npx wrangler secret put BACKUP_ENCRYPTION_KEY   (hex 64 chars: `openssl rand -hex 32`)',
	' *   npx wrangler secret put TELEGRAM_BOT_TOKEN',
	' *   npx wrangler secret put R2_SQL_TOKEN            (only when ENABLE_R2_LAKE=true)',
	' *   npx wrangler secret put ENCRYPTION_KEY          (only if schema has `encrypted` fields)',
	' * Local dev uses apps/api/.dev.vars (git-ignored).',
	' */',
];

// ─── prod API worker (apps/api/wrangler.jsonc) ──────────────────────────────
function renderApiProd(e) {
	const lines = [];
	lines.push(t(0, '{'));
	lines.push(t(1, '"$schema": "node_modules/wrangler/config-schema.json",'));
	for (const l of BANNER('env.prod')) lines.push(t(1, l));
	lines.push(t(1, `"name": "${e.WORKER_API}",`));
	lines.push(t(1, '"main": "src/index.ts",'));
	lines.push(t(1, '"compatibility_date": "2026-07-31",'));
	lines.push(t(1, '"compatibility_flags": ["nodejs_compat"],'));
	// Bundle the worker MINIFIED. Wrangler bundles but does NOT minify unless
	// asked, and the API shipped ~2.3 MB unminified — parse + top-level init of
	// that on a cold isolate is the dominant cost at this app's traffic.
	// `keep_names` preserves function/class names (error classes, handler names)
	// minification would otherwise mangle; source maps stay uploaded, so stack
	// traces still map back.
	lines.push(t(1, '"minify": true,'));
	lines.push(t(1, '"keep_names": true,'));
	lines.push(
		t(1, '/**'),
		t(1, ' * Dev server — bind 8788 so ANY `wrangler dev` invocation (bare, without'),
		t(1, " * --port flags) matches the miniapp's Vite proxy (vite.config.ts targets"),
		t(1, ' * http://localhost:8788). A bare `npx wrangler dev` would otherwise default'),
		t(1, ' * to 8787 and every /api call from the mini app fails with ECONNREFUSED.'),
		t(1, ' */'),
	);
	lines.push(t(1, '"dev": {'));
	lines.push(t(2, '"port": 8788,'));
	lines.push(t(2, '"ip": "0.0.0.0",'));
	lines.push(t(1, '},'));
	lines.push(t(1, '"d1_databases": ['));
	lines.push(t(2, '{'));
	lines.push(t(3, '"binding": "DB",'));
	lines.push(t(3, `"database_name": "${e.D1_NAME}",`));
	lines.push(t(3, `// Production D1 — created via \`npx wrangler d1 create ${e.D1_NAME}\`.`));
	lines.push(t(3, `"database_id": "${e.D1_ID}",`));
	if (e.D1_PREVIEW_ID) {
		lines.push(t(3, `"preview_database_id": "${e.D1_PREVIEW_ID}",`));
	} else {
		lines.push(
			t(3, '// NO preview_database_id — preview/`--remote` must never touch the prod'),
			t(3, '// database. Set D1_PREVIEW_ID in infra/env.prod to point at a scratch D1.'),
		);
	}
	lines.push(t(2, '},'));
	lines.push(t(1, '],'));
	lines.push(t(1, '"r2_buckets": ['));
	lines.push(t(2, '{'));
	lines.push(t(3, '"binding": "BUCKET",'));
	lines.push(t(3, `"bucket_name": "${e.R2_BUCKET}",`));
	lines.push(t(2, '},'));
	lines.push(t(1, '],'));
	lines.push(
		t(1, '/**'),
		t(1, ' * Durable Objects — global cross-isolate state.'),
		t(1, ' * RATE_LIMIT: true global rate limiting (per-tier per-IP), atomic counters.'),
		t(1, ' * Enabled when the binding exists AND vars.RATE_LIMIT_DO === "true".'),
		t(1, ' */'),
	);
	lines.push(t(1, '"durable_objects": {'));
	lines.push(t(2, '"bindings": ['));
	lines.push(t(3, '{'), t(4, '"name": "RATE_LIMIT",'), t(4, '"class_name": "GlobalRateLimitStore",'), t(3, '},'));
	lines.push(t(3, '{'), t(4, '"name": "SCHEDULER",'), t(4, '"class_name": "SchedulerDO",'), t(3, '},'));
	lines.push(t(3, '{'), t(4, '"name": "LOCK",'), t(4, '"class_name": "LockDO",'), t(3, '},'));
	lines.push(t(2, '],'));
	lines.push(t(1, '},'));
	lines.push(t(1, '"migrations": ['));
	lines.push(t(2, '{'), t(3, '"tag": "v1",'), t(3, '"new_sqlite_classes": ["GlobalRateLimitStore"],'), t(2, '},'));
	lines.push(t(2, '{'), t(3, '"tag": "v2",'), t(3, '"new_sqlite_classes": ["SchedulerDO"],'), t(2, '},'));
	lines.push(t(2, '{'), t(3, '"tag": "v3",'), t(3, '"new_sqlite_classes": ["LockDO"],'), t(2, '},'));
	lines.push(t(1, '],'));
	lines.push(
		t(1, '/**'),
		t(1, ' * Cloudflare Queues — reliable webhook delivery (retries + backoff) + the'),
		t(1, ' * internal event bus. Consumers run in this worker (the `queue` export in'),
		t(1, ' * src/index.ts). Names come from infra/env.prod — create once:'),
		t(1, ' *   npx wrangler queues create <name>   (+ <name>-dlq)'),
		t(1, ' */'),
	);
	lines.push(t(1, '"queues": {'));
	lines.push(t(2, '"producers": ['));
	lines.push(t(3, '{'), t(4, '"binding": "WEBHOOK_QUEUE",'), t(4, `"queue": "${e.QUEUE_WEBHOOK}",`), t(3, '},'));
	lines.push(t(3, '{'), t(4, '"binding": "EVENTS",'), t(4, `"queue": "${e.QUEUE_EVENTS}",`), t(3, '},'));
	lines.push(t(2, '],'));
	lines.push(t(2, '"consumers": ['));
	lines.push(t(3, '{'));
	lines.push(t(4, `"queue": "${e.QUEUE_WEBHOOK}",`));
	lines.push(t(4, '"max_retries": 3,'));
	lines.push(t(4, `"dead_letter_queue": "${e.QUEUE_WEBHOOK_DLQ}",`));
	lines.push(t(4, '"retry_delay": 30,'));
	lines.push(t(3, '},'));
	lines.push(t(3, '{'));
	lines.push(t(4, `"queue": "${e.QUEUE_EVENTS}",`));
	lines.push(t(4, '"max_retries": 5,'));
	lines.push(t(4, `"dead_letter_queue": "${e.QUEUE_EVENTS_DLQ}",`));
	lines.push(t(4, '"retry_delay": 30,'));
	lines.push(t(3, '},'));
	lines.push(t(2, '],'));
	lines.push(t(1, '},'));
	lines.push(
		t(1, '/**'),
		t(1, ' * Workers Analytics Engine — per-request usage metrics per client.'),
		t(1, ' * Dataset is created automatically on first write.'),
		t(1, ' */'),
	);
	lines.push(t(1, '"analytics_engine_datasets": ['));
	lines.push(t(2, '{'));
	lines.push(t(3, '"binding": "ANALYTICS",'));
	lines.push(t(3, `"dataset": "${e.ANALYTICS_DATASET}",`));
	lines.push(t(2, '},'));
	lines.push(t(1, '],'));
	lines.push(
		t(1, '/**'),
		t(1, ' * Scheduled backup — nightly full DB snapshot (schema + all collections) to R2.'),
		t(1, ' * Also prunes backups older than BACKUP_RETENTION_DAYS. Local: `wrangler dev --test-scheduled`.'),
		t(1, ' */'),
	);
	lines.push(t(1, '"triggers": {'));
	lines.push(t(2, '"crons": ["0 2 * * *", "30 8 * * *", "*/10 * * * *", "30 3 * * *", "* * * * *"],'));
	lines.push(t(1, '},'));
	for (const l of SECRETS_DOC) lines.push(t(1, l));
	lines.push(t(1, '"vars": {'));
	lines.push(
		t(2, '/**'),
		t(2, ' * Bootstrap admin username (config, not a secret). The password is set via'),
		t(2, ' * `wrangler secret put ADMIN_PASSWORD` — never in vars.'),
		t(2, ' */'),
	);
	lines.push(t(2, `"ADMIN_USERNAME": "${e.ADMIN_USERNAME}",`));
	lines.push(
		t(2, '/**'),
		t(2, ' * Table prefix + business modules served by this worker.'),
		t(2, " * DOMAIN_MODULES default when unset: 'hr'; 'none' = pure factory."),
		t(2, ' */'),
	);
	lines.push(t(2, `"TABLE_PREFIX": "${e.TABLE_PREFIX}",`));
	lines.push(t(2, `"DOMAIN_MODULES": "${e.DOMAIN_MODULES}",`));
	lines.push(
		t(2, '// PBKDF2 cost for NEW password hashes — lowered from the 600k code default'),
		t(2, '// because 600k PBKDF2 throws on this deployment (500 on login/verify).'),
		t(2, '// Stored hashes always verify at their own iteration count.'),
	);
	lines.push(t(2, `"PBKDF2_ITERATIONS": "${e.PBKDF2_ITERATIONS}",`));
	lines.push(
		t(2, '// ⚠️ IS_DEV must NEVER be set in production vars — it enables the'),
		t(2, '// publicly-known `dev-token` as full admin (routes/auth.ts) and relaxes'),
		t(2, '// rate limits to 10k/min. Local dev only: apps/api/.dev.vars (IS_DEV="true").'),
		t(2, '/**'),
		t(2, ' * Production defaults: cross-isolate rate limiting, per-request analytics'),
		t(2, ' * and the nightly backup are ON. Local dev/tests use wrangler.testco.jsonc,'),
		t(2, ' * which keeps these toggles off.'),
		t(2, ' */'),
	);
	lines.push(t(2, `"RATE_LIMIT_DO": "${e.RATE_LIMIT_DO}",`));
	lines.push(t(2, `"BACKUP_ENABLED": "${e.BACKUP_ENABLED}",`));
	lines.push(t(2, `"AI_PROVIDER": "${e.AI_PROVIDER}",`));
	lines.push(t(2, `"ANALYTICS_ENABLED": "${e.ANALYTICS_ENABLED}",`));
	lines.push(t(2, `"BACKUP_RETENTION_DAYS": "${e.BACKUP_RETENTION_DAYS}",`));
	lines.push(
		t(2, '// R2 Data Catalog (Iceberg) read-only analytics. R2_SQL_TOKEN secret is set'),
		t(2, '// via `wrangler secret put R2_SQL_TOKEN`. R2_ACCOUNT_ID overrides autodetect.'),
	);
	lines.push(t(2, `"ENABLE_R2_LAKE": "${e.ENABLE_R2_LAKE}",`));
	lines.push(t(2, `"R2_ACCOUNT_ID": "${e.CF_ACCOUNT_ID}",`));
	lines.push(t(2, `"R2_BUCKET": "${e.R2_BUCKET}",`));
	lines.push(
		t(2, '// Queue-name contract for the worker queue() dispatch (src/index.ts) —'),
		t(2, '// generated from the same env value as the EVENTS binding, so the runtime'),
		t(2, '// comparison `batch.queue === EVENT_QUEUE_NAME` can never drift.'),
	);
	lines.push(t(2, `"EVENT_QUEUE_NAME": "${e.QUEUE_EVENTS}",`));
	lines.push(t(1, '},'));
	lines.push(t(1, '"observability": {'));
	lines.push(t(2, '"enabled": true,'));
	lines.push(t(1, '},'));
	lines.push(t(0, '}'));
	return lines.join('\n') + '\n';
}

// ─── testco API worker (apps/api/wrangler.testco.jsonc) ─────────────────────
function renderApiTestco(e) {
	const lines = [];
	lines.push(t(0, '{'));
	lines.push(t(1, '"$schema": "node_modules/wrangler/config-schema.json",'));
	for (const l of BANNER('env.testco')) lines.push(t(1, l));
	lines.push(
		t(1, '// ⚠️ TEST-ONLY config — NEVER `wrangler deploy -c wrangler.testco.jsonc`'),
		t(1, '// into a shared/production account: it ships IS_DEV=true + KNOWN placeholder'),
		t(1, '// credentials (ADMIN_PASSWORD, JWT_SECRET, TELEGRAM_BOT_TOKEN, R2_SQL_TOKEN)'),
		t(1, '// that would grant full admin to anyone (dev-token + known admin password).'),
		t(1, '// Every resource below is isolated from production (own queues, own R2'),
		t(1, '// bucket, placeholder D1 ids — miniflare local only).'),
	);
	lines.push(t(1, `"name": "${e.WORKER_API}",`));
	lines.push(t(1, '"main": "src/index.ts",'));
	lines.push(t(1, '"compatibility_date": "2026-07-31",'));
	lines.push(t(1, '"compatibility_flags": ["nodejs_compat"],'));
	lines.push(t(1, '"d1_databases": ['));
	lines.push(t(2, '{'));
	lines.push(t(3, '"binding": "DB",'));
	lines.push(t(3, `"database_name": "${e.D1_NAME}",`));
	lines.push(t(3, `"database_id": "${e.D1_ID}",`));
	if (e.D1_PREVIEW_ID) lines.push(t(3, `"preview_database_id": "${e.D1_PREVIEW_ID}",`));
	lines.push(t(2, '},'));
	lines.push(t(1, '],'));
	lines.push(t(1, '"r2_buckets": ['));
	lines.push(t(2, '{'));
	lines.push(t(3, '"binding": "BUCKET",'));
	lines.push(t(3, `"bucket_name": "${e.R2_BUCKET}",`));
	lines.push(t(2, '},'));
	lines.push(t(1, '],'));
	lines.push(t(1, '"durable_objects": {'));
	lines.push(t(2, '"bindings": ['));
	lines.push(t(3, '{'), t(4, '"name": "SCHEDULER",'), t(4, '"class_name": "SchedulerDO",'), t(3, '},'));
	lines.push(t(3, '{'), t(4, '"name": "LOCK",'), t(4, '"class_name": "LockDO",'), t(3, '},'));
	lines.push(t(2, '],'));
	lines.push(t(1, '},'));
	lines.push(t(1, '"migrations": ['));
	lines.push(t(2, '{'), t(3, '"tag": "v2",'), t(3, '"new_sqlite_classes": ["SchedulerDO"],'), t(2, '},'));
	lines.push(t(2, '{'), t(3, '"tag": "v3",'), t(3, '"new_sqlite_classes": ["LockDO"],'), t(2, '},'));
	lines.push(t(1, '],'));
	lines.push(
		t(1, '/**'),
		t(1, ' * Event-bus queue — ISOLATED from production (own QUEUE_EVENTS from env.testco),'),
		t(1, ' * so a test/local run can never produce to or consume from the live queue.'),
		t(1, ' */'),
	);
	lines.push(t(1, '"queues": {'));
	lines.push(t(2, '"producers": ['));
	lines.push(t(3, '{'), t(4, '"binding": "EVENTS",'), t(4, `"queue": "${e.QUEUE_EVENTS}",`), t(3, '},'));
	lines.push(t(2, '],'));
	lines.push(t(2, '"consumers": ['));
	lines.push(t(3, '{'));
	lines.push(t(4, `"queue": "${e.QUEUE_EVENTS}",`));
	lines.push(t(4, '"max_retries": 5,'));
	lines.push(t(4, `"dead_letter_queue": "${e.QUEUE_EVENTS_DLQ}",`));
	lines.push(t(4, '"retry_delay": 30,'));
	lines.push(t(3, '},'));
	lines.push(t(2, '],'));
	lines.push(t(1, '},'));
	lines.push(t(1, '"vars": {'));
	lines.push(t(2, `"ADMIN_USERNAME": "${e.ADMIN_USERNAME}",`));
	lines.push(t(2, `"ADMIN_PASSWORD": "${e.ADMIN_PASSWORD}",`));
	lines.push(t(2, `"ADMIN_NAME": "${e.ADMIN_NAME}",`));
	lines.push(t(2, `"JWT_SECRET": "${e.JWT_SECRET}",`));
	lines.push(t(2, `"CLIENT_ID": "${e.CLIENT_ID}",`));
	lines.push(t(2, `"TABLE_PREFIX": "${e.TABLE_PREFIX}",`));
	lines.push(t(2, `"IS_DEV": "${e.IS_DEV}",`));
	lines.push(t(2, `"DOMAIN_MODULES": "${e.DOMAIN_MODULES}",`));
	lines.push(t(2, `"TELEGRAM_BOT_TOKEN": "${e.TELEGRAM_BOT_TOKEN}",`));
	lines.push(t(2, `"R2_SQL_TOKEN": "${e.R2_SQL_TOKEN}",`));
	lines.push(t(2, `"RATE_LIMIT_DO": "${e.RATE_LIMIT_DO}",`));
	lines.push(t(2, `"BACKUP_ENABLED": "${e.BACKUP_ENABLED}",`));
	lines.push(t(2, `"AI_PROVIDER": "${e.AI_PROVIDER}",`));
	lines.push(t(2, `"ANALYTICS_ENABLED": "${e.ANALYTICS_ENABLED}",`));
	lines.push(t(2, `"BACKUP_RETENTION_DAYS": "${e.BACKUP_RETENTION_DAYS}",`));
	lines.push(t(2, `"ENABLE_R2_LAKE": "${e.ENABLE_R2_LAKE}",`));
	lines.push(t(2, `"R2_ACCOUNT_ID": "${e.CF_ACCOUNT_ID}",`));
	lines.push(t(2, `"R2_BUCKET": "${e.R2_BUCKET}",`));
	lines.push(t(2, `"EVENT_QUEUE_NAME": "${e.QUEUE_EVENTS}",`));
	lines.push(t(1, '},'));
	lines.push(t(1, '"observability": {'));
	lines.push(t(2, '"enabled": true,'));
	lines.push(t(1, '},'));
	lines.push(t(0, '}'));
	return lines.join('\n') + '\n';
}

// ─── prod miniapp worker (apps/tgapp/wrangler.jsonc) ────────────────────────
function renderTgappProd(e) {
	const lines = [];
	lines.push(t(0, '{'));
	lines.push(t(1, '"$schema": "node_modules/wrangler/config-schema.json",'));
	for (const l of BANNER('env.prod')) lines.push(t(1, l));
	lines.push(
		t(1, '/**'),
		t(1, ' * Telegram Mini App worker config.'),
		t(1, ' *'),
		t(1, ' * The core API worker is reached through the private `API` service binding,'),
		t(1, ' * never a public URL. Assets serve the SPA with single-page-app fallback.'),
		t(1, ' *'),
		t(1, ' * Regenerate types after changing bindings: `pnpm cf-typegen` (wrangler types).'),
		t(1, ' */'),
	);
	lines.push(t(1, `"name": "${e.WORKER_MINIAPP}",`));
	lines.push(t(1, '"main": "worker/index.ts",'));
	lines.push(t(1, '"compatibility_date": "2026-08-25",'));
	lines.push(t(1, '"compatibility_flags": ["nodejs_compat"],'));
	lines.push(t(1, '"assets": {'));
	lines.push(t(2, '"directory": "./dist",'));
	lines.push(t(2, '"not_found_handling": "single-page-application",'));
	lines.push(t(2, '"binding": "ASSETS",'));
	lines.push(t(1, '},'));
	lines.push(t(1, `"workers_dev": ${e.MINIAPP_WORKERS_DEV === 'true'},`));
	lines.push(t(1, '"preview_urls": false,'));
	lines.push(t(1, '"observability": {'));
	lines.push(t(2, '"enabled": true,'));
	lines.push(t(1, '},'));
	lines.push(t(1, '"upload_source_maps": true,'));
	lines.push(t(1, '"services": ['));
	lines.push(t(2, '{'));
	lines.push(t(3, '"binding": "API",'));
	lines.push(t(3, `"service": "${e.WORKER_API}",`));
	lines.push(t(2, '},'));
	lines.push(t(1, '],'));
	lines.push(t(1, '"routes": ['));
	lines.push(t(2, '{'));
	lines.push(t(3, `"pattern": "${e.MINIAPP_DOMAIN}",`));
	lines.push(t(3, '"custom_domain": true,'));
	lines.push(t(2, '},'));
	lines.push(t(1, '],'));
	lines.push(t(0, '}'));
	return lines.join('\n') + '\n';
}

// ─── prod studio worker (apps/studio/wrangler.jsonc) ────────────────────────
function renderStudioProd(e) {
	const lines = [];
	lines.push(t(0, '{'));
	lines.push(t(1, '"$schema": "node_modules/wrangler/config-schema.json",'));
	for (const l of BANNER('env.prod')) lines.push(t(1, l));
	lines.push(
		t(1, '/**'),
		t(1, ' * Studio worker config — the headless Studio SPA (assets) + the /__studio'),
		t(1, ' * metadata routes backed by the Studio D1 (see worker/index.ts).'),
		t(1, ' *'),
		t(1, ' * The core API worker is reached through the private `API` service binding,'),
		t(1, ' * never a public URL. Assets serve the SPA with single-page-app fallback.'),
		t(1, ' *'),
		t(1, ' * Regenerate types after changing bindings: `pnpm cf-typegen` (wrangler types).'),
		t(1, ' */'),
	);
	lines.push(t(1, `"name": "${e.WORKER_STUDIO}",`));
	lines.push(t(1, '"main": "worker/index.ts",'));
	lines.push(t(1, '"compatibility_date": "2026-08-25",'));
	lines.push(t(1, '"compatibility_flags": ["nodejs_compat"],'));
	lines.push(t(1, '"assets": {'));
	lines.push(t(2, '"not_found_handling": "single-page-application",'));
	lines.push(t(2, '"binding": "ASSETS",'));
	lines.push(t(2, '"directory": "./dist",'));
	lines.push(t(1, '},'));
	lines.push(t(1, `"workers_dev": ${e.STUDIO_WORKERS_DEV === 'true'},`));
	lines.push(t(1, '"preview_urls": false,'));
	lines.push(t(1, '"observability": {'));
	lines.push(t(2, '"enabled": true,'));
	lines.push(t(1, '},'));
	lines.push(t(1, '"upload_source_maps": true,'));
	lines.push(t(1, '"d1_databases": ['));
	lines.push(t(2, '{'));
	lines.push(t(3, '"binding": "STUDIO_DB",'));
	lines.push(t(3, `"database_name": "${e.STUDIO_D1_NAME}",`));
	lines.push(t(3, `// Studio metadata D1 — created via \`npx wrangler d1 create ${e.STUDIO_D1_NAME}\`.`));
	lines.push(t(3, `"database_id": "${e.STUDIO_D1_ID}",`));
	lines.push(
		t(3, '// NO preview_database_id — preview/`--remote` must never touch the prod'),
		t(3, '// Studio database. Set STUDIO_D1_PREVIEW_ID in infra/env.prod to point at a scratch D1.'),
	);
	lines.push(t(2, '},'));
	lines.push(t(1, '],'));
	lines.push(t(1, '"services": ['));
	lines.push(t(2, '{'));
	lines.push(t(3, '"binding": "API",'));
	lines.push(t(3, `"service": "${e.WORKER_API}",`));
	lines.push(t(2, '},'));
	lines.push(t(1, '],'));
	lines.push(t(1, '"routes": ['));
	lines.push(t(2, '{'));
	lines.push(t(3, `"pattern": "${e.STUDIO_DOMAIN}",`));
	lines.push(t(3, '"custom_domain": true,'));
	lines.push(t(2, '},'));
	lines.push(t(1, '],'));
	lines.push(t(0, '}'));
	return lines.join('\n') + '\n';
}

// ─── targets ────────────────────────────────────────────────────────────────
const TARGETS = {
	prod: [
		{ envFile: 'infra/env.prod', file: 'apps/api/wrangler.jsonc', render: renderApiProd },
		{ envFile: 'infra/env.prod', file: 'apps/tgapp/wrangler.jsonc', render: renderTgappProd },
		{ envFile: 'infra/env.prod', file: 'apps/studio/wrangler.jsonc', render: renderStudioProd },
	],
	testco: [{ envFile: 'infra/env.testco', file: 'apps/api/wrangler.testco.jsonc', render: renderApiTestco }],
};

function main() {
	const args = process.argv.slice(2);
	const check = args.includes('--check');
	const envIdx = args.indexOf('--env');
	const envName = envIdx >= 0 ? args[envIdx + 1] : 'prod';
	if (!TARGETS[envName]) {
		console.error(`Unknown env "${envName}" — expected one of: ${Object.keys(TARGETS).join(', ')}`);
		process.exit(2);
	}
	const env = loadEnvFile(envName);
	let failed = 0;
	for (const target of TARGETS[envName]) {
		const content = target.render(env);
		const abs = path.join(ROOT, target.file);
		if (check) {
			const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
			if (current !== content) {
				failed = 1;
				console.error(`❌ drift: ${target.file} does not match ${target.envFile}`);
				if (current !== null) {
					const a = content.split('\n');
					const b = current.split('\n');
					for (let i = 0; i < Math.max(a.length, b.length); i++) {
						if (a[i] !== b[i]) {
							console.error(`   line ${i + 1} — expected: ${a[i] ?? '<eof>'}`);
							console.error(`              actual:   ${b[i] ?? '<eof>'}`);
							if (i > 4) break;
						}
					}
				}
			} else {
				console.log(`✓ ${target.file} matches ${target.envFile}`);
			}
		} else {
			fs.writeFileSync(abs, content);
			console.log(`✍️  ${target.file} ← ${target.envFile}`);
		}
	}
	process.exit(failed);
}

// Run only when executed directly (`node scripts/gen-wrangler.mjs`) — the
// loadEnvFile export is imported by the operational scripts (d1-export-via-api,
// sync-r2-to-local) so they read the same SSOT.
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
