import { MAX_PAGE_SIZE } from '@mmbix/config';
import type { ColumnDef, FetchParams } from '@mmbix/design-system/datatable';
import { listItems, type EntityListParams, type EntitySchema, type FieldDefinition } from './api';
import { renderCell } from './cell-render';
import { serializeTableFilters } from './collection-table-filters';
import { buildListFields } from './list-projection';

export type ExportRowsScope = 'page' | 'all';
export type ExportColumnsScope = 'visible' | 'all';

/** The scope names the DataTable is in when it has not fetched yet (nothing meaningful to export). */
const EMPTY_FETCH_PARAMS: FetchParams = {
	sorting: null,
	filters: [],
	globalFilter: '',
	pagination: { pageIndex: 0, pageSize: 0 },
	cursor: null,
};

/**
 * Shared CSV export for the Studio's collection tables. Extracted so the
 * Collections workbench and the App workbench export IDENTICALLY —
 * same display values (`renderCell`), same escaping, same cursor-walk for
 * "all rows" — instead of two pages drifting into two files.
 *
 * Both tables are server-side (cursor-paginated), so "all rows" cannot come from
 * the client: it walks the entity API one page at a time with the SAME sort,
 * search and rich filters the visible page was fetched with, then renders each
 * page through the same `renderCell` the table cells use.
 */

/** What a CSV cell may need quoting for. */
function escapeCsvCell(value: string): string {
	return value.includes(',') || value.includes('"') || value.includes('\n') ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Schema fields keyed by name — the `renderCell` lookup for each column. */
export function fieldMapOf(fields: FieldDefinition[]): Map<string, FieldDefinition> {
	return new Map(fields.map((f) => [f.name, f]));
}

/**
 * Build an `EntityListParams` from the DataTable's fetch contract — the ONE
 * translation from table state to backend query, shared by the page fetch AND
 * the "all rows" export walk so the two can never disagree on what filter/sort
 * the user is looking at.
 */
export function itemsParamsFromFetch(
	fields: FieldDefinition[],
	m2oSchemas: Record<string, EntitySchema>,
	params: FetchParams = EMPTY_FETCH_PARAMS,
	base: EntityListParams = {},
): EntityListParams {
	const out: EntityListParams = { ...base, limit: params.pagination.pageSize, fields: buildListFields(fields) };
	if (params.cursor) {
		out.cursor = params.cursor;
		out.dir = 'after';
	}
	if (params.sorting) out.sort = `${params.sorting.direction === 'desc' ? '-' : ''}${params.sorting.id}`;
	if (params.globalFilter) out.search = params.globalFilter;
	out.filters = serializeTableFilters(params.filters, fields, m2oSchemas);
	return out;
}

/**
 * Fetch EVERY row matching the given params via the cursor API — pages of
 * `MAX_PAGE_SIZE`, deduped by id (a collection without a total sort can repeat
 * a row across page boundaries). Refuses nothing: the reads ride the same
 * per-collection RBAC and response cache as the table's own pages.
 */
export async function collectAllRows(token: string, slug: string, params: EntityListParams): Promise<Record<string, unknown>[]> {
	const rows: Record<string, unknown>[] = [];
	const seen = new Set<string>();
	const pageParams: EntityListParams = { ...params, limit: MAX_PAGE_SIZE, dir: 'after' };
	let cursor: string | undefined;
	for (;;) {
		const page = await listItems(token, slug, cursor ? { ...pageParams, cursor } : pageParams);
		for (const row of page.rows) {
			const key = String(row.id);
			if (seen.has(key)) continue;
			seen.add(key);
			rows.push(row);
		}
		if (!page.meta.has_more || !page.meta.next_cursor) break;
		cursor = page.meta.next_cursor;
	}
	return rows;
}

/** Render rows × columns as CSV text (headers from `header`, cells via `renderCell`). */
export function buildCsv(
	rows: Record<string, unknown>[],
	columns: ColumnDef<Record<string, unknown>>[],
	fieldByName: Map<string, FieldDefinition>,
): string {
	const headers = columns.map((c) => (typeof c.header === 'string' ? c.header : c.id));
	const lines = [headers.join(',')];
	for (const row of rows) {
		const cells = columns.map((c) => {
			const field = fieldByName.get(c.id);
			const value = row[c.id];
			const text = field ? renderCell(field, value) : value == null ? '' : String(value);
			return escapeCsvCell(text);
		});
		lines.push(cells.join(','));
	}
	return lines.join('\n');
}

/** Browser download of a CSV filename. */
export function downloadCsv(filename: string, text: string): void {
	const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}
