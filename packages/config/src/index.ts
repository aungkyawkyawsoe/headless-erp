/**
 * Application Configuration
 *
 * Validates environment bindings at startup and provides
 * strongly-typed configuration to the rest of the application.
 */

export const APP_VERSION = '0.8.0';

/**
 * Page-size policy — the CROSS-PACKAGE single source of truth for how many
 * rows ONE call may return (backend, SDK, miniapp mirrors). Env-overridable at
 * deploy time via API_DEFAULT_LIMIT / API_MAX_LIMIT (see buildConfig); the
 * backend exposes the effective values via GET /api/meta, and `@mmbix/sdk`
 * adopts them at runtime via `client.loadLimits()`.
 */
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@mmbix/utils';
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };

/**
 * Aggregate GROUP BY bucket ceiling — how many buckets ONE grouped read may
 * return. A grouped aggregate is deliberately NOT page-limited (`?limit=` does
 * not apply: a chart needs every bucket), so without a bound a `groupBy=id` on a
 * large table could stream an unbounded response. The engine probes ONE bucket
 * past this ceiling and fails LOUDLY rather than truncating silently. A process
 * constant, not an env value, so client and server can never disagree on the
 * number; it is advertised (with the env-wired page limits) via GET /api/meta
 * as `data.aggregate.max_groups`.
 */
export const MAX_AGGREGATE_GROUPS = 5_000;

export interface AppConfig {
	auth: { username: string; password: string; enabled: boolean };
	upload: { maxFileSize: number; allowedMimeTypes: string[] };
	api: { defaultLimit: number; maxLimit: number; apiKeyAuth: boolean };
	cors: { origins: string[]; allowMethods: string[]; allowHeaders: string[] };
	isDev: boolean;
	tablePrefix: string;
	/** Self-tuning index advisor mode: 'auto' (apply DDL) or 'propose' (recommend only). */
	autoIndex: { mode: 'auto' | 'propose' };
	/**
	 * Telegram Mini App auth — the directory-as-gate is CONFIG-DRIVEN: which
	 * collection's rows count as "approved" and which role/permissions get
	 * provisioned are env knobs, so any collection can be the employee directory.
	 *
	 * Env knobs:
	 *   - TELEGRAM_DIRECTORY_COLLECTION — collection whose rows gate Telegram
	 *     login (default '' ⇒ Telegram auth is disabled).
	 *   - TELEGRAM_DIRECTORY_FIELD — field on that collection holding the
	 *     Telegram user id (default 'etg_id').
	 *   - TELEGRAM_ROLE_NAME — role provisioned for approved users (default 'Employee').
	 *   - TELEGRAM_ROLE_COLLECTIONS — comma-separated slugs granted
	 *     read/write/create to that role (default '' ⇒ role created WITHOUT
	 *     permissions; a domain module declares its own grants).
	 */
	telegram: {
		/** Directory collection whose rows gate Telegram login (the "who is an employee" source). */
		directoryCollection: string;
		/** Field on that collection holding the Telegram user id. */
		directoryField: string;
		/** Field on that collection holding the employee's RBAC role (a `_roles`
		 *  name or id). Empty/unknown ⇒ the `roleName` default is used. */
		roleField: string;
		/** Role provisioned for approved Telegram users (the fallback when the
		 *  directory row names no role). */
		roleName: string;
		/** Collections granted read/write/create to that role. */
		roleCollections: string[];
	};
	/**
	 * Domain modules shipped with this API instance. The API is a GENERIC
	 * entity engine; domain modules are business verticals on top, mounted from
	 * `apps/api/src/domain-modules/` (this repo ships none).
	 *
	 * Env knob: DOMAIN_MODULES — comma-separated list (default none).
	 *   - 'none' (or empty) → no domain modules (pure factory).
	 *   - a subset (e.g. 'hr,mro') → only those modules ship.
	 */
	modules: { enabled: string[] };
	/**
	 * Plugin gate — which of the worker's built-in plugins ship.
	 *
	 * Env knob: `PLUGINS` — comma-separated plugin ids.
	 *   - unset / empty → ALL plugins enabled (backward-compatible default).
	 *   - 'none'        → NO plugins enabled (pure engine).
	 *   - 'a,b'         → only those plugin ids (routes 404 otherwise; migrations
	 *                     for disabled plugins are skipped).
	 */
	plugins: { enabled: string[] | null };
}

const DEFAULT_CONFIG: AppConfig = {
	auth: { username: '', password: '', enabled: false },
	upload: {
		maxFileSize: 50 * 1024 * 1024,
		allowedMimeTypes: [
			'image/jpeg',
			'image/png',
			'image/gif',
			'image/webp',
			'image/avif',
			'image/svg+xml',
			'application/pdf',
			'text/plain',
			'text/csv',
			'application/json',
			'video/mp4',
			'video/webm',
			'video/quicktime',
			'audio/mpeg',
			'audio/ogg',
			'audio/wav',
			'audio/webm',
			'application/zip',
			'application/gzip',
		],
	},
	api: { defaultLimit: DEFAULT_PAGE_SIZE, maxLimit: MAX_PAGE_SIZE, apiKeyAuth: false },
	cors: {
		origins: ['*'],
		allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
	},
	isDev: false,
	tablePrefix: 'cms_',
	autoIndex: { mode: 'auto' },
	telegram: {
		// The directory gate ("who may sign in") is OFF until a deployment names
		// the collection that holds the Telegram link, via
		// TELEGRAM_DIRECTORY_COLLECTION / TELEGRAM_DIRECTORY_FIELD.
		directoryCollection: '',
		directoryField: 'etg_id',
		roleField: 'role',
		roleName: 'Employee',
		roleCollections: [],
	},
	modules: { enabled: ['idp'] },
	plugins: { enabled: null },
};

class ConfigError extends Error {
	constructor(message: string) {
		super(`[CONFIG] ${message}`);
		this.name = 'ConfigError';
		Object.setPrototypeOf(this, ConfigError.prototype);
	}
}

const parsePositiveInt = (raw: unknown, fallback: number, label: string): number => {
	if (raw === undefined || raw === null || raw === '') return fallback;
	const n = Number(raw);
	if (!Number.isInteger(n) || n <= 0) {
		console.warn(`[CONFIG] Invalid ${label} "${String(raw)}" — falling back to ${fallback}`);
		return fallback;
	}
	return n;
};

export function buildConfig(env: Record<string, unknown>): AppConfig {
	const isDev = typeof env.IS_DEV === 'string' ? env.IS_DEV === 'true' : false;
	// DEEP-clone the defaults: a shallow `{ ...DEFAULT_CONFIG }` shares the nested
	// objects (`telegram`, `plugins`, `api`, …), so assigning to one field below
	// would MUTATE the module-level defaults for every later build — `buildConfig`
	// must be pure (one env per call must never leak into the next).
	const config: AppConfig = { ...structuredClone(DEFAULT_CONFIG), isDev };
	const username = (env.ADMIN_USERNAME as string) || '';
	const password = (env.ADMIN_PASSWORD as string) || '';
	const jwtSecret = (env.JWT_SECRET as string) || '';
	// Fail-fast in production: missing bootstrap credentials OR the JWT signing
	// secret means every authenticated request would 500 mid-routing. Dev stays
	// permissive (tests + local .dev.vars set IS_DEV=true and may omit JWT_SECRET).
	if (!isDev && (!username || !password || !jwtSecret)) {
		throw new ConfigError('ADMIN_USERNAME, ADMIN_PASSWORD and JWT_SECRET must be configured in production');
	}
	config.auth = { username, password, enabled: !!(username && password) };
	config.tablePrefix = (env.TABLE_PREFIX as string) || 'cms_';
	// Env-wired limits (bytes for uploads; row counts for pagination caps).
	config.upload.maxFileSize = parsePositiveInt(env.UPLOAD_MAX_FILE_SIZE, config.upload.maxFileSize, 'UPLOAD_MAX_FILE_SIZE');
	config.api.defaultLimit = parsePositiveInt(env.API_DEFAULT_LIMIT, config.api.defaultLimit, 'API_DEFAULT_LIMIT');
	config.api.maxLimit = parsePositiveInt(env.API_MAX_LIMIT, config.api.maxLimit, 'API_MAX_LIMIT');
	// CORS allowlist — comma-separated origins, e.g. CORS_ORIGINS="https://studio.example.com,https://app.example.com".
	// The '*' default is treated by the middleware as "no cross-origin configured" (bearer-header auth),
	// so production cross-origin browser clients MUST be listed here explicitly.
	const corsOrigins = String(env.CORS_ORIGINS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	if (corsOrigins.length > 0) config.cors.origins = corsOrigins;
	const idxMode = String(env.AUTO_INDEX_MODE ?? 'auto').toLowerCase();
	config.autoIndex.mode = idxMode === 'propose' || idxMode === 'propose_only' ? 'propose' : 'auto';
	// Telegram auth — directory-as-gate + role provisioning (see AppConfig.telegram).
	config.telegram.directoryCollection = (env.TELEGRAM_DIRECTORY_COLLECTION as string) || config.telegram.directoryCollection;
	config.telegram.directoryField = (env.TELEGRAM_DIRECTORY_FIELD as string) || config.telegram.directoryField;
	config.telegram.roleField = (env.TELEGRAM_ROLE_FIELD as string) || config.telegram.roleField;
	config.telegram.roleName = (env.TELEGRAM_ROLE_NAME as string) || config.telegram.roleName;
	const roleCollections = String(env.TELEGRAM_ROLE_COLLECTIONS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	if (roleCollections.length > 0) config.telegram.roleCollections = roleCollections;
	// Domain-module gate — which business modules (/api/hr, /api/mro) ship.
	const enabledModules = String(env.DOMAIN_MODULES ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	if (enabledModules.length > 0) config.modules.enabled = enabledModules.filter((m) => m !== 'none');
	// Plugin gate — unset ⇒ all (null); 'none' ⇒ none ([]); else the listed ids.
	const pluginsRaw = String(env.PLUGINS ?? '')
		.trim()
		.toLowerCase();
	if (pluginsRaw) {
		config.plugins.enabled = pluginsRaw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
			.filter((p) => p !== 'none');
	}
	return config;
}

let _config: AppConfig | null = null;

/**
 * Initialize the app config from environment bindings.
 * Idempotent — builds only once per isolate, reuses the cached config afterwards.
 * Safe to call from middleware on every request without rebuilding cost.
 */
export function initConfig(env: Record<string, unknown>): AppConfig {
	if (!_config) {
		_config = buildConfig(env);
	}
	return _config;
}

export function getConfig(): AppConfig {
	if (!_config) throw new ConfigError('App configuration not initialized');
	return _config;
}

/**
 * Domain-module gate — is the business module `id` (e.g. 'hr', 'mro')
 * enabled for this deployment? Driven by `DOMAIN_MODULES` (default none;
 * 'none' = pure factory). Single source of truth for the factory's business
 * modules — the API worker and any domain-module registry both call this.
 */
export function isModuleEnabled(env: Record<string, unknown>, id: string): boolean {
	return initConfig(env).modules.enabled.includes(id);
}

/**
 * Plugin gate — is the built-in plugin `id` enabled for this deployment?
 * Driven by `PLUGINS` (unset ⇒ all enabled). Single source of truth for the
 * worker's route + migration gating.
 */
export function isPluginEnabled(env: Record<string, unknown>, id: string): boolean {
	const enabled = initConfig(env).plugins.enabled;
	return enabled === null || enabled.includes(id);
}

// Re-export RBAC policies
export { SYSTEM_GUARDS, IMMUTABLE_ROLES, ADMIN_ROLE_NAMES } from './rbac-policies';
export type { SystemPolicy } from './rbac-policies';
