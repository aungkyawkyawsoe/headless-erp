/**
 * Canonical field-type list — the single source of truth for the supported
 * field data types (41). The `FieldType` union in `@mmbix/types` is derived
 * from `FIELD_TYPE_NAMES`, and validators use `VALID_FIELD_TYPES` for membership.
 */
export const FIELD_TYPE_NAMES = [
	'text',
	'longtext',
	'slug',
	'password',
	'integer',
	'number',
	'bigint',
	'currency',
	'percent',
	'rating',
	'boolean',
	'timestamp',
	'date',
	'time',
	'json',
	'csv',
	'location',
	'color',
	'm2o',
	'o2m',
	'm2m',
	'm2a',
	'file',
	'image',
	'select',
	'uuid',
	'table',
	'formula',
	'text_editor',
	'code',
	'markdown',
	'signature',
	'duration',
	'barcode',
	'datetime',
	'phone',
	'email',
	'url',
	'icon',
	'tags',
	'progress',
] as const;

export const VALID_FIELD_TYPES: ReadonlySet<string> = new Set(FIELD_TYPE_NAMES);

/**
 * Field types a free-text search term matches (OR across all of them) — the ONE
 * list every search surface derives from:
 *   - the collection `?search=` filter (ItemQueryService)
 *   - the export `search` param (ExportImportService)
 *   - the global FTS5 / LIKE search (SearchService)
 *
 * Deliberately excludes relations (m2o/o2m/m2m/m2a/table/formula), id/system
 * timestamps and numeric/boolean/media types — none carry free text worth
 * scanning. The `as const satisfies` clause makes a typo'd (or removed) type a
 * COMPILE error, so this cannot drift from the field-type SSOT above.
 */
export const SEARCHABLE_FIELD_TYPES: ReadonlySet<string> = new Set<string>([
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
	'uuid',
	'color',
	'select',
	'time',
] as const satisfies readonly (typeof FIELD_TYPE_NAMES)[number][]);
