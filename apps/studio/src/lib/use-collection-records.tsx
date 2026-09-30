/**
 * useCollectionRecords — the read + write surface for ONE collection's rows.
 *
 * The Studio has TWO data surfaces and they show the same thing: a server-driven
 * table of a collection's rows with inline editing, bulk soft-delete/restore and
 * CSV export. The app workbench's record pane (`components/app/AppDataPane.tsx`)
 * scopes it to one module's collection; the global Collections registry
 * (`pages/CollectionsWorkbench.tsx`) shows every collection. The logic had been
 * implemented twice, so the two drifted by hand — fetch projection, the write
 * gate, the frozen-row partition, the export snapshot.
 *
 * This hook is the ONE home for that logic. The two surfaces keep only what makes
 * them different (their own chrome, dialogs and layout) and pass in the policy +
 * callbacks they own.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { confirmDialog } from '@mmbix/design-system';
import type { ColumnDef, DataTableInstance, FetchParams, FetchResult } from '@mmbix/design-system/datatable';
import {
	bulkDelete,
	bulkErrorMessage,
	bulkRestore,
	SYSTEM_FIELD_NAMES,
	type EntityListParams,
	type EntitySchema,
	type FieldDefinition,
} from './api';
import { itemsQuery } from './queries';
import { buildTableColumns, serializeTableFilters } from './collection-table-filters';
import { renderCell } from './cell-render';
import { buildListFields } from './list-projection';
import { buildCsv, collectAllRows, fieldMapOf, itemsParamsFromFetch, type ExportColumnsScope, type ExportRowsScope } from './csv-export';
import { frozenRowsReason, isRowFrozen, partitionFrozenRows, type CollectionWriteLock } from './write-lock';
import { InlineCellEditor } from '../components/InlineCellEditor';

export interface CollectionRecordsOptions {
	token: string;
	/** The focused collection slug, or null when none is selected. */
	selected: string | null;
	/** Every field (incl. system) of the focused collection's schema — the column source. */
	fields: FieldDefinition[];
	/** m2o target schemas, for typed filter / display resolution. */
	m2oSchemas: Record<string, EntitySchema>;
	/** The engine-enforced write policy for the focused collection. */
	writeLock: CollectionWriteLock;
	/** List soft-deleted rows instead of live ones. */
	trashMode: boolean;
	/** Re-read the visible page after a row write (the caller owns the remount tick). */
	refreshRows: (slug: string | null | undefined) => void | Promise<void>;
	/** Surface a write failure / partial-batch summary (the caller owns the banner). */
	onError: (message: string | null) => void;
}

export interface CollectionRecords {
	/** Typed columns for the DataTable (inline-editable through the write gate). */
	tableColumns: ColumnDef<Record<string, unknown>>[];
	/** The server-side fetch the DataTable calls — cursor pagination, sort, search, filters. */
	fetchData: (params: FetchParams) => Promise<FetchResult<Record<string, unknown>>>;
	/** Rows checked in the table for bulk delete / restore. */
	selectedRows: Record<string, unknown>[];
	setSelectedRows: (rows: Record<string, unknown>[]) => void;
	/** Soft-delete the selection (frozen rows skipped; the confirm dialog blocks until answered). */
	deleteRows: (rows: Record<string, unknown>[]) => Promise<void>;
	/** Restore the selection from trash mode (frozen rows skipped). */
	restoreRows: (rows: Record<string, unknown>[]) => Promise<void>;
	/** The one-shot export snapshot captured when Export was clicked. */
	exportState: { pageRows: Record<string, unknown>[]; visibleIds: Set<string> } | null;
	openExport: (instance: DataTableInstance<Record<string, unknown>>) => void;
	closeExport: () => void;
	runExport: (scope: { rows: ExportRowsScope; columns: ExportColumnsScope }) => Promise<string>;
}

/** The read + write surface for one focused collection (table view). */
export function useCollectionRecords(opts: CollectionRecordsOptions): CollectionRecords {
	const { token, selected, fields, m2oSchemas, writeLock, trashMode, refreshRows, onError } = opts;
	const queryClient = useQueryClient();

	const [selectedRows, setSelectedRows] = useState<Record<string, unknown>[]>([]);
	// A one-shot: the Export button captures the CURRENT table snapshot (rows in
	// memory + the params the page was fetched with), and the dialog only decides
	// scope — page vs all rows, visible vs all columns.
	const [exportState, setExportState] = useState<{ pageRows: Record<string, unknown>[]; visibleIds: Set<string> } | null>(null);

	// Table columns built from the focused collection's schema fields — typed filter
	// metadata is derived generically from field types (m2o columns filter on the
	// related row's display leaf). No per-row action column — clicking a row opens
	// the detail view (edit).
	const tableColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(
		() =>
			buildTableColumns(fields, m2oSchemas, {
				systemFieldNames: SYSTEM_FIELD_NAMES,
				renderCell: (field, value, row) => {
					const id = row?.id;
					return (
						<InlineCellEditor
							field={field}
							value={value}
							recordId={String(id ?? '')}
							token={token}
							collectionSlug={selected ?? ''}
							// The SAME write gate the record view uses — a service / append-only
							// collection, a frozen row, a frozen column, or a row without an id
							// keeps every cell read-only (least privilege).
							readOnly={
								id == null ||
								!selected ||
								!writeLock.canMutate ||
								isRowFrozen(writeLock, row) ||
								writeLock.frozenFields.includes(field.name)
							}
							onSaved={() => void refreshRows(selected)}
						/>
					);
				},
			}),
		[fields, m2oSchemas, token, selected, writeLock, refreshRows],
	);

	// Server-side fetch — cursor pagination, sorting, search, filters against the API.
	//
	// STABLE identity on purpose: DataTable re-runs its server effect whenever
	// `fetchData` changes, and `fields`/`m2oSchemas` change on every schema load, so
	// depending on them re-fetched the rows once per event. `selected` and
	// `trashMode` are DataTable REMOUNT keys, so those still refetch.
	const fetchCtxRef = useRef({ token, selected, trashMode, fields, m2oSchemas });
	fetchCtxRef.current = { token, selected, trashMode, fields, m2oSchemas };
	// The last `FetchParams` the table asked for — replayed by "export all rows" so
	// the export walks EXACTLY the filter/sort/search the page is showing.
	const lastFetchParamsRef = useRef<FetchParams | null>(null);

	const fetchData = useCallback(
		async (params: FetchParams): Promise<FetchResult<Record<string, unknown>>> => {
			lastFetchParamsRef.current = params;
			const ctx = fetchCtxRef.current;
			if (!ctx.selected) return { rows: [], nextCursor: null, prevCursor: null };
			// Lean table projection instead of `*.*` — own columns + m2o labels + id-only
			// relation arrays. Gated on the schema (see the DataTable `fetchData` prop).
			const entityParams: EntityListParams = {
				limit: params.pagination.pageSize,
				trashed: ctx.trashMode,
				fields: buildListFields(ctx.fields),
			};
			if (params.cursor) {
				entityParams.cursor = params.cursor;
				entityParams.dir = params.cursorDir ?? 'after';
			}
			if (params.sorting) entityParams.sort = `${params.sorting.direction === 'desc' ? '-' : ''}${params.sorting.id}`;
			if (params.globalFilter) entityParams.search = params.globalFilter;
			entityParams.filters = serializeTableFilters(params.filters, ctx.fields, ctx.m2oSchemas);
			// Through Query: shares the app cache + in-flight dedup, so a remount or a
			// repeated page/sort/filter within staleTime costs ZERO requests.
			return await queryClient.fetchQuery(itemsQuery(ctx.token, ctx.selected, entityParams));
		},
		[queryClient],
	);

	// Soft-delete one or more records (bulk delete from row selection).
	const deleteRows = useCallback(
		async (rows: Record<string, unknown>[]) => {
			if (!selected || rows.length === 0) return;
			// Defensive: the DataTable hides the delete action when the collection is not
			// generically writable, but the guard stays here too (the RBAC admin bypass
			// cannot reach a service-only table).
			if (!writeLock.canMutate) {
				onError(writeLock.reason ?? 'This collection cannot be written through the generic entity API.');
				return;
			}
			// Rows frozen by `freeze_when` 403 a generic delete — skip them so one frozen
			// row cannot fail the whole batch.
			const { writable, frozen } = partitionFrozenRows(writeLock, rows);
			if (writable.length === 0) {
				onError(frozenRowsReason(writeLock, frozen.length));
				return;
			}
			// Name the single record being deleted (its display leaf); count the rest.
			const displayField = fields.find((f) => f.name === 'name_en') ?? fields[0];
			const label =
				writable.length === 1 && displayField
					? `“${renderCell(displayField, writable[0].name_en ?? writable[0].name ?? writable[0].id)}”`
					: `${writable.length} records`;
			if (
				!(await confirmDialog({
					title: 'Delete records',
					description: `Delete ${label}?${frozen.length ? ` (${frozen.length} frozen skipped)` : ''}`,
					destructive: true,
					confirmLabel: 'Delete',
				}))
			)
				return;
			try {
				// ONE bulk request for N rows instead of N sequential DELETE round trips.
				const results = await bulkDelete(
					token,
					selected,
					writable.map((r) => String(r.id)),
				);
				setSelectedRows([]);
				await refreshRows(selected);
				onError([bulkErrorMessage(results), frozen.length > 0 ? frozenRowsReason(writeLock, frozen.length) : ''].filter(Boolean).join(' '));
			} catch (e) {
				onError(e instanceof Error ? e.message : 'Delete failed');
			}
		},
		[token, selected, writeLock, fields, onError, refreshRows],
	);

	// Restore one or more soft-deleted records (from trash mode).
	const restoreRows = useCallback(
		async (rows: Record<string, unknown>[]) => {
			if (!selected || rows.length === 0) return;
			if (!writeLock.canMutate) {
				onError(writeLock.reason ?? 'This collection cannot be written through the generic entity API.');
				return;
			}
			// A frozen row rejects a generic write — skip restore for it too.
			const { writable, frozen } = partitionFrozenRows(writeLock, rows);
			if (writable.length === 0) {
				onError(frozenRowsReason(writeLock, frozen.length));
				return;
			}
			try {
				const results = await bulkRestore(
					token,
					selected,
					writable.map((r) => String(r.id)),
				);
				setSelectedRows([]);
				await refreshRows(selected);
				onError([bulkErrorMessage(results), frozen.length > 0 ? frozenRowsReason(writeLock, frozen.length) : ''].filter(Boolean).join(' '));
			} catch (e) {
				onError(e instanceof Error ? e.message : 'Restore failed');
			}
		},
		[token, selected, writeLock, onError, refreshRows],
	);

	// ── CSV export ──────────────────────────────────────────────────────────────
	const openExport = useCallback(
		(instance: DataTableInstance<Record<string, unknown>>) => {
			if (!selected) return;
			const pageRows = instance.table.getFilteredRowModel().rows.map((r) => r.original);
			const visibleIds = new Set<string>();
			const visibility = instance.table.getState().columnVisibility;
			for (const c of tableColumns) {
				if (visibility[c.id] !== false) visibleIds.add(c.id);
			}
			setExportState({ pageRows, visibleIds });
		},
		[selected, tableColumns],
	);

	const closeExport = useCallback(() => setExportState(null), []);

	const runExport = useCallback(
		async (scope: { rows: ExportRowsScope; columns: ExportColumnsScope }): Promise<string> => {
			const ctx = fetchCtxRef.current;
			if (!ctx.selected || !exportState) throw new Error('No rows to export');
			const fieldByName = fieldMapOf(ctx.fields);
			const allColumns = tableColumns.filter((c) => c.enableHiding !== false);
			const columns = scope.columns === 'visible' ? allColumns.filter((c) => exportState.visibleIds.has(c.id)) : allColumns;
			const rows =
				scope.rows === 'page'
					? exportState.pageRows
					: await collectAllRows(
							ctx.token,
							ctx.selected,
							itemsParamsFromFetch(ctx.fields, ctx.m2oSchemas, lastFetchParamsRef.current ?? undefined, { trashed: ctx.trashMode }),
						);
			return buildCsv(rows, columns, fieldByName);
		},
		[exportState, tableColumns],
	);

	return {
		tableColumns,
		fetchData,
		selectedRows,
		setSelectedRows,
		deleteRows,
		restoreRows,
		exportState,
		openExport,
		closeExport,
		runExport,
	};
}
