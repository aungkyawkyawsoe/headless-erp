/**
 * Headless Entity Engine — Hono + Cloudflare Workers
 *
 * Modular by configuration. To disable a feature, comment out its line.
 * Bundle impact: ~2-5KB per feature group, ~10KB base.
 */
import { Hono, type Context, type Next } from 'hono';
import { cors } from 'hono/cors';
import { D1Client, QueryBuilder, setReadInvalidationObserver, configureDbLiveness } from '@mmbix/core';
import { initConfig, buildConfig, isPluginEnabled, isModuleEnabled, APP_VERSION, MAX_AGGREGATE_GROUPS } from '@mmbix/config';
import { API_ERROR_CODES, modulePath } from '@mmbix/types';
import { AuthService, type AuthContext } from '@/lib/services/auth.service';

// Shared middleware
import { requestLogger } from './middleware/logger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { rateLimiter } from './middleware/rate-limiter';
import { rateLimiterDO } from './middleware/rate-limiter-do';
import { RATE_LIMIT_TIERS, isLocalDevRequest } from './middleware/rate-limit-tiers';
import { securityHeaders } from './middleware/security-headers';
import { apiAnalytics } from './middleware/analytics';
import { bodySizeLimit } from './middleware/body-limit';
import { compression } from './middleware/compression';
import { edgeCache } from './middleware/edge-cache';
import { PluginMigrationService } from './lib/services/plugin-migration.service';
import { recordChange, runWithChangeScope } from './lib/change-scope';
import { parseWriteAcks, runWithWriteAcks, WRITE_ACK_HEADER } from './lib/write-ack';
import { runWithRequestTasks } from './lib/request-tasks';
import { countD1Statements, runWithDbStats, statementCount } from './lib/db-stats';
import { openD1Session, runWithD1Session } from './lib/d1-session';
import type { SchedulerEnv } from '@mmbix/scheduler';

// Scheduled + queue handlers
import { runScheduledBackup } from './scheduled/backup';
import { runAuditRetention } from './scheduled/maintenance';
import { webhookQueueConsumer, type WebhookQueueMessage } from './queue/webhook-queue';

// Durable Object classes must be exported from the entrypoint (wrangler requirement)
export { GlobalRateLimitStore } from './middleware/rate-limiter-do';
// Headless scheduler DO — one instance per scheduled task (alarm = next run).
export { SchedulerDO } from '@mmbix/scheduler';
// Distributed lock DO — one instance per lock name (lease-based mutex).
export { LockDO } from '@mmbix/locks';

// tRPC Layer — lazy-loaded dynamic import to avoid module-level init

// Feature routes — each can be disabled by commenting out
import { entityRoutes } from './routes/entities';
// v1.8: Schema plane (Directus-style) — collections + field-types live on their
// OWN top-level namespaces so a user-named collection (`detail`, `field-types`,
// `import`, …) can never be shadowed by a schema route on the data plane.
import { collectionRoutes, fieldTypesRoutes } from './routes/collections';
import { authRoutes } from './routes/auth';
import telegramAuthRoutes from './routes/auth-telegram';
import { userRoutes } from './routes/users';
import { webhookRoutes } from './routes/webhooks';
import { searchRoutes } from './routes/search';
import { auditRoutes } from './routes/audit';
import { meRoutes } from './routes/me';
import { bulkRoutes } from './routes/bulk';
import { exportRoutes } from './routes/export';
import { reportRoutes } from './routes/reports';
import { schedulerRoutes } from './routes/scheduler';
import { mediaRoutes } from './routes/media';
import { seedRoutes } from './routes/seed';
import { moduleRoutes } from './routes/modules';
// Aggregate app endpoints (dock + manifest — Studio config → frontend render)
import { appRoutes } from './routes/apps';
// v0.7: Saved views
import { savedViewRoutes } from './routes/views';
// v0.8: Persisted pages (block config)
import { pageRoutes } from './routes/pages';
import { translationRoutes } from './routes/translations';
// v0.9: AI generation (prompt → block JSON metadata)
import { aiRoutes } from './routes/ai';
// v0.9: Design tokens (theme swap layer)
import { designTokenRoutes } from './routes/design-tokens';
// v1.1: Machine API keys (headless/integration access)
import { apiKeyRoutes } from './routes/api-keys';
// v0.9: Extension API — custom block types
import { customBlockRoutes } from './routes/custom-blocks';
// v1.2: MVE templates (MiniApp module layouts — DB-driven)
import { mveRoutes } from './routes/mve';
// v1.6: Query batch — one-view-one-round-trip reads (generic consolidation)
import { queryRoutes } from './routes/query';
// Domain-module registry (config-gated verticals — ships the IDP admin module)
import { bootModuleHooks, moduleManifests, mountDomainModules } from './domain-modules';
// v1.5: Operations & self-tuning telemetry (index-advisor observability)
import { operationsRoutes } from './routes/operations';
// v1.5: Runtime feature policies (headless control plane)
import { policyRoutes } from './routes/policies';
// Add-on registry — runtime install/remove of modules (see domain-modules).
import { addonRoutes } from './routes/addons';
// Generic data-quality (anomaly) surface — runs a collection's integrity rules.
import { integrityRoutes } from './routes/integrity';
// Code-hook registry introspection (admin-only — Studio's lifecycle-hook viewer)
import { hookRegistryRoutes } from './routes/hook-registry';
// v1.7+: R2 Data Catalog (Iceberg) read-only analytics client — env-gated.
import { r2sqlRoutes } from './routes/r2sql';
//
// Bundle composition (wrangler deploy --dry-run): ~1,378 KB raw / ~242 KB gzip
//   → Well within Workers 1 MB compressed limit (24% utilized with 15 plugins)
//
// Optimization path when approaching the limit:
//   1. Multi-worker architecture: one worker per plugin domain (e.g. plugin-hr, plugin-finance)
//      with service bindings for private sub-ms routing — zero public internet hops.
//   2. Lazy registration: use wrangler's `routes` + `workers.dev` to split by path prefix
//      (/api/entities → core worker, /api/calendar → calendar worker, etc.).
//   3. Keep current structure until gzip exceeds ~700 KB (~70% utilization).
import { childTablePlugin } from './plugins/child-tables/plugin';
import { approvalPlugin } from './plugins/approvals/plugin';
import { tenantPlugin } from './plugins/tenants/plugin';
import { openApiPlugin } from './plugins/openapi/plugin';
import { notificationPlugin } from './plugins/notifications/plugin';
import { sdkPlugin } from './plugins/sdk/plugin';
import { templatePlugin } from './plugins/templates/plugin';
import { pdfPlugin } from './plugins/pdf/plugin';
import { calendarPlugin } from './plugins/calendar/plugin';
import { scheduledReportsPlugin } from './plugins/scheduled-reports/plugin';
import { archivePlugin } from './plugins/archive/plugin';
import { bulkNotifyPlugin } from './plugins/bulk-notify/plugin';
import { snapshotPlugin } from './plugins/snapshot/plugin';
import { serverFunctionsPlugin } from './plugins/server-functions/plugin';
import { workflowPlugin } from './plugins/workflow/plugin';
import { marketplacePlugin } from './plugins/marketplace/plugin';
import { outboxPlugin } from './plugins/outbox/plugin';
import { decisionTablePlugin } from './plugins/decision-table/plugin';
import { kpiPlugin } from './plugins/kpi/plugin';
import { fieldAuditPlugin } from './plugins/field-audit/plugin';
import { schedulerPlugin } from './plugins/scheduler/plugin';
import { idempotencyPlugin, idempotencyMiddleware } from './plugins/idempotency/plugin';
import { locksPlugin } from './plugins/locks/plugin';
import { eventsPlugin } from './plugins/events/plugin';
import { flagsPlugin } from './plugins/flags/plugin';
import { quotaPlugin } from './plugins/quota/plugin';
import { gdprPlugin } from './plugins/gdpr/plugin';
import { viewsPlugin } from './plugins/views/plugin';
import { jobsPlugin } from './plugins/jobs/plugin';
import { setChainEnv } from './plugins/marketplace/chain';
import { setTelegramPushEnv } from './lib/telegram-push';
import { registerComputeFunctions } from '@mmbix/compute';
import { pluginHookRegistry } from './core/plugin-hooks';

// Single source of truth for computation: register @mmbix/compute into the
// safe expression evaluator so EVERY declarative surface (workflow guards,
// server-function rules, linkage calculate, formula fields) can call
// financial/statistical/date functions — e.g. "guard": "NPV(0.08, doc.cfs) > 0".
registerComputeFunctions();
import type { PluginContext } from '@mmbix/types/worker';

// Note: The legacy plugin implementations for auth, entities, search, export, media,
// scheduler, reports, audit and webhooks were DELETED (src/plugins/{auth,entities,search,
// export,media,scheduler,reports,audit,webhooks}). These features are implemented in
// src/routes/*.ts with proper auth middleware — the plugin versions lacked auth
// enforcement and caused route conflicts. The 14 plugins below are the only registrations.

// ─── App ──────────────────────────────────────────────

const app = new Hono<{ Bindings: Record<string, unknown> }>();

// Request timing — ONE `Server-Timing` header on every response so a slow call
// can be split into SERVER vs NETWORK from the client. Registered FIRST, before
// the D1 session/config middleware, so `app` is the WHOLE server-side cost (the
// browser's Resource Timing then attributes the rest to DNS/TLS/transfer).
app.use('*', async (c, next) => {
	const t0 = performance.now();
	let statements = 0;
	// The D1 statement count for the whole request — read BEFORE the scope
	// unwinds. `app;dur` already reflects I/O time (timers only advance on I/O);
	// `db` says how many round trips that time was spent on, which distinguishes a
	// single slow query from an N+1.
	await runWithDbStats(async () => {
		await next();
		statements = statementCount();
	});
	try {
		c.res.headers.set('Server-Timing', `app;dur=${(performance.now() - t0).toFixed(1)}, db;desc="${statements} stmts"`);
	} catch {
		/* response already streamed — no header slot */
	}
});

// D1 read replication — open ONE session per request and issue every query in
// it through the Sessions API, so reads can be served by the replica nearest the
// user (sequential consistency) instead of always crossing to the primary's
// region. `first-primary` keeps read-your-writes: the FIRST query reads the
// primary, so a read can never miss a write committed before this request.
// Registered FIRST so it wraps every route. The session is OPTIONAL (a runtime
// without `withSession` keeps the plain binding); either way the executor is
// wrapped once here so the request's D1 statement count can be reported.
app.use('*', async (c, next) => {
	const db = (c.env as { DB?: D1Database }).DB;
	if (!db) return next();
	// Count every statement in one place: whether or not a read-replication
	// session is available, all queries funnel through this executor.
	const executor = countD1Statements(openD1Session(db) ?? db);
	await runWithD1Session(executor, () => next());
});

/** The ONE-time token verification the pre-auth middleware stores, so the
 *  limiters and `requireAuth` never re-verify. The root app is untyped for
 *  variables (its sub-apps carry their own `CmsBindings`), so this is the
 *  narrowest cast that keeps a single, discoverable accessor. */
const setAuthContext = (c: { set: unknown }, ctx: AuthContext) => (c.set as (key: string, value: unknown) => void)('auth', ctx);
const getAuthContext = (c: { get: unknown }) => (c.get as (key: string) => AuthContext | undefined)('auth');

// Every write path already calls `invalidateCollectionReads(...)` to drop the
// server read cache — tap that seam into the request-scoped change envelope so
// each response tells the client EXACTLY which collections changed (primary row
// + cascade parents + hook/denorm writes). Registered once per isolate; the
// collector itself is AsyncLocalStorage-scoped per request, so interleaved
// requests never bleed into each other.
setReadInvalidationObserver((collection, id) => recordChange(collection, id));

// Change scope — wrap every request so `success()` can attach `meta.changed`.
app.use('*', async (_c, next) => runWithChangeScope(() => next()));

// Write acknowledgements — a compiled guard may REFUSE a write the caller may
// legitimately want anyway (the MRO same-day duplicate requisition is a warning,
// not a rule violation). A caller that has seen the warning confirms it with the
// `X-Write-Ack` request header; the guard consults this scope and steps aside.
// Read once here — the confirmation is request metadata and never reaches a row.
app.use('*', async (c, next) => runWithWriteAcks(parseWriteAcks(c.req.header(WRITE_ACK_HEADER)), () => next()));

// Background tasks (the index advisor's opportunistic tune run) MUST reach
// `ctx.waitUntil`, or the runtime cancels them once the response is sent —
// silently, with no error or log. Bind the request's waitUntil into a scope so
// engine code can register work without threading `c` through every call site
// (mirrors the change scope / D1 session).
app.use('*', async (c, next) => {
	let waitUntil: ((p: Promise<unknown>) => void) | undefined;
	try {
		waitUntil = c.executionCtx?.waitUntil?.bind(c.executionCtx);
	} catch {
		/* no execution context (direct invocation / CLI) — backgroundTask falls back */
	}
	if (!waitUntil) return next();
	return runWithRequestTasks(waitUntil, () => next());
});

// Config middleware — idempotent: builds once per isolate (cold start) from real env
// bindings, then reuses the cached config on subsequent requests.
app.use('*', async (c, next) => {
	initConfig(c.env as Record<string, unknown>);

	// PBKDF2 cost is env-tunable (PBKDF2_ITERATIONS; default 600k — OWASP 2023).
	// Workers bills per-CPU-ms, so a deployment on a plan with a tight CPU budget
	// can lower the cost of NEW password hashes here. Existing hashes embed their
	// own iteration count and always verify. See AuthService.configure.
	const iters = Number((c.env as { PBKDF2_ITERATIONS?: string }).PBKDF2_ITERATIONS);
	if (Number.isInteger(iters)) AuthService.configure({ pbkdf2Iterations: iters });

	// Marketplace chain needs the current env (LOADER/R2/service bindings)
	// to reach sandboxed and binding-backed plugins at request time.
	setChainEnv(c.env as Record<string, unknown>);

	// Telegram push needs the bot token at hook time (compiled hooks never get
	// `c.env`). Same per-request capture as the marketplace chain.
	setTelegramPushEnv(c.env as Record<string, unknown>);

	// DB-liveness probe window. The probe (one `sqlite_master` round trip, run by
	// the plugin middleware below) exists to detect a TEST database reset between
	// tests while the isolate persists. Production never resets, so the short
	// 200ms window was probing on nearly every request (sparse user traffic is
	// usually >200ms apart) — widen it there. Dev/test keep the short window.
	// Idempotent, one value per isolate.
	const isDevEnv = (c.env as { IS_DEV?: string | boolean }).IS_DEV === 'true' || (c.env as { IS_DEV?: unknown }).IS_DEV === true;
	configureDbLiveness(isDevEnv ? 200 : 60_000);

	// Self-tuning index advisor mode is now per-COLLECTION via schema_json.policies
	// (auto_index.mode) — decided at tune() call time, not a global env flag. The
	// engine never applies DDL on a collection whose policy is 'propose'. (The
	// config.autoIndex global still exists only as a documentation fallback.)

	// v0.7: Initialize field encryption key once per isolate (no-op without ENCRYPTION_KEY)
	if (!(globalThis as unknown as Record<string, boolean>).__ENC_INIT__) {
		(globalThis as unknown as Record<string, boolean>).__ENC_INIT__ = true;
		try {
			const { FieldEncryption } = await import('./lib/services/field-encryption.service');
			FieldEncryption.init(c.env as Record<string, unknown>);
		} catch (err) {
			// ENCRYPTION_KEY missing → field encryption disabled. Loud on the
			// runtime log (once per isolate) so a schema with `encrypted` fields
			// but no key is visible instead of silently writing plaintext.
			console.warn('[encryption] field encryption disabled:', err instanceof Error ? err.message : String(err));
		}
	}

	await next();
});

// Global middleware
app.use('*', requestLogger);
app.use('*', securityHeaders());

// Dev flag (legacy globalThis marker — nothing sets __DEV__ today, so this is
// effectively false in production; kept for the plugin config below).
const isDev = (globalThis as unknown as Record<string, boolean>).__DEV__ === true;

// CORS: the header's auth is carried in the Authorization header (never
// cookies), but reflecting ANY origin with credentials enabled is still wrong —
// it would let a malicious page issue credentialed cross-origin calls and read
// the response. Allowlist instead (see M3): dev allows localhost origins; prod
// reflects only the configured allowlist (and never the '*' default).
app.use(
	'*',
	cors({
		origin: (origin, c) => {
			if (!origin) return origin;
			const env = (c.env ?? {}) as Record<string, unknown>;
			const isDev = env.IS_DEV === 'true' || env.IS_DEV === true;
			// Dev: the studio + miniapp dev servers run on localhost — allow any
			// local origin, reject everything else.
			if (isDev) return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : null;
			// Prod: explicit allowlist only. '*' is the config DEFAULT, not an
			// allowlist — with credentials, reflecting '*' would defeat the check,
			// so treat it as "no cross-origin configured": same-origin calls (no
			// Origin header → handled above) keep working, cross-origin calls get
			// no CORS headers and are blocked by the browser.
			const allowed = initConfig(env).cors.origins.filter((o) => o !== '*');
			return allowed.includes(origin) ? origin : null;
		},
		credentials: false,
		allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Tenant-Id'],
		maxAge: 86400,
	}),
);

// ONE token verification per request.
//
// Both limiters (`rateLimiter`, `rateLimiterDO`) and `requireAuth` used to each
// call `AuthService.verifyToken` on the SAME bearer — three full verifications
// per authenticated request. Every verification also runs `_healActingEmployee`
// → `findLiveEmployeeById`, which is an UNCACHED indexed point read, plus an
// `authzVersion` query. That is ~4 extra D1 round trips on 100% of traffic for
// a value that cannot change within one request.
//
// This runs FIRST and stores the result on the context. `resolveRateLimitTier`
// already short-circuits on `c.get('auth')`, and `requireAuth` now reuses it —
// so the work happens exactly once. A failure is swallowed here (an invalid
// token must NOT be rejected by this middleware, which also fronts public
// routes); `requireAuth` still makes the authoritative decision, and the
// external-provider fallback still runs there.
app.use('/api/*', async (c, next) => {
	const header = c.req.header('Authorization');
	if (header?.startsWith('Bearer ')) {
		try {
			const env = (c.env ?? {}) as Record<string, unknown>;
			const db = env.DB as D1Database | undefined;
			if (db && !getAuthContext(c)) {
				const jwtSecret = AuthService.resolveJwtSecret(env as { JWT_SECRET?: string; ADMIN_PASSWORD?: string; IS_DEV?: string });
				const ctx = await new AuthService(new D1Client(db)).verifyToken(header.slice(7), jwtSecret, true, env);
				if (ctx) setAuthContext(c, ctx);
			}
		} catch {
			// Unverifiable token (or missing JWT_SECRET) — leave `auth` unset and let
			// the route's own guard answer.
		}
	}
	await next();
});

// API-specific middleware
app.use('/api/*', rateLimiter());
// Global rate limiting via Durable Object — self-disables without the RATE_LIMIT
// binding + RATE_LIMIT_DO="true". The in-memory limiter above stays as the
// per-isolate fast path + endpoint overrides (e.g. /api/bulk).
app.use('/api/*', rateLimiterDO());
app.use(
	'/api/bulk/*',
	rateLimiter({
		endpoints: { POST: { window: 60, max: 10 } },
	}),
);
app.use('/api/*', async (c, next) => {
	// Body limits: JSON/API bodies capped at 10MB; multipart/form-data (media
	// uploads, CSV import) at the effective config's upload.maxFileSize (env
	// UPLOAD_MAX_FILE_SIZE, default 50MB). The media route enforces the same
	// config-driven per-file cap — one number, no drift. Config resolves
	// per-request so env-wired limits apply.
	const cfg = initConfig(c.env ?? {});
	return bodySizeLimit({ maxSize: 10 * 1024 * 1024, multipartMaxSize: cfg.upload.maxFileSize })(c, next);
});
app.use('/api/*', compression);
app.use('/api/*', apiAnalytics());

// Stripe-style Idempotency-Key support on entity writes — a keyed request runs
// exactly once; replays get the cached 2xx response (409 while in progress).
app.use('/api/entities/*', idempotencyMiddleware());

// Edge cache for entity read endpoints — leverages Cloudflare CDN (D1 read reduction)
app.use('/api/entities/*', edgeCache());

app.get('/api/health', async (c) => {
	const env = (c.env ?? {}) as Record<string, unknown>;
	// Anonymous callers get a minimal liveness probe only — version + backup
	// state reveal deployment details and are gated behind a valid token
	// (same acceptance rules as requireAuth: dev-token on local hosts, or a
	// valid JWT).
	const base = { status: 'ok', timestamp: new Date().toISOString() };
	const authHeader = c.req.header('Authorization') || '';
	let authenticated = false;
	if (authHeader.startsWith('Bearer ')) {
		const token = authHeader.slice(7);
		const isDev = env.IS_DEV === 'true' || env.IS_DEV === true;
		if (isDev && token === 'dev-token' && isLocalDevRequest(c)) {
			authenticated = true;
		} else {
			try {
				const db = new D1Client(env.DB as D1Database);
				const { AuthService } = await import('@/lib/services/auth.service');
				const jwtSecret = AuthService.resolveJwtSecret(env as { JWT_SECRET?: string; ADMIN_PASSWORD?: string; IS_DEV?: string });
				authenticated = !!(await new AuthService(db).verifyToken(token, jwtSecret, true, env));
			} catch {
				authenticated = false;
			}
		}
	}
	if (!authenticated) return c.json(base);
	// Authenticated — include the deployment detail (last successful/nightly
	// backup marker, persisted by the scheduled backup handler into `_backup_status`).
	let lastBackup: string | null = null;
	try {
		const db = new D1Client(env.DB as D1Database);
		const row = await db.first<{ at: string }>(QueryBuilder.from('_backup_status').select('at').orderBy('at', 'desc').limit(1).toSelect());
		lastBackup = row?.at ?? null;
	} catch {
		/* no backup has run yet — table may not exist */
	}
	return c.json({
		...base,
		version: APP_VERSION,
		backup_enabled: env.BACKUP_ENABLED === 'true',
		last_backup: lastBackup,
	});
});

// Platform contract — the BACKEND is the single source of truth for limits.
// Clients (the @mmbix/sdk via `client.loadLimits()`, other SDKs, direct
// integrations) discover the page-size policy here and adjust within it;
// they can never exceed it (the server clamps every endpoint anyway).
// The page-size values reflect the EFFECTIVE (env-wired) config —
// API_DEFAULT_LIMIT / API_MAX_LIMIT can tune them per deployment; the
// aggregate GROUP BY ceiling is the shared `MAX_AGGREGATE_GROUPS` constant the
// engine itself enforces (a grouped read is not page-limited, so it has its own
// advertised bound — see @mmbix/config).
app.get('/api/meta', async (c) => {
	const cfg = initConfig(c.env ?? {});
	return c.json({
		success: true,
		data: {
			platform: 'mmbix-headless',
			version: APP_VERSION,
			pagination: { default_page_size: cfg.api.defaultLimit, max_page_size: cfg.api.maxLimit },
			aggregate: { max_groups: MAX_AGGREGATE_GROUPS },
			// Identity contract — the configured employee-directory collection +
			// field (config-driven, may be null). Clients that need to resolve an
			// account's acting employee read it from here instead of hardcoding a
			// collection name.
			identity: {
				directory_collection: cfg.telegram.directoryCollection || null,
				directory_field: cfg.telegram.directoryField || null,
			},
			// Discovery — WHAT this BUILD makes available (the `DOMAIN_MODULES` /
			// `PLUGINS` allowlist), I/O-free. The RUNTIME install state (what is
			// actually installed) lives at `GET /api/addons`, which reads `_addons`;
			// /api/meta stays a static contract with zero D1 reads.
			modules: moduleManifests
				.filter((m) => isModuleEnabled(c.env ?? {}, m.id))
				.map((m) => ({ id: m.id, name: m.name, version: m.version, path: modulePath(m) })),
			plugins: plugins.filter((p) => isPluginEnabled(c.env ?? {}, p.id)).map((p) => p.id),
			rate_limits: {
				anonymous: RATE_LIMIT_TIERS.anonymous,
				authenticated: RATE_LIMIT_TIERS.authenticated,
				admin: RATE_LIMIT_TIERS.admin,
			},
			// Canonical error codes this deployment emits — the API-only subset of
			// @mmbix/types ERROR_CODES (single source), so tooling/SDK match the
			// real surface (no SDK-only codes like NETWORK_ERROR leak here).
			error_codes: API_ERROR_CODES,
		},
	});
});

// ─── tRPC Layer (type-safe RPC) ──────────────────────

/**
 * Replace the client-visible `message` of every tRPC error envelope with a
 * generic string — the error `code` + `data` (the machine contract clients
 * match on) are preserved. Handles both single envelopes and batched arrays.
 */
function genericizeTrpcErrors(body: unknown): unknown {
	if (Array.isArray(body)) return body.map((b) => genericizeTrpcErrors(b));
	if (body && typeof body === 'object') {
		const rec = body as Record<string, unknown>;
		const err = rec.error;
		if (err && typeof err === 'object' && !Array.isArray(err)) {
			const errRec = err as Record<string, unknown>;
			if (typeof errRec.message === 'string') {
				return { ...rec, error: { ...errRec, message: 'Internal server error' } };
			}
		}
	}
	return body;
}

app.use('/trpc/*', rateLimiter());
// Global DO rate limiter + body-size limit — /trpc/* must get the SAME
// protections as /api/* (they were previously missing entirely).
app.use('/trpc/*', rateLimiterDO());
app.use('/trpc/*', async (c, next) => {
	const cfg = initConfig(c.env ?? {});
	return bodySizeLimit({ maxSize: 10 * 1024 * 1024, multipartMaxSize: cfg.upload.maxFileSize })(c, next);
});
app.use('/trpc/*', async (c) => {
	// Dynamic import avoids @trpc/server module-level init at cold start
	const { fetchRequestHandler } = await import('@trpc/server/adapters/fetch');
	const { appRouter } = await import('./trpc/router');
	const { createTrpcContext } = await import('./trpc/context');
	const { D1Client } = await import('@mmbix/core');

	const db = new D1Client(c.env.DB as D1Database);
	const isProd = (c.env.IS_DEV as string) !== 'true';

	// Auth context — reuse the pre-auth middleware's ONE verification (index.ts),
	// falling back to a local verify only if it did not run.
	const authHeader = c.req.header('Authorization') || '';
	let authCtx: AuthContext | null = getAuthContext(c) ?? null;
	if (!authCtx && authHeader.startsWith('Bearer ')) {
		try {
			const { AuthService } = await import('./lib/services/auth.service');
			// 🔒 Fail closed: resolveJwtSecret throws in production without an
			// explicit JWT_SECRET — the ADMIN_PASSWORD fallback is dev-only.
			const jwtSecret = AuthService.resolveJwtSecret(c.env as { JWT_SECRET?: string; ADMIN_PASSWORD?: string; IS_DEV?: string });
			authCtx = await new AuthService(db).verifyToken(authHeader.slice(7), jwtSecret, true, c.env);
		} catch {
			/* ignore invalid tokens */
		}
	}

	const res = await fetchRequestHandler({
		endpoint: '/trpc',
		req: c.req.raw,
		router: appRouter,
		// Log the REAL error message server-side — clients in production only
		// ever see the genericized message (M4).
		onError: (opts) => {
			console.error(
				JSON.stringify({
					level: 'error',
					timestamp: new Date().toISOString(),
					code: opts.error.code,
					path: opts.path,
					message: opts.error.message,
				}),
			);
		},
		createContext: () =>
			createTrpcContext({
				db,
				env: c.env as Record<string, unknown>,
				auth: authCtx,
				// ExecutionCtx expects { executionCtx: { waitUntil } } — wrap Hono's
				// executionCtx so entity writes fire webhooks/audit via waitUntil.
				execCtx: { executionCtx: c.executionCtx },
				// CF-Connecting-IP only — X-Forwarded-For is client-spoofable.
				ip: c.req.header('CF-Connecting-IP') || 'unknown',
			}),
	});

	// M4: tRPC v11 has no per-handler errorFormatter — in production, rewrite
	// the client-visible error message to a generic one while keeping the error
	// code + data intact (that's the machine contract clients match on). Batched
	// responses are arrays; every error envelope is sanitized in place.
	// NOTE: tRPC returns HTTP 200 for most application errors, so sanitize by
	// body content, not by status code.
	if (isProd && (res.headers.get('content-type') || '').includes('application/json')) {
		try {
			const body = await res.clone().json();
			const sanitized = genericizeTrpcErrors(body);
			if (sanitized !== body) {
				const headers = new Headers(res.headers);
				headers.delete('content-length');
				return new Response(JSON.stringify(sanitized), { status: res.status, headers });
			}
		} catch {
			/* non-JSON body (streaming/SSE) — leave untouched */
		}
	}
	return res;
});

// ─── Core Feature Routes ─────────────────────────────

// All plugin factories (composable enterprise features). Declared here so the
// migration middleware below can gather every plugin's D1 migrations before
// core routes mount — plugin tables must exist before the entity pipeline runs.
const plugins = [
	childTablePlugin(),
	approvalPlugin(),
	tenantPlugin(),
	openApiPlugin(),
	notificationPlugin(),
	sdkPlugin(),
	templatePlugin(),
	pdfPlugin(),
	calendarPlugin(),
	scheduledReportsPlugin(),
	archivePlugin(),
	bulkNotifyPlugin(),
	snapshotPlugin(),
	serverFunctionsPlugin(),
	workflowPlugin(),
	marketplacePlugin(),
	outboxPlugin(),
	decisionTablePlugin(),
	kpiPlugin(),
	fieldAuditPlugin(),
	schedulerPlugin(),
	idempotencyPlugin(),
	locksPlugin(),
	eventsPlugin(),
	flagsPlugin(),
	quotaPlugin(),
	gdprPlugin(),
	viewsPlugin(),
	jobsPlugin(),
];

// Plugin-declared D1 migrations run once per isolate (tracked in _migrations),
// FILTERED to the plugins this deployment enables (`PLUGINS`). Registered BEFORE
// core routes so plugin tables (e.g. _server_functions, _workflows,
// _marketplace_plugins) exist by the time the entity pipeline touches them from
// any route — core routes included.
const pluginMigrationServices = new Map<string, PluginMigrationService>();
function pluginMigrationServiceFor(env: Record<string, unknown>): PluginMigrationService {
	const enabled = plugins.filter((p) => isPluginEnabled(env, p.id));
	const key = enabled.map((p) => p.id).join(',');
	let svc = pluginMigrationServices.get(key);
	if (!svc) {
		svc = new PluginMigrationService(
			enabled.flatMap((p) => p.migrations ?? []),
			key,
		);
		pluginMigrationServices.set(key, svc);
	}
	return svc;
}
app.use('*', async (c, next) => {
	// Boot the compiled hooks of every INSTALLED domain module — ONCE per isolate.
	// They fire on engine collections (not just the module's own routes), so they
	// must be live before any route runs.
	const env = (c.env ?? {}) as Record<string, unknown>;
	const db = new D1Client((c.env as { DB: D1Database }).DB);
	await bootModuleHooks(env, db);
	try {
		await pluginMigrationServiceFor(env).runPending(db);
	} catch (err) {
		console.error('[plugin-migration] failed:', err instanceof Error ? err.message : err);
	}
	await next();
});

app.route('/api/entities', entityRoutes);
// Schema plane — mounted separately from the data plane (zero routing conflicts).
app.route('/api/collections', collectionRoutes);
app.route('/api/field-types', fieldTypesRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/auth/telegram', telegramAuthRoutes);
app.route('/api/users', userRoutes);
app.route('/api/webhooks', webhookRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/audit', auditRoutes);
// GDPR/account endpoints (see routes/me.ts)
app.route('/api/me', meRoutes);
app.route('/api/bulk', bulkRoutes);
app.route('/api/export', exportRoutes);
app.route('/api/reports', reportRoutes);
app.route('/api/scheduler', schedulerRoutes);
app.route('/api/media', mediaRoutes);
app.route('/api/seed', seedRoutes);
app.route('/api/modules', moduleRoutes);
// Aggregate app endpoints (dock + manifest) — the frontend shell renders from these
app.route('/api/apps', appRoutes);
// v0.7: Saved views
app.route('/api/views', savedViewRoutes);
// v0.8: Persisted pages
app.route('/api/pages', pageRoutes);
// v0.8: Translations (i18n)
app.route('/api/translations', translationRoutes);
// v0.9: AI generation
app.route('/api/ai', aiRoutes);
// v0.9: Design tokens
app.route('/api/design-tokens', designTokenRoutes);
// v1.1: Machine API keys
app.route('/api/api-keys', apiKeyRoutes);
// v0.9: Custom blocks (extension API)
app.route('/api/custom-blocks', customBlockRoutes);
// v1.2: MVE templates (MiniApp module layouts)
app.route('/api/mve', mveRoutes);
// v1.3+ Domain modules — config-gated verticals mounted from domain-modules/
// (the factory core stays domain-agnostic). Ships the IDP admin module.
mountDomainModules(app);
// v1.6: Query batch — one-view-one-round-trip reads (generic consolidation)
app.route('/api/query', queryRoutes);
// v1.5: Operations & self-tuning telemetry (admin-only)
app.route('/api/operations', operationsRoutes);
// v1.5: Runtime feature policies — enable/configure/dispose per collection
app.route('/api/collections/:slug/policies', policyRoutes);
// Generic integrity checks — bounded data-quality rules declared per collection.
app.route('/api/collections/:slug/integrity', integrityRoutes);
// Add-on registry — catalog + install/uninstall (admin).
app.route('/api/addons', addonRoutes);
// v1.7+: R2 Data Catalog (Iceberg) read-only analytics — admin, env-gated by
// R2_SQL_TOKEN + ENABLE_R2_LAKE. Falls empty (404) when not enabled.
app.route('/api/r2sql', r2sqlRoutes);

// ─── Plugin Routes (composable enterprise features; env-gated by PLUGINS) ───

for (const plugin of plugins) {
	// Note: plugins access DB via c.env.DB at request time, not via ctx.d1.
	// ctx.d1 exists only for backward-compatible PluginContext interface.
	const ctx = {
		app,
		d1: null as unknown as D1Database,
		env: {},
		config: { isDev },
		hooks: pluginHookRegistry.createAPI(plugin.id),
	} as unknown as PluginContext;
	// Run plugin migrations if defined
	if (plugin.migrations && plugin.migrations.length > 0) {
		(ctx as unknown as Record<string, unknown>)._migrations = plugin.migrations;
	}
	const reg = plugin.register(ctx);
	if (reg.routes)
		for (const r of reg.routes) {
			// Per-request gate: a plugin disabled via `PLUGINS` answers 404 and
			// exposes no reachable route. Registered BEFORE the handler so it covers
			// both the exact path and every subpath.
			const gate = async (c: Context, next: Next) => {
				if (!isPluginEnabled(c.env as Record<string, unknown>, plugin.id)) {
					return c.json({ success: false, error: `Route not found: ${c.req.method} ${c.req.path}` }, 404);
				}
				await next();
			};
			app.use(r.path, gate);
			app.use(`${r.path}/*`, gate);
			app.route(r.path, r.handler);
		}
}

// Code-hook registry introspection — read-only, admin-gated. Reads the compiled
// plugin-hook registry (no DB): mounted AFTER the plugin loop so every boot-time
// registration (domain modules + factory plugins) is visible to Studio's viewer.
app.route('/api/hook-registry', hookRegistryRoutes);

// ─── Error Handling ──────────────────────────────────

app.onError(errorHandler);
app.notFound(notFoundHandler);

// ─── Worker handlers (queue + scheduled) ─────────────────
// The queue consumer delivers webhooks reliably (retries + backoff via Queues).
// The scheduled handler runs the nightly R2 backup (cron in wrangler.jsonc).

const workerHandlers = {
	// Cold-start config validation: a misconfigured deploy (missing JWT_SECRET /
	// ADMIN_* in production) fails loudly at the fetch boundary BEFORE routing,
	// instead of surfacing as a generic 500 from inside the per-request config
	// middleware. The middleware keeps its own cached initConfig path — this is
	// only the fail-fast guard.
	fetch: ((request: Request, ...args: unknown[]) => {
		const env = args[0];
		if (env && typeof env === 'object') {
			try {
				buildConfig(env as Record<string, unknown>);
			} catch (err) {
				console.error('[config] invalid environment:', err instanceof Error ? err.message : String(err));
				return Response.json({ success: false, error: 'Server configuration error', code: 'CONFIG_ERROR' }, { status: 500 });
			}
		}
		return app.fetch(request, args[0] as never, args[1] as never);
	}) as typeof app.fetch,

	async queue(batch: MessageBatch<unknown>, env: unknown, _ctx: ExecutionContext): Promise<void> {
		try {
			const e = env as Record<string, unknown>;
			// Event bus — fan out to subscribers with dedupe. The queue name is the
			// EVENT_QUEUE_NAME var (generated by scripts/gen-wrangler.mjs from the
			// same infra/env.* value as the EVENTS binding), so the runtime
			// comparison can never drift from the config. Missing var = broken
			// config (every generated config emits it) — fail the whole batch
			// loud instead of misrouting it to the webhook consumer.
			const eventsQueue = e.EVENT_QUEUE_NAME as string | undefined;
			if (!eventsQueue) throw new Error('EVENT_QUEUE_NAME var is missing — refusing to dispatch queue batch');
			if (batch.queue === eventsQueue) {
				const { consumeEventBatch } = await import('@mmbix/events');
				const { getHandler } = await import('@mmbix/scheduler');
				const result = await consumeEventBatch(
					batch as MessageBatch<import('@mmbix/events').EventEnvelope>,
					e as never,
					(handlerType, envelope) => {
						const handler = getHandler(handlerType);
						if (!handler) throw new Error(`no handler registered for event type "${handlerType}"`);
						return Promise.resolve(
							handler(envelope.payload, {
								task: {
									id: envelope.id,
									type: handlerType,
									name: null,
									payload_json: JSON.stringify(envelope.payload),
									status: 'pending',
									run_at: envelope.created_at,
									repeat_ms: null,
									cron: null,
									timezone: 'UTC',
									max_attempts: 1,
									attempts: 1,
									run_count: 0,
									last_error: null,
									last_result: null,
									last_run_at: null,
									completed_at: null,
									created_at: envelope.created_at,
									updated_at: envelope.created_at,
								} as import('@mmbix/scheduler').ScheduledTask,
								env: e as unknown as import('@mmbix/scheduler').SchedulerEnv,
								attempts: 1,
								log: (msg, data) => console.info(`[events] ${handlerType}: ${msg}`, data ?? ''),
							}),
						);
					},
				);
				if (result.delivered > 0) console.info('[queue] events consumed:', JSON.stringify(result));
			} else {
				await webhookQueueConsumer(env as Record<string, unknown>, batch as MessageBatch<WebhookQueueMessage>);
			}
		} catch (err) {
			console.error('[queue] consumer error:', err instanceof Error ? err.message : String(err));
		}
	},

	async scheduled(controller: ScheduledController, env: unknown, _ctx: ExecutionContext): Promise<void> {
		const e = env as Record<string, unknown>;

		// D1 keep-warm ping (every minute). D1 is a single SQLite-backed Durable
		// Object: after ~70–140s without a query the DO is evicted and the NEXT
		// query pays a multi-second cold start — on a low-traffic deployment that
		// shows up as "the first call occasionally takes 10s+", which no amount of
		// query tuning can fix. This runs far inside that eviction window. The plain
		// binding (not a Sessions-API session) resolves to the PRIMARY, which is the
		// DO that must stay warm for writes and read-your-writes reads.
		if (controller.cron === '* * * * *') {
			try {
				await new D1Client(e.DB as D1Database).first(QueryBuilder.raw('SELECT 1 AS ok'));
			} catch (err) {
				// Best-effort — a failed ping must never wedge the scheduler.
				console.error('[scheduled] D1 keep-warm failed:', err instanceof Error ? err.message : String(err));
			}
		}

		// Durable outbox flush — every 10 minutes, retries side-effects with
		// backoff and moves exhausted rows to the dead-letter table.
		if (controller.cron === '*/10 * * * *') {
			try {
				const { OutboxService } = await import('@/plugins/outbox/service');
				const result = await new OutboxService(new D1Client(e.DB as D1Database)).flushDue(50, e);
				if (result.processed > 0) console.info('[scheduled] outbox flush:', JSON.stringify(result));
			} catch (err) {
				console.error('[scheduled] outbox flush failed:', err instanceof Error ? err.message : String(err));
			}
			// Housekeeping — prune finished side-effects older than 7 days.
			try {
				const { OutboxService } = await import('@/plugins/outbox/service');
				const pruned = await new OutboxService(new D1Client(e.DB as D1Database)).pruneDone(7);
				if (pruned > 0) console.info(`[scheduled] outbox pruned ${pruned} done rows`);
			} catch (err) {
				console.error('[scheduled] outbox prune failed:', err instanceof Error ? err.message : String(err));
			}
			// Headless scheduler watchdog — re-arm any due task whose DO alarm was
			// lost (eviction before arm, crashed alarm handler, direct-DB inserts).
			try {
				const { SchedulerService } = await import('@mmbix/scheduler');
				const result = await new SchedulerService(new D1Client(e.DB as D1Database)).reconcile(e as unknown as SchedulerEnv, 200);
				if (result.armed > 0) console.info(`[scheduled] scheduler reconcile: armed ${result.armed} tasks`);
			} catch (err) {
				console.error('[scheduled] scheduler reconcile failed:', err instanceof Error ? err.message : String(err));
			}
		}
		// KPI materialization — nightly 03:30 recompute for scheduled KPIs.
		if (controller.cron === '30 3 * * *') {
			try {
				const { runKpiMaterialization } = await import('@/plugins/kpi/scheduler');
				const result = await runKpiMaterialization(e);
				if (result.computed > 0) console.info('[scheduled] KPI materialization:', JSON.stringify(result));
			} catch (err) {
				console.error('[scheduled] KPI materialization failed:', err instanceof Error ? err.message : String(err));
			}
		}
		// Nightly R2 backup (toggle: BACKUP_ENABLED=true — now the default in
		// wrangler.jsonc). Gated to the 02:00 cron so the 08:30 digest trigger
		// never runs it a second time. Failures + truncation are logged inside
		// runScheduledBackup and persisted to the _backup_status marker.
		if (controller.cron === '0 2 * * *') {
			if (e.BACKUP_ENABLED === 'true') {
				const result = await runScheduledBackup(e);
				console.info('[scheduled] backup:', JSON.stringify(result));
			} else {
				console.info('[scheduled] backup disabled (BACKUP_ENABLED != "true")');
			}
			// Audit-log retention (nightly, alongside the backup — gated to 02:00).
			try {
				const pruned = await runAuditRetention(e);
				if (pruned > 0) console.info(`[scheduled] audit retention: pruned ${pruned} rows`);
			} catch (err) {
				console.error('[scheduled] audit retention failed:', err instanceof Error ? err.message : String(err));
			}
			// Scheduler housekeeping — prune finished tasks older than 7 days.
			try {
				const { SchedulerService } = await import('@mmbix/scheduler');
				const pruned = await new SchedulerService(new D1Client(e.DB as D1Database)).prune(7);
				if (pruned > 0) console.info(`[scheduled] scheduler pruned ${pruned} finished tasks`);
			} catch (err) {
				console.error('[scheduled] scheduler prune failed:', err instanceof Error ? err.message : String(err));
			}
			// Idempotency keys + event deliveries — expire old records (nightly).
			try {
				const { IdempotencyService } = await import('@mmbix/idempotency');
				const pruned = await new IdempotencyService(new D1Client(e.DB as D1Database)).pruneExpired(7);
				if (pruned > 0) console.info(`[scheduled] idempotency pruned ${pruned} keys`);
			} catch (err) {
				console.error('[scheduled] idempotency prune failed:', err instanceof Error ? err.message : String(err));
			}
			try {
				const { pruneEventDeliveries } = await import('@mmbix/events');
				const pruned = await pruneEventDeliveries(new D1Client(e.DB as D1Database), 7);
				if (pruned > 0) console.info(`[scheduled] event deliveries pruned ${pruned} rows`);
			} catch (err) {
				console.error('[scheduled] event deliveries prune failed:', err instanceof Error ? err.message : String(err));
			}
		}
	},
};

export default workerHandlers;
