import { m2mIds } from './record-label';
import type { LinkageCondition, ValidationRule } from '@mmbix/types';
import { SYSTEM_FIELD_NAMES as ENGINE_SYSTEM_FIELD_NAMES } from '@mmbix/ui-views';

const BASE = '';

// ─── Session expiry (401) ─────────────────────────────
// Every authenticated Studio call goes through `api()` — a 401 always means
// the token is invalid/expired, so it fires the registered handler and the
// App drops the session (login screen returns).

let unauthorizedHandler: (() => void) | null = null;

/** Register a callback fired when any authed request returns 401. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
	unauthorizedHandler = fn;
}

/** Fire the registered 401 handler (session expiry). Returns true when the response is a 401. */
export function handleUnauthorized(res: Response): boolean {
	if (res.status === 401 && unauthorizedHandler) unauthorizedHandler();
	return res.status === 401;
}

// ─── /__studio metadata calls ─────────────────────────────────
// The dev-only Vite plugin (studio.db/vitePlugin.ts) ignores auth, but the
// production Studio worker serves /__studio against D1 and gates WRITES behind
// the same admin session — so every /__studio call attaches the stored bearer
// token (reads stay open: the catalog is non-sensitive design metadata).
// Key mirrors App.tsx TOKEN_KEY — keep them in lock-step.
export function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
	let token: string | null = null;
	try {
		token = localStorage.getItem('studio_token');
	} catch {
		token = null;
	}
	return fetch(path, {
		...init,
		headers: {
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...init.headers,
		},
	});
}

/** The success envelope every API route shares. `meta` is optional (paginated reads). */
export interface ApiEnvelope<T, M = unknown> {
	success?: boolean;
	error?: string;
	data?: T;
	meta?: M;
}

/**
 * The request that returns the FULL envelope (`data` + `meta`) — for reads that
 * need pagination metadata alongside the rows (`listItems`).
 *
 * This is pure transport: no caching and no request merging live here. Every
 * cached/deduped read goes through TanStack Query (`lib/queries.ts`), which owns
 * keys, staleness and in-flight dedup — the app's ONE caching layer. Keeping a
 * second, hand-rolled cache here would be a second source of truth.
 */
export function apiRead<T, M = unknown>(token: string, path: string, opts?: RequestInit): Promise<ApiEnvelope<T, M>> {
	return apiFetch<T, M>(token, path, opts);
}

export function api<T>(token: string, path: string, opts?: RequestInit): Promise<T> {
	return apiRead<T>(token, path, opts).then((body) => body.data as T);
}

async function apiFetch<T, M = unknown>(token: string, path: string, opts?: RequestInit): Promise<ApiEnvelope<T, M>> {
	let res: Response;
	try {
		res = await fetch(`${BASE}${path}`, {
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...opts?.headers },
			...opts,
		});
	} catch {
		// fetch throws a bare TypeError("Failed to fetch") when the request never
		// reaches the server (backend down, proxy unreachable, CORS). Surface a
		// clear, actionable message instead of the cryptic browser default.
		throw new Error('Cannot reach the API server — is the backend running? (cd apps/api && npx wrangler dev)');
	}
	handleUnauthorized(res);
	const body = (await res.json().catch(() => null)) as ApiEnvelope<T, M> | null;
	if (!body?.success) {
		// A 404 on an /api/idp/* path means the IDP domain-module is disabled in
		// this environment (`DOMAIN_MODULES` omits `idp`, so its routes are not
		// mounted). Surface that plainly instead of the raw "Route not found"
		// plumbing message the not-found handler would otherwise throw.
		if (res.status === 404 && path.startsWith('/api/idp/')) {
			throw new Error('The IDP module is not enabled in this environment.');
		}
		throw new Error(body?.error ?? `API error ${res.status}`);
	}
	return body;
}

export async function loginApi(email: string, password: string) {
	const res = await fetch(`${BASE}/api/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password }),
	});
	const body = await res.json();
	if (!res.ok || !body.success) throw new Error(body.error ?? 'Login failed');
	return body.data as { token: string; user: { email: string; full_name: string } };
}

export interface ModuleInfo {
	slug: string;
	name: string;
	description?: string | null;
	icon: string;
	icon_color?: string | null;
	bg_color?: string | null;
	version: string;
	collection_count?: number;
}
export async function listModules(token: string) {
	return api<ModuleInfo[]>(token, '/api/modules');
}

/** `GET /api/meta` — the server's advertised contract (pagination, limits, and
 *  the config-driven identity directory). No hardcoded collection names. */
export interface ServerMeta {
	platform: string;
	version: string;
	identity?: { directory_collection: string | null; directory_field: string | null };
}
export async function getServerMeta(token: string) {
	return api<ServerMeta>(token, '/api/meta');
}
export async function createModule(
	token: string,
	name: string,
	slug: string,
	extra?: { description?: string; icon?: string; icon_color?: string; bg_color?: string },
) {
	return api<ModuleInfo>(token, '/api/modules', { method: 'POST', body: JSON.stringify({ name, slug, ...extra }) });
}

export interface ModuleDetail extends ModuleInfo {
	id: string;
	is_active: number;
	collections?: Array<{ id: string; name: string; slug: string }>;
	/** Bumped on every module/menu/page/view mutation — used to live-sync external changes. */
	config_version?: number;
}
export async function getModule(token: string, slug: string) {
	return api<ModuleDetail>(token, `/api/modules/${slug}`);
}
export async function updateModule(
	token: string,
	slug: string,
	body: {
		name?: string;
		icon?: string;
		icon_color?: string;
		bg_color?: string;
		description?: string;
		version?: string;
		is_active?: boolean;
		sort_order?: number;
	},
) {
	return api<ModuleDetail>(token, `/api/modules/${slug}`, { method: 'PUT', body: JSON.stringify(body) });
}
export async function attachCollectionToModule(token: string, slug: string, collectionSlug: string) {
	return api<{ attached: boolean }>(token, `/api/modules/${slug}/collections`, {
		method: 'POST',
		body: JSON.stringify({ collection_slug: collectionSlug }),
	});
}

// ─── IDP Power-Up (developer portal) ─────────────────────
// Read-oriented portal surface: catalog, scorecard, golden-path scaffolder,
// and deployment workflow. All live under /api/idp/*.

export interface IdpEnvironment {
	environment_id: string;
	environment: string;
	kind: string;
	status: string;
	version: string;
	deployed_at: string | null;
}
export interface CatalogEntry {
	id: string;
	name: string;
	slug: string;
	version: string;
	is_active: number | boolean;
	icon: string | null;
	icon_color: string | null;
	bg_color: string | null;
	owner: string | null;
	owner_role: string | null;
	environments: IdpEnvironment[];
}
export interface IdpScorecard {
	total: number;
	with_owner: number;
	owner_coverage_pct: number;
	with_live_deployment: number;
	deploy_coverage_pct: number;
	owned_and_live: number;
	owned_not_live: number;
	unowned_live: number;
	unowned_not_live: number;
}
export interface IdpTemplate {
	name: string;
	label: string;
	description: string;
	entities: string[];
}
export interface ScaffoldResult {
	module: Record<string, unknown>;
	collections: string[];
}
export interface IdpDeployment {
	id: string;
	module_id: string;
	environment_id: string;
	version: string;
	status: string;
	state?: string;
	environment?: string;
	kind?: string;
	git_ref?: string | null;
	manifest_json?: string | null;
	snapshot_json?: string | null;
	deployed_at?: string | null;
}
export interface PromoteResult {
	deployment_id: string;
	state: string;
	terminal?: boolean;
}
export interface IdpHistoryEntry {
	id: string;
	deployment_id: string;
	from_state?: string | null;
	to_state: string;
	actor?: string | null;
	created_at: string;
}

export async function getIdpCatalog(token: string) {
	return api<CatalogEntry[]>(token, '/api/idp/catalog');
}
export async function getIdpScorecard(token: string) {
	return api<IdpScorecard>(token, '/api/idp/scorecard');
}
export async function listIdpTemplates(token: string) {
	return api<IdpTemplate[]>(token, '/api/idp/templates');
}
export async function scaffoldModule(token: string, templateName: string, body: { name: string; slug: string; icon?: string }) {
	return api<ScaffoldResult>(token, `/api/idp/templates/${encodeURIComponent(templateName)}/scaffold`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}
export interface IdpUsage {
	days: number;
	series: {
		modules: Array<{ day: string; n: number }>;
		collections: Array<{ day: string; n: number }>;
		deployments: Array<{ day: string; n: number }>;
		ownership: Array<{ day: string; n: number }>;
	};
	totals: { modules: number; collections: number; deployments: number; ownership: number };
	template_adoption: Array<{ template: string; count: number }>;
}
export async function getIdpUsage(token: string, days = 30) {
	return api<IdpUsage>(token, `/api/idp/usage?days=${days}`);
}
export async function listIdpDeployments(token: string) {
	return api<IdpDeployment[]>(token, '/api/idp/deployments');
}
/** Create a draft deployment (GitOps) — POST /api/idp/deployments. */
export async function createDeployment(
	token: string,
	body: {
		module_id: string;
		environment_id: string;
		version?: string;
		git_ref?: string | null;
		snapshot_json?: string | null;
		status?: string;
	},
) {
	return api<IdpDeployment>(token, '/api/idp/deployments', { method: 'POST', body: JSON.stringify(body) });
}

export interface IdpPlanResult {
	deployment_id: string;
	git_ref: string | null;
	summary: { totalChanges: number; breakingChanges: string[]; safeToApply: boolean };
}

export interface IdpApplyResult {
	deployment_id: string;
	applied: boolean;
	already_applied?: boolean;
	checksum?: string;
	results?: Array<{ slug: string; status: string }>;
	summary?: { totalChanges: number; breakingChanges: string[]; safeToApply: boolean };
}

/** Plan — diff the deployment's pinned snapshot against the live DB (read-only). */
export async function planDeployment(token: string, id: string) {
	return api<IdpPlanResult>(token, `/api/idp/deployments/${encodeURIComponent(id)}/plan`, { method: 'POST' });
}

/** Apply — idempotent, gated migration of the deployment's snapshot. */
export async function applyDeployment(token: string, id: string, force = false) {
	return api<IdpApplyResult>(token, `/api/idp/deployments/${encodeURIComponent(id)}/apply`, {
		method: 'POST',
		body: JSON.stringify({ force }),
	});
}

/** Rollback — re-apply the previous live snapshot for the same module+env. */
export async function rollbackDeployment(token: string, id: string) {
	return api<IdpApplyResult>(token, `/api/idp/deployments/${encodeURIComponent(id)}/rollback`, { method: 'POST' });
}
export async function promoteDeployment(token: string, id: string) {
	return api<PromoteResult>(token, `/api/idp/deployments/${encodeURIComponent(id)}/promote`, { method: 'POST' });
}
export async function getDeploymentHistory(token: string, id: string) {
	return api<IdpHistoryEntry[]>(token, `/api/idp/deployments/${encodeURIComponent(id)}/history`);
}
export async function listIdpEnvironments(token: string) {
	return api<IdpEnvironment[]>(token, '/api/idp/environments');
}
export async function listIdpOwnership(token: string) {
	return api<unknown[]>(token, '/api/idp/ownership');
}

export interface MenuNode {
	id: string;
	label: string;
	label_my?: string | null;
	icon?: string | null;
	type: string;
	target?: string | null;
	/** Role names allowed to see this item (null/empty = everyone). */
	roles?: string[] | null;
	/** Per-menu designer template (e.g. 'table-card-form') — NULL = not set. */
	template?: string | null;
	children?: MenuNode[];
}
export async function getMenus(token: string, slug: string) {
	return api<MenuNode[]>(token, `/api/modules/${slug}/menus?all=true`);
}
export async function createMenu(
	token: string,
	slug: string,
	body: {
		parent_id?: string | null;
		label: string;
		label_my?: string;
		type: string;
		target?: string;
		icon?: string;
		roles?: string[];
		template?: string | null;
	},
) {
	return api<MenuNode>(token, `/api/modules/${slug}/menus`, { method: 'POST', body: JSON.stringify(body) });
}
export async function deleteMenu(token: string, id: string) {
	return api<{ deleted: boolean }>(token, `/api/modules/menus/${id}`, { method: 'DELETE' });
}
export async function updateMenu(
	token: string,
	id: string,
	body: {
		label?: string;
		label_my?: string;
		type?: string;
		target?: string;
		icon?: string;
		sort_order?: number;
		parent_id?: string | null;
		is_active?: boolean;
		roles?: string[] | null;
		template?: string | null;
	},
) {
	return api<MenuNode>(token, `/api/modules/menus/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

/* ── Collections / Form Builder ──────────────────────── */

export interface FieldDefinition {
	name: string;
	type: string;
	label?: string;
	required?: boolean;
	default?: string | number | boolean;
	/** Select choices — plain strings or Studio-style {label, value} objects. */
	options?: Array<string | { label?: string; value?: string }>;
	related_collection?: string;
	/** o2m: the foreign-key column in the related collection pointing back to this one. */
	foreign_key?: string;
	cascade_delete?: boolean;
	unique?: boolean;
	index?: boolean;
	display_template?: string;
	/** Studio extras (stored in schema_json, pass-through) */
	placeholder?: string;
	help?: string;
	read_only?: boolean;
	no_create?: boolean;
	no_open?: boolean;
	widget?: string;
	/** Conditional display (linkage rules) — show/disable/require the field when the condition holds. */
	visible_when?: FieldCondition;
	readonly_when?: FieldCondition;
	required_when?: FieldCondition;
	/** Number fields: min/max/step constraints (HTML input attrs, passed through). */
	min?: number | string;
	max?: number | string;
	step?: number | string;
	/** Currency field: ISO currency code (e.g. MMK, USD). */
	currency?: string;
	/** File field: accepted extensions (comma-separated, e.g. "png,jpg,pdf") and max size in MB. */
	file_accept?: string;
	max_size?: number;
	/** Rating field: maximum stars (1–10). */
	rating_max?: number;
	/** Validation rules (12 types) — enforced by FieldValidator at the API. */
	validation?: ValidationRule[];
	/** True = value encrypted at rest (AES-256-GCM); requires ENCRYPTION_KEY. */
	encrypted?: boolean;
	/** Computed field formula — expression / lookup (e.g. "qty * rate", "SUM(items.amount)"). */
	formula?: string;
	formula_type?: 'expression' | 'lookup';
	/** Stored computed field — real column, recomputed on write (filterable/sortable). */
	store?: boolean;
	/** Computed field result type — drives the column type + SDK type (default 'number'). */
	result_type?: 'number' | 'string' | 'boolean' | 'json';
	/** Round numeric results to N decimals (0–10). */
	precision?: number;
	/** Rounding mode when `precision` is set (default 'half_up'). */
	rounding?: 'half_up' | 'half_even' | 'up' | 'down';
	/** Write-back: derive `inverse_target` from this when the payload includes the computed field. */
	inverse_formula?: string;
	/** The plain field `inverse_formula` writes to. */
	inverse_target?: string;
}

/** Field validation rules — canonical type from @mmbix/types (single source of truth). */
export type { ValidationRule };

/** Linkage-rule condition — alias of the canonical @mmbix/types LinkageCondition. */
export type FieldCondition = LinkageCondition;

export interface CollectionSummary {
	id: string;
	name: string;
	slug: string;
	description?: string | null;
	updated_at?: string;
	/** Auto-number pattern ("INV-" or "INV-####") — "" / null = no Doc No. */
	naming_series?: string | null;
	/** meta.hidden — the collection is excluded from the schema-registry lists (engine/Studio, not data access). */
	hidden?: boolean;
}

/**
 * The engine-enforced WRITE policy (`schema_json.policies.writes`) — the same
 * document the entity API honours: a `service`-mode collection is written ONLY by
 * its domain service (the generic entity API 403s), `append_only` forbids update /
 * delete, `frozen_fields` are stripped from a generic write and `freeze_when` 403s
 * a row once the field holds one of the values.
 */
export interface CollectionWritePolicy {
	mode?: 'service' | 'any';
	append_only?: boolean;
	frozen_fields?: string[];
	freeze_when?: { field?: string; values?: string[] };
	actor_fields?: string[];
}

export interface EntitySchema {
	id: string;
	name: string;
	slug: string;
	table_name: string;
	description?: string | null;
	/** Auto-number pattern ("INV-" or "INV-####") — "" / null = no Doc No. */
	naming_series?: string | null;
	schema_json: { fields: FieldDefinition[]; actions?: unknown; policies?: { writes?: CollectionWritePolicy } & Record<string, unknown> };
	/**
	 * Present only when the read asked for it (`?with=relation_schemas`): every m2o
	 * TARGET's schema, keyed by slug. It rides the focused read so the table view
	 * resolves each relation column's display leaf without one request per relation.
	 * Each value is the canonical schema row, so `queries.ts` seeds it under the
	 * target's OWN cache key and it is indistinguishable from a direct fetch.
	 */
	related_schemas?: Record<string, EntitySchema>;
}

export async function listCollections(token: string) {
	return api<CollectionSummary[]>(token, '/api/collections');
}
export async function createCollection(token: string, name: string, extra?: { description?: string; naming_series?: string }) {
	const created = await api<EntitySchema>(token, '/api/collections', { method: 'POST', body: JSON.stringify({ name, ...extra }) });
	return created;
}
/** Update collection metadata — top-level keys (name/description/naming_series/…) → PUT /api/collections/:slug (admin). */
export async function updateCollectionMeta(token: string, slug: string, meta: { naming_series?: string | null }) {
	const updated = await api<EntitySchema>(token, `/api/collections/${slug}`, { method: 'PUT', body: JSON.stringify(meta) });
	return updated;
}
/**
 * Render the first display_number a naming-series pattern would produce.
 *  - '' (empty) → null      (auto-numbering off)
 *  - 'OUT-####' → 'OUT-0001' (prefix + example counter)
 *  - invalid pattern → false
 */
export function namingSeriesExample(series: string): string | null | false {
	const trimmed = series.trim();
	if (!trimmed) return null;
	const m = trimmed.match(/^([A-Za-z0-9_-]+-)(#{0,10})$/);
	if (!m) return false;
	const hashes = m[2] ?? '';
	const width = hashes.length > 0 ? hashes.length : 5;
	return `${m[1]}${String(1).padStart(width, '0')}`;
}
/** Permanently delete a collection (schema + data table) — DELETE /api/collections/:slug (admin). */
export async function deleteCollection(token: string, slug: string) {
	const res = await api<{ deleted: boolean }>(token, `/api/collections/${slug}`, { method: 'DELETE' });
	return res;
}
/** Toggle a collection's visibility in the schema-registry lists (meta.hidden — metadata only, no schema/DDL). */
export async function setCollectionHidden(token: string, slug: string, hidden: boolean) {
	const updated = await api<EntitySchema>(token, `/api/collections/${slug}`, {
		method: 'PUT',
		body: JSON.stringify({ hidden }),
	});
	return updated;
}
export async function getCollectionDetail(token: string, slug: string, opts?: { withRelations?: boolean }) {
	// `with=relation_schemas` bundles every m2o target's schema into this one
	// response (one batched server read) instead of one request per relation.
	const q = opts?.withRelations ? '?with=relation_schemas' : '';
	return api<EntitySchema>(token, `/api/collections/${slug}${q}`);
}

/** The per-collection runtime policy document (`schema_json.policies`) as the
 *  control plane stores it. Structurally identical to `RawPolicy` in policy-form. */
export interface CollectionPolicy {
	auto_index?: { enabled?: boolean; mode?: 'auto' | 'propose' };
	cache?: { enabled?: boolean; ttl_s?: number };
	offline_reads?: { enabled?: boolean; max_age_s?: number };
}
/** Read a collection's runtime policy (auto-index / cache / offline reads). */
export async function getCollectionPolicies(token: string, slug: string) {
	return api<CollectionPolicy>(token, `/api/collections/${slug}/policies`);
}
/** Write a collection's runtime policy — the API merges per feature; applies at runtime. */
export async function setCollectionPolicies(token: string, slug: string, body: CollectionPolicy) {
	return api<CollectionPolicy>(token, `/api/collections/${slug}/policies`, { method: 'PUT', body: JSON.stringify(body) });
}
export async function updateCollectionFields(token: string, slug: string, fields: FieldDefinition[], formLayout?: unknown) {
	const updated = await api<EntitySchema>(token, `/api/collections/${slug}`, {
		method: 'PUT',
		body: JSON.stringify(formLayout === undefined ? { fields } : { fields, form_layout: formLayout }),
	});
	return updated;
}

/** Persist the table/card/kanban view editor configs (schema_json.list_view / .card_view / .kanban_view) — no field changes. */
export async function patchCollectionViews(
	token: string,
	slug: string,
	views: { list_view?: unknown; card_view?: unknown; kanban_view?: unknown; pivot_view?: unknown },
) {
	const updated = await api<EntitySchema>(token, `/api/collections/${slug}`, {
		method: 'PUT',
		body: JSON.stringify(views),
	});
	return updated;
}

// ─── Lifecycle hooks — declarative server-function rules per collection ──
// Mirrors the API's `_server_functions` rows. Hooks are JSON rules (no JS —
// the Workers runtime disallows eval/new Function), keyed by collection + the
// lifecycle event they fire on (insert / update / delete / validate / change).
export interface StudioServerHook {
	id: string;
	name: string;
	collection_slug: string;
	/** Lifecycle stage the hook runs on: before_insert | after_insert | before_update | after_update | before_delete | validate | on_change */
	trigger_event: string;
	/** Legacy JS — kept only for display of pre-v0.7 rows; never executed. */
	function_code: string;
	/** Declarative rules as a JSON string — parse before use. */
	rules_text: string | null;
	enabled: boolean;
	created_at: string;
	updated_at: string;
}

/** List lifecycle hooks, optionally for one collection (GET /api/server-functions — admin). */
export async function listServerHooks(token: string, collection?: string) {
	return api<StudioServerHook[]>(token, `/api/server-functions${collection ? `?collection=${encodeURIComponent(collection)}` : ''}`);
}

// ─── Code hooks — COMPILED lifecycle hooks registered in the worker ──
// GET /api/hook-registry (admin). These are TypeScript handlers living in the
// domain modules / plugins (e.g. the veh-relink fleet pointer hooks), NOT rows
// in `_server_functions` — they cannot be edited from Studio, only viewed.
export interface StudioCodeHook {
	/** The registering plugin/builder (e.g. "veh-relink"). */
	plugin_id: string;
	/** The collection the hook FIRES on (e.g. "orders"). */
	collection: string;
	/** Lifecycle stage: after_insert | after_update | before_insert | … */
	event: string;
	/** Human purpose — copy written by the registering module. */
	description: string | null;
	/** Collections this hook REWRITES (kept fresh) — e.g. a fleet master. */
	writes_to: string[];
	priority: number;
	timeout_ms: number;
}

/** List every registered code hook (GET /api/hook-registry — admin). */
export async function listCodeHooks(token: string) {
	return api<StudioCodeHook[]>(token, '/api/hook-registry');
}

export interface FieldConfigEntry {
	key: string;
	label: string;
	type:
		| 'input'
		| 'number'
		| 'select'
		| 'checkbox'
		| 'textarea'
		| 'json-editor'
		| 'key-value-editor'
		| 'field-picker'
		| 'collection-picker'
		| 'multi-select'
		| 'template-editor';
	/** Create is blocked until every required entry has a value. */
	required?: boolean;
	default?: string | number | boolean | string[];
	placeholder?: string;
	help?: string;
	options?: string[];
	/** Only show this entry once the named config key has a value (e.g. o2m foreign_key after related_collection). */
	depends_on?: string;
	source?: string;
}

export interface FieldTypeDef {
	type: string;
	label: string;
	group: string;
	icon: string;
	description?: string;
	/** Per-type property schema — the add-field dialog renders these dynamically. */
	config_schema?: FieldConfigEntry[];
}
/** Full field-type catalog from the backend (40 types, grouped). */
export async function getFieldTypes(token: string) {
	return api<{ types: FieldTypeDef[]; groups: Record<string, FieldTypeDef[]> }>(token, '/api/field-types');
}

export interface EntityListMeta {
	limit: number;
	has_more: boolean;
	next_cursor?: string;
	prev_cursor?: string;
}

export interface EntityListFilter {
	operator: string;
	value?: string;
	valueTo?: string;
	/** Backend function wrapper — e.g. 'date' → filter[date(field)][_op]=value. */
	fn?: string;
}

export interface EntityListParams {
	limit?: number;
	cursor?: string;
	dir?: 'after' | 'before';
	sort?: string;
	search?: string;
	/** Directus-style field projection — e.g. 'id,title', 'category.name', '*.*'. */
	fields?: string;
	filters?: Record<string, EntityListFilter>;
	/**
	 * `count_only=true` — return JUST the filtered total in `meta.total`, skipping the
	 * page SELECT and every per-row enrichment (relations, decryption, merge). This is
	 * the only correct way to ask for a count: without it the engine omits `meta.total`
	 * entirely (a `limit: 1` read would then look like a total of 1).
	 */
	countOnly?: boolean;
	/** Include soft-deleted (trashed) records. */
	trashed?: boolean;
	/** Export the result as CSV (server returns a CSV attachment). */
	export?: 'csv';
}

/**
 * Serialize entity filter params to URL search params. Supports the three backend
 * key shapes the engine parses:
 *
 *   filter[field][_op]=value            — scalar
 *   filter[parent.leaf][_op]=value      — nested m2o path
 *   filter[date(field)][_op]=value      — date/day function filter
 *
 * `valueTo` joins with `value` via a comma for `_between` (server parses the pair).
 */
function appendEntityFilters(q: URLSearchParams, filters: Record<string, EntityListFilter>): void {
	for (const [field, cond] of Object.entries(filters)) {
		const key = cond.fn ? `filter[${cond.fn}(${field})][${cond.operator}]` : `filter[${field}][${cond.operator}]`;
		const parts: string[] = [];
		if (cond.value !== undefined && cond.value !== null) parts.push(String(cond.value));
		if (cond.valueTo !== undefined && cond.valueTo !== null) parts.push(String(cond.valueTo));
		q.set(key, parts.join(','));
	}
}
/** List records of a collection (GET /api/entities/:slug) with server-side params. */
export interface StudioReportDef {
	collection: string;
	rowDimensions: string[];
	columnDimensions?: string[];
	measures: Array<{ op: string; field: string; alias: string }>;
}

/** Execute a report definition in the builder (live preview). */
export async function executeReportV2(
	token: string,
	def: StudioReportDef,
): Promise<{ data: Array<Record<string, unknown>>; columns: string[] }> {
	const res = await fetch(`${BASE}/api/reports/execute`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify(def),
	});
	handleUnauthorized(res);
	const body = (await res.json().catch(() => null)) as {
		success?: boolean;
		error?: string;
		data?: Array<Record<string, unknown>>;
		columns?: string[];
	} | null;
	if (!res.ok || !body?.success) throw new Error(body?.error ?? `Report failed (${res.status})`);
	return { data: body.data ?? [], columns: body.columns ?? [] };
}

/** Saved reports (for the block's saved-report picker). */
export async function listSavedReports(token: string): Promise<Array<{ id: string; name: string; collection: string }>> {
	return api<Array<{ id: string; name: string; collection: string }>>(token, '/api/reports');
}

export async function listItems(token: string, slug: string, params: EntityListParams = {}) {
	const q = new URLSearchParams();
	if (params.limit) q.set('limit', String(params.limit));
	if (params.cursor) q.set('cursor', params.cursor);
	if (params.dir) q.set('dir', params.dir);
	if (params.sort) q.set('sort', params.sort);
	if (params.search) q.set('search', params.search);
	if (params.countOnly) q.set('count_only', 'true');
	if (params.trashed) q.set('trashed', 'true');
	if (params.export) q.set('export', params.export);
	// The API is lean-by-default (columns only — relations must be requested). The
	// Studio is a visual builder that renders rows generically, so request the
	// full shape ('*.*' = all columns + all 1st-level relations) unless the caller
	// asked for a specific projection. Callers can override with params.fields.
	q.set('fields', params.fields ?? '*.*');
	if (params.filters) appendEntityFilters(q, params.filters);
	const body = await apiRead<Record<string, unknown>[], EntityListMeta & { total?: number }>(token, `/api/entities/${slug}?${q}`);
	return { rows: body.data ?? [], meta: body.meta ?? { limit: params.limit ?? 50, has_more: false } };
}

/** Export a collection's records to CSV — GET /api/entities/:slug?export=csv (auth required). */
export async function exportCsv(token: string, slug: string, params: EntityListParams = {}) {
	const q = new URLSearchParams();
	if (params.sort) q.set('sort', params.sort);
	if (params.search) q.set('search', params.search);
	if (params.trashed) q.set('trashed', 'true');
	q.set('export', 'csv');
	q.set('fields', params.fields ?? '*.*');
	if (params.filters) appendEntityFilters(q, params.filters);
	const res = await fetch(`${BASE}/api/entities/${slug}?${q}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	handleUnauthorized(res);
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { error?: string } | null;
		throw new Error(body?.error ?? `Export failed (${res.status})`);
	}
	return await res.text();
}

/** Create a record in a collection — POST /api/entities/:slug (auth required). */
export async function createItem(token: string, slug: string, body: Record<string, unknown>) {
	return api<Record<string, unknown>>(token, `/api/entities/${slug}`, { method: 'POST', body: JSON.stringify(body) });
}

/** Update a record — PUT /api/entities/:slug/:id (auth required). */
export async function updateItem(token: string, slug: string, id: string, body: Record<string, unknown>) {
	return api<Record<string, unknown>>(token, `/api/entities/${slug}/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

/** Soft-delete a record — DELETE /api/entities/:slug/:id (auth required). */
export async function deleteItem(token: string, slug: string, id: string) {
	return api<{ deleted: boolean }>(token, `/api/entities/${slug}/${id}`, { method: 'DELETE' });
}

/** One entry in a bulk-operation result (order matches the input array). */
export interface BulkResultEntry {
	id?: string;
	status: string;
	error?: string;
}

/**
 * Run one bulk action over N ids in a SINGLE round trip
 * (POST /api/bulk/:slug) — the engine runs the per-row pipeline at bounded
 * concurrency and isolates per-item errors, so this replaces an N-request
 * for-loop. `restore` is a write on the row (same permission action).
 */
async function bulkEntityAction(token: string, slug: string, action: 'delete' | 'restore', ids: string[]): Promise<BulkResultEntry[]> {
	const res = await api<{ action: string; processed: number; results: BulkResultEntry[] }>(token, `/api/bulk/${slug}`, {
		method: 'POST',
		body: JSON.stringify({ action, items: ids }),
	});
	return res.results ?? [];
}

/** Bulk soft-delete N records in one request. */
export async function bulkDelete(token: string, slug: string, ids: string[]): Promise<BulkResultEntry[]> {
	return bulkEntityAction(token, slug, 'delete', ids);
}

/** Bulk restore N soft-deleted records in one request. */
export async function bulkRestore(token: string, slug: string, ids: string[]): Promise<BulkResultEntry[]> {
	return bulkEntityAction(token, slug, 'restore', ids);
}

/** Summarize per-item bulk failures into one message (null when all succeeded). */
export function bulkErrorMessage(results: BulkResultEntry[]): string | null {
	const failed = results.filter((r) => r.status === 'error');
	if (failed.length === 0) return null;
	return `${failed.length} of ${results.length} failed — ${failed[0].error ?? 'unknown error'}`;
}

/** Restore a soft-deleted record — POST /api/entities/:slug/:id/restore (auth required). */
export async function restoreItem(token: string, slug: string, id: string) {
	return api<Record<string, unknown>>(token, `/api/entities/${slug}/${id}/restore`, { method: 'POST' });
}

/** Hard-delete a record permanently — DELETE /api/entities/:slug/:id/force (admin only). */
export async function hardDeleteItem(token: string, slug: string, id: string) {
	return api<{ deleted: boolean }>(token, `/api/entities/${slug}/${id}/force`, { method: 'DELETE' });
}

/** Duplicate a record — create a new record copying the given fields (id excluded).
 *  Expanded relation arrays (m2m rows arrive as { id, … } objects from '*.*' reads)
 *  are reduced to their ids — the engine expects an id array for m2m junction writes. */
export async function duplicateItem(token: string, slug: string, source: Record<string, unknown>) {
	const body: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(source)) {
		if (k === 'id' || k === 'created_at' || k === 'updated_at' || k === 'deleted_at' || k === 'deleted_by' || k === '_owner') continue;
		body[k] = Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' ? m2mIds(v) : v;
	}
	return createItem(token, slug, body);
}

// ─── Media + record update (card preview photo picker) ─────────────

export interface MediaUploadResult {
	key: string;
	url: string;
	filename: string;
	size: number;
	mime_type: string;
}

/** Upload a file to R2 via POST /api/media/upload (auth required). */
export async function uploadFile(token: string, file: File): Promise<MediaUploadResult> {
	const form = new FormData();
	form.append('file', file);
	const res = await fetch(`${BASE}/api/media/upload`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` },
		body: form,
	});
	handleUnauthorized(res);
	const body = (await res.json().catch(() => null)) as { success?: boolean; error?: string; data?: MediaUploadResult } | null;
	if (!res.ok || !body?.success || !body.data) throw new Error(body?.error ?? 'Upload failed');
	return body.data;
}

// ─── Media library list (Studio gallery over existing `_media` assets) ──

export interface MediaAsset {
	id: string;
	key: string;
	url: string;
	filename: string;
	mime_type: string;
	size: number;
	created_at?: string | null;
}

const IMAGE_MIME_RE = /^image\//i;

/** True when an asset is a raster image (what an Image field accepts). */
export function isImageAsset(a: MediaAsset): boolean {
	return IMAGE_MIME_RE.test(a.mime_type);
}

/** List `_media` assets via GET /api/media (auth required). Newest-first. */
export async function listMedia(token: string, opts: { mime?: 'image'; limit?: number; offset?: number } = {}): Promise<MediaAsset[]> {
	const params = new URLSearchParams();
	if (opts.limit) params.set('limit', String(opts.limit));
	if (opts.offset) params.set('offset', String(opts.offset));
	if (opts.mime) params.set('mime', opts.mime);
	const q = params.toString();
	const data = await api<{ data: MediaAsset[] }>(token, `/api/media${q ? `?${q}` : ''}`);
	return data.data;
}

/** Ref-guarded delete of one asset — succeeds only when nothing references it. */
export async function deleteMediaKey(token: string, key: string): Promise<boolean> {
	const res = await fetch(`${BASE}/api/media/${encodeURIComponent(key)}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${token}` },
	});
	handleUnauthorized(res);
	const body = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
	if (res.status === 409) throw new Error(body?.error ?? 'Still referenced by a record');
	if (!res.ok || !body?.success) throw new Error(body?.error ?? `Delete failed (${res.status})`);
	return true;
}

/** Garbage-collect every zero-reference asset (admin). Returns the count removed. */
export async function clearUnusedMedia(token: string): Promise<number> {
	const res = await fetch(`${BASE}/api/media/gc`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` },
	});
	handleUnauthorized(res);
	const body = (await res.json().catch(() => null)) as { success?: boolean; error?: string; data?: { removed?: number } } | null;
	if (!res.ok) throw new Error(body?.error ?? `Clean-up failed (${res.status})`);
	return body?.data?.removed ?? 0;
}

/* ── Roles & permissions (admin) ───────────────────── */

export interface RoleRecord {
	id: string;
	name: string;
	description?: string | null;
	is_system?: number;
	/** Mini-app launcher board (Design-B role→app access): app ids this role may
	 *  open. null = every app. Parsed from the DB JSON by the backend. */
	app_access?: string[] | null;
}

export interface RolePermission {
	id: string;
	role_id: string;
	collection_slug: string;
	/** Runtime truth is boolean — the users router / AuthService coerce 0|1 to booleans. */
	can_read: boolean;
	can_write: boolean;
	can_create: boolean;
	can_delete: boolean;
	can_approve?: boolean;
	can_submit?: boolean;
	/** JSON array of ALLOWED field names (whitelist); '*' or null = all visible. */
	field_restrictions?: string | null;
	row_filters?: string | null;
}

export async function listRoles(token: string) {
	return api<RoleRecord[]>(token, '/api/users/roles');
}

/** Create a role (name required; optional description / app board). */
export async function createRole(
	token: string,
	body: { name: string; description?: string; app_access?: string[] | null },
): Promise<RoleRecord> {
	return api<RoleRecord>(token, '/api/users/roles', { method: 'POST', body: JSON.stringify(body) });
}

/** Update a role's description and/or mini-app launcher board. */
export async function updateRole(
	token: string,
	roleId: string,
	body: { description?: string; app_access?: string[] | null },
): Promise<RoleRecord> {
	return api<RoleRecord>(token, `/api/users/roles/${roleId}`, { method: 'PUT', body: JSON.stringify(body) });
}

export async function getRolePermissions(token: string, roleId: string) {
	return api<RolePermission[]>(token, `/api/users/permissions/${roleId}`);
}

export async function setPermission(
	token: string,
	body: {
		role_id: string;
		collection_slug: string;
		can_read?: boolean;
		can_write?: boolean;
		can_create?: boolean;
		can_delete?: boolean;
		can_approve?: boolean;
		can_submit?: boolean;
		field_restrictions?: string[] | '*' | null;
		/** JSON string of { conditions, combiner } — row-level RBAC. */
		row_filters?: string | null;
	},
) {
	return api<RolePermission>(token, '/api/users/permissions', {
		method: 'POST',
		body: JSON.stringify({
			...body,
			field_restrictions:
				body.field_restrictions === '*' || body.field_restrictions === null ? '*' : JSON.stringify(body.field_restrictions),
		}),
	});
}
/** System fields are engine-managed — shown read-only in the Form Builder.
 *
 *  The canonical list lives in `@mmbix/ui-views` (shared with every view config
 *  and the runtime admin). The Studio deliberately treats `_meta` as a normal
 *  field, so it is SUBTRACTED from that one source rather than forked into a
 *  second copy that drifts. */
export const SYSTEM_FIELD_NAMES: Set<string> = new Set([...ENGINE_SYSTEM_FIELD_NAMES].filter((n) => n !== '_meta'));

/* ── Pages / Page Builder ───────────────────────────── */

export interface PageBlock {
	id: string;
	type: string;
	label?: string;
	layout: {
		order: number;
		colSpan?: number;
		colStart?: number;
		alignY?: 'start' | 'end';
		rowSpan?: number;
		x?: number;
		y?: number;
		width?: number;
		height?: number;
	};
	config: Record<string, unknown>;
	/** Nested children — containers (row/column/tabs/accordion) hold child blocks. */
	children?: PageBlock[];
}

export interface PageData {
	id: string;
	module_id: string | null;
	path: string;
	title: string;
	blocks: PageBlock[];
	globalFilter?: Record<string, unknown> | null;
	isPublished: boolean;
	createdAt: string;
	updatedAt: string;
}

export async function listPages(token: string) {
	return api<PageData[]>(token, '/api/pages');
}
export async function getPage(token: string, id: string) {
	return api<PageData>(token, `/api/pages/id/${id}`);
}
export async function savePage(
	token: string,
	body: { path: string; title: string; module_slug?: string; blocks?: PageBlock[]; is_published?: boolean },
) {
	return api<PageData>(token, '/api/pages', { method: 'POST', body: JSON.stringify(body) });
}
export async function updatePage(token: string, id: string, body: { title?: string; blocks?: PageBlock[]; is_published?: boolean }) {
	return api<PageData>(token, `/api/pages/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

/* ── Custom Blocks (Extension API) ─────────────── */

export interface CustomBlockDef {
	id: string;
	type: string;
	label: string;
	group: string;
	resolve: string;
	icon?: string | null;
	props_schema?: Record<string, unknown> | null;
	defaults?: Record<string, unknown> | null;
}
export async function listCustomBlocks(token: string) {
	return api<CustomBlockDef[]>(token, '/api/custom-blocks');
}

/* ── Users & API keys (admin) ─────────────────────── */

export interface StudioUser {
	id: string;
	email: string;
	full_name?: string;
	role_id?: string | null;
	/** `disabled` is refused at sign-in (and its live tokens 401 on the next
	 *  request) — see `AuthService.login` / `verifyToken`. */
	status?: 'active' | 'disabled';
	/** The the directory row this account signs in AS (the web employee link).
	 *  Null for the bootstrap admin and for Telegram accounts, whose acting
	 *  employee comes from the token's `tg-<id>` address instead. */
	employee_id?: string | null;
	last_login?: string | null;
	created_at?: string;
}

/** Admin — list users. The ONE `_users` read: the Users tab renders it and the
 *  API-keys tab resolves its owner labels from it, so both share `qk.users()`. */
export async function listUsers(token: string) {
	return api<StudioUser[]>(token, '/api/users');
}

export interface CreateStudioUserInput {
	email: string;
	password: string;
	full_name: string;
	role_id?: string | null;
	/** Omit to create an account with no acting employee (an admin-style login). */
	employee_id?: string | null;
}

/** Admin — create an account that signs in with email + password. */
export async function createUser(token: string, body: CreateStudioUserInput) {
	return api<{ id: string; email: string; full_name: string }>(token, '/api/users', {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export interface UpdateStudioUserInput {
	email?: string;
	full_name?: string;
	/** Omit (or leave blank) to leave the stored password untouched. */
	password?: string;
	/** ⚠️ The Admin API only assigns a role when this is TRUTHY, so a role can
	 *  never be un-assigned here — a password account always holds one. */
	role_id?: string | null;
	status?: 'active' | 'disabled';
	/** The employee this account signs in as. `null` UNLINKS it (the API treats
	 *  `undefined` as "leave it alone") — the fix for a binding made to the wrong
	 *  person, and how a former employee's account stops acting as anyone. */
	employee_id?: string | null;
}

/** Admin — update an account (name / role / status / set a new password). */
export async function updateUser(token: string, id: string, body: UpdateStudioUserInput) {
	return api<StudioUser>(token, `/api/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

/* ── Design tokens (per-app theme sets, admin) ────── */

export interface DesignTokenSet {
	id: string;
	app_id: string | null;
	set_name: string;
	is_default: number;
	tokens_json: string;
	created_at: string;
	updated_at: string;
}

export async function listDesignTokens(token: string) {
	return api<DesignTokenSet[]>(token, '/api/design-tokens');
}

export async function upsertDesignToken(
	token: string,
	body: { id?: string; app_id: string | null; set_name: string; is_default: boolean; tokens_json: string },
) {
	return api<DesignTokenSet>(token, '/api/design-tokens', { method: 'POST', body: JSON.stringify(body) });
}

export async function deleteDesignToken(token: string, id: string) {
	return api<{ deleted: boolean }>(token, `/api/design-tokens/${id}`, { method: 'DELETE' });
}

export interface ApiKeyInfo {
	id: string;
	name: string;
	user_id: string;
	role_id: string | null;
	is_active: number;
	created_at: string;
	last_used_at: string | null;
}

export async function listApiKeys(token: string) {
	return api<ApiKeyInfo[]>(token, '/api/api-keys');
}

export async function createApiKey(token: string, name: string, userId: string, roleId?: string | null) {
	return api<{ id: string; name: string; key: string; user_id: string }>(token, '/api/api-keys', {
		method: 'POST',
		body: JSON.stringify({ name, user_id: userId, role_id: roleId ?? null }),
	});
}

export async function revokeApiKey(token: string, id: string) {
	return api<{ id: string; revoked: boolean }>(token, `/api/api-keys/${id}`, { method: 'DELETE' });
}

/** Bulk import records — JSON array or CSV text (row errors reported, not fatal). */
export async function importRecords(token: string, slug: string, format: 'json' | 'csv', data: string) {
	return api<{ imported: number; errors: Array<{ row: number; error: string }> }>(token, `/api/entities/${slug}/import`, {
		method: 'POST',
		body: JSON.stringify({ format, data }),
	});
}

/* ── Custom Widgets ──────────────────────────────────────────
 * Widgets are real React component FILES under packages/design-system/
 * src/components/widgets — no database involved (see WIDGET_REGISTRY in
 * @mmbix/design-system). The studio code view saves them via /__studio. */
