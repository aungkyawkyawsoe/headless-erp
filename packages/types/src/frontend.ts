/**
 * Frontend-facing API contract types — the shapes the mini app
 * (the client app) exchanges with the REST API. Kept here (not in the app) so
 * backend handlers and the frontend client can never drift: both reference the
 * same field/response definitions.
 */

// ─── Auth ─────────────────────────────────────────────

export interface AuthUser {
	id: string;
	email: string;
	full_name: string;
}

export interface MyAccess {
	role: string | null;
	isAdmin: boolean;
	/** Allowed field names for a collection (whitelist); null = all visible. */
	fieldRestrictions: string[] | null;
}

// ─── Modules / apps (dock) ────────────────────────────

export interface ApiModule {
	slug: string;
	name: string;
	icon?: string | null;
	icon_color?: string | null;
	bg_color?: string | null;
	is_active?: number;
	sort_order?: number;
}

/** A sidebar menu node (from the app manifest). */
export interface MenuNode {
	id: string;
	label: string;
	label_my?: string | null;
	icon?: string | null;
	type: string;
	target?: string | null;
	roles?: string[] | null;
	children?: MenuNode[];
}

/** A page block — the Studio writes these, the frontend renders them via @mmbix/ui-views. */
export interface PageBlock {
	id: string;
	type: string;
	label?: string;
	layout: { order: number; colSpan?: number; colStart?: number; alignY?: 'start' | 'end'; rowSpan?: number };
	config: Record<string, unknown>;
	/** Nested children (containers: row/column/tabs/accordion). */
	children?: PageBlock[];
}

export interface AppPage {
	id: string;
	path: string;
	title?: string;
	isPublished: boolean;
	blocks: PageBlock[];
}

export interface AppManifest {
	slug: string;
	name: string;
	menus: MenuNode[];
	collections: Array<{ id: string; name: string; slug: string }>;
	pages: AppPage[];
	custom_blocks?: Array<{ type: string; label: string; group: string; resolve: string }>;
	config_version: number;
}

// ─── Entities (collections + records) ─────────────────

/** Linkage-rule condition: `{ field, op, value }` — see docs/backend-plugins/linkage-rules.md. */
export interface FieldCondition {
	field: string;
	op: 'eq' | 'neq' | 'in' | 'nin' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'starts_with' | 'is_empty' | 'is_not_empty';
	value?: unknown;
}

/** A schema field as consumed by the frontend (schema_json.fields entries). */
export interface FieldDef {
	name: string;
	type: string;
	label?: string;
	required?: boolean;
	/** Select choices — plain strings or Studio-style {label, value} objects. */
	options?: Array<string | { label?: string; value?: string }>;
	related_collection?: string;
	display_template?: string;
	/** Conditional visibility — the field renders only when the condition holds. */
	visible_when?: FieldCondition;
	/** Conditional read-only — the field is disabled when the condition holds. */
	readonly_when?: FieldCondition;
	/** Conditional required — the field shows the required marker when the condition holds. */
	required_when?: FieldCondition;
	/** Studio per-type config (passed through from schema_json). */
	min?: number | string;
	max?: number | string;
	step?: number | string;
	currency?: string;
	file_accept?: string;
	max_size?: number;
	rating_max?: number;
}

/** Collection detail as returned by GET /api/entities/detail/:slug (parsed schema_json). */
export interface CollectionDetail {
	id: string;
	name: string;
	slug: string;
	table_name: string;
	schema_json: { fields: FieldDef[] };
}

export interface CollectionSummary {
	id: string;
	name: string;
	slug: string;
	table_name: string;
}

// ─── List / query contract ────────────────────────────

/** A column filter as emitted by the DataTable's filter popover (`ActiveFilter`). */
export interface ColumnFilter {
	id: string;
	operator: string;
	value: unknown;
	valueTo?: unknown;
}

export interface ListOptions {
	limit?: number;
	cursor?: string;
	dir?: 'after' | 'before';
	sort?: string;
	search?: string;
	fields?: string;
	/** Column filters from the DataTable filter popover. */
	filters?: ColumnFilter[];
	/** Aggregations — [{ op: 'sum', field: 'amount' }] → aggregate[sum]=amount. */
	aggregate?: Array<{ op: string; field: string }>;
	/** Group aggregate rows by fields or date buckets — `status`, `month(created_at)`, … */
	groupBy?: string[];
	/** Include the total row count in the result (KPI blocks). */
	count?: boolean;
}

/** Page metadata — canonical wire contract (matches `{success, data, meta}` from the entity engine). */
export interface PageMeta {
	limit: number;
	has_more: boolean;
	next_cursor?: string | null;
	prev_cursor?: string | null;
	/** Present only when the request asked for a count (?count=true / ?count_only=true). */
	total?: number | null;
}

/** Canonical paginated list result — matches the wire envelope. */
export interface ListResult<T> {
	data: T[];
	meta: PageMeta;
}

// ─── Saved views ──────────────────────────────────────

/** ViewConfig as persisted by the backend (saved-view.service / ViewConfig). */
export interface SavedViewConfig {
	filter?: Array<{ field: string; op: string; value: unknown }>;
	sort?: string;
	columns?: string[];
	pageSize?: number;
	isDefault?: boolean;
}

export interface SavedView {
	id: string;
	collection_slug: string;
	name: string;
	user_id: string;
	visibility: 'private' | 'public' | string;
	config: SavedViewConfig;
	created_at: string;
}

// ─── Audit trail ──────────────────────────────────────

export interface AuditChanges {
	snapshot_before: Record<string, unknown> | null;
	snapshot_after: Record<string, unknown> | null;
	fields: Record<string, unknown> | null;
}

export type AuditAction = 'create' | 'update' | 'delete' | 'submit' | 'approve' | 'reject' | 'restore';

export interface AuditEntry {
	id: string;
	collection_slug: string;
	document_id: string;
	action: AuditAction;
	user_id: string | null;
	timestamp: string;
	changes: AuditChanges | null;
}
