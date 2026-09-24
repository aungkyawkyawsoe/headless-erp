/**
 * CMS Field Utilities — Enterprise Edition
 *
 * Adds support for:
 *   - Soft delete (deleted_at column)
 *   - DocStatus (draft → submitted → approved → cancelled, or draft → confirmed)
 *   - Display number (auto-generated document IDs)
 *   - M2M junction table awareness
 *   - Formula fields (computed, no physical column)
 */

import type { FieldDefinition, FieldType, DocStatus, SystemFieldOptions } from '@mmbix/types';
import { DEFAULT_SYSTEM_FIELDS, SYSTEM_FIELDS } from '@mmbix/types';
import type { TableBuilder } from '../db/schema-builder';
import { sanitizeIdentifier, sanitizeHtml, UUID_V4_RE } from '@mmbix/utils';
import { ValidationError } from '@mmbix/utils';
import { formulaResultType } from './computed';

// ─── Type Mapping ───────────────────────────────────────

const FIELD_TYPE_MAP: Record<FieldType, (t: TableBuilder, name: string) => void> = {
	text: (t, n) => t.text(n),
	integer: (t, n) => t.integer(n),
	number: (t, n) => t.real(n),
	boolean: (t, n) => t.boolean(n),
	timestamp: (t, n) => t.timestamp(n),
	json: (t, n) => t.json(n),
	slug: (t, n) => t.text(n),
	m2o: (t, n) => {
		t.text(n);
		t.nullable();
	},
	o2m: (_t, _n) => {},
	m2m: (_t, _n) => {},
	table: (_t, _n) => {}, // Child table — no column on parent
	file: (t, n) => {
		t.text(n);
		t.nullable();
	},
	image: (t, n) => {
		t.text(n);
		t.nullable();
	},
	currency: (t, n) => t.real(n),
	percent: (t, n) => t.real(n),
	select: (t, n) => t.text(n),
	color: (t, n) => t.text(n),
	password: (t, n) => t.text(n),
	location: (t, n) => t.json(n),
	longtext: (t, n) => {
		t.text(n);
		t.nullable();
	},
	rating: (t, n) => t.real(n),
	bigint: (t, n) => t.integer(n),
	csv: (t, n) => t.json(n),
	uuid: (t, n) => t.text(n),
	m2a: (t, n) => {
		t.text(n + '_type');
		t.nullable();
		t.text(n + '_id');
		t.nullable();
	},
	formula: (_t, _n) => {}, // No physical column — computed at query time
	text_editor: (t, n) => {
		t.text(n);
		t.nullable();
	},
	code: (t, n) => {
		t.text(n);
		t.nullable();
	},
	markdown: (t, n) => {
		t.text(n);
		t.nullable();
	},
	signature: (t, n) => {
		t.text(n);
		t.nullable();
	},
	duration: (t, n) => t.integer(n),
	barcode: (t, n) => {
		t.text(n);
		t.nullable();
	},
	time: (t, n) => t.text(n),
	date: (t, n) => t.date(n), // TEXT (ISO 8601 date, no time) — mirrors datetime's TEXT storage
	datetime: (t, n) => t.timestamp(n),
	phone: (t, n) => {
		t.text(n);
		t.nullable();
	},
	email: (t, n) => {
		t.text(n);
		t.nullable();
	},
	url: (t, n) => {
		t.text(n);
		t.nullable();
	},
	icon: (t, n) => {
		t.text(n);
		t.nullable();
	},
	tags: (t, n) => t.json(n),
	progress: (t, n) => t.integer(n),
};

// ─── Table Column Builder ───────────────────────────────

export function applyFieldDefinitions(
	t: TableBuilder,
	fields: FieldDefinition[],
	withSystemColumns: boolean | SystemFieldOptions = true,
): void {
	for (const field of fields) {
		const columnName = sanitizeIdentifier(field.name, `field.${field.name}`);
		if (field.type === 'formula' && field.store) {
			// Stored computed field — a REAL column typed by result_type. Always
			// nullable: the engine writes it on every create/update (never NOT
			// NULL, so pre-existing rows without a backfill stay readable).
			const rt = formulaResultType(field);
			if (rt === 'boolean') t.integer(columnName);
			else if (rt === 'number') t.real(columnName);
			else t.text(columnName);
			t.nullable();
		} else {
			const builder = FIELD_TYPE_MAP[field.type];
			if (!builder) throw new Error(`Unsupported field type: "${field.type}" for field "${field.name}"`);
			builder(t, columnName);
			if (field.required === false) t.nullable();
			if (field.default !== undefined) {
				const val = field.default;
				if (typeof val === 'string') t.default(val);
				else if (typeof val === 'number') t.default(val);
				else if (typeof val === 'boolean') t.default(val ? 1 : 0);
			}
		}
		if (field.index) t.index();
		if (field.unique) t.unique();
	}
	if (withSystemColumns) {
		applySystemColumns(t, typeof withSystemColumns === 'object' ? withSystemColumns : undefined);
	}
}

// ─── System Columns ─────────────────────────────────────

export function applySystemColumns(t: TableBuilder, opts?: SystemFieldOptions): void {
	// NOTE: `id` is a system column too, but it is added by the caller
	// (e.g. createCollection does `t.uuid('id')` before this runs) so it is
	// NOT re-created here — adding it would produce duplicate-column DDL.
	// buildSystemColumnsList includes it because every table has it.
	const o = { ...DEFAULT_SYSTEM_FIELDS, ...opts };
	if (o.doc_status) t.text('doc_status').default('draft');
	if (o.display_number) t.text('display_number').nullable();
	if (o._owner) t.text('_owner').nullable();
	if (o.deleted_at) t.text('deleted_at').nullable();
	if (o.deleted_by) t.text('deleted_by').nullable();
	t.text('_meta').nullable();
	if (o.created_by) t.text('created_by').nullable();
	if (o.updated_by) t.text('updated_by').nullable();
	t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
	t.timestamp('updated_at').defaultRaw('CURRENT_TIMESTAMP');
}

// ─── Data Splitting ─────────────────────────────────────

/**
 * Field types with NO column of their own name: o2m/m2m/table are always
 * virtual; formula is virtual unless store:true (stored computed fields own a
 * real column — see isVirtualField). m2a stores its payload in `{name}_type` /
 * `{name}_id` columns instead (never its own name).
 */
export const VIRTUAL_FIELD_TYPES: ReadonlySet<string> = new Set(['o2m', 'm2m', 'table']);

/** True when the field has no physical column of its own name. */
export function isVirtualField(field: FieldDefinition): boolean {
	if (field.type === 'formula') return !field.store;
	return VIRTUAL_FIELD_TYPES.has(field.type);
}

/**
 * Map schema fields to the physical column names they occupy on the table.
 *
 * - o2m / m2m / table / formula → no column (excluded)
 * - m2a → expands to `{name}_type` + `{name}_id`
 * - everything else → the field name itself
 *
 * Use this when building SELECT lists so virtual relation fields never
 * produce "no such column" SQL errors.
 */
export function physicalColumnNames(fields: FieldDefinition[]): string[] {
	const cols: string[] = [];
	for (const f of fields) {
		if (isVirtualField(f)) continue;
		if (f.type === 'm2a') {
			cols.push(`${f.name}_type`, `${f.name}_id`);
			continue;
		}
		cols.push(f.name);
	}
	return cols;
}

export function buildSystemColumnsList(opts?: SystemFieldOptions): string[] {
	// Canonical system-column set (used for SELECT lists): `id` is always
	// present (caller-added, see applySystemColumns), `_meta`/`created_at`/
	// `updated_at` are unconditional, the rest follow SystemFieldOptions.
	const o = { ...DEFAULT_SYSTEM_FIELDS, ...opts };
	const cols = ['id', '_meta', 'created_at', 'updated_at'];
	if (o.doc_status) cols.push('doc_status');
	if (o.display_number) cols.push('display_number');
	if (o._owner) cols.push('_owner');
	if (o.deleted_at) cols.push('deleted_at');
	if (o.created_by) cols.push('created_by');
	if (o.updated_by) cols.push('updated_by');
	if (o.deleted_by) cols.push('deleted_by');
	return cols;
}

// Re-export for backward compatibility; canonical source is types/entity.ts
export const SYSTEM_COLUMNS = SYSTEM_FIELDS;

export function splitRowData(
	body: Record<string, unknown>,
	schemaFields: FieldDefinition[],
): { columns: Record<string, unknown>; meta: Record<string, unknown> } {
	const schemaNames = new Set(schemaFields.map((f) => f.name));
	const schemaTypeMap = new Map(schemaFields.map((f) => [f.name, f.type]));
	const columns: Record<string, unknown> = {};
	const meta: Record<string, unknown> = {};

	// Build m2a field column names for recognition
	const m2aColumns = new Set<string>();
	for (const f of schemaFields) {
		if (f.type === 'm2a') {
			m2aColumns.add(`${f.name}_type`);
			m2aColumns.add(`${f.name}_id`);
		}
	}

	for (const [key, value] of Object.entries(body)) {
		if (SYSTEM_COLUMNS.has(key)) continue;
		if (schemaNames.has(key)) {
			const fieldType = schemaTypeMap.get(key) as FieldType;
			if (fieldType === 'o2m' || fieldType === 'm2m' || fieldType === 'table' || fieldType === 'formula') continue;
			columns[key] = coerceValue(value, fieldType);
			// Rich text is rendered with dangerouslySetInnerHTML on the client — the
			// sanitizer is the trust boundary, so it runs here (create + update + import).
			if (fieldType === 'text_editor' || fieldType === 'markdown') {
				columns[key] = sanitizeHtml(columns[key]);
			}
		} else if (m2aColumns.has(key)) {
			// M2A columns: {field}_type and {field}_id are real columns
			columns[key] = value;
		} else {
			meta[key] = value;
		}
	}

	for (const field of schemaFields) {
		if (field.type === 'slug' && !(field.name in body) && field.source && columns[field.source]) {
			const sourceVal = String(columns[field.source]);
			columns[field.name] = sourceVal
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '')
				.substring(0, 200);
		}
		// Auto-generate UUID for uuid fields when no value is provided
		if (field.type === 'uuid' && !(field.name in columns)) {
			columns[field.name] = crypto.randomUUID();
		}
	}

	const result: Record<string, unknown> = {};
	if (Object.keys(columns).length > 0) Object.assign(result, columns);
	if (Object.keys(meta).length > 0) result._meta = JSON.stringify(meta);
	else result._meta = '{}';

	return { columns: result, meta };
}

// ─── Data Merging ───────────────────────────────────────

export function mergeRowData(dbRow: Record<string, unknown>): Record<string, unknown> {
	if (!dbRow) return {};
	const { _meta, ...rest } = dbRow as Record<string, unknown>;
	if (typeof _meta === 'string' && _meta.length > 2) {
		try {
			const parsed = JSON.parse(_meta) as Record<string, unknown>;
			// Physical row columns ALWAYS win over stale _meta keys: after schema
			// evolution a leftover _meta key could otherwise shadow a real column.
			return { ...parsed, ...rest };
		} catch (err) {
			console.warn('[mergeRowData] failed to parse _meta', err instanceof Error ? err.message : String(err));
		}
	}
	return rest;
}

/**
 * Decode D1 storage values back into API wire values for a page of rows:
 *
 *  - `json` fields: TEXT column holding JSON.stringify output → parsed value.
 *    JSON fields are stringified on write (coerceValue) because D1 has no
 *    native JSON column; without this read-side decode every /api/entities
 *    response would leak the raw string (e.g. superiors: "[{\"tg_id\":…}]").
 *  - `boolean` fields (and stored boolean formulas): stored INTEGER 1/0 → real
 *    `true`/`false`. Booleans are persisted as 1/0 because D1 has no native
 *    boolean column; they must be un-boxed on read or every entity response
 *    leaks the storage integer (`"active": 1` instead of `true`).
 *
 * Non-parseable strings (corrupt rows, values that were never JSON) and
 * already-decoded values pass through untouched — decoding must never fail a read.
 */
export function decodeJsonFields(
	rows: Record<string, unknown>[],
	fields: Array<{ name: string; type: string; result_type?: string }>,
): Record<string, unknown>[] {
	const jsonFields = fields.filter((f) => f.type === 'json').map((f) => f.name);
	// Stored boolean formulas (type 'formula' + store:true) type their INTEGER
	// column via result_type — coerce those too. Virtual formulas never reach
	// D1 storage, so they are intentionally not listed here.
	const booleanFields = fields
		.filter((f) => f.type === 'boolean' || (f.type === 'formula' && f.result_type === 'boolean'))
		.map((f) => f.name);
	if (jsonFields.length === 0 && booleanFields.length === 0) return rows;
	for (const row of rows) {
		for (const name of jsonFields) {
			const v = row[name];
			if (typeof v === 'string' && v.length > 0) {
				const c = v[0];
				if (c === '{' || c === '[' || c === '"') {
					try {
						row[name] = JSON.parse(v) as unknown;
					} catch {
						// leave the raw value in place — never fail a read over bad data
					}
				}
			}
		}
		for (const name of booleanFields) {
			const v = row[name];
			if (typeof v === 'boolean') continue;
			if (v === 1 || v === '1' || v === 'true') row[name] = true;
			else if (v === 0 || v === '0' || v === 'false') row[name] = false;
		}
	}
	return rows;
}

// ─── Value Coercion ─────────────────────────────────────

/**
 * Coerce a raw input value to the storage representation for a field type.
 * Booleans store as INTEGER 1/0; numeric strings are parsed (and floored for
 * integer fields); non-numeric garbage coerces to 0 — the `required`
 * validation layer is what reports real errors.
 */
export function coerceValue(value: unknown, fieldType: FieldType): unknown {
	if (value === null || value === undefined) return null;
	switch (fieldType) {
		case 'integer': {
			// Parse numeric strings too ("12.7" → 12); anything non-numeric → 0.
			const num = typeof value === 'number' ? value : Number(value);
			return Number.isNaN(num) ? 0 : Math.floor(num);
		}
		case 'number': {
			const numVal = typeof value === 'number' ? value : Number(value);
			if (Number.isNaN(numVal)) throw new ValidationError(`Invalid number value: "${String(value)}"`);
			return numVal;
		}
		case 'boolean': {
			// Accept true/false/1/0/'true'/'false'/'1'/'0' (case-insensitive); everything else → 0.
			if (typeof value === 'boolean') return value ? 1 : 0;
			if (value === 1) return 1;
			if (value === 0) return 0;
			const s = String(value).trim().toLowerCase();
			if (s === 'true' || s === '1') return 1;
			return 0; // includes 'false', '0', and anything unrecognized
		}
		case 'json':
			return typeof value === 'string' ? value : JSON.stringify(value);
		case 'uuid': {
			const raw = String(value);
			if (!UUID_V4_RE.test(raw)) throw new ValidationError(`Invalid UUID value: "${raw}"`);
			return raw;
		}
		case 'm2o': {
			const raw = String(value);
			if (!UUID_V4_RE.test(raw)) throw new ValidationError(`Invalid m2o foreign key UUID: "${raw}"`);
			return raw;
		}
		default:
			return String(value);
	}
}

// ─── DocStatus Helpers ──────────────────────────────────

const VALID_DOC_STATUSES = new Set(['draft', 'submitted', 'approved', 'cancelled', 'confirmed', 'pending_review', 'rejected']);

export function isValidDocStatus(status: string): status is DocStatus {
	if (VALID_DOC_STATUSES.has(status)) return true;
	if (/^approved_l\d+$/.test(status)) return true;
	return false;
}

/**
 * Check if a docstatus transition is valid.
 * Core rules:
 *   draft → submitted | cancelled | pending_review
 *   submitted → approved | cancelled
 *   approved → cancelled
 *   confirmed → (terminal — a posted document is frozen by `writes.freeze_when`,
 *               never rewritten; a domain service reverses it out of band)
 *   cancelled → draft (reopen)
 *   pending_review → approved | rejected | cancelled | approved_l1
 *   rejected → draft | cancelled
 * Approval levels (multi-level workflow, see apps/api/src/plugins/approvals):
 *   approved_l{n} → approved_l{m} (m > n) | approved | rejected | cancelled
 *
 * `confirmed` is deliberately NOT reachable generically by default: it is the
 * posted state a domain service owns (MRO stock documents), and a plain REST
 * write must never forge one. A collection that genuinely wants the simple
 * "confirm this draft" flow opts in with `policies.writes.confirmable` — the
 * mutation service then passes `allowConfirmed` (see ItemMutationService).
 */
const VALID_TRANSITIONS: Partial<Record<DocStatus, DocStatus[]>> = {
	draft: ['submitted', 'cancelled', 'pending_review'],
	submitted: ['approved', 'cancelled'],
	approved: ['cancelled'],
	confirmed: [],
	cancelled: ['draft'],
	pending_review: ['approved', 'rejected', 'cancelled', 'approved_l1'],
	rejected: ['draft', 'cancelled'],
};

export interface TransitionOptions {
	/** Permit `draft → confirmed` for a collection that opted into the generic
	 *  confirm flow (`policies.writes.confirmable`). Never set this for a
	 *  service-owned posted document (that state is the service's to write). */
	allowConfirmed?: boolean;
}

export function isValidTransition(from: DocStatus, to: DocStatus, options?: TransitionOptions): boolean {
	if (options?.allowConfirmed && from === 'draft' && to === 'confirmed') return true;
	// approval-level states are dynamic (approved_l{n}) so they can't live in
	// the static map: approve at level n+1, or finish/abort the workflow.
	const fromMatch = /^approved_l(\d+)$/.exec(from);
	if (fromMatch) {
		if (to === 'approved' || to === 'rejected' || to === 'cancelled') return true;
		const toMatch = /^approved_l(\d+)$/.exec(to);
		if (toMatch) return Number(toMatch[1]) > Number(fromMatch[1]);
		return false;
	}
	return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
