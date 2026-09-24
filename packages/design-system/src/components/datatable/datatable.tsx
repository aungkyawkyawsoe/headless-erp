'use client';

import * as React from 'react';
import { cn } from '@/utils';
import type { ViewMode } from '@/kanban/core/types';
import { KanbanBoard } from '@/kanban';
import { ViewModeToggle } from '@/kanban/core/view-mode-toggle';
import { DataTableInstanceContext } from './core/context';
import { useDataTable } from './core/use-datatable';
import { DataTableToolbar } from './components/datatable-toolbar';
import { DataTableFilterBar } from './components/datatable-filter-bar';
import { DataTableHeader } from './components/datatable-header';
import { DataTableBody } from './components/datatable-body';
import { DataTableFooter } from './components/datatable-footer';
import { DataTableScrollbar } from './components/datatable-scrollbar';
import { PaginationCursor } from '@/pagination';
import { ProcessedDataProvider } from './datatable-context';
import { createKanbanColumnsFromRows, DataTableKanbanCard, type KanbanViewItem } from './components/kanban-view';
import type { RowData } from '@tanstack/react-table';
import type { LegacyReactTable } from '@tanstack/react-table/legacy';
import type { DataTableProps } from './core/types';

function DataTableRoot<TData extends RowData>(props: DataTableProps<TData>) {
	const {
		columns,
		showToolbar = true,
		showFilterBar = true,
		showFooter = false,
		density = 'comfortable',
		className,
		labels,
		enableRowSelection = false,
		onSelectionChange,
		onRowClick,
		rowKey = 'id' as keyof TData & string,
		toolbarActions,
		toolbarIconOnly = false,
		borderStyle = 'row',
		striped = false,
		stickyHeader = false,
		enableColumnResizing = false,
		onCreate,
		toolbarSticky = false,
		getRowCanExpand,
		renderSubComponent,
		getSubRows,
		viewMode: viewModeProp,
		defaultViewMode = 'table',
		onViewModeChange,
		kanban: kanbanConfig,
		showViewModeToggle,
	} = props;

	// ── View mode (Table / Kanban) ─────────────────────────────
	const [internalViewMode, setInternalViewMode] = React.useState<ViewMode>(defaultViewMode);
	const viewMode = viewModeProp ?? internalViewMode;
	const handleViewModeChange = React.useCallback(
		(mode: ViewMode) => {
			if (viewModeProp === undefined) setInternalViewMode(mode);
			onViewModeChange?.(mode);
		},
		[viewModeProp, onViewModeChange],
	);
	const isKanbanEnabled = kanbanConfig != null;
	const viewModeToggle =
		isKanbanEnabled && (showViewModeToggle ?? true) ? <ViewModeToggle viewMode={viewMode} onViewModeChange={handleViewModeChange} /> : null;

	const table = useDataTable<TData>(props);

	const enableRowExpansion = Boolean(renderSubComponent || getSubRows || getRowCanExpand);

	// Pinned state — gates the custom center-area scrollbar (the native
	// horizontal scrollbar spans the full width, which looks wrong when
	// columns are pinned).
	const hasPinnedColumns = table.table.getIsSomeColumnsPinned();
	const pinningKey = JSON.stringify(table.table.getState().columnPinning);

	// Resizable tables size to their columns (`w-max table-fixed`) and never
	// stretch to the container — but with a SINGLE visible column that leaves a
	// narrow 150px column and a mostly empty canvas. Fall back to the full-width
	// auto layout so the lone column fills the table, and drop its resize handle
	// (dragging a single column to fill the width is meaningless).
	const visibleColumnCount = table.table.getHeaderGroups()[0]?.headers.length ?? 0;
	const singleColumnFill = enableColumnResizing && visibleColumnCount === 1;
	const columnResizingEnabled = enableColumnResizing && !singleColumnFill;

	// TanStack's sizing model only understands numeric `size` values, but the
	// column defs size columns with CSS width strings (e.g. "200px") that are
	// applied via inline styles. `column.getSize()` therefore reports the
	// default (150) for those columns, which corrupts `getStart()` — the value
	// used for pinned-column sticky offsets. Multi-column pin groups would end
	// up with gaps/overlaps when scrolling. Sync TanStack's `columnSizing`
	// state with the rendered header-cell widths so pin offsets match layout.
	// (Skipped in single-column fill mode — the stretched header width is not
	// a real column size, so pushing it would corrupt the layout the moment a
	// second column becomes visible again.)
	const tableElRef = React.useRef<HTMLTableElement | null>(null);
	const tableInstance = table.table;
	React.useLayoutEffect(() => {
		const el = tableElRef.current;
		if (!el || singleColumnFill) return;

		const sync = () => {
			// Read current sizing and only push a new sizing state when a measured
			// header width actually differs. Calling setColumnSizing unconditionally
			// (even with an unchanged value) triggers a TanStack re-render, and the
			// ResizeObserver below fires on that re-layout → an endless loop
			// ("Maximum update depth exceeded" under StrictMode).
			const current = tableInstance.getState().columnSizing;
			let next: Record<string, number> | null = null;
			for (const th of el.querySelectorAll<HTMLElement>("[data-slot='datatable-header-cell']")) {
				const id = th.dataset.columnId;
				if (!id) continue;
				const width = th.getBoundingClientRect().width;
				if (Math.abs((current[id] ?? 0) - width) > 0.5) {
					next ??= { ...current };
					next[id] = width;
				}
			}
			if (next) tableInstance.setColumnSizing(next);
		};

		sync();
		const observer = new ResizeObserver(sync);
		observer.observe(el);
		return () => observer.disconnect();
	}, [tableInstance, singleColumnFill]);

	// Cursor pagination — rendered top-right before the custom actions, level with the search bar
	const pagination =
		viewMode === 'kanban' ? null : (
			<PaginationCursor
				from={table.cursorFrom}
				to={table.cursorTo}
				canPrevious={table.canGoPrevious}
				canNext={table.canGoNext}
				onPrevious={table.goToPrevPage}
				onNext={table.goToNextPage}
			/>
		);

	// Resolve toolbarActions — support both ReactNode and render prop
	const resolvedActions = React.useMemo(() => {
		if (typeof toolbarActions === 'function') {
			return toolbarActions({
				table: table.table,
				totalCount: table.totalCount,
				globalFilter: table.globalFilter,
				setGlobalFilter: table.setGlobalFilter,
				grouping: table.grouping,
				setGrouping: table.setGrouping,
				toggleGrouping: table.toggleGrouping,
				addFilter: table.addFilter,
				setFilters: table.setFilters,
				removeFilter: table.removeFilter,
				clearFilters: table.clearFilters,
				expandedRowIds: table.expandedRowIds,
				getIsRowExpanded: table.getIsRowExpanded,
				toggleRowExpanded: table.toggleRowExpanded,
				expandAll: table.expandAll,
				collapseAll: table.collapseAll,
			});
		}
		return toolbarActions;
	}, [toolbarActions, table]);

	// Kanban view — group the filtered rows into board columns. Memoized on
	// the row model so a drag inside the board (which only touches board-local
	// state) does not reset the columns, while filter/search/sort changes do.
	const filteredRowModel = table.table.getFilteredRowModel();
	const kanbanColumns = React.useMemo(() => {
		if (!kanbanConfig) return null;
		const rows = filteredRowModel.rows.map((row) => row.original);
		return createKanbanColumnsFromRows(rows, columns, kanbanConfig);
	}, [kanbanConfig, columns, filteredRowModel]);

	const handleKanbanItemMove = React.useCallback(
		(event: { item: KanbanViewItem<TData>; sourceColumnId: string; targetColumnId: string; newIndex: number }) => {
			kanbanConfig?.onItemMove?.({
				item: event.item,
				sourceColumnId: event.sourceColumnId,
				targetColumnId: event.targetColumnId,
				newIndex: event.newIndex,
			});
		},
		[kanbanConfig],
	);

	// ── Kanban view body ───────────────────────────────────────
	const kanbanView = React.useMemo(() => {
		if (viewMode !== 'kanban' || !kanbanConfig || !kanbanColumns) return null;

		if (table.isLoading) {
			return (
				<div data-slot="datatable-kanban-loading" className="flex gap-4 overflow-x-auto">
					{Array.from({ length: 3 }).map((_, i) => (
						<div key={i} className="flex h-64 w-64 shrink-0 animate-pulse flex-col gap-2 rounded-xl border border-border bg-muted/25 p-3">
							<div className="h-4 w-24 rounded bg-muted" />
							<div className="h-16 rounded bg-muted" />
							<div className="h-16 rounded bg-muted" />
						</div>
					))}
				</div>
			);
		}

		if (table.error) {
			return (
				<div className="flex flex-col items-center gap-2 p-8 text-muted-foreground">
					<span className="text-sm font-medium">Failed to load data</span>
					<span className="text-xs">{table.error}</span>
				</div>
			);
		}

		return (
			<KanbanBoard<KanbanViewItem<TData>>
				columns={kanbanColumns}
				renderCard={(props) =>
					kanbanConfig.renderCard ? (
						kanbanConfig.renderCard(props)
					) : (
						<DataTableKanbanCard<TData> {...props} columns={columns} config={kanbanConfig} />
					)
				}
				reorderItems={kanbanConfig.reorderItems}
				onItemMove={handleKanbanItemMove}
				columnWidth={kanbanConfig.columnWidth}
				columnGap={kanbanConfig.columnGap}
				maxHeight={kanbanConfig.maxHeight}
				className="pt-1"
			/>
		);
	}, [viewMode, kanbanConfig, kanbanColumns, columns, table.isLoading, table.error, handleKanbanItemMove]);
	const processedDataValue = {
		table: table.table,
		rows: table.table.getRowModel().rows,
		columns,
		isLoading: table.isLoading,
		error: table.error,
		density,
		labels,
		enableRowSelection,
		onRowClick,
		rowKey,
		onSelectionChange,
		enableRowExpansion,
		expandedRowIds: table.expandedRowIds,
		getIsRowExpanded: table.getIsRowExpanded,
		toggleRowExpanded: table.toggleRowExpanded,
		expandAll: table.expandAll,
		collapseAll: table.collapseAll,
	};

	return (
		<DataTableInstanceContext.Provider
			value={{
				// Table<TData> is invariant — the context is typed `any`; cast at the
				// boundary, consumers re-cast via useDataTableInstance<TData>().
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				table: table.table as LegacyReactTable<any>,
				totalCount: table.totalCount,
				globalFilter: table.globalFilter,
				setGlobalFilter: table.setGlobalFilter,
				grouping: table.grouping,
				setGrouping: table.setGrouping,
				toggleGrouping: table.toggleGrouping,
				addFilter: table.addFilter,
				setFilters: table.setFilters,
				removeFilter: table.removeFilter,
				clearFilters: table.clearFilters,
				expandedRowIds: table.expandedRowIds,
				getIsRowExpanded: table.getIsRowExpanded,
				toggleRowExpanded: table.toggleRowExpanded,
				expandAll: table.expandAll,
				collapseAll: table.collapseAll,
			}}
		>
			<ProcessedDataProvider {...processedDataValue}>
				<div data-slot="datatable" className={cn('w-full space-y-3', className)}>
					{(() => {
						const toolbarArea = (
							<>
								{showToolbar ? (
									<DataTableToolbar
										columns={columns}
										globalFilter={table.globalFilter}
										onGlobalFilterChange={table.setGlobalFilter}
										filters={table.filters}
										onSetFilters={table.setFilters}
										onClearFilters={table.clearFilters}
										toolbarActions={resolvedActions}
										iconOnly={toolbarIconOnly}
										labels={labels}
										onCreate={onCreate}
										createLabel={labels?.create}
										pagination={pagination}
										viewModeToggle={viewModeToggle}
									/>
								) : (
									<div data-slot="datatable-pagination" className="flex w-full justify-end">
										{pagination}
									</div>
								)}
								{showFilterBar && table.filters.length > 0 && (
									<DataTableFilterBar
										filters={table.filters}
										columns={columns}
										onRemoveFilter={table.removeFilter}
										onClearFilters={table.clearFilters}
										labels={labels}
									/>
								)}
							</>
						);

						if (toolbarSticky) {
							return <div className="sticky top-12 z-5 -mx-4 bg-background px-4 pb-3">{toolbarArea}</div>;
						}

						return toolbarArea;
					})()}
					{/* Non-scrolling wrapper — the custom scrollbar must live outside the
              scroll container or it would scroll away with the table content. */}
					{kanbanView ?? (
						<div className="relative">
							<div
								data-slot="datatable-container"
								className={cn(
									'relative w-full overflow-x-auto',
									stickyHeader && 'max-h-[65vh] overflow-y-auto',
									// When columns are pinned, hide the native horizontal
									// scrollbar — it spans the full width, while a custom
									// scrollbar covers only the unpinned area between the pinned
									// columns. `::-webkit-scrollbar` height only affects the
									// horizontal axis, so the vertical scrollbar (stickyHeader)
									// stays intact. Firefox has no per-axis control, so
									// `scrollbar-width: none` is only applied when there is no
									// vertical scrolling to lose.
									hasPinnedColumns && cn('[&::-webkit-scrollbar]:h-0', !stickyHeader && 'scrollbar-none'),
								)}
							>
								<table
									ref={tableElRef}
									data-slot="datatable-table"
									className={cn(
										// With column resizing, the table sizes to its columns
										// (never stretches to the container) and uses fixed layout
										// so every column renders exactly at its TanStack size.
										// Otherwise `w-full` + auto layout redistributes the spare
										// width across ALL columns, making them shift when one
										// column is resized.
										'min-w-max caption-bottom border-separate border-spacing-0 text-sm',
										columnResizingEnabled ? 'w-max table-fixed' : 'w-full',
									)}
								>
									<DataTableHeader
										columns={columns}
										enableRowSelection={enableRowSelection}
										enableRowExpansion={enableRowExpansion}
										stickyHeader={stickyHeader}
										borderStyle={borderStyle}
										enableColumnResizing={columnResizingEnabled}
									/>
									<DataTableBody
										columns={columns}
										density={density}
										enableRowSelection={enableRowSelection}
										enableRowExpansion={enableRowExpansion}
										renderSubComponent={renderSubComponent}
										labels={labels}
										rowKey={rowKey}
										onRowClick={onRowClick}
										borderStyle={borderStyle}
										striped={striped}
									/>
									{showFooter && (
										<DataTableFooter
											columns={columns}
											density={density}
											enableRowSelection={enableRowSelection}
											enableRowExpansion={enableRowExpansion}
											borderStyle={borderStyle}
										/>
									)}
								</table>
							</div>
							{hasPinnedColumns && <DataTableScrollbar pinningKey={pinningKey} />}
						</div>
					)}
				</div>
			</ProcessedDataProvider>
		</DataTableInstanceContext.Provider>
	);
}

const DataTable = DataTableRoot as <TData extends RowData>(props: DataTableProps<TData>) => React.JSX.Element;

export { DataTable };

export { useDataTable } from './core/use-datatable';
export type {
	DataTableProps,
	DataTableInstance,
	ColumnDef,
	FilterDef,
	ActiveFilter,
	SortState,
	PaginationState,
	CursorState,
	FetchParams,
	FetchResult,
	BorderStyle,
	DataTableLabels,
	Density,
} from './core/types';
