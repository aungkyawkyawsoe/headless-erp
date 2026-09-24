/**
 * Schema Migration Runner — Enterprise Edition
 *
 * System tables follow the convention: `{TABLE_PREFIX}_` (e.g., `cms__entity_schemas`).
 * User collection tables follow: `{TABLE_PREFIX}{slug}` (e.g., `cms_articles`).
 * The `_migrations` bootstrap table is always unprefixed (created before config loads).
 *
 * Includes system tables for:
 *   - Users, Roles, Role Permissions
 *   - Junction tables (M2M)
 *   - Webhooks
 *   - Naming series support
 *   - Soft delete support
 */

import type { SqlStatement } from '@mmbix/types';
import type { MigrationRecord } from '@mmbix/types';
import { dbVerifiedWithin, markDbVerified } from './db-liveness';
import { D1Client } from './d1-client';
import { SchemaBuilder } from './schema-builder';
import { QueryBuilder } from './query-builder';

export interface Migration {
	name: string;
	up: (SqlStatement | SqlStatement[])[];
}

const sb = new SchemaBuilder();

const MIGRATIONS: Migration[] = [
	{
		name: '001_create_core_entity_tables',
		up: [
			// ── _migrations ────────────────────────────
			sb.createTable('_migrations', (t) => {
				t.uuid('id');
				t.text('name');
				t.timestamp('applied_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			// ── _entity_schemas ─────────────────────────
			sb.createTable('_entity_schemas', (t) => {
				t.uuid('id');
				t.text('name');
				t.text('slug');
				t.text('table_name');
				t.text('description').nullable();
				t.text('schema_json').default('{}');
				t.text('naming_series').nullable();
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_schemas_name ON _entity_schemas (name)'),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_schemas_slug ON _entity_schemas (slug)'),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_schemas_table_name ON _entity_schemas (table_name)'),
			// ── _media ──────────────────────────────────
			sb.createTable('_media', (t) => {
				t.uuid('id');
				t.text('key');
				t.text('filename');
				t.integer('size');
				t.text('mime_type');
				t.text('url');
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_media_key ON _media (key)'),
		],
	},
	{
		name: '002_users_and_permissions',
		up: [
			// ── _users ──────────────────────────────────
			sb.createTable('_users', (t) => {
				t.uuid('id');
				t.text('email');
				t.text('password_hash');
				t.text('full_name');
				t.text('role_id').nullable();
				t.text('status').default('active');
				t.text('last_login').nullable();
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON _users (email)'),
			// ── _roles ───────────────────────────────────
			sb.createTable('_roles', (t) => {
				t.uuid('id');
				t.text('name');
				t.text('description').nullable();
				t.boolean('is_system').default(0);
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_name ON _roles (name)'),
			// ── _role_permissions ────────────────────────
			sb.createTable('_role_permissions', (t) => {
				t.uuid('id');
				t.text('role_id');
				t.text('collection_slug');
				t.boolean('can_read').default(1);
				t.boolean('can_write').default(0);
				t.boolean('can_create').default(0);
				t.boolean('can_delete').default(0);
				t.boolean('can_approve').default(0);
				t.boolean('can_submit').default(0);
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_rp_role_collection ON _role_permissions (role_id, collection_slug)'),
		],
	},
	{
		name: '003_webhooks',
		up: [
			sb.createTable('_webhooks', (t) => {
				t.uuid('id');
				t.text('name');
				t.text('url');
				t.text('collection_slug');
				t.text('events').default('[]');
				t.text('secret').nullable();
				t.boolean('enabled').default(1);
				t.text('last_triggered').nullable();
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
		],
	},
	{
		name: '004_audit_log',
		up: [
			sb.createTable('_audit_log', (t) => {
				t.uuid('id');
				t.text('collection_slug');
				t.text('document_id');
				t.text('action');
				t.text('user_id').nullable();
				t.text('changes').nullable();
				t.timestamp('timestamp').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_audit_collection ON _audit_log (collection_slug)'),
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_audit_document ON _audit_log (collection_slug, document_id)'),
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON _audit_log (timestamp)'),
		],
	},
	{
		name: '005_scheduled_jobs',
		up: [
			sb.createTable('_scheduled_jobs', (t) => {
				t.uuid('id');
				t.text('name');
				t.text('description').nullable();
				t.text('cron');
				t.text('collection_slug').nullable();
				t.text('action');
				t.text('config').default('{}');
				t.boolean('enabled').default(1);
				t.text('last_run').nullable();
				t.text('next_run').nullable();
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_enabled ON _scheduled_jobs (enabled)'),
		],
	},
	{
		name: '006_approvals',
		up: [
			sb.createTable('_approvals', (t) => {
				t.uuid('id');
				t.text('collection_slug');
				t.text('document_id');
				t.integer('level');
				t.text('approved_by');
				t.text('role_name');
				t.integer('amount').nullable();
				t.text('comment').nullable();
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_approvals_doc ON _approvals (collection_slug, document_id)'),
		],
	},
	{
		name: '006b_role_permissions_extended',
		up: [
			// Add field-level restrictions (JSON array of hidden field names, or '*' for all visible)
			QueryBuilder.raw('ALTER TABLE _role_permissions ADD COLUMN field_restrictions TEXT DEFAULT NULL'),
			// Add row-level filter (JSON object with filter conditions)
			QueryBuilder.raw('ALTER TABLE _role_permissions ADD COLUMN row_filters TEXT DEFAULT NULL'),
		],
	},
	{
		name: '006c_schema_version_tracking',
		up: [QueryBuilder.raw('ALTER TABLE _entity_schemas ADD COLUMN _schema_version INTEGER DEFAULT 1')],
	},
	{
		name: '007_tenants',
		up: [
			sb.createTable('_tenants', (t) => {
				t.uuid('id');
				t.text('name');
				t.text('slug');
				t.boolean('is_active').default(1);
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug ON _tenants (slug)'),
		],
	},
	{
		name: '008_collection_metadata_and_user_stamps',
		up: [
			QueryBuilder.raw('ALTER TABLE _entity_schemas ADD COLUMN is_singleton INTEGER DEFAULT 0'),
			QueryBuilder.raw('ALTER TABLE _entity_schemas ADD COLUMN icon TEXT DEFAULT NULL'),
			QueryBuilder.raw('ALTER TABLE _entity_schemas ADD COLUMN color TEXT DEFAULT NULL'),
			QueryBuilder.raw('ALTER TABLE _entity_schemas ADD COLUMN hidden INTEGER DEFAULT 0'),
			QueryBuilder.raw('ALTER TABLE _entity_schemas ADD COLUMN sort_field TEXT DEFAULT NULL'),
			QueryBuilder.raw('ALTER TABLE _entity_schemas ADD COLUMN system_field_options TEXT DEFAULT NULL'),
			QueryBuilder.raw('ALTER TABLE _entity_schemas ADD COLUMN created_by TEXT DEFAULT NULL'),
			QueryBuilder.raw('ALTER TABLE _entity_schemas ADD COLUMN updated_by TEXT DEFAULT NULL'),
		],
	},
	{
		name: '009_modules',
		up: [
			sb.createTable('_modules', (t) => {
				t.uuid('id');
				t.text('name');
				t.text('slug');
				t.text('icon').default('lucide:box');
				t.text('description').nullable();
				t.text('version').default('1.0.0');
				t.boolean('is_active').default(1);
				t.integer('sort_order').default(0);
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_modules_slug ON _modules (slug)'),
			sb.createTable('_module_collections', (t) => {
				t.uuid('id');
				t.text('module_id');
				t.text('collection_id');
				t.integer('sort_order').default(0);
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_mc_pair ON _module_collections (module_id, collection_id)'),
		],
	},
	{
		name: '010_module_menus',
		up: [
			sb.createTable('_module_menus', (t) => {
				t.uuid('id');
				t.text('module_id');
				t.text('parent_id').nullable();
				t.text('label');
				t.text('label_my').nullable();
				t.text('icon').nullable();
				t.text('type').default('collection');
				t.text('target').nullable();
				t.integer('sort_order').default(0);
				t.boolean('is_active').default(1);
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_module_menus_module ON _module_menus (module_id)'),
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_module_menus_parent ON _module_menus (parent_id)'),
		],
	},
	{
		name: '011_module_views',
		up: [
			sb.createTable('_module_views', (t) => {
				t.uuid('id');
				t.text('module_id');
				t.text('collection_slug');
				t.text('name');
				t.text('type').default('table');
				t.text('config_json').default('{}');
				t.boolean('is_default').default(0);
				t.integer('sort_order').default(0);
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_module_views_module ON _module_views (module_id)'),
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_module_views_collection ON _module_views (collection_slug)'),
		],
	},
	{
		name: '012_menu_actions',
		up: [QueryBuilder.raw('ALTER TABLE _module_menus ADD COLUMN action_config TEXT DEFAULT NULL')],
	},
	{
		name: '013_pages',
		up: [
			sb.createTable('_pages', (t) => {
				t.uuid('id');
				t.text('module_id').nullable();
				t.text('path');
				t.text('title');
				t.text('blocks_json').default('{}');
				t.text('global_filter').nullable();
				t.boolean('is_published').default(0);
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_module_path ON _pages (module_id, path)'),
		],
	},
	{
		name: '014_translations',
		up: [
			// i18n key/value store. System table (unprefixed) like _users/_modules.
			// `collection`/`field` are optional — used to auto-generate field-level labels.
			sb.createTable('_translations', (t) => {
				t.uuid('id');
				t.text('module_id').nullable();
				t.text('language').default('en');
				t.text('key');
				t.text('value');
				t.text('context').default('ui');
				t.text('collection').nullable();
				t.text('field').nullable();
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_translations_uniq ON _translations (module_id, language, key, context)'),
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_translations_language ON _translations (language)'),
		],
	},
	{
		name: '015_module_colors',
		up: [
			// Per-app icon + background colors (the Manage App dialog preview).
			QueryBuilder.raw('ALTER TABLE _modules ADD COLUMN icon_color TEXT DEFAULT NULL'),
			QueryBuilder.raw('ALTER TABLE _modules ADD COLUMN bg_color TEXT DEFAULT NULL'),
		],
	},
	{
		name: '016_menu_roles',
		up: [
			// Role-restricted menus: JSON array of role names allowed to see the item.
			// NULL/empty = visible to everyone. (Frontend filters by the user's role.)
			QueryBuilder.raw('ALTER TABLE _module_menus ADD COLUMN roles TEXT DEFAULT NULL'),
		],
	},
	// Legacy — superseded by the idempotency plugin's _idempotency_keys (029); kept so old DBs stay migratable.
	{
		name: '017_idempotency',
		up: [
			// Idempotent write tracking: clients send an Idempotency-Key on mutating
			// requests (entity/menu create) so retries never duplicate rows.
			sb.createTable('_idempotency', (t) => {
				t.text('key');
				t.text('method').default('POST');
				t.text('path').nullable();
				t.integer('status').default(200);
				t.text('response');
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_key ON _idempotency (key)'),
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_idempotency_created ON _idempotency (created_at)'),
		],
	},
	{
		name: '018_module_config_version',
		up: [
			// Per-app config version — bumped on every Studio publish (module/menu/
			// page/view mutation) so the frontend can do cheap conditional freshness
			// checks (If-None-Match on the version) instead of guessing with TTLs.
			QueryBuilder.raw('ALTER TABLE _modules ADD COLUMN config_version INTEGER DEFAULT 0'),
		],
	},
	{
		name: '019_design_tokens',
		up: [
			// Per-app theme token sets — the design-system swap layer. Each row holds a
			// named token set (e.g. 'default' | 'dark' | 'brand-a') as CSS-variable
			// key/value pairs (--primary, --radius-3, ...). NULL app_id = global default.
			sb.createTable('_design_tokens', (t) => {
				t.uuid('id');
				t.text('app_id').nullable();
				t.text('set_name');
				t.integer('is_default').default(0);
				t.text('tokens_json');
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_design_tokens_app ON _design_tokens (app_id, set_name)'),
		],
	},
	{
		name: '020_page_versions',
		up: [
			// Page version history — snapshot of blocks_json at every save so the
			// Studio can diff, restore, or audit page evolution (enterprise safety).
			sb.createTable('_page_versions', (t) => {
				t.uuid('id');
				t.text('page_id');
				t.integer('version');
				t.text('blocks_json');
				t.text('title');
				t.text('meta_json').nullable();
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_page_versions_page ON _page_versions (page_id, version)'),
		],
	},
	{
		name: '021_custom_blocks',
		up: [
			// Extension API — custom block types registered at runtime. Each row maps
			// a new type name to an existing design-system component (resolve) plus a
			// props schema + defaults. The Studio palette + runtime renderer pick these
			// up automatically — no code change required to add a block type.
			sb.createTable('_custom_blocks', (t) => {
				t.uuid('id');
				t.text('type');
				t.text('label');
				t.text('group_name').default('Custom');
				t.text('resolve');
				t.text('icon').nullable();
				t.text('props_schema_json').nullable();
				t.text('defaults_json').nullable();
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_blocks_type ON _custom_blocks (type)'),
		],
	},
	{
		name: '022_api_keys',
		up: [
			// Machine API keys — Bearer tokens (mmk_… prefix) for headless/integration
			// access. Only the SHA-256 hash is stored; the plaintext key is shown once
			// at creation. Keys resolve to a user (role + audit identity).
			sb.createTable('_api_keys', (t) => {
				t.uuid('id');
				t.text('name');
				t.text('key_hash');
				t.text('user_id');
				t.text('role_id').nullable();
				t.boolean('is_active').default(1);
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('last_used_at').nullable();
				t.timestamp('revoked_at').nullable();
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON _api_keys (key_hash)'),
		],
	},
	{
		name: '023_approval_workflow',
		up: [
			// Multi-level approval workflow support — the 006_approvals table tracked
			// one level of approval; the workflow engine needs per-level state, a
			// human label, an outcome status and a timestamp per decision.
			QueryBuilder.raw('ALTER TABLE _approvals ADD COLUMN level_label TEXT DEFAULT NULL'),
			QueryBuilder.raw("ALTER TABLE _approvals ADD COLUMN status TEXT DEFAULT 'pending'"),
			QueryBuilder.raw('ALTER TABLE _approvals ADD COLUMN approved_at TEXT DEFAULT NULL'),
		],
	},
	{
		name: '024_menu_templates',
		up: [
			// Per-menu designer template (e.g. 'table-card-form') — the Studio builder
			// applies each menu item's own view template on click and persists changes
			// to that menu item, so menus no longer share one global template.
			QueryBuilder.raw('ALTER TABLE _module_menus ADD COLUMN template TEXT DEFAULT NULL'),
		],
	},
	{
		name: '025_reports',
		up: [
			// Saved report definitions — first-class, reusable across pages/modules.
			// config_json holds a ReportDefinition; roles gates who may view it.
			sb.createTable('_reports', (t) => {
				t.uuid('id');
				t.text('name');
				t.text('slug');
				t.text('collection');
				t.text('type'); // 'grouped' | 'pivot'
				t.text('config_json').default('{}');
				t.text('roles').nullable(); // JSON array of role ids/names — null = all readers
				t.text('created_by').nullable();
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_slug ON _reports (slug)'),
		],
	},
	{
		name: '026_mve_templates',
		up: [
			// MVE (Mobile View Engine) templates — the MiniApp's module layouts
			// (list/form/editForm/dashboard configs) served from the DB so the Studio
			// can edit them without a client redeploy. Keyed by the full module slug
			// (e.g. 'store/products'); config_json holds the template bundle.
			sb.createTable('_mve_templates', (t) => {
				t.text('slug');
				t.text('title');
				t.text('accent');
				t.text('collection').nullable();
				t.text('config_json').default('{}');
				t.integer('version').default(1);
				t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_mve_templates_slug ON _mve_templates (slug)'),
		],
	},
	{
		name: '027_media_references',
		up: [
			// Media reference registry — powers the “delete/Garbage-collect unused
			// media” feature. Every entity row that stores an R2 /api/media/<key>
			// value (image/file or any text column) is registered here at write time
			// so an asset can safely be removed only once NO rack row references it.
			sb.createTable('_media_refs', (t) => {
				t.text('media_key');
				t.text('collection');
				t.text('doc_id');
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_media_refs_doc_key ON _media_refs (collection, doc_id, media_key)'),
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_media_refs_key ON _media_refs (media_key)'),
		],
	},
	{
		name: '028_role_app_access',
		up: [
			// Design-B role→app access: which mini-app launcher ids a role may open.
			// Stored as a JSON array of client app registry `AppDefinition.id`s (e.g.
			// ["attendance","tyres",…]). NULL/absent ⇒ the role may open every app
			// (Administrator + roles not yet curated). Re-exposed on /auth/me so the
			// launcher can filter tiles per role.
			QueryBuilder.raw('ALTER TABLE _roles ADD COLUMN app_access TEXT DEFAULT NULL'),
		],
	},
	{
		name: '029_authz_version_indexes',
		up: [
			// `authzVersion()` (apps/api/src/lib/services/authz-version.ts) computes
			// `MAX(updated_at)` across these three tables and is read by `verifyToken`
			// AND every `PermissionEvaluator` lookup, so it runs on essentially every
			// request. `updated_at` had no index, so each call was three full table
			// scans; with many isolates that is one triple scan per isolate per second
			// even though the value almost never changes. These indexes turn each MAX
			// into a single index seek. Idempotent + additive.
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_users_updated_at ON _users (updated_at)'),
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_roles_updated_at ON _roles (updated_at)'),
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_role_permissions_updated_at ON _role_permissions (updated_at)'),
		],
	},
	{
		name: '030_maintenance_marker',
		up: [
			// Small key/value marker table for IDEMPOTENT one-time maintenance whose
			// "already done" state must be shared across ISOLATES. The in-memory
			// CacheLayer is per-isolate, so a sweep guarded only by it re-runs on
			// every cold isolate; persisting the marker here makes a settled database
			// pay one tiny read instead of the whole sweep. Values are opaque strings
			// owned by their writer (the index backfill stores a schema fingerprint).
			sb.createTable('_maintenance', (t) => {
				t.text('name');
				t.text('value');
				t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
			}),
			QueryBuilder.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_name ON _maintenance (name)'),
		],
	},
	{
		name: '031_role_permissions_role_id_index',
		up: [
			// `AuthService.getPermissions` runs `SELECT * FROM _role_permissions
			// WHERE role_id = ? ORDER BY id DESC` on every `/auth/me` (every app
			// load/resume). `idx_rp_role_collection (role_id, collection_slug)` serves
			// the filter but NOT the id order, so SQLite built a temp B-tree sort per
			// call (D1 flagged it). `(role_id, id)` serves both — an index-ordered read
			// with no sort step. Idempotent + additive.
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON _role_permissions (role_id, id)'),
		],
	},
	{
		name: '035_users_employee_id',
		up: [
			// `_users.employee_id` — the ONE link between a LOGIN identity and the
			// directory record it acts as. It exists because a password (web) login
			// had no acting employee at all: the token was minted with no
			// `employee_id`, so every server-scoped action (punch, leave, custody,
			// transfers) refused a web session, and offboarding an employee left
			// their web account working — unlike the Telegram gate, which revokes
			// through the directory's configured tg-id field.
			//
			// Nullable on purpose: the bootstrap admin and Telegram-provisioned rows
			// have no link (their acting employee is derived from the token's
			// `tg-<id>@telegram.local` email), and an existing deployment's rows must
			// not become un-signable by gaining a NOT NULL column.
			QueryBuilder.raw('ALTER TABLE _users ADD COLUMN employee_id TEXT'),
			// The login + `/auth/me` gate reads this column for a password session, and
			// the Users table resolves a dozen links per page — an index keeps both a
			// bounded point/range read instead of a scan of every account.
			QueryBuilder.raw('CREATE INDEX IF NOT EXISTS idx_users_employee_id ON _users (employee_id)'),
		],
	},
	{
		name: '036_role_permissions_lineage',
		up: [
			// Permission lineage — WHAT wrote each grant, so "where did this role's
			// read on `X` come from?" is answerable: an admin edit in the Studio
			// (`admin`), a Telegram role provisioner (`provisioner`), or a domain
			// module's manifest (`manifest` + `source_module`). Nullable so rows
			// written before lineage existed stay valid.
			QueryBuilder.raw('ALTER TABLE _role_permissions ADD COLUMN source TEXT DEFAULT NULL'),
			QueryBuilder.raw('ALTER TABLE _role_permissions ADD COLUMN source_module TEXT DEFAULT NULL'),
		],
	},
];

/** Source-of-truth migration names — the CLI imports these instead of keeping a stale copy. */
export const MIGRATION_NAMES: string[] = MIGRATIONS.map((m) => m.name);

// ─── Migration Runner ──────────────────────────────────

export class MigrationRunner {
	constructor(private db: D1Client) {}

	async runPending(): Promise<string[]> {
		// Per-isolate fast path: migrations only need to run once per isolate.
		// A tiny sqlite_master probe detects a reset/wiped database (tests reset
		// the DB per test while the isolate persists) and re-runs in that case.
		// Probes the CORE marker table `_entity_schemas` (created by migration
		// 001) — NOT `_migrations`, which plugin migrations also record into and
		// may recreate, which would make this probe wrongly assume core tables
		// exist.
		const g = globalThis as unknown as Record<string, boolean>;
		if (g.__MIGRATIONS_INIT__) {
			// A liveness proof recorded moments ago in THIS request (by the plugin
			// runner, which always runs first) already covers this probe — skip the
			// round trip. Correctness holds: a WIPED database makes the plugin runner
			// call `invalidateDbLiveness()`, which clears this guard, so we never skip
			// past a reset.
			if (dbVerifiedWithin()) return [];
			// No recent proof (a caller that bypassed the plugin middleware) — probe
			// the marker table DIRECTLY. `SELECT … FROM sqlite_master` cannot use an
			// index, so it scans the whole schema catalogue; a `LIMIT 1` read of the
			// table itself is a bounded point lookup, and a missing table raises
			// "no such table" — the same wiped-database signal.
			try {
				await this.db.first<{ n: number }>({ sql: 'SELECT 1 AS n FROM _entity_schemas LIMIT 1', bindings: [] });
				markDbVerified();
				return [];
			} catch {
				g.__MIGRATIONS_INIT__ = false;
			}
		}

		await this._ensureMigrationsTable();
		const applied = await this._getApplied();
		const appliedNames = new Set(applied.map((m) => m.name));
		const pending = MIGRATIONS.filter((m) => !appliedNames.has(m.name));
		if (pending.length === 0) {
			g.__MIGRATIONS_INIT__ = true;
			return [];
		}

		const runNames: string[] = [];
		for (const migration of pending) {
			console.log(`[migration] running: ${migration.name}`);
			// Run each migration as ONE atomic batch: if any statement fails, D1
			// rolls the whole migration back and the name is never recorded — the
			// next cold start re-runs it cleanly instead of hitting a half-applied
			// state (e.g. duplicate-column errors on non-idempotent ADD COLUMN).
			const statements = migration.up.flat();
			await this.db.batch(statements);

			// Seed admin role after users/roles migration
			if (migration.name === '002_users_and_permissions') {
				await this.db.run(
					QueryBuilder.raw(
						`INSERT OR IGNORE INTO _roles (id, name, description, is_system) VALUES (?, 'Administrator', 'Full system access', 1)`,
						[crypto.randomUUID()],
					),
				);
			}

			const insertStmt = QueryBuilder.from('_migrations').toInsert({
				id: crypto.randomUUID(),
				name: migration.name,
			});
			await this.db.run(insertStmt);
			runNames.push(migration.name);
			console.log(`[migration] completed: ${migration.name}`);
		}
		g.__MIGRATIONS_INIT__ = true;
		return runNames;
	}

	private async _ensureMigrationsTable(): Promise<void> {
		const statements = sb.createTable('_migrations', (t) => {
			t.uuid('id');
			t.text('name');
			t.timestamp('applied_at').defaultRaw('CURRENT_TIMESTAMP');
		});
		for (const stmt of statements) {
			await this.db.exec(stmt.sql);
		}
	}

	private async _getApplied(): Promise<MigrationRecord[]> {
		try {
			const selectStmt = QueryBuilder.from('_migrations').select('id', 'name', 'applied_at').orderBy('id', 'asc').toSelect();
			return await this.db.all<MigrationRecord>(selectStmt);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('no such table')) return [];
			throw err;
		}
	}
}
