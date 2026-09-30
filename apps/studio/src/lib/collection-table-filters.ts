/**
 * Generic collection-table filters for the Studio workbench.
 *
 * Turns any collection's schema fields into the design-system DataTable's
 * `filter` metadata and serializes the popover's rich filters into the backend
 * entity-list query params (`filter[field][_op]=…`).
 *
 * Field types are mapped by schema type ONLY — no per-collection/table logic:
 *  - text-ish      → contains filters
 *  - select        → option dropdown (field.options)
 *  - numeric       → equals / comparisons / between
 *  - boolean       → true/false picker (serialized 1/0 — SQLite stores INTEGER)
 *  - date          → date picker
 *  - datetime/timestamp → date picker serialized via `filter[date(field)][_op]`
 *                         so a picked day covers the whole stored day
 *  - m2o           → the real m2o column gets a filter typed by the related row's
 *                    display field (`filter[department.name][_icontains]=…`)
 *
 * Virtual/array relations (o2m/m2m/m2a/table), media, password, encrypted and
 * virtual formulas are deliberately excluded — the generic backend list API
 * either cannot filter them or the filter would be meaningless.
 */

import { useMemo, type ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { ActiveFilter, ColumnDef, ColumnMenuOption, FilterDef } from '@mmbix/design-system/datatable';
import { M2O_DISPLAY_FIELDS } from './record-label';
import { selectableDisplayFields } from './relation-display';
import type { EntityListFilter, EntitySchema, FieldDefinition } from './api';
import { collectionQuery } from './queries';

// ── Types ────────────────────────────────────────────────────────────────

type DsFilterType = NonNullable<FilterDef['type']>;
type DsOperator = NonNullable<FilterDef['operator']>;

/** What the backend stores for a field / a related display leaf. */
interface FilterableField {
	/** The schema type that drives value handling (formulas report result_type). */
	rawType: string;
	dsType: Extract<DsFilterType, 'text' | 'select' | 'number' | 'boolean' | 'date'>;
	defaultOperator: DsOperator;
	options?: FilterDef['options'];
	/** datetime/timestamp → date(field) function filter for day-granular matching. */
	dateFn?: boolean;
}

export interface FilterFieldMeta {
	/** Design-system filter id (== backend query path for m2o leaves). */
	id: string;
	/** Backend path — scalar field name or `relation.leaf`. */
	path: string;
	/** Column used for is-empty / is-not-empty (the m2o FK for relation leaves). */
	nullPath: string;
	rawType: string;
	dateFn: boolean;
}

export interface BuildColumnsOptions {
	/** Names hidden from the table by default. System fields can still be filtered. */
	systemFieldNames?: ReadonlySet<string>;
	/** Cell renderer (e.g. DataCell / InlineCellEditor). `row` is the record's
	 *  `original` — the inline editor needs its id to persist an edit; `displayLeaf`
	 *  is the related field this relation column displays (the picker's choice).
	 *  Omit for the DataTable's raw cell rendering. */
	renderCell?: (field: FieldDefinition, value: unknown, row: Record<string, unknown>, displayLeaf?: FieldDefinition) => ReactNode;
	/** relation field name → the related field it was explicitly set to display. */
	displayLeaves?: Record<string, string>;
	/** Receives a display-field pick (`null` = back to automatic). */
	onPickDisplayLeaf?: (fieldName: string, leaf: string | null) => void;
}

// ── Field-type sets ──────────────────────────────────────────────────────

const TEXT_LIKE = new Set([
	'text',
	'longtext',
	'text_editor',
	'markdown',
	'code',
	'slug',
	'phone',
	'email',
	'url',
	'icon',
	'barcode',
	'csv',
	'tags',
	'color',
	'time',
]);

const NUMERIC = new Set(['integer', 'number', 'bigint', 'currency', 'percent', 'rating', 'duration', 'progress']);

/** System user-reference columns hold raw UUIDs — not useful in a filter list. */
const SYSTEM_REFERENCE_FIELDS = new Set(['_owner', 'created_by', 'updated_by', 'deleted_by']);

// ── Options normalization ────────────────────────────────────────────────

/** Studio options are plain strings or { label, value } objects (values may be non-string). */
function normalizeSelectOptions(options: FieldDefinition['options']): NonNullable<FilterDef['options']> {
	return (options ?? []).map((opt) => {
		const o = typeof opt === 'object' ? opt : { label: opt, value: opt };
		const value = o.value !== undefined && o.value !== null ? String(o.value) : o.label !== undefined ? String(o.label) : '';
		const label = o.label !== undefined && o.label !== null ? String(o.label) : value;
		return { label, value };
	});
}

// ── Type mapping ─────────────────────────────────────────────────────────

/** Schema type that drives filtering for a formula (stored formulas only). */
function effectiveType(field: FieldDefinition): string {
	if (field.type === 'formula') return field.result_type ?? 'number';
	return field.type;
}

/** Map a physical/filterable schema field to DS filter behavior, or null. */
function filterableField(field: FieldDefinition): FilterableField | null {
	// Computed values only exist as a column when stored.
	if (field.type === 'formula' && field.store !== true) return null;
	if (field.encrypted === true || SYSTEM_REFERENCE_FIELDS.has(field.name)) return null;

	const type = effectiveType(field);
	let result: Omit<FilterableField, 'rawType'> | null = null;

	if (type === 'select') {
		result = { dsType: 'select', defaultOperator: 'equals', options: normalizeSelectOptions(field.options) };
	} else if (type === 'boolean') {
		result = { dsType: 'boolean', defaultOperator: 'equals' };
	} else if (NUMERIC.has(type)) {
		result = { dsType: 'number', defaultOperator: 'equals' };
	} else if (type === 'date') {
		result = { dsType: 'date', defaultOperator: 'equals' };
	} else if (type === 'datetime' || type === 'timestamp') {
		result = { dsType: 'date', defaultOperator: 'equals', dateFn: true };
	} else if (type === 'uuid') {
		result = { dsType: 'text', defaultOperator: 'equals' };
	} else if (TEXT_LIKE.has(type)) {
		result = { dsType: 'text', defaultOperator: 'contains' };
	}

	if (!result) return null;
	return { ...result, rawType: type };
}

function filterDefFor(field: FilterableField, id: string, label: string): FilterDef {
	return {
		id,
		label,
		type: field.dsType,
		operator: field.defaultOperator,
		...(field.options ? { options: field.options } : {}),
	};
}

// ── m2o display-leaf resolution ────────────────────────────────

/** `{{name}}` / `{{ a.b }}` tokens from an m2o display template (simple keys only). */
function templateFieldNames(template: string | undefined): string[] {
	if (!template) return [];
	const out: string[] = [];
	const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(template))) {
		const key = m[1].trim();
		// Dotted template tokens ({{a.b}}) imply a deeper relation — skip in v1.
		if (key && !key.includes('.')) out.push(key);
	}
	return out;
}

/**
 * Pick the related row field a relation column DISPLAYS — used as the cell label,
 * the nested `?fields=` projection and the nested filter leaf
 * (`filter[department.name][_icontains]=…`).
 *
 * `picked` is the operator's choice from the header menu's Columns picker: it wins
 * outright when the related collection still has that field (a stale pick — the
 * related field was renamed/removed — falls through to automatic, so the column
 * never goes blank because of a choice the schema can no longer satisfy).
 * Automatic prefers display_template fields, then the conventional display
 * columns; only falls back to `id` when nothing readable exists.
 */
export function displayLeafField(relationField: FieldDefinition, related: EntitySchema, picked?: string): FieldDefinition | null {
	const fields = related.schema_json.fields ?? [];
	const byName = new Map(fields.map((f) => [f.name, f]));

	if (picked) {
		const chosen = byName.get(picked);
		if (chosen) return chosen;
	}

	const templateFields = templateFieldNames(relationField.display_template).filter((n) => n !== 'id');
	const candidates = [
		// Preferred: whatever the display_template resolves to.
		...templateFields.filter((n) => byName.has(n)),
		// Fallback: the same display columns record-label.ts uses for table cells.
		...M2O_DISPLAY_FIELDS,
	];
	for (const name of candidates) {
		const leaf = byName.get(name);
		// Only a leaf the engine can actually filter on is usable.
		if (leaf && filterableField(leaf)) return leaf;
	}
	// No human-readable display column — fall back to the relation's own id.
	for (const name of templateFieldNames(relationField.display_template)) {
		const leaf = byName.get(name);
		if (leaf && name === 'id' && filterableField(leaf)) return leaf;
	}
	return null;
}

/** relation field name → the related field it displays, for the relation fields
 *  whose target schema has loaded. */
export function relationLeafMap(
	fields: FieldDefinition[],
	m2oSchemas: Record<string, EntitySchema>,
	picks?: Record<string, string>,
): Map<string, FieldDefinition> {
	const out = new Map<string, FieldDefinition>();
	for (const f of fields) {
		if (f.type !== 'm2o' || !f.related_collection) continue;
		const related = m2oSchemas[f.related_collection];
		if (!related) continue;
		const leaf = displayLeafField(f, related, picks?.[f.name]);
		if (leaf) out.set(f.name, leaf);
	}
	return out;
}

// ── Related schema loading hook ──────────────────────────────────────────
// ── Related schema loading hooks ─────────────────────────────

/**
 * Every m2o target's schema, through the app's query cache.
 *
 * `useQueries` gives each related collection its own `collectionQuery` entry:
 * already-cached targets resolve synchronously, the rest fetch in parallel, and
 * because the key is shared with the focused-schema query, a target the user has
 * already opened costs ZERO requests. A schema write invalidates the entry (see
 * `invalidateCollection`), so no hand-rolled cache is needed. (This used to take
 * a `knownSchemas` map + a manual reset effect; the query cache IS that map now.)
 */
export function useM2oSchemas(token: string, fields: FieldDefinition[]): Record<string, EntitySchema> {
	const relatedSlugs = useMemo(() => {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const f of fields) {
			if (f.type !== 'm2o' || !f.related_collection) continue;
			if (seen.has(f.related_collection)) continue;
			seen.add(f.related_collection);
			out.push(f.related_collection);
		}
		return out;
	}, [fields]);

	const results = useQueries({ queries: relatedSlugs.map((slug) => collectionQuery(token, slug)) });

	// Rebuild only when a related schema actually (re)loads — a new object every
	// render would recompute every dependent column memo (the old refetch cascade).
	const version = results.map((r) => (r.data ? `${r.dataUpdatedAt}` : '0')).join('|');
	return useMemo(() => {
		const out: Record<string, EntitySchema> = {};
		results.forEach((r, i) => {
			if (r.data) out[relatedSlugs[i]] = r.data;
		});
		return out;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [relatedSlugs, version]);
}

/**
 * ONE related collection's schema (same cache entry as the focused view) — for
 * editors that need the target's own fields, e.g. the relation "Display field"
 * dropdown. A schema already loaded elsewhere resolves instantly.
 */
export function useRelatedSchema(token: string, slug: string | undefined | null): EntitySchema | null {
	return useQuery(collectionQuery(token, slug)).data ?? null;
}

// ── Column building ──────────────────────────────────────────────────────

/**
 * Build the DataTable column definitions for a collection, attaching typed
 * `filter` metadata to every meaningful field. m2o columns filter on their
 * related row's display field; the filter sits on the REAL column and only the
 * serialization map targets the nested leaf (see buildFilterFieldMap).
 */
/**
 * The Columns-list choices a relation column offers: back to automatic first,
 * then every field of the related collection a cell can state.
 */
function displayFieldOptions(
	relationField: FieldDefinition,
	related: EntitySchema,
	picked: string | undefined,
	onPick: (fieldName: string, leaf: string | null) => void,
): ColumnMenuOption[] {
	// Named in the "Default" entry so the operator sees what clearing a pick falls
	// back to — the automatic rule is otherwise invisible.
	const automatic = displayLeafField(relationField, related);
	return [
		{
			id: '',
			label: automatic ? `Default (${automatic.name})` : 'Default (automatic)',
			selected: !picked,
			onSelect: () => onPick(relationField.name, null),
		},
		...selectableDisplayFields(related.schema_json.fields ?? []).map((leaf) => ({
			id: leaf.name,
			label: leaf.label || leaf.name,
			selected: picked === leaf.name,
			onSelect: () => onPick(relationField.name, leaf.name),
		})),
	];
}

export function buildTableColumns(
	fields: FieldDefinition[],
	m2oSchemas: Record<string, EntitySchema>,
	options: BuildColumnsOptions = {},
): ColumnDef<Record<string, unknown>>[] {
	const { systemFieldNames, renderCell, displayLeaves, onPickDisplayLeaf } = options;
	const columns: ColumnDef<Record<string, unknown>>[] = [];

	for (const f of fields) {
		const visible = !(systemFieldNames?.has(f.name) ?? false);

		// An m2o column filters on its related row's display field; the display leaf
		// is resolved from the related schema (fetching lazily in useM2oSchemas). The
		// filter metadata therefore appears on the REAL column once the leaf is known.
		let kind = filterableField(f);
		let leaf: FieldDefinition | null = null;
		let related: EntitySchema | undefined;
		const pickedName = displayLeaves?.[f.name];
		if (f.type === 'm2o' && f.related_collection) {
			related = m2oSchemas[f.related_collection];
			leaf = related ? displayLeafField(f, related, pickedName) : null;
			kind = leaf ? filterableField(leaf) : null;
		}
		// A pick the related schema no longer satisfies fell back to automatic — the
		// menu must show THAT (nothing is checked on a dangling choice) and, when the
		// operator picks again, the new choice replaces it.
		const pickApplied = pickedName && leaf?.name === pickedName ? pickedName : undefined;
		const menuOptions = leaf && related && onPickDisplayLeaf ? displayFieldOptions(f, related, pickApplied, onPickDisplayLeaf) : undefined;

		columns.push({
			id: f.name,
			accessorKey: f.name,
			header: f.label || f.name,
			enableSorting: true,
			defaultVisible: visible,
			...(menuOptions ? { menuOptions } : {}),
			...(renderCell ? { cell: ({ value, row }) => renderCell(f, value, row.original, leaf ?? undefined) } : {}),
			...(kind ? { filter: filterDefFor(kind, f.name, f.label || f.name) } : {}),
		});
	}

	return columns;
}

// ── Filter serialization ─────────────────────────────────────────────────

const OP_TO_BACKEND: Record<DsOperator, string> = {
	equals: '_eq',
	'not-equals': '_neq',
	contains: '_icontains',
	'not-contains': '_ncontains',
	'starts-with': '_startswith',
	'ends-with': '_endswith',
	gt: '_gt',
	gte: '_gte',
	lt: '_lt',
	lte: '_lte',
	between: '_between',
	in: '_in',
	'not-in': '_nin',
	'is-empty': '_null',
	'is-not-empty': '_nnull',
};

function filterFieldMeta(field: FieldDefinition, kind: FilterableField, path = field.name, nullPath = field.name): FilterFieldMeta {
	return {
		id: path,
		path,
		nullPath,
		rawType: kind.rawType,
		// date(field) is only expressible on a plain column, never a dotted relation path.
		dateFn: !!kind.dateFn && !path.includes('.'),
	};
}

/** id → backend target metadata for every filterable field in the schema. */
export function buildFilterFieldMap(
	fields: FieldDefinition[],
	m2oSchemas: Record<string, EntitySchema>,
	picks?: Record<string, string>,
): Map<string, FilterFieldMeta> {
	const meta = new Map<string, FilterFieldMeta>();

	for (const f of fields) {
		// m2o columns get ONE filter entry (the column itself) whose backend target
		// is the related display field — `filter[department.name][_icontains]=…`.
		if (f.type === 'm2o' && f.related_collection) {
			const related = m2oSchemas[f.related_collection];
			const leaf = related ? displayLeafField(f, related, picks?.[f.name]) : null;
			if (!leaf) continue;
			const leafKind = filterableField(leaf);
			if (!leafKind) continue;
			const path = `${f.name}.${leaf.name}`;
			// meta.id == f.name so the popover's ActiveFilter maps to the real column;
			// meta.path carries the nested backend target, nullPath the FK for empty checks.
			meta.set(f.name, filterFieldMeta(leaf, leafKind, path, f.name));
			continue;
		}

		const kind = filterableField(f);
		if (kind) meta.set(f.name, filterFieldMeta(f, kind));
	}

	return meta;
}

/**
 * Translate DataTable rich filters to backend entity filters. Unknown filter ids
 * (stale UI state after a schema change) are dropped instead of erroring the list.
 */
export function serializeTableFilters(
	filters: ActiveFilter[],
	fields: FieldDefinition[],
	m2oSchemas: Record<string, EntitySchema>,
	picks?: Record<string, string>,
): Record<string, EntityListFilter> | undefined {
	if (filters.length === 0) return undefined;
	const metaById = buildFilterFieldMap(fields, m2oSchemas, picks);
	const out: Record<string, EntityListFilter> = {};

	for (const filter of filters) {
		const meta = metaById.get(filter.id);
		if (!meta) continue;

		// is-empty / is-not-empty act on the nullable column itself (m2o FK or scalar).
		if (filter.operator === 'is-empty' || filter.operator === 'is-not-empty') {
			out[meta.nullPath] = { operator: filter.operator === 'is-empty' ? '_null' : '_nnull' };
			continue;
		}

		const op = OP_TO_BACKEND[filter.operator];
		if (!op) continue;

		let value = filter.value;
		if (meta.rawType === 'boolean' && value !== null && value !== undefined) {
			value = value === true || value === 'true' || value === 1 ? '1' : '0';
		}

		const cond: EntityListFilter = { operator: op };
		if (value !== null && value !== undefined) cond.value = Array.isArray(value) ? value.join(',') : String(value);
		if (filter.valueTo !== null && filter.valueTo !== undefined) cond.valueTo = String(filter.valueTo);
		if (meta.dateFn) cond.fn = 'date';
		out[meta.path] = cond;
	}

	return Object.keys(out).length > 0 ? out : undefined;
}
