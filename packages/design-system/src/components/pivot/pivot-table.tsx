'use client';

import * as React from 'react';
import { cn } from '@/utils';
import { Button } from '@/button';
import { Skeleton } from '@/skeleton';
import { PaginationCursor } from '@/pagination';
import { SearchBox } from '@/search-box';
import { NativeSelect, NativeSelectOption } from '@/native-select';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@/combobox';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/dropdown-menu';
import {
	ArrowLeftRightIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	ChevronUpIcon,
	ChevronsDownUpIcon,
	ChevronsUpDownIcon,
	Columns3Icon,
	DownloadIcon,
	SigmaIcon,
	SlidersHorizontalIcon,
} from 'lucide-react';

/**
 * Pivot (cross-tabulation) table — presentational only.
 *
 * Renders the API's pivot report result (`rows` + `columns`) as an
 * enterprise-grade grid with the DataTable's toolbar conventions: search on
 * the left, pagination at the top-right level with the search, sorting,
 * column show/hide, totals, loading/error/empty states — all client-side over
 * the provided rows. The DS never fetches; data arrives via props.
 */

export type PivotDensity = 'compact' | 'comfortable' | 'spacious';
export type PivotBorderStyle = 'row' | 'all' | 'none';

export interface PivotLabels {
	/** Toolbar search placeholder. Defaults to `"Search…"`. */
	searchPlaceholder?: string;
	/** Result summary when a search/filter has no matches. Defaults to `"No matching rows"`. */
	noResults?: string;
	/** Empty state (no rows at all). Defaults to `"No data"`. */
	empty?: string;
	/** Loading hint. Defaults to `"Loading…"`. */
	loading?: string;
	/** Error-state heading. Defaults to `"Failed to load pivot"`. */
	errorTitle?: string;
	/** Columns toggle button label. Defaults to `"Columns"`. */
	columns?: string;
	/** Page-size selector label. Defaults to `"Rows per page"`. */
	pageSize?: string;
	/** Measure selector label. Defaults to `"Measure"`. */
	measure?: string;
	/** Customize-panel trigger tooltip/aria. Defaults to `"Customize"`. */
	customize?: string;
	/** Flip-axis button tooltip/aria. Defaults to `"Flip axis"`. */
	flipAxis?: string;
	/** Expand-all button tooltip/aria. Defaults to `"Expand all"`. */
	expandAll?: string;
	/** Collapse-all button tooltip/aria. Defaults to `"Collapse all"`. */
	collapseAll?: string;
	/** Export button label. Defaults to `"Export"`. */
	export?: string;
	/** Export menu item for CSV. Defaults to `"CSV"`. */
	exportCsv?: string;
	/** Export menu item for Excel (.xlsx). Defaults to `"Excel"`. */
	exportXlsx?: string;
	/** Totals row/column label. Defaults to `"Total"`. */
	total?: string;
	/** Empty-cell placeholder. Defaults to `"—"`. */
	emptyCell?: string;
	/** aria-label prefix for sorting a column. Defaults to `"Sort"`. */
	sort?: string;
}

/** Params handed to `fetchData` (server mode) — the app controls data bounds. */
export interface PivotFetchParams {
	/** Current search query (the app may translate it into a server filter). */
	search: string;
	/** Current sort (the app may translate it into server ordering). */
	sort: { key: string; dir: 'asc' | 'desc' } | null;
	/** Currently selected measure key (the app re-executes with that measure). */
	measure?: string;
}

export interface PivotFetchResult {
	rows: Array<Record<string, unknown>>;
	columns: string[];
}

/** Drill-down cell context passed to `onCellClick`. */
export interface PivotCellClick {
	row: Record<string, unknown>;
	/** The clicked column key, or null for the row-label cell. */
	column: string | null;
	rowIndex: number;
}

export interface PivotTableProps {
	/** Pivot rows from the API: `{ [rowGroup]: label, [colValue]: value, … }`. */
	rows: Array<Record<string, unknown>>;
	/** Distinct column-group values (the cross-tab columns), in display order. */
	columns: string[];
	/** Row-group field name — the label column. */
	rowLabel: string;
	/** Key inside each row that holds the row label. Defaults to `rowLabel`. */
	valueKey?: string;
	/** Header for the value-column group. Defaults to `rowLabel`. */
	aggregateLabel?: string;
	/** Render a totals row (bottom) + totals column (right), client-side sums. */
	showTotals?: boolean;
	density?: PivotDensity;
	borderStyle?: PivotBorderStyle;
	striped?: boolean;
	/** Keep the header row sticky when scrolling vertically (bounded container). */
	stickyHeader?: boolean;
	/**
	 * Fill the parent's height (spreadsheet-style workspace): the container
	 * becomes a column flex of the parent's height, the toolbar stays put and
	 * the table scrolls vertically inside the remaining space. Use inside a
	 * definite-height flex chain (e.g. the runtime pivot view + customize column).
	 */
	fillHeight?: boolean;
	/** Show the toolbar (search + pagination + page size + columns toggle). Defaults to true. */
	showToolbar?: boolean;
	/**
	 * Enable pagination. When set, rows are split into pages of this size and
	 * the toolbar shows a page-size selector + cursor navigation.
	 * @default 10 (pagination off when omitted)
	 */
	defaultPageSize?: number;
	/** Enable column show/hide from the toolbar. Defaults to true. */
	enableColumnVisibility?: boolean;
	/** Show a loading skeleton over the table. */
	isLoading?: boolean;
	/** Error message — renders an error state instead of the table. */
	error?: string | null;
	/** Row click callback. */
	onRowClick?: (row: Record<string, unknown>, rowIndex: number) => void;
	/**
	 * Server mode: fetch the (bounded) matrix from the app — e.g. the app calls
	 * `/api/reports/execute` with rowLimit/topNColumns. Re-fetches when search
	 * or sort change (debounced). Client-side sort/search/pagination still apply
	 * on top of the fetched result.
	 */
	fetchData?: (params: PivotFetchParams) => Promise<PivotFetchResult>;
	/** Drill-down hook — fired when a value cell or the row-label cell is clicked. */
	onCellClick?: (cell: PivotCellClick) => void;
	/** Show an Export button in the toolbar. Calls `onExport` (the app downloads the file). */
	showExport?: boolean;
	/** Download handler — receives the chosen format (defaults to the first of `exportFormats`). */
	onExport?: (format?: 'csv' | 'xlsx') => void;
	/**
	 * Export formats offered when `showExport` is set. One format renders a plain
	 * button; two render a small dropdown menu. Defaults to `['csv']`.
	 */
	exportFormats?: Array<'csv' | 'xlsx'>;
	/** Pivot settings group: flip the rows ↔ columns axes (the app re-executes). */
	onFlipAxis?: () => void;
	/** Pivot settings group: expand all / collapse all hierarchy groups. */
	onToggleHierarchy?: () => void;
	/**
	 * Customize trigger — the app renders its own Data-Studio-style panel
	 * (Y axis / X axis / measure). Shows a toolbar button when provided.
	 */
	onCustomize?: () => void;
	/** Highlight the customize button while the app's panel is open. */
	customizeActive?: boolean;
	/**
	 * Odoo-style measure selector — the measures the end user may switch between
	 * (e.g. "Sum of amount", "Count"). When provided, the toolbar shows a
	 * searchable combobox and `onMeasureChange` fires (the app re-executes with
	 * the chosen measure).
	 */
	measures?: Array<{ key: string; label: string }>;
	/** Currently selected measure key. Defaults to the first of `measures`. */
	measure?: string;
	/** Fired when the end user picks a different measure. */
	onMeasureChange?: (key: string) => void;
	labels?: PivotLabels;
	className?: string;
}

const densityMap: Record<PivotDensity, string> = {
	compact: 'h-8 px-3 py-0',
	comfortable: 'h-10 px-3 py-1.5',
	spacious: 'h-12 px-3 py-2.5',
};

const PAGE_SIZES = [5, 10, 25, 50];

function formatCell(value: unknown): string {
	if (value == null || value === '') return '';
	if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
	return String(value);
}

function isNumericCell(value: unknown): boolean {
	return typeof value === 'number' && Number.isFinite(value);
}

type SortDir = 'asc' | 'desc';
interface SortState {
	key: string;
	dir: SortDir;
}

function compareValues(a: unknown, b: unknown): number {
	if (a == null && b == null) return 0;
	if (a == null) return 1;
	if (b == null) return -1;
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	if (typeof a === 'number') return -1;
	if (typeof b === 'number') return 1;
	return String(a).localeCompare(String(b));
}

function cellClass(borderStyle: PivotBorderStyle, index: number, numeric: boolean, header = false): string {
	return cn(
		'align-middle text-sm',
		borderStyle === 'all' ? 'border-b border-r last:border-r-0' : 'border-b',
		header && 'bg-muted/40 font-medium text-foreground',
		numeric && 'text-right font-variant-numeric:tabular-nums',
	);
}

/**
 * Header sort button — module-level so its identity is stable across renders
 * (an inline definition would unmount/remount the DOM node on every render).
 * Mirrors the DataTable header's hover-pill treatment.
 */
function SortButton({
	sortKey,
	sort,
	cycleSort,
	sortLabel,
	children,
}: {
	sortKey: string;
	sort: SortState | null;
	cycleSort: (key: string) => void;
	sortLabel?: string;
	children: React.ReactNode;
}) {
	const active = sort?.key === sortKey;
	return (
		<button
			type="button"
			data-slot="pivot-sort-button"
			aria-label={`${sortLabel ?? 'Sort'} by ${String(children)}`}
			onClick={() => cycleSort(sortKey)}
			className="inline-flex max-w-full cursor-pointer items-center gap-1 transition-colors group-hover:bg-muted-foreground/10 hover:bg-muted-foreground/10"
		>
			<span className="-ml-1 truncate rounded px-1 font-semibold capitalize">{children}</span>
			{active && (sort!.dir === 'asc' ? <ChevronUpIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />)}
		</button>
	);
}

/**
 * Pivot table — enterprise-grade cross-tab. See {@link PivotTableProps}.
 */
export function PivotTable({
	rows,
	columns,
	rowLabel,
	valueKey,
	aggregateLabel,
	showTotals = false,
	density = 'comfortable',
	borderStyle = 'row',
	striped = false,
	stickyHeader = false,
	fillHeight = false,
	showToolbar = true,
	defaultPageSize,
	enableColumnVisibility = true,
	isLoading = false,
	error = null,
	onRowClick,
	onCellClick,
	showExport = false,
	onExport,
	exportFormats = ['csv'],
	measures,
	measure,
	onMeasureChange,
	onFlipAxis,
	onCustomize,
	customizeActive = false,
	fetchData,
	labels,
	className,
}: PivotTableProps) {
	const labelKey = valueKey ?? rowLabel;
	const totalLabel = labels?.total ?? 'Total';
	const emptyCell = labels?.emptyCell ?? '\u2014';
	const formats: Array<'csv' | 'xlsx'> = exportFormats.length > 0 ? exportFormats : ['csv'];
	const effectiveMeasure = measure ?? measures?.[0]?.key;

	// ── Pagination (page size is user-adjustable via the toolbar) ──
	const [pageSizeState, setPageSizeState] = React.useState<number | null>(null);
	const effectivePageSize = pageSizeState ?? defaultPageSize ?? 0;
	const paginated = effectivePageSize > 0;

	// ── Search ───────────────────────────────────────────
	const [search, setSearch] = React.useState('');
	const query = search.trim().toLowerCase();

	// ── Sort ─────────────────────────────────────────────
	const [sort, setSort] = React.useState<SortState | null>(null);
	const cycleSort = (key: string) =>
		setSort((prev) => (prev?.key !== key ? { key, dir: 'asc' } : prev.dir === 'asc' ? { key, dir: 'desc' } : null));

	// ── Server mode ──────────────────────────────────────
	// `fetchData` supplies the (bounded) matrix; re-fetches when search/sort
	// change (debounced search). Client-side sort/search/pagination still apply
	// on top of the fetched rows.
	const [serverResult, setServerResult] = React.useState<PivotFetchResult | null>(null);
	const [serverLoading, setServerLoading] = React.useState(false);
	const searchTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	React.useEffect(() => {
		if (!fetchData) return;
		let cancelled = false;
		if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
		searchTimerRef.current = setTimeout(() => {
			setServerLoading(true);
			fetchData({ search, sort, measure: effectiveMeasure })
				.then((r) => {
					if (!cancelled) setServerResult(r);
				})
				.catch(() => {
					if (!cancelled) setServerResult(null);
				})
				.finally(() => {
					if (!cancelled) setServerLoading(false);
				});
		}, 300);
		return () => {
			cancelled = true;
			if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
		};
	}, [fetchData, search, sort, measure, effectiveMeasure]);
	const effectiveRows = serverResult?.rows ?? rows;
	const effectiveColumns = serverResult?.columns ?? columns;
	const effectiveLoading = isLoading || serverLoading;

	// ── Column visibility ────────────────────────────────
	const [hiddenColumns, setHiddenColumns] = React.useState<Set<string>>(() => new Set());
	const visibleColumns = React.useMemo(() => effectiveColumns.filter((c) => !hiddenColumns.has(c)), [effectiveColumns, hiddenColumns]);
	const toggleColumn = (col: string) =>
		setHiddenColumns((prev) => {
			const next = new Set(prev);
			if (next.has(col)) next.delete(col);
			else next.add(col);
			return next;
		});

	// ── Filtered / sorted / paginated rows ───────────────
	const filteredRows = React.useMemo(() => {
		if (!query) return effectiveRows;
		return effectiveRows.filter((r) => {
			if (
				String(r[labelKey] ?? '')
					.toLowerCase()
					.includes(query)
			)
				return true;
			return visibleColumns.some((col) =>
				String(r[col] ?? '')
					.toLowerCase()
					.includes(query),
			);
		});
	}, [effectiveRows, query, labelKey, visibleColumns]);

	const sortedRows = React.useMemo(() => {
		if (!sort) return filteredRows;
		const factor = sort.dir === 'asc' ? 1 : -1;
		return [...filteredRows].sort((a, b) => compareValues(a[sort.key], b[sort.key]) * factor);
	}, [filteredRows, sort]);

	const [pageIndex, setPageIndex] = React.useState(0);
	// Reset pagination whenever the result set changes.
	React.useEffect(() => {
		setPageIndex(0);
	}, [query, sort, hiddenColumns]);

	const pageCount = paginated ? Math.max(1, Math.ceil(sortedRows.length / effectivePageSize)) : 1;
	const safePageIndex = Math.min(pageIndex, pageCount - 1);
	const pageRows = paginated ? sortedRows.slice(safePageIndex * effectivePageSize, (safePageIndex + 1) * effectivePageSize) : sortedRows;
	const from = paginated ? safePageIndex * effectivePageSize + 1 : 0;
	const to = paginated ? Math.min((safePageIndex + 1) * effectivePageSize, sortedRows.length) : sortedRows.length;

	// ── Hierarchy (Odoo-style subtotal groups with expand/collapse) ──
	// The engine marks subtotal rows with `__subtotal` and appends each group's
	// total AFTER its leaves. We rebuild that into a display tree: the subtotal
	// row becomes the group HEADER (rendered first, like Odoo's "Total"), its
	// leaves follow indented, and the header toggles them. "Expand all / Collapse
	// all" flips every group at once.
	const isSubtotal = (row: Record<string, unknown>) => row.__subtotal === true;
	const leafRows = React.useMemo(() => effectiveRows.filter((r) => !isSubtotal(r)), [effectiveRows]);
	const hasHierarchy = React.useMemo(() => pageRows.some(isSubtotal), [pageRows]);
	const [collapsedGroups, setCollapsedGroups] = React.useState<Set<number>>(() => new Set());
	const [allCollapsed, setAllCollapsed] = React.useState(false);

	const hierarchy = React.useMemo(() => {
		if (!hasHierarchy) return null;
		const out: Array<{ row: Record<string, unknown>; indent: number; isHeader: boolean; groupIndex: number }> = [];
		const pending: Array<Record<string, unknown>> = [];
		let groupIndex = 0;
		const flush = (subtotal: Record<string, unknown>) => {
			out.push({ row: subtotal, indent: 0, isHeader: true, groupIndex });
			for (const leaf of pending) out.push({ row: leaf, indent: 1, isHeader: false, groupIndex });
			pending.length = 0;
			groupIndex++;
		};
		for (const r of pageRows) {
			if (isSubtotal(r)) flush(r);
			else pending.push(r);
		}
		for (const leaf of pending) out.push({ row: leaf, indent: 0, isHeader: false, groupIndex: -1 });
		return out;
	}, [pageRows, hasHierarchy]);

	const renderRows = React.useMemo(() => {
		if (!hierarchy) return pageRows.map((row) => ({ row, indent: 0, isHeader: false, groupIndex: -1 }));
		return hierarchy.filter((r) => r.isHeader || (!allCollapsed && !collapsedGroups.has(r.groupIndex)));
	}, [hierarchy, pageRows, allCollapsed, collapsedGroups]);

	const toggleGroup = (index: number) =>
		setCollapsedGroups((prev) => {
			const next = new Set(prev);
			if (next.has(index)) next.delete(index);
			else next.add(index);
			return next;
		});
	const toggleHierarchy = () => setAllCollapsed((v) => !v);

	// ── Totals (over leaf rows only — subtotal rows must not double-count) ──
	const columnTotals = React.useMemo(() => {
		if (!showTotals) return null;
		const sums: Record<string, number> = {};
		for (const col of visibleColumns) {
			sums[col] = leafRows.reduce((acc, r) => (isNumericCell(r[col]) ? acc + (r[col] as number) : acc), 0);
		}
		return sums;
	}, [leafRows, visibleColumns, showTotals]);

	const rowTotal = (row: Record<string, unknown>): number =>
		visibleColumns.reduce((acc, col) => (isNumericCell(row[col]) ? acc + (row[col] as number) : acc), 0);
	const grandTotal = columnTotals ? Object.values(columnTotals).reduce((a, b) => a + b, 0) : 0;

	const sortableHeaderProps = (key: string): React.AriaAttributes => ({
		'aria-sort': sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined,
	});

	// Header cell — sticky top when stickyHeader (matches the DataTable: header
	// z-2 above body sticky cells at z-1; the corner cell also sticks left at z-3).
	const headerCellClass = cn(densityMap[density], cellClass(borderStyle, 0, false, true), stickyHeader && 'sticky top-0 z-2');
	const cornerCellClass = cn(headerCellClass, 'sticky left-0 z-3');

	// ── Multi-level column headers (composite `a|b|c` keys) ──
	// The engine emits composite column keys (`region|status`, `region|status|sum_total`)
	// when a pivot has multiple column dims / measures. When every visible column
	// shares the same segment count (>= 2) we render a stacked header: group rows
	// on top and a sortable leaf row at the bottom. Mixed-depth keys (e.g. `Other`
	// after top-N) fall back to the flat single-row header.
	const headerDepth = React.useMemo(() => {
		if (visibleColumns.length === 0) return 1;
		const depths = new Set(visibleColumns.map((c) => c.split('|').length));
		return depths.size === 1 ? visibleColumns[0].split('|').length : 1;
	}, [visibleColumns]);

	const headerGroupRows = React.useMemo(() => {
		if (headerDepth <= 1) return [];
		const rows: Array<Array<{ label: string; colSpan: number }>> = [];
		for (let l = 0; l < headerDepth - 1; l++) {
			const groups: Array<{ label: string; colSpan: number }> = [];
			let i = 0;
			while (i < visibleColumns.length) {
				const segs = visibleColumns[i].split('|');
				const prefix = segs.slice(0, l + 1).join('|');
				let j = i;
				while (
					j < visibleColumns.length &&
					visibleColumns[j]
						.split('|')
						.slice(0, l + 1)
						.join('|') === prefix
				)
					j++;
				groups.push({ label: segs[l], colSpan: j - i });
				i = j;
			}
			rows.push(groups);
		}
		return rows;
	}, [headerDepth, visibleColumns]);

	// Multi-level headers drop the top-sticky behavior (stacked rows need pixel
	// math to stick cleanly) — the corner keeps its left-sticky treatment.
	const multiCornerCellClass = cn(densityMap[density], cellClass(borderStyle, 0, false, true), 'sticky left-0 z-3');
	const multiGroupCellClass = cn(densityMap[density], cellClass(borderStyle, 0, false, true));

	// ── Toolbar — mirrors DataTableToolbar: search left, pagination right,
	// level with the search (pagination rendered top-right, NOT under the table).
	const paginationNode =
		paginated && sortedRows.length > 0 ? (
			<PaginationCursor
				from={from}
				to={to}
				canPrevious={safePageIndex > 0}
				canNext={safePageIndex < pageCount - 1}
				onPrevious={() => setPageIndex((p) => p - 1)}
				onNext={() => setPageIndex((p) => p + 1)}
			/>
		) : null;

	const toolbar = showToolbar ? (
		<div data-slot="pivot-toolbar" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			{/* ── LEFT: Global search ──────────────────── */}
			<div className="w-full sm:max-w-sm">
				<SearchBox
					value={search}
					onValueChange={setSearch}
					onClear={() => setSearch('')}
					placeholder={labels?.searchPlaceholder ?? 'Search…'}
					className="z-20 mt-1 w-50"
					inputClassName="h-7!"
				/>
			</div>

			{/* ── RIGHT: Pagination (level with search) + page size + columns ── */}
			<div className="flex items-center gap-1.5">
				{paginationNode && (
					<div data-slot="pivot-pagination" className="flex items-center">
						{paginationNode}
					</div>
				)}
				{paginated && (
					<NativeSelect
						value={String(effectivePageSize)}
						onChange={(e) => {
							setPageSizeState(Number(e.target.value));
							setPageIndex(0);
						}}
						aria-label={labels?.pageSize ?? 'Rows per page'}
						size="sm"
					>
						{PAGE_SIZES.map((s) => (
							<NativeSelectOption key={s} value={String(s)}>
								{s}
							</NativeSelectOption>
						))}
					</NativeSelect>
				)}
				{hasHierarchy && (
					<Button
						variant="outline"
						size="sm"
						onClick={toggleHierarchy}
						title={allCollapsed ? (labels?.expandAll ?? 'Expand all') : (labels?.collapseAll ?? 'Collapse all')}
						aria-label={allCollapsed ? (labels?.expandAll ?? 'Expand all') : (labels?.collapseAll ?? 'Collapse all')}
					>
						{allCollapsed ? <ChevronsUpDownIcon className="size-3.5" /> : <ChevronsDownUpIcon className="size-3.5" />}
					</Button>
				)}
				{onFlipAxis && (
					<Button
						variant="outline"
						size="sm"
						onClick={onFlipAxis}
						title={labels?.flipAxis ?? 'Flip axis'}
						aria-label={labels?.flipAxis ?? 'Flip axis'}
					>
						<ArrowLeftRightIcon className="size-3.5" />
					</Button>
				)}
				{measures && measures.length > 0 && (
					<div data-slot="pivot-measure" className="flex items-center gap-1">
						<SigmaIcon className="size-3.5 text-muted-foreground" />
						<Combobox
							value={effectiveMeasure ?? ''}
							items={measures.map((m) => m.key)}
							itemToStringLabel={(k) => measures.find((m) => m.key === String(k))?.label ?? String(k)}
							onValueChange={(k) => {
								const key = String(k ?? '');
								if (key) onMeasureChange?.(key);
							}}
							onInputValueChange={() => {}}
						>
							<ComboboxInput showTrigger aria-label={labels?.measure ?? 'Measure'} className="w-44" />
							<ComboboxContent align="end" sideOffset={4} className="w-56">
								<ComboboxList>
									{(k: string) => {
										const m = measures.find((x) => x.key === k);
										if (!m) return null;
										return (
											<ComboboxItem key={m.key} value={m.key}>
												{m.label}
											</ComboboxItem>
										);
									}}
								</ComboboxList>
								<ComboboxEmpty>No matching measures</ComboboxEmpty>
							</ComboboxContent>
						</Combobox>
					</div>
				)}
				{showExport &&
					(formats.length > 1 ? (
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button variant="outline" size="sm">
										<DownloadIcon className="size-3.5" />
										{labels?.export ?? 'Export'}
										<ChevronDownIcon className="size-3" />
									</Button>
								}
							/>
							<DropdownMenuContent align="end">
								<DropdownMenuGroup>
									{formats.map((f) => (
										<DropdownMenuItem key={f} onSelect={() => onExport?.(f)}>
											{f === 'csv' ? (labels?.exportCsv ?? 'CSV') : (labels?.exportXlsx ?? 'Excel')}
										</DropdownMenuItem>
									))}
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					) : (
						<Button variant="outline" size="sm" onClick={() => onExport?.('csv')} aria-label={labels?.export ?? 'Export'}>
							<DownloadIcon className="size-3.5" />
							{labels?.export ?? 'Export'}
						</Button>
					))}
				{/* Customize docks next to Columns at the right edge (Data-Studio style). */}
				{onCustomize && (
					<Button
						variant={customizeActive ? 'default' : 'outline'}
						size="sm"
						onClick={onCustomize}
						title={labels?.customize ?? 'Customize'}
						aria-label={labels?.customize ?? 'Customize'}
					>
						<SlidersHorizontalIcon className="size-3.5" />
					</Button>
				)}
				{enableColumnVisibility && (
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button variant="outline" size="sm">
									<Columns3Icon className="size-3.5" />
									{labels?.columns ?? 'Columns'}
								</Button>
							}
						/>
						<DropdownMenuContent align="end" className="max-h-72 w-48 overflow-y-auto">
							<DropdownMenuGroup>
								<DropdownMenuLabel>{labels?.columns ?? 'Columns'}</DropdownMenuLabel>
							</DropdownMenuGroup>
							{effectiveColumns.map((col) => (
								<DropdownMenuCheckboxItem key={col} checked={!hiddenColumns.has(col)} onCheckedChange={() => toggleColumn(col)}>
									{col}
								</DropdownMenuCheckboxItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>
		</div>
	) : null;

	// ── States ───────────────────────────────────────────
	if (error) {
		return (
			<div className={cn('w-full space-y-3', fillHeight && 'flex h-full min-h-0 flex-col', className)}>
				{toolbar}
				<div data-slot="pivot-error" className="rounded-md border border-destructive/40 bg-destructive/5 p-8 text-center">
					<p className="text-sm font-medium text-foreground">{labels?.errorTitle ?? 'Failed to load pivot'}</p>
					<p className="mt-1 text-xs text-muted-foreground">{error}</p>
				</div>
			</div>
		);
	}

	const colCount = visibleColumns.length + 1 + (showTotals ? 1 : 0);

	return (
		<div className={cn('w-full space-y-3', fillHeight && 'flex h-full min-h-0 flex-col', className)}>
			{toolbar}
			<div
				className={cn(
					'relative w-full overflow-x-auto',
					fillHeight ? 'min-h-0 flex-1 overflow-y-auto' : stickyHeader && 'max-h-[65vh] overflow-y-auto',
				)}
			>
				<table data-slot="pivot-table" className="w-full caption-bottom border-separate border-spacing-0 text-sm">
					<thead data-slot="pivot-header">
						{headerDepth > 1 ? (
							<>
								{headerGroupRows.map((groups, l) => (
									<tr key={l}>
										{l === 0 && (
											<th
												data-slot="pivot-row-label"
												className={cn(multiCornerCellClass, 'text-left')}
												rowSpan={headerDepth}
												{...sortableHeaderProps(labelKey)}
											>
												<SortButton sortKey={labelKey} sort={sort} cycleSort={cycleSort} sortLabel={labels?.sort}>
													{aggregateLabel ?? rowLabel}
												</SortButton>
											</th>
										)}
										{groups.map((g, gi) => (
											<th key={gi} data-slot="pivot-group-header" className={cn(multiGroupCellClass, 'text-right')} colSpan={g.colSpan}>
												<span className="truncate px-1 font-semibold capitalize">{g.label}</span>
											</th>
										))}
										{l === 0 && showTotals && (
											<th data-slot="pivot-total-header" className={cn(multiGroupCellClass, 'text-right')} rowSpan={headerDepth}>
												{totalLabel}
											</th>
										)}
									</tr>
								))}
								<tr>
									{visibleColumns.map((col) => {
										const segs = col.split('|');
										return (
											<th key={col} data-slot="pivot-column" className={cn(headerCellClass, 'text-right')} {...sortableHeaderProps(col)}>
												<SortButton sortKey={col} sort={sort} cycleSort={cycleSort} sortLabel={labels?.sort}>
													{segs[segs.length - 1]}
												</SortButton>
											</th>
										);
									})}
									{showTotals && <th data-slot="pivot-total-header" className={cn(headerCellClass, 'text-right')} />}
								</tr>
							</>
						) : (
							<tr>
								<th data-slot="pivot-row-label" className={cn(cornerCellClass, 'text-left')} {...sortableHeaderProps(labelKey)}>
									<SortButton sortKey={labelKey} sort={sort} cycleSort={cycleSort} sortLabel={labels?.sort}>
										{aggregateLabel ?? rowLabel}
									</SortButton>
								</th>
								{visibleColumns.map((col) => (
									<th key={col} data-slot="pivot-column" className={cn(headerCellClass, 'text-right')} {...sortableHeaderProps(col)}>
										<SortButton sortKey={col} sort={sort} cycleSort={cycleSort} sortLabel={labels?.sort}>
											{col}
										</SortButton>
									</th>
								))}
								{showTotals && (
									<th data-slot="pivot-total-header" className={cn(headerCellClass, 'text-right')}>
										{totalLabel}
									</th>
								)}
							</tr>
						)}
					</thead>
					<tbody data-slot="pivot-body">
						{effectiveLoading ? (
							Array.from({ length: 4 }).map((_, i) => (
								<tr key={i} className="bg-background">
									<td className={cn(densityMap[density], 'sticky left-0 z-1 bg-background')}>
										<Skeleton className="h-4 w-24" />
									</td>
									{visibleColumns.map((col) => (
										<td key={col} className={cn(densityMap[density], cellClass(borderStyle, i, true))}>
											<Skeleton className="ml-auto h-4 w-16" />
										</td>
									))}
									{showTotals && (
										<td className={cn(densityMap[density], cellClass(borderStyle, i, true))}>
											<Skeleton className="ml-auto h-4 w-10" />
										</td>
									)}
								</tr>
							))
						) : renderRows.length === 0 ? (
							<tr>
								<td colSpan={colCount} className="p-10 text-center text-sm text-muted-foreground">
									{query ? (labels?.noResults ?? 'No matching rows') : (labels?.empty ?? 'No data')}
								</td>
							</tr>
						) : (
							renderRows.map((item, i) => {
								const { row, indent, isHeader, groupIndex } = item;
								const absoluteIndex = paginated ? safePageIndex * effectivePageSize + i : i;
								// Sticky label column keeps an OPAQUE bg so scrolled cells never
								// show through, and honors the zebra stripe + hover like the
								// non-sticky cells (bg order matters: stripe AFTER the base).
								const labelBg = cn('bg-background', striped && absoluteIndex % 2 === 1 && 'bg-muted/30', 'group-hover:bg-muted/50');
								return (
									<tr
										key={absoluteIndex}
										data-slot={isHeader ? 'pivot-group-row' : 'pivot-row'}
										className={cn('group bg-background transition-colors hover:bg-muted/40', onRowClick && !isHeader && 'cursor-pointer')}
										onClick={onRowClick && !isHeader ? () => onRowClick(row, absoluteIndex) : undefined}
									>
										<td
											data-slot="pivot-row-label-cell"
											className={cn(
												densityMap[density],
												cellClass(borderStyle, absoluteIndex, false),
												'sticky left-0 z-1 text-left',
												isHeader ? 'cursor-pointer font-semibold' : 'font-medium',
												labelBg,
											)}
											style={{ paddingLeft: 12 + indent * 18 }}
											onClick={
												isHeader
													? () => toggleGroup(groupIndex)
													: onCellClick
														? () => onCellClick({ row, column: null, rowIndex: absoluteIndex })
														: undefined
											}
										>
											{isHeader && (
												<span
													className="inline-flex items-center justify-center"
													style={{ width: 14, marginRight: 4, color: '#6b7280' }}
													aria-hidden
												>
													{allCollapsed || collapsedGroups.has(groupIndex) ? (
														<ChevronRightIcon className="size-3" />
													) : (
														<ChevronDownIcon className="size-3" />
													)}
												</span>
											)}
											{String(row[labelKey] ?? emptyCell)}
										</td>
										{visibleColumns.map((col) => {
											const v = row[col];
											return (
												<td
													key={col}
													data-slot="pivot-cell"
													className={cn(
														densityMap[density],
														cellClass(borderStyle, absoluteIndex, isNumericCell(v)),
														isHeader && 'font-semibold',
													)}
													onClick={!isHeader && onCellClick ? () => onCellClick({ row, column: col, rowIndex: absoluteIndex }) : undefined}
												>
													{formatCell(v) || emptyCell}
												</td>
											);
										})}
										{showTotals && (
											<td
												data-slot="pivot-row-total"
												className={cn(densityMap[density], cellClass(borderStyle, absoluteIndex, true), 'font-medium')}
											>
												{formatCell(rowTotal(row))}
											</td>
										)}
									</tr>
								);
							})
						)}
					</tbody>
					{showTotals && !effectiveLoading && leafRows.length > 0 && (
						<tfoot data-slot="pivot-footer">
							<tr>
								<td
									data-slot="pivot-total-cell"
									className={cn(densityMap[density], cellClass(borderStyle, 0, false, true), 'sticky left-0 z-1 bg-muted/40')}
								>
									{totalLabel}
								</td>
								{visibleColumns.map((col) => (
									<td key={col} data-slot="pivot-total-cell" className={cn(densityMap[density], cellClass(borderStyle, 0, true, true))}>
										{formatCell(columnTotals?.[col])}
									</td>
								))}
								<td
									data-slot="pivot-grand-total"
									className={cn(densityMap[density], cellClass(borderStyle, 0, true, true), 'font-semibold')}
								>
									{formatCell(grandTotal)}
								</td>
							</tr>
						</tfoot>
					)}
				</table>
			</div>
		</div>
	);
}
