/**
 * Core Entity TypeScript Interfaces
 *
 * These types represent the shape of data stored in D1 tables,
 * the API response contracts, and the enterprise system fields.
 */

import { FIELD_TYPE_NAMES } from '@mmbix/utils';

// ─── Query Builder ──────────────────────────────────────

/** Result of query builder — pure SQL + bindings, ready for D1 */
export interface SqlStatement {
	sql: string;
	bindings: unknown[];
}

// ─── Field System ───────────────────────────────────────

/** Supported field data types for schema-backed collections */
export type FieldType = (typeof FIELD_TYPE_NAMES)[number];

/** Document status values — core workflow + plugin extensions */
export type DocStatus =
	| 'draft'
	| 'submitted'
	| 'approved'
	| 'cancelled'
	// Posted/confirmed state — the terminal lock a collection freezes on
	// (`writes.freeze_when` on doc_status=confirmed). MRO domain services set it
	// directly; a generic collection (e.g. veh_maintenance_logs) reaches it with a
	// plain draft → confirmed write.
	| 'confirmed'
	// Approval plugin extensions
	| 'pending_review'
	| 'rejected'
	| `approved_l${number}`;

/** One approval level (step) in a collection's approval workflow. */
export interface ApprovalLevel {
	/** Stable id (uuid) — levels are re-created on every submit, so reordering is safe. */
	id: string;
	/** Human label, e.g. "Manager approval". */
	label: string;
	/** Role that must approve this level (by role name). */
	role_name: string;
	/** Optional amount field: the level only applies when the field's value exceeds `threshold`. */
	amount_field?: string | null;
	threshold?: number | null;
}

/** Collection-level approval workflow — stored in schema_json under `workflow`. */
export interface ApprovalWorkflow {
	enabled: boolean;
	name: string;
	levels: ApprovalLevel[];
}

/** A row in _approvals — one decision slot per submit round. */
export interface ApprovalRecord {
	id: string;
	collection_slug: string;
	document_id: string;
	level: number;
	level_label: string | null;
	role_name: string;
	amount: number | null;
	status: 'pending' | 'approved' | 'rejected' | 'skipped';
	approved_by: string | null;
	comment: string | null;
	approved_at: string | null;
	created_at: string;
}

/** A single field definition within a collection schema */
export interface FieldDefinition {
	name: string;
	type: FieldType;
	label?: string;
	required?: boolean;
	default?: string | number | boolean;
	/** For slug type: field to generate slug from */
	source?: string;
	/** For relation types: the related collection slug */
	related_collection?: string;
	/** For relation types: foreign key field (o2m) or junction prefix */
	foreign_key?: string;
	related_collections?: string[];
	/** When true, deleting the related (parent) record also deletes child records pointing to it */
	cascade_delete?: boolean;
	/** Formula expression (e.g., "qty * rate", "SUM(items.amount)") */
	formula?: string;
	/** How to interpret the formula */
	formula_type?: 'expression' | 'sql' | 'lookup';
	/**
	 * Formula fields: materialize the computed value into a REAL column,
	 * recomputed on every write (create/update). Stored formulas are
	 * filterable/sortable/indexable. Default false = virtual (computed on read
	 * only, no column).
	 */
	store?: boolean;
	/**
	 * Formula fields: the result type. Drives the SQL column type for stored
	 * formulas (number→REAL, boolean→INTEGER, string/json→TEXT) and the
	 * generated SDK type. Defaults to 'number'.
	 */
	result_type?: 'number' | 'string' | 'boolean' | 'json';
	/** Formula fields (numeric result): decimal places to round to. Off by default (no rounding). */
	precision?: number;
	/** Formula fields: rounding mode when `precision` is set (default 'half_up'). */
	rounding?: 'half_up' | 'half_even' | 'up' | 'down';
	/**
	 * Formula write-back (the Odoo `inverse` equivalent): when a payload
	 * includes this field, compute `inverse_target` from `inverse_formula`
	 * BEFORE validation — e.g. field `total` (formula `qty * rate`) with
	 * `inverse_formula: "total / rate"`, `inverse_target: "qty"` lets a client
	 * send `{ rate, total }` and the engine derives `qty`.
	 */
	inverse_formula?: string;
	/** Field that `inverse_formula` writes to — must be a real (non-formula) field of the collection. */
	inverse_target?: string;
	/** UNIQUE constraint or app-level uniqueness check */
	unique?: boolean;
	/** Create a database index */
	index?: boolean;
	/** Minimum value (for number types) */
	min?: number;
	/** Maximum value (for number types) */
	max?: number;
	/** Max characters (for text types) */
	max_length?: number;
	/** Choice list for select type */
	options?: string[];
	/** UI placeholder/hint text */
	placeholder?: string;
	/** Help text shown below the field */
	hint?: string;
}

/**
 * A composite (multi-column) database index — turns hot multi-column filters
 * (e.g. `WHERE assignee_tg_id = ? AND status IN (…) AND due_date < ?`) from a
 * full scan into an index seek. Stored in the collection's `schema_json` as
 * `composite_indexes` (a sibling of `fields`), created/backfilled idempotently.
 */
export interface CompositeIndex {
	/** Optional index name; defaults to `idx_<table>_<col>_<col>…`. */
	name?: string;
	/** Columns, in index order (leading column first — this is the one a
	 *  single-column `=`/`IN` filter alone can seek on). Any column must be a
	 *  real physical column of the collection's table. */
	columns: string[];
}

// ─── Field Type Registry (config-driven property panels) ──

/** UI component types for field type property editors */
export type FieldPropertyType =
	| 'input' // text input
	| 'number' // number input
	| 'textarea' // multi-line text
	| 'checkbox' // boolean toggle
	| 'select' // dropdown
	| 'multi-select' // tag/multi-picker
	| 'collection-picker' // select from available collections
	| 'field-picker' // select a field from a collection
	| 'template-editor' // {{field_name}} template with autocomplete
	| 'json-editor' // JSON editor / textarea
	| 'color-picker' // color input
	| 'key-value-editor'; // key:value pair list

/** A single configurable property for a field type's property panel */
export interface FieldTypeProperty {
	key: string;
	label: string;
	type: FieldPropertyType;
	required?: boolean;
	placeholder?: string;
	help?: string;
	/** How to populate the options */
	source?: 'collections' | 'collections-list' | 'static';
	/** For static select: list of options */
	options?: string[];
	/** Default value */
	default?: unknown;
	/**
	 * Points to another property key that must be filled first.
	 * e.g. field-picker depends on 'related_collection' — the picker
	 * uses the value of field.related_collection to know which
	 * collection's fields to display.
	 * When set, the UI shows a disabled placeholder until the
	 * dependency is satisfied.
	 */
	depends_on?: string;
	/** Condition to show/hide this property */
	show_when?: { key: string; value: unknown };
}

/** Extended field type definition returned by the API */
export interface FieldTypeSchema {
	type: string;
	label: string;
	group: string;
	icon: string;
	description: string;
	config_schema: FieldTypeProperty[];
}

/** Configurable system field options when creating a collection */
export interface SystemFieldOptions {
	doc_status?: boolean;
	display_number?: boolean;
	created_by?: boolean;
	updated_by?: boolean;
	deleted_at?: boolean;
	deleted_by?: boolean;
	_owner?: boolean;
}

/** Default: all system fields enabled */
export const DEFAULT_SYSTEM_FIELDS: Required<SystemFieldOptions> = {
	doc_status: true,
	display_number: true,
	created_by: true,
	updated_by: true,
	deleted_at: true,
	deleted_by: true,
	_owner: true,
};

/**
 * System field names that may be present in collection tables.
 *
 * NOTE: `data` and `sort` are deliberately NOT reserved — a user field named
 * `data` or `sort` is a normal, physical column (splitRowData only treats
 * names in this set as system keys; every entry here must map to a column
 * that applySystemColumns actually creates, otherwise writes to that column
 * would be silently dropped).
 */
export const SYSTEM_FIELDS = new Set([
	'id',
	'_meta',
	'doc_status',
	'display_number',
	'deleted_at',
	'deleted_by',
	'created_at',
	'updated_at',
	'created_by',
	'updated_by',
	'_owner',
]);

// ─── Database Tables ────────────────────────────────────

/** A registered content collection (from _entity_schemas) */
export interface EntitySchema {
	/** TEXT PRIMARY KEY (uuid) in D1 — ids are opaque keys, never numeric */
	id: string;
	name: string;
	slug: string;
	table_name: string;
	/** Whether this is a system collection (true) or user-defined (false) */
	is_system?: boolean;
	description: string | null;
	schema_json: string; // JSON string of FieldDefinition[]
	/** Auto-numbering pattern: "INV-" → INV-00001 (default 5-digit); trailing `#`s set the width, "INV-####" → INV-0001. null → no auto-number */
	naming_series: string | null;
	/** Whether this collection holds exactly 1 record (site settings, company profile, etc.) */
	is_singleton?: boolean;
	/** Lucide icon name for this collection (e.g. "folder", "users", "settings") */
	icon?: string | null;
	/** Hex color for the icon */
	color?: string | null;
	/** Whether this collection is hidden from navigation */
	hidden?: boolean;
	/** Field name used for drag-drop manual ordering (null = disabled) */
	sort_field?: string | null;
	/** JSON config for optional system fields */
	system_field_options?: string | null;
	/** Schema version counter — set by migration 006c (`_schema_version INTEGER DEFAULT 1`) */
	_schema_version?: number;
	/** Who created this collection schema */
	created_by?: string | null;
	/** Who last updated this collection schema */
	updated_by?: string | null;
	created_at: string;
	updated_at: string;
}

/** A tracked migration (from _migrations) */
export interface MigrationRecord {
	/** TEXT PRIMARY KEY (uuid) in D1 — ids are opaque keys, never numeric */
	id: string;
	name: string;
	applied_at: string;
}

/** A media asset record (from _media) */
export interface MediaRecord {
	/** TEXT PRIMARY KEY (uuid) in D1 — ids are opaque keys, never numeric */
	id: string;
	key: string;
	filename: string;
	size: number;
	mime_type: string;
	url: string;
	created_at: string;
}

/** A user record (from _users) */
export interface UserRecord {
	id: string;
	email: string;
	password_hash: string;
	full_name: string;
	role_id: string;
	status: 'active' | 'disabled';
	/** The `hrm_employees` row this account acts as — the web-sign-in identity.
	 *  Null for the bootstrap admin and for Telegram accounts, whose acting
	 *  employee is derived from the token's `tg-<id>` email instead. */
	employee_id?: string | null;
	last_login: string | null;
	created_at: string;
	updated_at: string;
}

/** A role record (from _roles) */
export interface RoleRecord {
	id: string;
	name: string;
	description: string | null;
	is_system: boolean; // Built-in roles can't be deleted
	/** Raw JSON TEXT of the mini-app launcher app ids this role may open
	 *  (Design-B role→app access). null/absent ⇒ open to every app. Parsed to an
	 *  array only when surfaced (see AuthService.roleAppList). */
	app_access?: string | null;
	created_at: string;
	updated_at: string;
}

/** A role permission record (from _role_permissions) */
export interface RolePermissionRecord {
	id: string;
	role_id: string;
	collection_slug: string;
	// Booleans are the API contract; D1 stores them as INTEGER 0/1
	// (schema-builder `boolean()` → INTEGER, default 1/0). apps/api coerces
	// on read/write — keep `boolean` here.
	can_read: boolean;
	can_write: boolean;
	can_create: boolean;
	can_delete: boolean;
	can_approve: boolean; // Can move doc_status to "approved"
	can_submit: boolean; // Can move doc_status to "submitted"
	field_restrictions?: string | null; // JSON array of hidden field names
	row_filters?: string | null; // JSON object with filter conditions
	created_at: string;
	updated_at: string;
}

/** A junction table record for M2M relations */
export interface JunctionRecord {
	id: string;
	source_id: string;
	target_id: string;
	created_at: string;
}

/** A webhook subscription */
export interface WebhookRecord {
	id: string;
	name: string;
	url: string;
	collection_slug: string;
	events: string; // JSON array: ["create","update","delete"]
	secret: string | null; // HMAC signing secret
	enabled: boolean;
	last_triggered: string | null;
	created_at: string;
}

// ─── API Contracts ──────────────────────────────────────

/** Standard API success response */
export interface ApiResponse<T = unknown> {
	success: true;
	data: T;
	meta?: Record<string, unknown>;
}

// ─── Media ──────────────────────────────────────────────

/** Metadata returned after a successful upload */
export interface MediaUploadResult {
	key: string;
	url: string;
	filename: string;
	size: number;
	mime_type: string;
}

// ─── v0.7: Field Linkage Types ─────────────────────────────

export interface FieldLinkage {
	target: string;
	action: 'set_value' | 'clear' | 'calculate' | 'set_options';
	value?: unknown;
	expression?: string;
	condition?: LinkageCondition;
}

export interface LinkageCondition {
	field: string;
	op: 'eq' | 'neq' | 'in' | 'nin' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'starts_with' | 'is_empty' | 'is_not_empty';
	value?: unknown;
}

// ─── v0.7: Validation Rule Types ───────────────────────────

export type ValidationRule =
	| { type: 'required'; message?: string }
	| { type: 'min'; value: number; message?: string }
	| { type: 'max'; value: number; message?: string }
	| { type: 'min_length'; value: number; message?: string }
	| { type: 'max_length'; value: number; message?: string }
	| { type: 'regex'; pattern: string; message?: string }
	| { type: 'email'; message?: string }
	| { type: 'url'; message?: string }
	| { type: 'unique'; message?: string }
	| { type: 'in'; values: unknown[]; message?: string }
	| { type: 'expression'; formula: string; message: string }
	| { type: 'required_if'; field: string; value: unknown; message?: string };

// ─── v0.7: Collection Action Types ─────────────────────────

export interface CollectionAction {
	name: string;
	label: string;
	type: 'single' | 'bulk';
	handler: string;
	confirm?: string;
	condition?: LinkageCondition;
	permission?: 'read' | 'write' | 'approve';
}

// ─── v0.7: Collection Notification Types ───────────────────

export interface CollectionNotification {
	event: 'create' | 'update' | 'delete' | 'status_change';
	status?: string;
	template: string;
	recipients: string[];
}

// ─── v0.7: Saved View Types ────────────────────────────────

export interface CollectionView {
	id: string;
	collection_slug: string;
	name: string;
	user_id: string;
	visibility: 'private' | 'public' | string;
	config: ViewConfig;
	created_at: string;
}

export interface ViewConfig {
	filter?: Array<{ field: string; op: string; value: unknown }>;
	sort?: string;
	columns?: string[];
	pageSize?: number;
	isDefault?: boolean;
}

// ─── v0.7: Schema Snapshot Types ───────────────────────────

export interface SchemaSnapshot {
	version: string;
	timestamp: string;
	checksum: string;
	collections: EntitySchema[];
	roles: RoleRecord[];
	permissions: RolePermissionRecord[];
	webhooks: WebhookRecord[];
	plugins: string[];
}

export interface SchemaDiff {
	collectionsAdded: EntitySchema[];
	collectionsRemoved: string[];
	collectionsModified: Array<{ slug: string; fieldChanges: FieldDiff[] }>;
	rolesAdded: string[];
	rolesRemoved: string[];
	permissionsChanged: Array<{ role_id: string; collection_slug: string; changes: string[] }>;
	summary: {
		totalChanges: number;
		breakingChanges: string[];
		safeToApply: boolean;
	};
}

export interface FieldDiff {
	field: string;
	change: 'added' | 'removed' | 'type_changed' | 'modified';
	oldValue?: unknown;
	newValue?: unknown;
}
