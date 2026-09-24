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
	 * Telegram Mini App auth — the directory-as-gate is CONFIG-DRIVEN, not
	 * hardcoded to hr_*: which collection's rows count as "approved" and which
	 * role/permissions get provisioned are env knobs, so any collection can be
	 * the employee directory.
	 *
	 * Env knobs:
	 *   - TELEGRAM_DIRECTORY_COLLECTION — collection whose rows gate Telegram
	 *     login (default 'hrm_employees' — the tgapp model after the hr_*→hrm_*
	 *     rename; e.g. 'staff' for a generic deploy, legacy 'hr_employees').
	 *   - TELEGRAM_DIRECTORY_FIELD — field on that collection holding the
	 *     Telegram user id (default 'etg_id'; legacy model: 'tg_id').
	 *   - TELEGRAM_ROLE_NAME — role provisioned for approved users
	 *     (default 'Employee').
	 *   - TELEGRAM_ROLE_COLLECTIONS — comma-separated slugs granted
	 *     read/write/create to that role (default: the hr/vehicle/store set;
	 *     empty → role created WITHOUT permissions).
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
	 * entity engine; /api/hr + /api/mro are business modules on top (the legacy
	 * 'store' domain was removed — MRO (mro_* + veh_fleets) is the inventory engine).
	 *
	 * Env knob: DOMAIN_MODULES — comma-separated list (default 'hr').
	 *   - 'none' → no domain modules (pure factory).
	 *   - a subset (e.g. 'mro') → only those modules ship.
	 */
	modules: { enabled: string[] };
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
		// The directory gate ("who may sign in") reads the CURRENT tgapp model —
		// the hr_*→hrm_* rename moved the Telegram link onto `hrm_employees.etg_id`.
		// A deployment still on the legacy model overrides per environment via
		// TELEGRAM_DIRECTORY_COLLECTION / TELEGRAM_DIRECTORY_FIELD (buildConfig below).
		directoryCollection: 'hrm_employees',
		directoryField: 'etg_id',
		roleField: 'role',
		roleName: 'Employee',
		roleCollections: [
			'hr_employees',
			'hr_requests',
			'hr_attendance',
			'hr_notifications',
			'hr_tasks',
			'hr_shifts',
			// HR master-data lookup tables — the employee edit form's department /
			// designation / organization pickers search these, so the role needs read.
			'hr_departments',
			'hr_designations',
			'org_companies',
			// The `employees`-model directory + its lookup + attendance tables (the
			// Studio's collections — physical `cms_hrm_employees` etc.) — the tgapp's
			// ဝန်ထမ်းများ directory + details sheet + ရုံးတက် attendance page read
			// these. Inert where only the hr_* model exists.
			'hrm_employees',
			'hrm_departments',
			'hrm_designations',
			'hrm_shifts',
			'hrm_attendances',
			'hrm_leaves',
			// The remaining native per-type request collections the request &
			// approval flows persist to, + the `hrm_employee_links` reporting graph the
			// approval center routes through (see attendance/data/api.ts).
			'hrm_overtimes',
			'hrm_early_leaves',
			'hrm_employee_links',
			// Vehicle master + the fleet-lifecycle tables the tgapp's ယာဉ် / ဆီဖြည့် /
			// လိုင်စင် / အာမခံ / ပြင်ဆင် / မှတ်တမ်း / တာယာ screens read (provisioned under
			// their app-facing `veh_*` slugs, physical `cms_veh_*`).
			'veh_fleets',
			'veh_permits',
			'veh_insurances',
			'veh_maintenance_logs',
			'veh_issue_types',
			'veh_fuel_logs',
			'veh_tyres',
			'veh_incidents',
			// Fleet care — the Daily ODO month buckets + engine/gear oil fills the
			// ODO + Fluid apps read AND write (Employee records a reading/fill; a
			// fill's Pending row is confirmed by the same operator). Same grant as
			// the veh_* lifecycle tables above so a real (non-admin) bot user is
			// not 403'd on /app/daily-odo / /app/fluid.
			'veh_odo_months',
			'veh_fluid_fills',
			'store_requests',
			'store_request_items',
			'store_categories',
			'store_items',
			'store_item_models',
			'store_purchases',
			'store_usage',
			'store_writeoffs',
			'store_locations',
			// MRO mini-app — the masters hub /app/mro-categories (အုပ်စု /
			// ရောင်းချသူ) reads the catalog masters + walks `mro_item_model` for the
			// per-group SKU counts; the items / inbound flows read the same masters as
			// pickers and write the SKUs + supplier. Provide the same read/write/create
			// grant the other verticals get so a real (non-admin) bot user is not 403'd.
			// `mro_item_categories` is the top-level grouping behind the stock page's
			// Categories funnel + the in/outbound category filter — read via
			// model → item_name → category — so the role needs the same grant.
			'mro_item_categories',
			'mro_item_name',
			'mro_item_model',
			'mro_suppliers',
			// MRO movement documents — the in/out/transfer/adjustment/requisition
			// screens (list + create + expanded lines) read and write the multi-line
			// headers and their `*_lines` child collections through the GENERIC
			// entity API, which is RBAC-gated per collection. Without these grants a
			// real (non-admin) Telegram role gets `403 read` on /app/inbounds, outbound
			// hub, stock-moves, adjustments and requisitions → blank lists. Keep the
			// same read/write/create/submit grant the other verticals get.
			'mro_inbounds',
			'mro_inbound_lines',
			'mro_outbounds',
			'mro_outbound_lines',
			'mro_transfers',
			'mro_transfer_lines',
			'mro_adjustments',
			'mro_adjustment_lines',
			'mro_requisitions',
			'mro_requisition_lines',
			// MRO stock trace — the stock kiosk (/app/stocks) reads `mro_inventory`
			// balances and the tyre pages read `mro_stock_serials` through the GENERIC
			// entity API (each with its relations expanded in the same request). Without
			// these grants a real (non-admin) employee is 403'd on /app/stocks →
			// "Couldn't read the stock balances". Both are `writes.mode: 'service'` (the
			// confirm services are the sole writers), so the write grant this standard
			// grant set carries is inert here — only read is reachable.
			'mro_inventory',
			'mro_stock_serials',
			// The asset-transfer request is FILED generically by the holder and DECIDED
			// through the /api/mro/asset-requests routes, whose `gateWrite` needs the
			// role's `can_write` — so a recorded superior (not just an admin) can decide.
			// A self row filter (see `auth-telegram.ts`) scopes any generic read/write to
			// the requester, so one holder can never edit another's pending request.
			'mro_asset_requests',
			// Purchase-receipt PAYMENT ledger — the inbound card's money strip and
			// the payment sheet read it through the GENERIC entity API (the receipt's
			// paid/left figures are the engine-derived mirror on the header, but the
			// "which day did we pay how much" history is the ledger itself). Without
			// this grant a real (non-admin) operator saw "Couldn't load the ledger."
			// The WRITE paths are the domain routes `POST /api/mro/inbounds/:id/payments`
			// and `DELETE /api/mro/inbounds/:id/payments/:paymentId` (both gated on
			// `mro_inbounds` write above), so a real operator files and removes WITHOUT
			// any ledger write grant — `can_delete` in particular is 0 for every
			// operational role, which is why the generic DELETE is not the client path.
			'mro_inbound_payments',
		],
	},
	modules: { enabled: ['hr'] },
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
	const config: AppConfig = { ...DEFAULT_CONFIG, isDev };
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
 * enabled for this deployment? Driven by `DOMAIN_MODULES` (default 'hr';
 * 'none' = pure factory). Single source of truth for the factory's business
 * modules — the API worker and domain-module registry both call this.
 */
export function isModuleEnabled(env: Record<string, unknown>, id: string): boolean {
	return initConfig(env).modules.enabled.includes(id);
}

// Re-export RBAC policies
export { SYSTEM_GUARDS, IMMUTABLE_ROLES, ADMIN_ROLE_NAMES } from './rbac-policies';
export type { SystemPolicy } from './rbac-policies';
