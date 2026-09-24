'use client';

import * as React from 'react';
import { cn } from '@/utils';
import { Checkbox } from '@/checkbox';
import {
	ArrowUpIcon,
	ArrowDownIcon,
	ArrowLeftToLineIcon,
	ArrowRightToLineIcon,
	ArrowLeftIcon,
	ArrowRightIcon,
	EyeOffIcon,
	Columns3Icon,
	PinOffIcon,
} from 'lucide-react';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from '@/dropdown-menu';
import { useProcessedData } from '../datatable-context';
import { columnBorderCellClass, CONTROL_COLUMN_WIDTH, pinnedColumnBorderClass } from '../core/utils';
import type { ColumnPinningState, RowData } from '@tanstack/react-table';
import type { LegacyTable } from '@tanstack/react-table/legacy';
import type { BorderStyle, ColumnDef } from '../core/types';

interface DataTableHeaderProps<TData extends RowData> {
	columns: ColumnDef<TData>[];
	enableRowSelection?: boolean;
	/** Show the expand/collapse toggle column */
	enableRowExpansion?: boolean;
	/** Make the header row sticky at the top of the scroll container */
	stickyHeader?: boolean;
	/** Border style — vertical column lines mirror the body's `all`/`column` styles */
	borderStyle?: BorderStyle;
	/** Render a drag handle on each header cell to resize the column */
	enableColumnResizing?: boolean;
}

/**
 * Opaque header-cell background for the sticky header.
 *
 * The regular header uses translucent `bg-muted/30`, which lets scrolled rows
 * show through once the header sticks to the top. Layering the same 30% muted
 * tint over an opaque `bg-background` base keeps the exact visual look while
 * staying fully opaque.
 */
const opaqueHeaderBgClass =
	'bg-background [background-image:linear-gradient(color-mix(in_oklab,var(--muted)_30%,transparent),color-mix(in_oklab,var(--muted)_30%,transparent))]';

/** Header-cell background — translucent by default, opaque when sticky */
function headerBgClass(stickyHeader?: boolean): string {
	return stickyHeader ? opaqueHeaderBgClass : 'bg-muted/30';
}

/**
 * Pinned column sticky offset for header cells.
 * Combines horizontal pinning (left/right) with vertical stickiness (top) when stickyHeader is on.
 * `controlOffset` is the width of the sticky selection/expansion control columns
 * that sit to the left of the data columns (they are rendered outside TanStack's
 * column model, so `getStart('start')` does not include them).
 */
function pinnedHeaderStyle<TData extends RowData>(
	table: LegacyTable<TData>,
	columnId: string,
	stickyHeader?: boolean,
	controlOffset = 0,
): React.CSSProperties | undefined {
	const col = table.getColumn(columnId);
	if (!col) return undefined;
	const pinned = col.getIsPinned();
	if (!pinned) return undefined;
	const rect = col.getStart(pinned);
	// Right-pinned columns must use getAfter('end') so their DOM order matches
	// their visual order. getStart('end') would reverse the order, and the
	// browser's sticky-shift limit would then stop the DOM-first right-pinned
	// column from staying pinned at high scroll positions.
	const offset = pinned === 'end' ? col.getAfter('end') : rect;
	return {
		position: 'sticky',
		top: stickyHeader ? 0 : undefined,
		[pinned === 'start' ? 'left' : 'right']: `${offset + (pinned === 'start' ? controlOffset : 0)}px`,
		zIndex: 3,
	};
}

/** Column header menu content (Asc, Desc, Pin, Move, Hide, Columns) */
function HeaderMenuContent({ columnId }: { columnId: string }) {
	const { table } = useProcessedData();
	const column = table.getColumn(columnId);
	if (!column) return null;

	const isSorted = column.getIsSorted();
	const canPin = column.getCanPin();
	const isPinnedLeft = column.getIsPinned() === 'start';
	const isPinnedRight = column.getIsPinned() === 'end';

	const hideableColumns = table
		.getAllLeafColumns()
		.filter(
			(col) =>
				col.getCanHide() &&
				col.columnDef.header != null &&
				col.columnDef.header !== '' &&
				(typeof col.columnDef.header !== 'string' || col.columnDef.header.trim() !== ''),
		);

	const canSort = column.getCanSort();
	const showMove = !isPinnedLeft && !isPinnedRight;
	const showHide = column.getCanHide();

	// Separators are rendered as the *leading* separator of each following
	// block, only when a previous block was rendered — so adjacent groups never
	// produce double dividers (e.g. when the Move block is hidden for pinned
	// columns).
	return (
		<>
			{canSort && (
				<>
					<DropdownMenuItem
						onClick={() => {
							table.setSorting([{ id: columnId, desc: false }]);
						}}
						className="flex items-center gap-2"
					>
						<ArrowUpIcon className="size-3.5" />
						<span className="grow">Asc</span>
						{isSorted === 'asc' && (
							<svg className="size-4 text-primary" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
								<path d="M20 6 9 17l-5-5" />
							</svg>
						)}
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => {
							table.setSorting([{ id: columnId, desc: true }]);
						}}
						className="flex items-center gap-2"
					>
						<ArrowDownIcon className="size-3.5" />
						<span className="grow">Desc</span>
						{isSorted === 'desc' && (
							<svg className="size-4 text-primary" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
								<path d="M20 6 9 17l-5-5" />
							</svg>
						)}
					</DropdownMenuItem>
				</>
			)}

			{canPin && (
				<>
					{canSort && <DropdownMenuSeparator />}
					<DropdownMenuItem
						onClick={() => {
							table.setColumnPinning((prev: ColumnPinningState) => ({
								start: [...(prev.start ?? []).filter((id) => id !== columnId), columnId],
								end: (prev.end ?? []).filter((id) => id !== columnId),
							}));
						}}
						disabled={isPinnedLeft}
						className="flex items-center gap-2"
					>
						<ArrowLeftToLineIcon className="size-3.5" />
						<span className="grow">Pin to left</span>
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => {
							table.setColumnPinning((prev: ColumnPinningState) => ({
								start: (prev.start ?? []).filter((id) => id !== columnId),
								end: [...(prev.end ?? []).filter((id) => id !== columnId), columnId],
							}));
						}}
						disabled={isPinnedRight}
						className="flex items-center gap-2"
					>
						<ArrowRightToLineIcon className="size-3.5" />
						<span className="grow">Pin to right</span>
					</DropdownMenuItem>
					{(isPinnedLeft || isPinnedRight) && (
						<DropdownMenuItem
							onClick={() => {
								table.setColumnPinning((prev: ColumnPinningState) => ({
									start: (prev.start ?? []).filter((id) => id !== columnId),
									end: (prev.end ?? []).filter((id) => id !== columnId),
								}));
							}}
							className="flex items-center gap-2"
						>
							<PinOffIcon className="size-3.5" />
							<span className="grow">Unpin</span>
						</DropdownMenuItem>
					)}
				</>
			)}

			{/* Moving a pinned column is confusing — reorder only makes sense for
          unpinned (center) columns, so hide the actions for pinned ones. */}
			{showMove && (
				<>
					{(canSort || canPin) && <DropdownMenuSeparator />}
					<DropdownMenuItem
						onClick={() => {
							const allCols = table.getAllLeafColumns();
							const order = allCols.map((c) => c.id);
							const idx = order.indexOf(columnId);
							if (idx > 0) {
								[order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
								table.setColumnOrder(order);
							}
						}}
						disabled={(() => {
							const order = table.getAllLeafColumns().map((c) => c.id);
							return order.indexOf(columnId) <= 0;
						})()}
						className="flex items-center gap-2"
					>
						<ArrowLeftIcon className="size-3.5" />
						<span>Move to Left</span>
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => {
							const allCols = table.getAllLeafColumns();
							const order = allCols.map((c) => c.id);
							const idx = order.indexOf(columnId);
							if (idx < order.length - 1) {
								[order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
								table.setColumnOrder(order);
							}
						}}
						disabled={(() => {
							const order = table.getAllLeafColumns().map((c) => c.id);
							return order.indexOf(columnId) >= order.length - 1;
						})()}
						className="flex items-center gap-2"
					>
						<ArrowRightIcon className="size-3.5" />
						<span>Move to Right</span>
					</DropdownMenuItem>
				</>
			)}

			{showHide && (
				<>
					{(canSort || canPin || showMove) && <DropdownMenuSeparator />}
					<DropdownMenuItem onClick={() => column.toggleVisibility(false)} className="flex items-center gap-2">
						<EyeOffIcon className="size-3.5" />
						<span>Hide</span>
					</DropdownMenuItem>
				</>
			)}

			<DropdownMenuSeparator />
			<DropdownMenuSub>
				<DropdownMenuSubTrigger className="flex items-center gap-2">
					<Columns3Icon className="size-3.5" />
					<span>Columns</span>
				</DropdownMenuSubTrigger>
				<DropdownMenuSubContent className="w-44">
					{hideableColumns.map((col) => (
						<DropdownMenuCheckboxItem key={col.id} checked={col.getIsVisible()} onCheckedChange={() => col.toggleVisibility()}>
							{typeof col.columnDef.header === 'string' ? col.columnDef.header : col.id}
						</DropdownMenuCheckboxItem>
					))}
				</DropdownMenuSubContent>
			</DropdownMenuSub>
		</>
	);
}

// ── Sort indicator SVGs ──────────────────────────────────

function SortIndicator({ sorted }: { sorted: 'asc' | 'desc' | false }) {
	return (
		<span className="flex shrink-0 flex-col -space-y-1">
			<svg
				className={cn('size-2.5', sorted === 'asc' ? 'text-foreground' : 'text-muted-foreground/30')}
				fill="none"
				stroke="currentColor"
				strokeWidth={2.5}
				viewBox="0 0 24 24"
			>
				<path d="m5 15 7-7 7 7" />
			</svg>
			<svg
				className={cn('size-2.5', sorted === 'desc' ? 'text-foreground' : 'text-muted-foreground/30')}
				fill="none"
				stroke="currentColor"
				strokeWidth={2.5}
				viewBox="0 0 24 24"
			>
				<path d="m5 9 7 7 7-7" />
			</svg>
		</span>
	);
}

// ── Main Header ───────────────────────────────────────────

export function DataTableHeader<TData extends RowData>({
	columns,
	enableRowSelection = false,
	enableRowExpansion = false,
	stickyHeader = false,
	borderStyle = 'row',
	enableColumnResizing = false,
}: DataTableHeaderProps<TData>) {
	const { table } = useProcessedData<TData>();

	// Mirror the body: the expand toggle is left-most/sticky only when the
	// selection checkbox isn't anchoring the left edge.
	const expandSticky = enableRowExpansion && !enableRowSelection;

	const isAllSelected = table.getIsAllPageRowsSelected();
	const isIndeterminate = table.getIsSomePageRowsSelected() && !isAllSelected;

	const thStickyClass = stickyHeader ? 'sticky top-0' : '';
	const thBgClass = headerBgClass(stickyHeader);

	// Width of the sticky control columns (selection checkbox / expand toggle)
	// that anchor the left edge — left-pinned columns must be offset past them.
	const controlOffset = (enableRowSelection ? CONTROL_COLUMN_WIDTH : 0) + (expandSticky ? CONTROL_COLUMN_WIDTH : 0);

	// Use TanStack header groups — returns columns in pinned order
	// (left-pinned first, center, right-pinned last) plus columnOrder & visibility.
	// Computed inline (not memoized) so it reacts to pinning/order state changes.
	const headerGroup = table.getHeaderGroups()[0];
	const colMap = new Map(columns.map((c) => [c.id, c]));
	const visibleCols = (headerGroup?.headers ?? []).map((h) => colMap.get(h.column.id)).filter(Boolean) as ColumnDef<TData>[];

	return (
		<thead data-slot="datatable-header">
			{/* When sticky, the border must live on each cell — the <tr> box scrolls
          away with the table, while the sticky cells stay pinned. */}
			<tr className={stickyHeader ? '' : 'border-b'}>
				{enableRowSelection && (
					<th
						className={cn(
							'h-8 w-10 px-3 align-middle',
							thBgClass,
							thStickyClass,
							stickyHeader && 'border-b',
							columnBorderCellClass[borderStyle],
						)}
						style={{
							position: 'sticky',
							left: 0,
							top: stickyHeader ? 0 : undefined,
							zIndex: 10,
						}}
					>
						<Checkbox
							checked={isAllSelected}
							data-state={isIndeterminate ? 'indeterminate' : undefined}
							onCheckedChange={() => table.toggleAllPageRowsSelected()}
							aria-label="Select all rows"
						/>
					</th>
				)}
				{enableRowExpansion && (
					<th
						aria-label="Expand rows"
						className={cn('h-8 w-10', thBgClass, thStickyClass, stickyHeader && 'border-b', columnBorderCellClass[borderStyle])}
						style={
							expandSticky
								? {
										position: 'sticky',
										left: 0,
										top: stickyHeader ? 0 : undefined,
										zIndex: 10,
									}
								: undefined
						}
					/>
				)}
				{visibleCols.map((column) => {
					const colInstance = table.getColumn(column.id);
					const isVisible = colInstance?.getIsVisible() ?? true;
					if (!isVisible) return null;

					const isSorted = colInstance?.getIsSorted();
					const canSort = column.enableSorting !== false && column.sortable !== false;
					const isPinned = colInstance?.getIsPinned();
					const pinnedBorderClass = pinnedColumnBorderClass<TData>(table, column.id);

					// Column resizing — TanStack drives the width via `column.getSize()`
					// (seeded from the column's CSS width); the handle is the drag target.
					const resizeHeader = headerGroup?.headers.find((h) => h.column.id === column.id);
					const canResize = Boolean(enableColumnResizing && colInstance?.getCanResize());
					const colWidth = canResize && colInstance ? colInstance.getSize() : undefined;

					return (
						<th
							key={column.id}
							data-slot="datatable-header-cell"
							data-column-id={column.id}
							className={cn(
								'group h-8 px-3 text-left align-middle text-xs leading-5 font-semibold capitalize select-none',
								// Pinned cells are sticky horizontally — they need the opaque
								// background so scrolled header cells don't show through.
								isPinned ? opaqueHeaderBgClass : thBgClass,
								thStickyClass,
								stickyHeader && 'border-b',
								columnBorderCellClass[borderStyle],
								pinnedBorderClass,
								canResize && 'relative',

								column.headerClassName,
							)}
							style={{
								// Resizable columns render from TanStack's numeric sizing model;
								// otherwise the column's own CSS width strings are used as-is.
								width: colWidth != null ? `${colWidth}px` : column.width,
								minWidth: colWidth != null ? undefined : column.minWidth,
								maxWidth: colWidth != null ? undefined : column.maxWidth,
								textAlign: column.align,
								...pinnedHeaderStyle<TData>(table, column.id, stickyHeader, controlOffset),
								...(stickyHeader && !isPinned ? { position: 'sticky', top: 0, zIndex: 2 } : {}),
							}}
							aria-sort={isSorted === 'asc' ? 'ascending' : isSorted === 'desc' ? 'descending' : undefined}
						>
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<button
											type="button"
											className="flex w-full min-w-0 cursor-pointer items-center gap-1 transition-colors hover:text-foreground"
										>
											<span className="-ml-1 truncate rounded px-1 font-semibold capitalize transition-colors group-hover:bg-muted-foreground/10">
												{typeof column.header === 'function'
													? colInstance
														? column.header({ column: colInstance })
														: null
													: String(column.header)}
											</span>
											{canSort && <SortIndicator sorted={isSorted ?? false} />}
										</button>
									}
								/>
								<DropdownMenuContent align="start" className="w-44">
									<HeaderMenuContent columnId={column.id} />
								</DropdownMenuContent>
							</DropdownMenu>
							{canResize && resizeHeader && colInstance && (
								<div
									role="separator"
									aria-orientation="vertical"
									aria-label={`Resize ${typeof column.header === 'string' ? column.header : column.id} column`}
									onPointerDown={resizeHeader.getResizeHandler() as React.PointerEventHandler}
									onDoubleClick={() => colInstance.resetSize()}
									className={cn(
										'absolute top-0 right-0 z-10 flex h-full w-2.5 cursor-col-resize touch-none items-center justify-center select-none',
										colInstance.getIsResizing() &&
											'after:absolute after:inset-y-1 after:right-1 after:w-0.5 after:rounded-full after:bg-ring',
									)}
									style={{ touchAction: 'none' }}
								>
									{/* Divider — hidden until the column is hovered; stays
                      visible + highlighted while actively resizing. */}
									<span
										className={cn(
											'h-5 w-0.5 rounded-full bg-border opacity-0 transition-opacity group-hover:opacity-100',
											colInstance.getIsResizing() && 'bg-ring opacity-100',
										)}
									/>
								</div>
							)}
						</th>
					);
				})}
			</tr>
		</thead>
	);
}
