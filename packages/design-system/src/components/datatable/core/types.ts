import type * as React from 'react';
import type { ColumnPinningState, RowData } from '@tanstack/react-table';
import type { LegacyColumn, LegacyReactTable, LegacyTable } from '@tanstack/react-table/legacy';
import type { KanbanCardRenderProps, ViewMode } from '@/kanban/core/types';

// ── Column Definition ──────────────────────────────────────

export type SortDirection = 'asc' | 'desc';

/** TanStack built-in aggregation functions usable for grouped rows + footer totals. */
export type AggregationFnName = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'unique' | 'uniqueCount';

export type FilterOperator =
	| 'equals'
	| 'not-equals'
	| 'contains'
	| 'not-contains'
	| 'starts-with'
	| 'ends-with'
	| 'gt'
	| 'gte'
	| 'lt'
	| 'lte'
	| 'between'
	| 'in'
	| 'not-in'
	| 'is-empty'
	| 'is-not-empty';

export type FilterType = 'text' | 'number' | 'select' | 'multi-select' | 'date' | 'date-range' | 'boolean';

export interface FilterDef {
	id: string;
	label: string;
	type: FilterType;
	operator?: FilterOperator;
	options?: Array<{ label: string; value: string }>;
	minDate?: Date;
	maxDate?: Date;
}

export interface ActiveFilter {
	id: string;
	operator: FilterOperator;
	value: unknown;
	valueTo?: unknown;
}

// ── Column Definition (TanStack-compatible) ───────────────

/**
 * Column definition. Fully compatible with TanStack Table's ColumnDef.
 * Extra fields (filter, width, align, etc.) are stored in `meta` and
 * accessed via `column.columnDef.meta` in custom cell/header renderers.
 */
export interface ColumnDef<TData extends RowData, TValue = unknown> {
	/** Unique column id */
	id: string;
	/** Accessor key (keyof TData) */
	accessorKey?: keyof TData & string;
	/** Custom accessor function */
	accessorFn?: (row: TData, index: number) => TValue;
	/** Header text or render function */
	header: string | ((props: { column: LegacyColumn<TData, TValue> }) => React.ReactNode);
	/** Custom cell render function */
	cell?: (props: { row: { original: TData; index: number; getValue: () => TValue }; value: TValue; index: number }) => React.ReactNode;
	/** Enable sorting. Defaults to true for most columns. */
	enableSorting?: boolean;
	/** Shorthand alias for enableSorting */
	sortable?: boolean;
	/** Custom sort function */
	sortFn?: (a: TValue, b: TValue, direction: SortDirection) => number;
	/** Whether this column can be hidden. Defaults to true. */
	enableHiding?: boolean;
	/** Column width — CSS value like "200px" or "15rem" */
	width?: string;
	/** Minimum column width (CSS) */
	minWidth?: string;
	/** Maximum column width (CSS) */
	maxWidth?: string;
	/** TanStack: fixed column width in px (number). Overrides width string. */
	size?: number;
	/** TanStack: min width in px */
	minSize?: number;
	/** TanStack: max width in px */
	maxSize?: number;
	/** Text alignment inside cells */
	align?: 'left' | 'center' | 'right';
	/** Whether column is visible by default (defaults to true) */
	defaultVisible?: boolean;
	/** Filter UI definition attached to this column */
	filter?: FilterDef;
	/** Custom filter function (client-side), overrides default operator matcher */
	filterFn?: (row: TData, filter: ActiveFilter) => boolean;
	/** CSS class for <th> */
	headerClassName?: string;
	/** CSS class for <td> */
	cellClassName?: string;
	/** Show tooltip on truncated content */
	enableTooltip?: boolean;
	/** Footer text or render function. Render prop receives the TanStack column +
	 *  table — `column.getAggregatedValue()` works when grouping is active.
	 *  `header` is the footer header (TanStack-compatible) for custom layouts. */
	footer?:
		string | ((props: { table: LegacyTable<TData>; column: LegacyColumn<TData, TValue>; header?: { id: string } }) => React.ReactNode);
	/** Allow this column to be pinned to left/right. Defaults to true. */
	enablePinning?: boolean;
	/** Allow this column to be a grouping column. Defaults to true. */
	enableGrouping?: boolean;
	/** Aggregation for grouped rows and footer totals. TanStack built-ins. */
	aggregationFn?: AggregationFnName;
	/** Allow this column to be reordered via drag. Defaults to true. */
	enableReordering?: boolean;
	/** Allow this column to be resized via its header handle. Defaults to true. */
	enableResizing?: boolean;
}

// ── Layout variants ─────────────────────────────────────

/**
 * Border rendering style for the table.
 * - `"row"` (default): horizontal borders between rows only
 * - `"all"`: full grid with borders on every cell
 * - `"column"`: vertical borders between columns only
 * - `"none"`: no internal borders
 */
export type BorderStyle = 'all' | 'column' | 'row' | 'none';

// ── Sort / Pagination ─────────────────────────────────────

export interface SortState {
	id: string;
	direction: SortDirection;
}

export interface PaginationState {
	pageIndex: number;
	pageSize: number;
}

export interface CursorState {
	/** Cursor returned by the last fetch for the next page */
	nextCursor: string | null;
	/** Cursor returned by the last fetch for the previous page */
	prevCursor: string | null;
}

// ── Fetch params & result ─────────────────────────────────

export interface FetchParams {
	sorting: SortState | null;
	filters: ActiveFilter[];
	globalFilter: string;
	pagination: PaginationState;
	/** The cursor to fetch from (cursor-based mode) */
	cursor?: string | null;
	/** Which side of `cursor` to fetch. `'after'` (default) = next page,
	 *  `'before'` = previous page. Lets server-mode consumers emit the API's
	 *  `dir` so a backward walk actually moves back. */
	cursorDir?: 'after' | 'before';
	/** Active grouping column ids — lets server-mode consumers switch to `?groupBy[]=`.
	 *  Optional so existing server-mode callers stay source-compatible. */
	grouping?: string[];
}

export interface FetchResult<TData> {
	rows: TData[];
	/** Cursor for the next page */
	nextCursor?: string | null;
	/** Cursor for the previous page */
	prevCursor?: string | null;
}

// ── DataTable Instance (exposed to toolbarActions) ────────

export interface DataTableInstance<TData extends RowData> {
	/** TanStack table instance */
	table: LegacyReactTable<TData>;
	/** Total row count (before pagination). `-1` in server-side cursor mode. */
	totalCount: number;
	/** Current global filter value */
	globalFilter: string;
	/** Set global filter */
	setGlobalFilter: (value: string) => void;
	/** Active grouping column ids */
	grouping: string[];
	/** Set grouping column ids */
	setGrouping: (grouping: string[]) => void;
	/** Toggle a column in/out of the grouping state */
	toggleGrouping: (columnId: string) => void;
	/** Add/update a column filter */
	addFilter: (filter: ActiveFilter) => void;
	/** Replace all column filters atomically */
	setFilters: (filters: ActiveFilter[]) => void;
	/** Remove a column filter by column id */
	removeFilter: (id: string) => void;
	/** Remove all column filters */
	clearFilters: () => void;
	/** Row ids that are currently expanded (rowKey values, or nested `parentId.childRowKey` ids) */
	expandedRowIds: string[];
	/** Whether a row is expanded by its row id */
	getIsRowExpanded: (rowId: string) => boolean;
	/** Toggle a single row's expanded state. Pass `expanded` to force a state. */
	toggleRowExpanded: (rowId: string, expanded?: boolean) => void;
	/** Expand every row */
	expandAll: () => void;
	/** Collapse every row */
	collapseAll: () => void;
}

// ── Labels ────────────────────────────────────────────────

export interface DataTableLabels {
	searchPlaceholder?: string;
	noResults?: string;
	empty?: string;
	filters?: string;
	clearFilters?: string;
	columns?: string;
	loading?: string;
	retry?: string;
	/** Label for the built-in "Create" button. Defaults to `"Create"`. */
	create?: string;
	/** Error-state heading. Defaults to `"Failed to load data"`. */
	errorTitle?: string;
	/** aria-label for expanding a grouped row. Defaults to `"Expand group"`. */
	groupExpand?: string;
	/** aria-label for collapsing a grouped row. Defaults to `"Collapse group"`. */
	groupCollapse?: string;
}

// ── Kanban view configuration ────────────────────────────

/**
 * Configures the built-in Kanban view of the DataTable.
 *
 * Rows are grouped into kanban columns by the value of `groupByColumnId`
 * (e.g. a `status` column). Card content reuses the column definitions'
 * `cell` renderers, so formatting stays identical between the two views.
 */
export interface KanbanTableConfig<TData> {
	/**
	 * Column id whose value groups rows into kanban columns.
	 * The column's `filter.options` (when present) define the column order.
	 */
	groupByColumnId: string;
	/**
	 * Column id used as the card title. Defaults to the first column
	 * in the column definitions.
	 */
	titleColumnId?: string;
	/**
	 * Column ids rendered as compact summary cells on each card.
	 * Defaults to all columns except the title and group columns (max 3).
	 */
	summaryColumnIds?: string[];
	/** Row key used as the kanban item id. Defaults to the table's `rowKey` ("id"). */
	rowKey?: keyof TData & string;
	/** Fixed kanban column width (CSS value). Default: "20rem" */
	columnWidth?: string;
	/** Gap between kanban columns (CSS value). Default: "1rem" */
	columnGap?: string;
	/** Maximum board height (CSS value). Enables vertical scrolling. */
	maxHeight?: string;
	/** Enable drag-and-drop item reordering in the kanban view. */
	reorderItems?: boolean;
	/**
	 * Called after a card is dragged to a new column/position.
	 * Use it to update the underlying data (e.g. change the row's group
	 * column value) so the table view stays in sync.
	 */
	onItemMove?: (event: { item: TData; sourceColumnId: string; targetColumnId: string; newIndex: number }) => void;
	/**
	 * Custom card renderer. Receives the standard kanban card render props
	 * with the row as the item. Defaults to `DataTableKanbanCard`.
	 */
	renderCard?: (props: KanbanCardRenderProps<TData & { id: string }>) => React.ReactNode;
	/**
	 * Custom titles for group values — key: group value, value: column title.
	 * Defaults to the raw group value.
	 */
	columnTitles?: Record<string, string>;
	/**
	 * Explicit order of kanban columns (group values). Defaults to the
	 * groupBy column's `filter.options` order, then first-seen row order.
	 */
	columnOrder?: string[];
	/** Title used for the column holding rows with no group value. */
	emptyGroupLabel?: string;
}

// ── DataTable Props ───────────────────────────────────────

export type Density = 'compact' | 'comfortable' | 'spacious';

export interface DataTableProps<TData extends RowData> {
	/** Column definitions */
	columns: ColumnDef<TData>[];
	/** Data rows (client-side mode) */
	data?: TData[];
	/**
	 * Server-side fetch callback. When provided, enables server-side mode.
	 * Cursor-based: return `nextCursor`/`prevCursor` for navigation.
	 */
	fetchData?: (params: FetchParams) => Promise<FetchResult<TData>>;
	/**
	 * An external re-fetch signal. Bump it after a write to reload the CURRENT page
	 * (same page, sort, filter, search and cursor) — the state-preserving alternative
	 * to remounting the table with a new `key`, which resets all of that. Ignored in
	 * client-side mode.
	 */
	refreshKey?: number;
	/** Initial page size */
	defaultPageSize?: number;
	/** Controlled page size (overrides internal state when provided with onPageSizeChange) */
	pageSize?: number;
	/** Called when the user changes the page size */
	onPageSizeChange?: (pageSize: number) => void;
	/** Initial sort state */
	defaultSorting?: SortState | null;
	/**
	 * Columns pinned by default (TanStack `ColumnPinningState` shape).
	 * @example
	 * ```tsx
	 * defaultColumnPinning={{ start: ["name"], end: ["actions"] }}
	 * ```
	 */
	defaultColumnPinning?: ColumnPinningState;
	/** Show the toolbar (search + filter trigger + actions) */
	showToolbar?: boolean;
	/** Show active filter chips bar */
	showFilterBar?: boolean;
	/** Density preset */
	density?: Density;
	/** Row key accessor — defaults to "id" */
	rowKey?: keyof TData & string;
	/** Enable row selection */
	enableRowSelection?: boolean;
	/** Callback when selection changes */
	onSelectionChange?: (selectedRows: TData[]) => void;
	/** Custom labels for i18n */
	labels?: DataTableLabels;
	/** CSS class for the wrapper */
	className?: string;
	/** Show loading skeleton */
	isLoading?: boolean;
	/** Error state */
	error?: string | null;
	/** Row click callback */
	onRowClick?: (row: TData) => void;
	/**
	 * Custom actions rendered on the right side of the toolbar.
	 * Receives the DataTableInstance for access to the underlying table.
	 *
	 * @example
	 * ```tsx
	 * toolbarActions={(table) => (
	 *   <Button onClick={() => exportCSV(table.table.getFilteredRowModel().rows)}>
	 *     Export CSV
	 *   </Button>
	 * )}
	 * ```
	 */
	toolbarActions?: React.ReactNode | ((table: DataTableInstance<TData>) => React.ReactNode);
	/**
	 * When true, toolbar buttons (Filters, Columns) show only icons
	 * without text labels. Ideal for compact layouts or narrow containers.
	 */
	toolbarIconOnly?: boolean;
	/**
	 * Border rendering style.
	 * @default "row"
	 */
	borderStyle?: BorderStyle;
	/**
	 * Enable zebra striping — alternating row background colors.
	 * @default false
	 */
	striped?: boolean;
	/**
	 * Make the header row sticky — stays visible when scrolling vertically.
	 * Requires the table to be inside a scroll container with a defined height.
	 * @default false
	 */
	stickyHeader?: boolean;
	/**
	 * Enable column resizing via a drag handle on each column header.
	 * Double-click a handle to reset the column to its default width.
	 * @default false
	 */
	enableColumnResizing?: boolean;
	/**
	 * Enable column reordering via drag-and-drop.
	 * When true, a grip handle appears on each column header.
	 * @default false
	 */
	enableColumnReordering?: boolean;
	/**
	 * Enable row reordering via drag-and-drop.
	 * When true, a grip handle appears on each row.
	 * Requires `onRowReorder` callback.
	 * @default false
	 */
	enableRowReordering?: boolean;
	/**
	 * Callback when rows are reordered via drag-and-drop.
	 * Receives the reordered data array.
	 */
	onRowReorder?: (reorderedData: TData[]) => void;
	/**
	 * Make the toolbar + filter bar sticky so they remain visible
	 * when scrolling. The offset defaults to `top-0` (use `top-12`
	 * when inside an AppShell to sit below its breadcrumb header).
	 * @default false
	 */
	toolbarSticky?: boolean;
	/**
	 * When provided, a "Create" button appears at the top right of the toolbar.
	 * Clicking it calls this callback.
	 */
	onCreate?: () => void;
	/**
	 * Determine whether an individual row can be expanded. When omitted:
	 * - rows with sub-rows (via `getSubRows`) are expandable automatically
	 * - every row is expandable when `renderSubComponent` is provided
	 */
	getRowCanExpand?: (row: TData) => boolean;
	/**
	 * Custom content rendered in a full-width detail row below an expanded row.
	 * Use this for master–detail layouts.
	 *
	 * @example
	 * ```tsx
	 * renderSubComponent={({ row }) => (
	 *   <div className="p-4">Details for {row.name}</div>
	 * )}
	 * ```
	 */
	renderSubComponent?: (props: { row: TData; index: number }) => React.ReactNode;
	/**
	 * Return the child rows of a row to build a nested (tree) table.
	 * Child rows are rendered as indented rows below their parent when expanded.
	 */
	getSubRows?: (originalRow: TData) => TData[];
	/**
	 * Row ids (values of `rowKey`) expanded by default.
	 * Nested children use the composite id `parentId.childRowKey`
	 * (e.g. `"dept-eng.lead-alice"`). Ignored when `expandedRowIds` is controlled.
	 */
	defaultExpandedRowIds?: string[];
	/**
	 * Controlled expanded row ids. Provide with `onExpandedRowIdsChange` for full control.
	 */
	expandedRowIds?: string[];
	/** Called whenever the set of expanded row ids changes */
	onExpandedRowIdsChange?: (rowIds: string[]) => void;

	// ── Row grouping (TanStack getGroupedRowModel) ────────────
	/**
	 * Enable row grouping. When active, rows are collapsed into group rows on
	 * the grouping column(s); expand chevrons toggle groups. Group counts
	 * reflect the currently loaded rows (current page in server mode).
	 * @default false
	 */
	enableGrouping?: boolean;
	/**
	 * Controlled grouping column ids.
	 * @example
	 * ```tsx
	 * grouping={['status', 'category']}
	 * ```
	 */
	grouping?: string[];
	/** Uncontrolled initial grouping column ids. */
	defaultGrouping?: string[];
	/** Called when the grouping state changes. */
	onGroupingChange?: (grouping: string[]) => void;
	/**
	 * Expand every group by default (grouping mode).
	 * @default false
	 */
	defaultExpandAll?: boolean;
	/**
	 * Render a `<tfoot>` summary row from `table.getFooterGroups()`.
	 * Column `footer` renderers receive `{ table, column }` — use
	 * `column.getAggregatedValue()` when grouping is active.
	 * @default false
	 */
	showFooter?: boolean;
	/**
	 * Persist column layout (visibility / order / pinning) to localStorage
	 * under this key. Restored on mount; unknown columns from stale state are
	 * dropped. Best-effort — no data is sent to the server.
	 * @example
	 * ```tsx
	 * persistStateKey={`${collection}:list`}
	 * ```
	 */
	persistStateKey?: string;

	// ── View mode (Table / Kanban) ──────────────────────────
	/**
	 * Controlled view mode. When omitted, the DataTable tracks
	 * `defaultViewMode` internally.
	 */
	viewMode?: ViewMode;
	/** Uncontrolled initial view mode. Defaults to `"table"`. */
	defaultViewMode?: ViewMode;
	/** Called when the user switches between Table and Kanban views. */
	onViewModeChange?: (mode: ViewMode) => void;
	/**
	 * Kanban view configuration. When provided, the toolbar shows the
	 * icon-only [Table | Kanban] toggle at the top-right and the data can be
	 * rendered as a kanban board grouped by `groupByColumnId`.
	 */
	kanban?: KanbanTableConfig<TData>;
	/**
	 * Force-show/hide the view-mode toggle. Defaults to showing it whenever
	 * `kanban` config is provided.
	 */
	showViewModeToggle?: boolean;
}
