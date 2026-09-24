/**
 * Shared constants, types, and small helpers for the collection engine.
 *
 * Imported by the CollectionService facade and every collaborator
 * (SchemaService / ItemQueryService / ItemMutationService / RelationResolver /
 * CascadeService) so the public API surface stays in ONE place.
 */
import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { buildSystemColumnsList } from '@mmbix/core';
import type { FieldDefinition, SystemFieldOptions } from '@mmbix/types';
import type { FieldSelection } from '@/lib/api/query-parser';
import type { AuthContext } from '@/lib/services/auth.service';
import { DataFilterService, type DataFilterContext } from '@/lib/services/data-filter.service';
import { ForbiddenError } from '@mmbix/utils';

/** Execution context compatible with Hono's executionCtx */
export type ExecutionCtx = null | undefined | { executionCtx?: { waitUntil: (p: Promise<unknown>) => void } };

/** System columns stripped from schema field lists — never treated as user fields. */
export const SYSTEM_FIELD_NAMES = new Set([
	'id',
	'created_at',
	'updated_at',
	'doc_status',
	'display_number',
	'created_by',
	'updated_by',
	'_owner',
	'deleted_at',
	'deleted_by',
]);

/**
 * Order a field list so engine system fields always sit BELOW the user-defined
 * fields: `id` stays pinned first (primary key), then all user fields in their
 * stored relative order, then the remaining system fields. Preserves relative
 * order within each group, so freshly-created collections (already canonical)
 * are untouched while legacy schemas — where fields appended after the system
 * block left system fields stranded mid-list — come out healed on every read.
 */
export function systemFieldsLast<T extends { name?: string }>(fields: T[]): T[] {
	const system = new Set(SYSTEM_FIELD_NAMES);
	const idField = fields.find((f) => f.name === 'id');
	const rest = fields.filter((f) => f.name !== 'id');
	const userFields = rest.filter((f) => !f.name || !system.has(f.name));
	const systemFields = rest.filter((f) => !!f.name && system.has(f.name));
	return [...(idField ? [idField] : []), ...userFields, ...systemFields];
}

/**
 * System columns that store a reference to ANOTHER record (the acting user /
 * record owner), not business data. They behave like relation fields on the
 * wire: the column exists on the table and stays in the SQL SELECT (filters,
 * sorts, RBAC row filters and cursors still see it), but the JSON default
 * hides it unless the caller projects it explicitly.
 */
export const SYSTEM_REFERENCE_COLUMNS = new Set(['_owner', 'created_by', 'updated_by', 'deleted_by']);

/**
 * Cache-key namespace + full-row marker for INTERNAL entity reads that need the
 * raw row (idempotent-create replay, workflow guards/hooks). These project '*'
 * but must keep the relation FK columns and audit columns the public API hides,
 * and they must never share a cache entry with the public `?fields=*` read.
 */
export const FULL_ROW_READ_KEY = 'internal:full-row';

/**
 * Columns a wire payload must omit because they are OPT-IN references, not the
 * record's own data:
 *
 *  - the physical FK keys of schema relations — m2o FK columns, m2a
 *    `{name}_type` / `{name}_id` pairs — unless that relation is actually being
 *    expanded at this level (bare name in `columns`, an explicit dotted path in
 *    `relations`, or wildcard depth like `*.*`);
 *  - the system user-reference columns `_owner` / `created_by` / `updated_by` /
 *    `deleted_by` — unless explicitly named.
 *
 * This shapes BOTH the default lean read (no `?fields=`, no schema
 * `list_fields`) AND the bare `*` wildcard: `*` returns the record's own data
 * columns (+ virtual formulas), never relation keys. Relations and audit
 * columns come back only when named (`*,department`, `*,created_by`, …) or via
 * `*.*`-style relation expansion. The SQL SELECT keeps the columns (filters,
 * sorts, cursors, RBAC and CSV exports still see them) — this only shapes the
 * JSON payload. Virtual relations (o2m/m2m/table/formula) have no column and
 * never appear in a lean payload anyway.
 */
export function defaultLeanHiddenColumns(
	schemaFields: FieldDefinition[],
	systemFieldOptions: SystemFieldOptions,
	selection: FieldSelection | null = null,
): Set<string> {
	const hidden = new Set<string>();
	// A relation is visible at this level when it is being expanded (named bare,
	// named as a dotted path, or pulled in by wildcard depth) — mirror childOf().
	const expandingRelation = (name: string): boolean =>
		!!selection && (selection.relations.has(name) || selection.expandDepth > 0 || selection.columns.has(name));
	for (const f of schemaFields) {
		if (f.type === 'm2o') {
			if (!expandingRelation(f.name)) hidden.add(f.name);
		} else if (f.type === 'm2a' && !expandingRelation(f.name)) {
			hidden.add(`${f.name}_type`);
			hidden.add(`${f.name}_id`);
		}
	}
	for (const c of buildSystemColumnsList(systemFieldOptions)) {
		if (SYSTEM_REFERENCE_COLUMNS.has(c) && !selection?.columns.has(c)) hidden.add(c);
	}
	return hidden;
}

/** Config-driven state machine for a collection's status field (schema_json). */
export interface StatusMachineConfig {
	field: string;
	transitions: Record<string, string[]>;
}

export interface CollectionInfo {
	table_name: string;
	schemaFields: FieldDefinition[];
	naming_series: string | null;
	is_singleton?: boolean;
	systemFieldOptions: SystemFieldOptions;
	/** Schema-defined preview columns (schema_json.list_fields) — the default
	 *  list projection when the caller doesn't pass ?fields=. Optional. */
	listFields?: string[];
	/** Directus-style per-collection audit toggle — _audit_log rows are written
	 *  ONLY when true. Absent/false = no audit writes (the default). */
	audit_enabled?: boolean;
	/** How much state to materialize in the audit trail for this collection.
	 *  - 'full'  → store full snapshot_before/snapshot_after per change (legacy
	 *              default; write-amplified but read-agnostic).
	 *  - 'delta' → store ONLY the compact per-field delta (changes) and rely on
	 *              _field_audit lineage to reconstruct snapshots on demand. This
	 *              is the zero-waste mode — no 3× full-doc copies per write.
	 *  - 'none'  → no snapshots; history entries carry the delta fields only.
	 *  Absent/false audit_enabled still disables all audit writes. */
	snapshotMode?: 'full' | 'delta' | 'none';
	/** Composite (multi-column) DB indexes declared in schema_json.composite_indexes.
	 *  Created idempotently at table-create and backfilled for existing tables. */
	compositeIndexes?: { columns: string[] }[];
	/** Declarative status machine (schema_json.status_machine) — enforced on every
	 *  write to this collection, generically. Any collection can opt in; no plugin. */
	statusMachine?: StatusMachineConfig;
	/** Runtime feature policies (schema_json.policies) — enable/configure/dispose
	 *  engine behaviors per collection via REST, no code. Merged with env defaults
	 *  by the PolicyResolver. */
	policies?: CollectionPolicy;
}

/**
 * Runtime feature policies for a collection — the headless control plane.
 * Each engine subsystem (index, cache, audit, hooks, status-machine) reads its
 * merged policy here so a tenant can toggle/configure/dispose behavior via REST
 * without any code. Absent keys fall back to engine defaults.
 */
export interface CollectionPolicy {
	/** Self-tuning composite-index advisor behaviour. */
	auto_index?: {
		enabled?: boolean;
		/** 'auto' → applies DDL; 'propose' → recommends only (change-mgmt). */
		mode?: 'auto' | 'propose';
		/** Per-collection dynamic-index budget (defaults to engine cap). */
		max_dynamic?: number;
	};
	/** Response/data cache (readiness — wired once the layered cache lands). */
	cache?: {
		enabled?: boolean;
		ttl_s?: number;
		/** 'auto' lets the engine pick the layer by situation. */
		layer?: 'auto' | 'memory' | 'cache_api' | 'kv';
	};
	/** Client-side offline reads — may a device persist this collection's read
	 *  bodies? Deny by default: persisting rows on a device is a privacy decision
	 *  (logout/erasure cannot reach it), not an implicit consequence of deploy.
	 *  `max_age_s` bounds how long a persisted body may be served stale. */
	offline_reads?: {
		enabled?: boolean;
		max_age_s?: number;
	};
	/** _audit_log write toggle for this collection. */
	audit?: { enabled?: boolean };
	/** Server-hooks / declarative rules dispatch toggle. */
	hooks?: { enabled?: boolean };
	/**
	 * Who may mutate ROWS through the GENERIC entity API (POST/PUT/DELETE
	 * /api/entities/:slug). This never constrains the owning domain service, which
	 * writes through D1 directly — so 'service' means "not writable via REST".
	 *
	 * `mode: 'service'` locks a table whose only legitimate writer is a domain
	 * service (stock balances, serial units, trace/link tables), so a generic REST
	 * write can never move live state without appending its ledger event. This is
	 * what makes "the confirm service is the sole writer" an enforced invariant
	 * instead of a comment.
	 *
	 * `append_only` freezes a history/ledger table: generic update + delete +
	 * restore are rejected outright (rows can only be inserted).
	 */
	writes?: {
		mode?: 'any' | 'service';
		append_only?: boolean;
		/**
		 * Fields the generic entity API refuses to write (silently stripped on create
		 * and update) — workflow/state columns (`status`, `approved_by`, `executed_at`)
		 * that only the owning service may set. Without this a client with `write` on
		 * the collection could forge an approval by PUTting the state fields.
		 */
		frozen_fields?: string[];
		/**
		 * State-conditional immutability: while the row's `field` equals one of
		 * `values`, the generic entity API may not update/delete/restore it — only the
		 * owning service may. This is how a POSTED document becomes immutable without
		 * freezing its draft state (the ERP rule: you reverse, you never edit).
		 */
		freeze_when?: { field?: string; values?: string[] };
		/**
		 * Opt-in to the GENERIC `draft → confirmed` transition. `confirmed` is a
		 * posted state normally owned by a domain service (MRO stock docs), so the
		 * engine refuses it from the generic API by default. A plain record whose
		 * only "workflow" is edit → confirm (vehicle maintenance logs) sets this
		 * true; paired with `freeze_when` on doc_status=confirmed it yields a
		 * server-enforced one-way lock. Never set it on a service-owned document.
		 */
		confirmable?: boolean;
	};
	/**
	 * How the generic list read's `?search=` term matches (see SearchPolicy in
	 * @mmbix/core). `contains` = substring (default, unindexed); `prefix` = the
	 * index-backed type-ahead shape, scoped to `fields`. Deny-by-default: an empty
	 * policy is exactly today's substring behavior.
	 */
	search?: {
		mode?: 'contains' | 'prefix';
		fields?: string[];
	};
	/**
	 * Fields the engine stamps with the AUTHENTICATED employee (the session actor)
	 * on create — e.g. `["reported_by"]`, `["requested_by"]`. A client value is
	 * overridden, so a reporter/requester can never be forged and a two-person
	 * rule (`approver != reporter`) can never be defeated by naming someone else.
	 * On update the engine refuses to let a non-admin REASSIGN them. An admin (or
	 * the dev-token path) keeps explicit control — the trusted-root escape hatch.
	 */
	actor_fields?: string[];
}

export interface ItemListResult {
	data: Record<string, unknown>[];
	meta: Record<string, unknown>;
}

// ─── Valid Field Types ─────────────────────────────────
// Canonical 40-type list lives in @mmbix/utils — re-exported so collaborators
// keep importing from the shared surface (single source of truth).
export { VALID_FIELD_TYPES } from '@mmbix/utils';

// ─── RBAC row-filter helpers ───────────────────────────

/** Build the row-filter context for a collection (null when anonymous). */
export function getFilterContext(db: D1Client, auth: AuthContext | null, collectionSlug: string): DataFilterContext | null {
	if (!auth) return null;
	return { db, auth, collectionSlug };
}

/**
 * RBAC row-filter check — a record is only accessible if it passes the
 * caller's role row filter (owners see only their rows, etc.). Admins and
 * roles without a row filter always pass. Used for read-by-id and every
 * write path (update/delete/restore) so row security cannot be bypassed.
 */
export async function checkRowFilterAccess(
	db: D1Client,
	auth: AuthContext | null,
	collectionSlug: string,
	tableName: string,
	id: string,
): Promise<void> {
	if (!auth || auth.is_admin) return;
	const ctx = getFilterContext(db, auth, collectionSlug);
	if (!ctx) return;
	const qb = QueryBuilder.from(tableName).select('id').where('id', id);
	await DataFilterService.applyRowFilter(qb, ctx);
	const row = await db.first<{ id: string }>(qb.toSelect());
	if (!row) throw new ForbiddenError('You do not have access to this record');
}

/** Stable per-session identity for response-cache keys (never the raw JWT). */
export function authFingerprint(auth: AuthContext | null): string {
	if (!auth) return 'anon';
	return auth.user_id || auth.email || 'anon';
}
