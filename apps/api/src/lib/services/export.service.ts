/**
 * Export/Import Service
 *
 * Exports and imports data in JSON or CSV format.
 * Supports full collection export, filtered export, and batch import.
 */

import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { mergeRowData } from '@mmbix/core';
import { NotFoundError } from '@mmbix/utils';
import { DataFilterService, type DataFilterContext } from '@/lib/services/data-filter.service';
import type { AuthContext } from '@/lib/services/auth.service';
import type { EntitySchema, FieldDefinition } from '@mmbix/types';

export interface ExportOptions {
	format: 'json' | 'csv';
	fields?: string[];
	includeTrashed?: boolean;
	limit?: number;
	/** Sort clauses, e.g. "-created_at,title" (matches the list API `sort` param). */
	sort?: string;
	/** Global search term — matched across the collection's text fields. */
	search?: string;
	/** Exact-match field filters (filter[field][_eq]) — mirrors the list's active tab chip. */
	filters?: Record<string, string>;
	/**
	 * OR-grouped filters (filter[_or][N][field][_op]) — parenthesized OR,
	 * AND-joined to the rest, same semantics as the entity list API. Used to
	 * scope exports to e.g. approvals' "pending + routed to me" view.
	 */
	orFilters?: { field: string; op?: '_eq' | '_contains'; value: string }[];
}

export interface ExportOptions {
	format: 'json' | 'csv';
	fields?: string[];
	includeTrashed?: boolean;
	limit?: number;
	/** Sort clauses, e.g. "-created_at,title" (matches the list API `sort` param). */
	sort?: string;
	/** Global search term — matched across the collection's text fields. */
	search?: string;
	/** Exact-match field filters (filter[field][_eq]) — mirrors the list's active tab chip. */
	filters?: Record<string, string>;
	/**
	 * OR-grouped filters (filter[_or][N][field][_op]) — parenthesized OR,
	 * AND-joined to the rest, same semantics as the entity list API. Used to
	 * scope exports to e.g. approvals' "pending + routed to me" view.
	 */
	orFilters?: { field: string; op?: '_eq' | '_contains'; value: string }[];
}

export class ExportImportService {
	private _auth: AuthContext | null = null;

	constructor(
		private db: D1Client,
		auth?: AuthContext,
	) {
		this._auth = auth || null;
	}

	setAuth(auth: AuthContext): this {
		this._auth = auth;
		return this;
	}

	/**
	 * Export data from a collection in JSON or CSV format.
	 */
	async exportCollection(collectionSlug: string, options: ExportOptions): Promise<string> {
		const collection = await this.db.first<EntitySchema>(
			QueryBuilder.from('_entity_schemas').select('*').where('slug', collectionSlug).toSelect(),
		);
		if (!collection) throw new NotFoundError('Collection', collectionSlug);

		const tableName = collection.table_name;
		const qb = QueryBuilder.from(tableName);

		if (options.includeTrashed) {
			qb.whereNotNull('deleted_at');
		} else {
			qb.whereNull('deleted_at');
		}
		if (options.fields && options.fields.length > 0) qb.select(...options.fields);
		qb.limit(options.limit || 1000);
		qb.orderBy('id', 'desc');

		// Exact-match filters (the active filter chip the user had on) — same
		// semantics as ?filter[field][_eq]= on the list API.
		for (const [field, value] of Object.entries(options.filters ?? {})) {
			qb.where(field, '=', value);
		}

		// OR-group filters — parenthesized OR, AND-joined to the rest of the query
		// (same shape the entity list API builds from filter[_or][N][field][_op]).
		if (options.orFilters && options.orFilters.length > 0) {
			qb.whereGroup(
				options.orFilters.map((f) => ({
					column: f.field,
					op: f.op === '_contains' ? 'LIKE' : '=',
					value: f.op === '_contains' ? `%${f.value}%` : f.value,
					type: 'or' as const,
				})),
				'and',
			);
		}

		// Keep the exported rows consistent with the list the user was looking at:
		// apply the same sort clauses and global search term the DataTable sends.
		if (options.sort) {
			qb.clearOrderBy();
			for (const clause of options.sort.split(',')) {
				const c = clause.trim();
				if (!c) continue;
				qb.orderBy(c.startsWith('-') ? c.slice(1) : c, c.startsWith('-') ? 'desc' : 'asc');
			}
		}
		if (options.search) {
			const schemaJson = JSON.parse(collection.schema_json || '{}') as { fields?: FieldDefinition[] };
			const textFields = (schemaJson.fields || [])
				.filter((f) =>
					[
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
					].includes(f.type),
				)
				.map((f) => f.name);
			if (textFields.length > 0) {
				// Parenthesized OR group AND-joined to the rest of the query:
				// whereGroup with per-clause 'or' types yields AND (a LIKE ? OR b LIKE ?).
				qb.whereGroup(
					textFields.map((col) => ({ column: col, op: 'LIKE', value: `%${options.search}%`, type: 'or' as const })),
					'and',
				);
			}
		}

		// Apply RBAC row-level filters at the SQL level — the same filter the
		// CollectionService list path uses — so a role with an owner-scoped row
		// filter can never export others' rows.
		if (this._auth && !this._auth.is_admin) {
			const fctx: DataFilterContext = { db: this.db, auth: this._auth, collectionSlug };
			await DataFilterService.applyRowFilter(qb, fctx);
		}

		let items = await this.db.all<Record<string, unknown>>(qb.toSelect());
		items = items.map(mergeRowData);

		// Apply RBAC: field-level filters (in-memory whitelist)
		if (this._auth && !this._auth.is_admin) {
			const fctx: DataFilterContext = { db: this.db, auth: this._auth, collectionSlug };
			const schema = JSON.parse(collection.schema_json || '{}') as { fields?: FieldDefinition[] };
			const fieldNames = (schema.fields || []).map((f) => f.name);
			items = await DataFilterService.applyFieldFilter(items, fctx, fieldNames);
		}

		if (options.format === 'csv') {
			return this._toCsv(items);
		}
		return JSON.stringify(items, null, 2);
	}

	/**
	 * Export all collections metadata (schema-only).
	 *
	 * JSON-encoded columns (schema_json, system_field_options) are parsed into
	 * objects so the export is readable, nested JSON — not escaped strings.
	 */
	async exportSchema(): Promise<string> {
		const collections = await this.db.all<EntitySchema>(QueryBuilder.from('_entity_schemas').select('*').orderBy('name', 'asc').toSelect());
		const data = collections.map((c) => ({
			...c,
			schema_json: this._tryParseJson(c.schema_json),
			system_field_options: this._tryParseJson(c.system_field_options),
		}));
		return JSON.stringify(data, null, 2);
	}

	/** Parse a stored JSON column; fall back to the raw string if corrupt. */
	private _tryParseJson(value: string | null | undefined): unknown {
		if (!value) return value ?? null;
		try {
			return JSON.parse(value);
		} catch {
			return value;
		}
	}

	private _toCsv(items: Record<string, unknown>[]): string {
		if (items.length === 0) return '';
		const headers = Object.keys(items[0]);
		const csvHeaders = headers.map((h) => {
			// Headers are schema/tenant-controlled — guard the same formula prefix
			// (a leading space before =,+,-,@ is trimmed by spreadsheets before eval).
			const safe = /^[\s]*[=+\-@\t\r]/.test(h) ? `'${h}` : h;
			return safe.includes(',') ? `"${safe.replace(/"/g, '""')}"` : safe;
		});
		const rows = [csvHeaders.join(',')];
		for (const item of items) {
			const row = headers.map((h) => {
				const val = item[h];
				if (val === null || val === undefined) return '';
				const str = String(val);
				// CSV formula injection protection — leading whitespace before a dangerous
				// char is stripped by spreadsheets before evaluation, so match it too.
				if (/^[\s]*[=+\-@\t\r]/.test(str)) return `'${str}`;
				if (str.includes(',') || str.includes('"') || str.includes('\n')) return `"${str.replace(/"/g, '""')}"`;
				return str;
			});
			rows.push(row.join(','));
		}
		return rows.join('\n');
	}
}

// ─── Standalone CSV Generator ──────────────────────────────

/**
 * Convert an array of objects to a CSV string with header row.
 * Used by the entity list route (?export=csv) and other export paths.
 *
 * Safety: cells starting with =, +, -, @, \t, \r are prefixed with
 * a single quote to prevent CSV injection (Formula Injection attack).
 *
 * @param rows - Array of row objects (keys become headers)
 * @param excludeFields - Internal/system field names to strip out
 * @param fieldFilter - If provided, only include these columns (respects ?fields= param)
 */
export function toCsv(rows: Record<string, unknown>[], excludeFields: string[] = [], fieldFilter?: string[]): string {
	if (rows.length === 0) return '';

	const internalFields = new Set(excludeFields);

	// Determine headers from the first row, excluding internal fields
	let headers = Object.keys(rows[0]).filter((h) => !internalFields.has(h));

	// If a field filter is requested (from ?fields= param), respect it
	if (fieldFilter && fieldFilter.length > 0) {
		const requested = new Set(fieldFilter);
		headers = headers.filter((h) => requested.has(h));
	}

	// Header row — headers are schema/tenant-controlled, so guard the same
	// formula prefix (leading whitespace is stripped by spreadsheets first).
	const csvRows = [headers.map((h) => (/^[\s]*[=+\-@\t\r]/.test(h) ? `'${h}` : h)).join(',')];

	// Data rows
	for (const item of rows) {
		const row = headers.map((h) => {
			const val = item[h];
			if (val === null || val === undefined) return '';
			let sanitized = String(val);

			// CSV injection prevention — prefix dangerous leading chars (including
			// leading whitespace, which spreadsheets trim before evaluating).
			if (/^[\s]*[=+\-@\t\r]/.test(sanitized)) {
				sanitized = "'" + sanitized;
			}

			// Quote cells containing commas, quotes, or newlines
			if (sanitized.includes(',') || sanitized.includes('"') || sanitized.includes('\n')) {
				return '"' + sanitized.replace(/"/g, '""') + '"';
			}

			return sanitized;
		});
		csvRows.push(row.join(','));
	}

	return csvRows.join('\n');
}
