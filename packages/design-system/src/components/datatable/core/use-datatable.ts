'use client';

import * as React from 'react';
import {
	useLegacyTable,
	getCoreRowModel,
	getSortedRowModel,
	getFilteredRowModel,
	getGroupedRowModel,
	getExpandedRowModel,
	getPaginationRowModel,
	getFacetedRowModel,
	type LegacyColumnDef as TanStackColumnDef,
	type LegacyFeatures,
	type LegacyReactTable,
	type LegacyRow,
	type LegacyTable,
} from '@tanstack/react-table/legacy';
import type {
	CellContext,
	ColumnFiltersState,
	ColumnPinningState,
	ExpandedState,
	GroupingState,
	PaginationState as TanStackPaginationState,
	RowData,
	Updater,
} from '@tanstack/react-table';
import { cssWidthToNumber, matchesFilter } from './utils';
import { loadPersistedColumnState, savePersistedColumnState } from './persist';
import type {
	ActiveFilter,
	ColumnDef,
	CursorState,
	DataTableProps,
	DataTableInstance,
	FetchParams,
	FetchResult,
	PaginationState,
	SortState,
} from './types';

// ── Custom filter function for our rich ActiveFilter format ──

function richFilterFn<TData extends RowData>(row: LegacyRow<TData>, columnId: string, filterValue: unknown): boolean {
	const filter = filterValue as ActiveFilter | undefined;
	if (!filter) return true;

	const colDef = row.getAllCells().find((c) => c.column.id === columnId)?.column.columnDef as ColumnDef<TData> | undefined;

	if (colDef?.filterFn) {
		return colDef.filterFn(row.original, filter);
	}

	const cellValue = row.getValue(columnId);
	return matchesFilter(cellValue, filter.operator, filter.value, filter.valueTo);
}

// ── Global filter function ────────────────────────────────

function globalFilterFn<TData extends RowData>(row: LegacyRow<TData>, columnId: string, filterValue: unknown): boolean {
	const query = String(filterValue ?? '');
	if (!query) return true;
	const value = row.getValue(columnId);
	if (value == null) return false;
	return String(value).toLowerCase().includes(query.toLowerCase());
}

// ── Adapter: our ColumnDef → TanStack ColumnDef ───────────

// TanStack's built-in aggregation functions keyed by their canonical names.
// We accept the friendlier `avg` alias and normalize it to TanStack's `mean`.
const AGG_FN_ALIASES: Record<string, string> = { avg: 'mean' };

function toTanStackColumn<TData extends RowData, TValue = unknown>(col: ColumnDef<TData, TValue>): TanStackColumnDef<TData> {
	const column = {
		id: col.id,
		header: col.header as TanStackColumnDef<TData>['header'],
		enableSorting: col.enableSorting ?? col.sortable ?? true,
		enableHiding: col.enableHiding ?? true,
		enablePinning: col.enablePinning !== false,
		enableGrouping: col.enableGrouping,
		filterFn: richFilterFn,
	} as TanStackColumnDef<TData>;

	const meta: Record<string, unknown> = {
		filterDef: col.filter,
		width: col.width,
		minWidth: col.minWidth,
		maxWidth: col.maxWidth,
		align: col.align,
		headerClassName: col.headerClassName,
		cellClassName: col.cellClassName,
		enableTooltip: col.enableTooltip,
		defaultVisible: col.defaultVisible,
		enableGrouping: col.enableGrouping,
	};

	const aggregationFn = col.aggregationFn == null ? undefined : (AGG_FN_ALIASES[col.aggregationFn] ?? col.aggregationFn);

	return {
		...column,
		accessorKey: col.accessorKey as string | undefined,
		accessorFn: col.accessorFn as unknown,
		cell: col.cell
			? (((info: CellContext<LegacyFeatures, TData, unknown>) => {
					const value = info.getValue();
					return col.cell!({
						row: {
							original: info.row.original,
							index: info.row.index,
							getValue: () => info.getValue() as TValue,
						},
						value: value as TValue,
						index: info.row.index,
					});
				}) as TanStackColumnDef<TData>['cell'])
			: undefined,
		footer: col.footer as TanStackColumnDef<TData>['footer'],
		aggregationFn: aggregationFn as TanStackColumnDef<TData>['aggregationFn'],
		size: col.size ?? cssWidthToNumber(col.width),
		minSize: col.minSize ?? cssWidthToNumber(col.minWidth),
		maxSize: col.maxSize ?? cssWidthToNumber(col.maxWidth),
		enableResizing: col.enableResizing,
		meta,
	} as TanStackColumnDef<TData>;
}

// ── Main Hook ─────────────────────────────────────────────

export function useDataTable<TData extends RowData>(
	props: DataTableProps<TData>,
): DataTableInstance<TData> & {
	columns: ColumnDef<TData>[];
	pagination: PaginationState;
	sorting: SortState | null;
	isLoading: boolean;
	error: string | null;
	filters: ActiveFilter[];
	density: import('./types').Density;
	enableRowSelection: boolean;
	rowKey: keyof TData & string;
	onRowClick?: (row: TData) => void;
	enableRowExpansion: boolean;
	expandedRowIds: string[];
	getIsRowExpanded: (rowId: string) => boolean;
	toggleRowExpanded: (rowId: string, expanded?: boolean) => void;
	expandAll: () => void;
	collapseAll: () => void;
	cursorState: CursorState;
	cursorFrom: number;
	cursorTo: number;
	canGoPrevious: boolean;
	canGoNext: boolean;
	goToNextPage: () => void;
	goToPrevPage: () => void;
} {
	const {
		columns: rawColumns,
		data: externalData = [],
		fetchData,
		refreshKey = 0,
		defaultPageSize = 10,
		pageSize: pageSizeProp,
		onPageSizeChange,
		defaultSorting = null,
		defaultColumnPinning = { start: [], end: [] },
		isLoading: isLoadingProp,
		error: errorProp,
		density = 'comfortable',
		enableRowSelection = false,
		enableColumnResizing = false,
		onSelectionChange,
		onRowClick,
		rowKey = 'id' as keyof TData & string,
		getRowCanExpand,
		renderSubComponent,
		getSubRows,
		defaultExpandedRowIds,
		expandedRowIds: expandedRowIdsProp,
		onExpandedRowIdsChange,
		enableGrouping = false,
		grouping: groupingProp,
		defaultGrouping,
		onGroupingChange,
		defaultExpandAll = false,
		persistStateKey,
	} = props;

	const enableRowExpansion = Boolean(renderSubComponent || getSubRows || getRowCanExpand || enableGrouping);

	// ── Convert columns to TanStack format ────────────────
	const tanStackColumns = React.useMemo(() => rawColumns.map(toTanStackColumn), [rawColumns]);

	// ── Controlled state ─────────────────────────────────
	const [sorting, setSorting] = React.useState<import('@tanstack/react-table').SortingState>(
		defaultSorting ? [{ id: defaultSorting.id, desc: defaultSorting.direction === 'desc' }] : [],
	);
	const [globalFilter, setGlobalFilter] = React.useState('');
	const [pagination, setPagination] = React.useState<PaginationState>({
		pageIndex: 0,
		pageSize: pageSizeProp ?? defaultPageSize,
	});

	// Sync controlled pageSize into internal state
	React.useEffect(() => {
		if (pageSizeProp != null && pageSizeProp !== pagination.pageSize) {
			setPagination((p) => ({ ...p, pageSize: pageSizeProp }));
		}
	}, [pageSizeProp, pagination.pageSize]);

	// Cursor state (only used in cursor mode)
	const [cursorState, setCursorState] = React.useState<CursorState>({
		nextCursor: null,
		prevCursor: null,
	});
	// The in-flight navigation: which cursor, which side, and the offset the
	// resulting page WILL occupy. The offset is applied only when the fetch
	// settles (below), so the visible range and the cursors always come from the
	// SAME committed response and can never disagree.
	const [cursorNav, setCursorNav] = React.useState<{ cursor: string | null; dir: 'after' | 'before'; offset: number }>({
		cursor: null,
		dir: 'after',
		offset: 0,
	});
	// Displayed range offset in cursor mode (e.g. `0–25`, `25–50`, …)
	const [cursorOffset, setCursorOffset] = React.useState(0);

	// Rich filters (our format)
	const [richFilters, setRichFilters] = React.useState<ActiveFilter[]>([]);

	// ── Column visibility ─────────────────────────────────
	// Seeds from defaultVisible flags, then applies persisted layout (when a
	// persistStateKey is provided) — so a returning user keeps their layout.
	const initialPersisted = React.useMemo(
		() =>
			persistStateKey
				? loadPersistedColumnState(
						persistStateKey,
						rawColumns.map((c) => c.id),
					)
				: null,
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[persistStateKey],
	);

	const [columnVisibility, setColumnVisibility] = React.useState<Record<string, boolean>>(() => {
		const vis: Record<string, boolean> = {};
		rawColumns.forEach((col) => {
			if (col.defaultVisible === false) {
				vis[col.id] = false;
			}
		});
		if (initialPersisted) {
			for (const [id, v] of Object.entries(initialPersisted.visibility)) vis[id] = v;
		}
		return vis;
	});

	// Column pinning
	const [columnPinning, setColumnPinning] = React.useState<ColumnPinningState>(() => {
		if (initialPersisted && (initialPersisted.pinning.start.length || initialPersisted.pinning.end.length)) {
			return initialPersisted.pinning;
		}
		return defaultColumnPinning;
	});

	// ── Row expansion ────────────────────────────────────
	// Ref mirroring the table instance so expansion callbacks defined inside the
	// useReactTable options can read row ids without a self-reference.
	const tableRef = React.useRef<LegacyTable<TData> | null>(null);
	const [expanded, setExpanded] = React.useState<ExpandedState>(() => {
		// Expand every group by default (grouping mode / master-detail).
		if (defaultExpandAll) return true;
		if (!enableRowExpansion || !defaultExpandedRowIds?.length) return {};
		return Object.fromEntries(defaultExpandedRowIds.map((id) => [id, true]));
	});

	// Sync controlled expandedRowIds into internal state
	React.useEffect(() => {
		if (!enableRowExpansion || expandedRowIdsProp == null) return;
		setExpanded(expandedRowIdsProp.length ? Object.fromEntries(expandedRowIdsProp.map((id) => [id, true])) : {});
	}, [enableRowExpansion, expandedRowIdsProp]);

	// Column order (for reordering)
	const [columnOrder, setColumnOrder] = React.useState<string[]>(() => {
		const ids = rawColumns.map((c) => c.id);
		if (!initialPersisted || initialPersisted.order.length === 0) return ids;
		// Persisted order wins for known columns; new columns append at the end.
		return [...initialPersisted.order, ...ids.filter((id) => !initialPersisted.order.includes(id))];
	});

	// ── Persist column layout (visibility / order / pinning) ──
	// Skips the initial render so defaults are never written back immediately.
	const isFirstRenderRef = React.useRef(true);
	React.useEffect(() => {
		if (isFirstRenderRef.current) {
			isFirstRenderRef.current = false;
			return;
		}
		if (!persistStateKey) return;
		savePersistedColumnState(persistStateKey, {
			visibility: columnVisibility,
			order: columnOrder,
			// ColumnPinningState uses logical start/end regions (required arrays).
			pinning: { start: columnPinning.start, end: columnPinning.end },
		});
	}, [persistStateKey, columnVisibility, columnOrder, columnPinning]);

	// ── Row grouping ────────────────────────────────────
	const [grouping, setGroupingState] = React.useState<GroupingState>(() => [...(defaultGrouping ?? [])]);

	// Sync controlled grouping into internal state
	React.useEffect(() => {
		if (groupingProp != null) setGroupingState([...groupingProp]);
	}, [groupingProp]);

	const handleGroupingChange = React.useCallback(
		(updater: Updater<GroupingState>) => {
			const next = typeof updater === 'function' ? updater(grouping) : updater;
			setGroupingState([...next]);
			onGroupingChange?.(next);
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[groupingProp, onGroupingChange, grouping],
	);

	const setGrouping = React.useCallback((next: string[]) => setGroupingState([...next]), []);
	const toggleGrouping = React.useCallback((columnId: string) => {
		setGroupingState((prev) => (prev.includes(columnId) ? prev.filter((id) => id !== columnId) : [...prev, columnId]));
	}, []);

	// Convert rich filters to TanStack columnFilters format
	const columnFilters = React.useMemo(() => richFilters.map((f) => ({ id: f.id, value: f })), [richFilters]);

	// ── Data (client vs server) ───────────────────────────
	const isServerSide = fetchData != null;
	const [serverData, setServerData] = React.useState<TData[]>([]);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const fetchRef = React.useRef(fetchData);
	fetchRef.current = fetchData;

	// Extract primitives so the fetch effect depends on VALUES, not the identity
	// of the `cursorNav` object — a reset that re-creates the object with the same
	// values must not re-fire the fetch.
	const navCursor = cursorNav.cursor;
	const navDir = cursorNav.dir;
	const navOffset = cursorNav.offset;

	// Extract pagination members for stable effect deps
	const pageIndex = pagination.pageIndex;
	const pageSize = pagination.pageSize;

	// ── Server-side fetching ──────────────────────────────
	React.useEffect(() => {
		if (!isServerSide) return;
		let cancelled = false;

		async function load() {
			setLoading(true);
			setError(null);
			try {
				const s = sorting[0] ?? null;
				const params: FetchParams = {
					sorting: s ? { id: s.id, direction: s.desc ? 'desc' : 'asc' } : null,
					filters: richFilters,
					globalFilter,
					pagination: { pageIndex, pageSize },
					cursor: navCursor,
					cursorDir: navDir,
					grouping: grouping.length ? [...grouping] : undefined,
				};

				const result: FetchResult<TData> = await fetchRef.current!(params);

				if (!cancelled) {
					setServerData(result.rows);
					// Commit the cursors AND the offset together — one snapshot, so
					// Back/Next and the shown range always describe the same page.
					setCursorOffset(navOffset);
					setCursorState({
						nextCursor: result.nextCursor ?? null,
						prevCursor: result.prevCursor ?? null,
					});
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : 'Failed to fetch data');
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		}

		load();
		return () => {
			cancelled = true;
		};
		// `refreshKey` is an external nudge (bump after a write) that re-runs `load()`
		// WITHOUT touching any pagination/sort/filter state — unlike a remount.
	}, [
		isServerSide,
		sorting,
		richFilters,
		globalFilter,
		pageIndex,
		pageSize,
		navCursor,
		navDir,
		navOffset,
		grouping,
		fetchData,
		refreshKey,
	]);

	// ── Reset cursor when filters/sort/search/pageSize change ──
	const prevFiltersKeyRef = React.useRef('');
	React.useEffect(() => {
		const currentKey = JSON.stringify({
			sorting,
			richFilters,
			globalFilter,
			pageSize,
			grouping,
		});
		if (currentKey !== prevFiltersKeyRef.current) {
			prevFiltersKeyRef.current = currentKey;
			setCursorNav({ cursor: null, dir: 'after', offset: 0 });
			// Drop the committed cursors too. Keeping them while the walk resets to
			// page 1 would let a click page from a page we are no longer on.
			setCursorState({ nextCursor: null, prevCursor: null });
			setCursorOffset(0);
		}
	}, [sorting, richFilters, globalFilter, pageSize, grouping]);

	// ── TanStack Table ────────────────────────────────────
	const tableData = isServerSide ? serverData : externalData;

	// TanStack's useReactTable returns non-memoizable functions (React Compiler
	// limitation of the library itself) — disable that specific check here.

	const table = useLegacyTable<TData>({
		data: tableData,
		columns: tanStackColumns,
		state: {
			sorting,
			globalFilter,
			columnFilters,
			pagination,
			columnVisibility,
			columnPinning,
			columnOrder,
			expanded,
			grouping,
		},
		onSortingChange: setSorting,
		onGlobalFilterChange: setGlobalFilter,
		onColumnFiltersChange: ((updater: Updater<ColumnFiltersState>) => {
			const next = typeof updater === 'function' ? updater(columnFilters) : updater;
			const rich = next.filter((f) => f.value != null).map((f) => f.value as ActiveFilter);
			setRichFilters(rich);
		}) as import('@tanstack/react-table').OnChangeFn<ColumnFiltersState>,
		onPaginationChange: ((updater: Updater<TanStackPaginationState>) => {
			const next = typeof updater === 'function' ? updater(pagination as TanStackPaginationState) : updater;
			const nextState = next as PaginationState;
			if (nextState.pageSize !== pagination.pageSize) {
				onPageSizeChange?.(nextState.pageSize);
			}
			// When controlled externally, don't override pageSize from the updater
			if (pageSizeProp != null) {
				setPagination({
					pageIndex: nextState.pageIndex,
					pageSize: pageSizeProp,
				});
			} else {
				setPagination(nextState);
			}
		}) as import('@tanstack/react-table').OnChangeFn<TanStackPaginationState>,
		onColumnVisibilityChange: setColumnVisibility,
		onColumnPinningChange: setColumnPinning,
		onColumnOrderChange: setColumnOrder,
		onGroupingChange: handleGroupingChange as import('@tanstack/react-table').OnChangeFn<GroupingState>,

		onExpandedChange: ((updater: Updater<ExpandedState>) => {
			const next = typeof updater === 'function' ? updater(expanded) : updater;
			setExpanded(next);
			if (onExpandedRowIdsChange) {
				onExpandedRowIdsChange(
					next === true
						? (tableRef.current?.getCoreRowModel().flatRows ?? []).map((r) => r.id)
						: Object.keys(next).filter((id) => next[id]),
				);
			}
		}) as import('@tanstack/react-table').OnChangeFn<ExpandedState>,

		// Stable row identity — keyed by rowKey so expansion/selection survive
		// re-renders and default-expanded ids map to user data. Nested rows use
		// `parentId.childRowKey` (falling back to the child index) so ids stay
		// unique, readable and stable regardless of sort/filter order.
		getRowId: (originalRow, index, parent) => {
			const key = originalRow[rowKey];
			if (parent) {
				return `${parent.id}.${key == null ? index : String(key)}`;
			}
			return key == null ? String(index) : String(key);
		},
		getSubRows: getSubRows as ((row: TData) => TData[]) | undefined,
		getRowCanExpand: getRowCanExpand
			? (row) => getRowCanExpand(row.original)
			: getSubRows
				? undefined
				: renderSubComponent
					? () => true
					: undefined,

		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		// Grouping sits between filtering and expansion: groups are computed from
		// filtered rows, then expansion expands/collapses group children. Inert
		// when `grouping` is empty, so non-grouped tables render exactly as before.
		getGroupedRowModel: getGroupedRowModel(),
		// Expansion must wrap the filtered model but sit below pagination so
		// expanded children count toward the current page.
		getExpandedRowModel: getExpandedRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getFacetedRowModel: getFacetedRowModel(),

		// Grouping configuration
		enableGrouping,
		// Group columns keep their natural position in the grid (design parity
		// with the old inline group-value rendering). `false` = no reorder, no
		// removal (TanStack's "keep in place" mode).
		groupedColumnMode: false,
		// Column-level opt-out is honored via ColumnDef.enableGrouping, which
		// TanStack's column.getCanGroup() reads directly.

		globalFilterFn: globalFilterFn as TanStackColumnDef<TData>['filterFn'],

		manualFiltering: isServerSide,
		manualSorting: isServerSide,
		manualPagination: isServerSide,

		enableRowSelection,
		enableColumnFilters: true,
		// Column resizing — opt-in via `enableColumnResizing`.
		enableColumnResizing,
		columnResizeMode: 'onChange',

		// Grouping: aggregate cells opt in EXPLICITLY via ColumnDef.aggregationFn.
		// TanStack defaults every column to `aggregationFn: 'auto'` (numeric
		// columns would silently sum on group rows) — override to `undefined` so
		// group rows stay blank outside the group column unless opted in.
		defaultColumn: { aggregationFn: undefined },
	});
	tableRef.current = table;

	// ── Notify selection changes ──────────────────────────
	// Depend on the selection STATE (referentially stable until the selection
	// actually changes), NOT on the `table` instance. TanStack v9's useLegacyTable
	// mints a new wrapper object on every render (its inner useTable memo keys on
	// the options literal), so listing `table` as a dep re-fires this effect on
	// every render — and because onSelectionChange hands the parent a fresh array
	// each time, that drives an infinite parent↔child re-render loop
	// ("Maximum update depth exceeded") whenever a collection switch remounts the
	// table with row selection enabled. Read the live instance via tableRef.
	const rowSelection = table.getState().rowSelection;
	React.useEffect(() => {
		if (onSelectionChange) {
			const selectedRows = tableRef.current!.getSelectedRowModel().rows.map((r) => r.original);
			onSelectionChange(selectedRows);
		}
	}, [rowSelection, onSelectionChange]);

	// ── Computed totals ───────────────────────────────────
	const computedTotal = isServerSide
		? -1 // unknown in cursor mode
		: table.getFilteredRowModel().rows.length;

	// ── Cursor pagination (always cursor-based) ────────────
	const filteredCount = isServerSide ? -1 : table.getFilteredRowModel().rows.length;

	const cursorFrom = isServerSide ? cursorOffset : pageIndex * pageSize;
	const cursorTo = isServerSide ? cursorOffset + pageSize : Math.min((pageIndex + 1) * pageSize, Math.max(filteredCount, 0));
	// BOTH buttons read the SAME source — the cursors committed by the last
	// settled fetch. Deriving one from `cursorOffset` and the other from
	// `cursorState` let them disagree (offset 0 + a stale `nextCursor` reads as
	// "last page AND first page" → both disabled). The committed pair is one
	// consistent snapshot: a page advertises a neighbour only when the server
	// confirmed one. `loading` blocks a click from reading cursors that belong
	// to rows no longer on screen.
	const canGoPrevious = isServerSide ? !loading && cursorState.prevCursor != null : pageIndex > 0;
	const canGoNext = isServerSide ? !loading && cursorState.nextCursor != null : (pageIndex + 1) * pageSize < filteredCount;

	// ── Filter action creators ────────────────────────────
	const addFilter = React.useCallback((filter: ActiveFilter) => {
		setRichFilters((prev) => {
			const idx = prev.findIndex((f) => f.id === filter.id);
			if (idx >= 0) {
				const next = [...prev];
				next[idx] = filter;
				return next;
			}
			return [...prev, filter];
		});
		setPagination((p) => ({ ...p, pageIndex: 0 }));
	}, []);

	const removeFilter = React.useCallback((id: string) => {
		setRichFilters((prev) => prev.filter((f) => f.id !== id));
		setPagination((p) => ({ ...p, pageIndex: 0 }));
	}, []);

	const setFilters = React.useCallback((filters: ActiveFilter[]) => {
		setRichFilters(filters);
		setPagination((p) => ({ ...p, pageIndex: 0 }));
	}, []);

	const clearFilters = React.useCallback(() => {
		setRichFilters([]);
		setPagination((p) => ({ ...p, pageIndex: 0 }));
	}, []);

	// ── Expansion helpers ────────────────────────────────
	const getIsRowExpanded = React.useCallback(
		(rowId: string) => {
			const state = table.getState().expanded;
			return state === true || (!!state && !!state[rowId]);
		},
		[table],
	);

	const toggleRowExpanded = React.useCallback(
		(rowId: string, isExpanded?: boolean) => {
			table.getRow(rowId)?.toggleExpanded(isExpanded);
		},
		[table],
	);

	const expandAll = React.useCallback(() => {
		table.toggleAllRowsExpanded(true);
	}, [table]);

	const collapseAll = React.useCallback(() => {
		table.toggleAllRowsExpanded(false);
	}, [table]);

	// Computed inline (not memoized) — the table instance is stable across
	// renders, so memoizing on it would freeze the ids at the first render.
	const expandedState = table.getState().expanded;
	const expandedRowIds =
		expandedState === true
			? table.getCoreRowModel().flatRows.map((r) => r.id)
			: Object.keys(expandedState).filter((id) => expandedState[id]);

	// ── Cursor navigation ────────────────────────────────
	const goToNextPage = React.useCallback(() => {
		if (isServerSide) {
			if (cursorState.nextCursor) {
				setCursorNav({ cursor: cursorState.nextCursor, dir: 'after', offset: cursorOffset + pageSize });
			}
			return;
		}
		table.nextPage();
	}, [isServerSide, cursorState.nextCursor, cursorOffset, pageSize, table]);

	const goToPrevPage = React.useCallback(() => {
		if (isServerSide) {
			if (cursorState.prevCursor) {
				setCursorNav({ cursor: cursorState.prevCursor, dir: 'before', offset: Math.max(0, cursorOffset - pageSize) });
			}
			return;
		}
		table.previousPage();
	}, [isServerSide, cursorState.prevCursor, cursorOffset, pageSize, table]);

	// ── Sorting (single-column, compatible with our API) ──
	const sortState: SortState | null = sorting[0] ? { id: sorting[0].id, direction: sorting[0].desc ? 'desc' : 'asc' } : null;

	const isLoading = isLoadingProp ?? loading;
	const errorVal = errorProp ?? error;

	return {
		table: table as LegacyReactTable<TData>,
		totalCount: computedTotal,
		globalFilter,
		setGlobalFilter,
		grouping,
		setGrouping,
		toggleGrouping,
		addFilter,
		setFilters,
		removeFilter,
		clearFilters,
		columns: rawColumns,
		pagination,
		sorting: sortState,
		isLoading,
		error: errorVal,
		filters: richFilters,
		density,
		enableRowSelection,
		rowKey,
		onRowClick,
		enableRowExpansion,
		expandedRowIds,
		getIsRowExpanded,
		toggleRowExpanded,
		expandAll,
		collapseAll,
		cursorState,
		cursorFrom,
		cursorTo,
		canGoPrevious,
		canGoNext,
		goToNextPage,
		goToPrevPage,
	};
}
