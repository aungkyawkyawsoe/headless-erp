'use client';

import * as React from 'react';
import { cn } from '@/utils';
import { Checkbox } from '@/checkbox';
import { Skeleton } from '@/skeleton';
import { ChevronRightIcon } from 'lucide-react';
import { useProcessedData } from '../datatable-context';
import { columnBorderCellClass, CONTROL_COLUMN_WIDTH, pinnedColumnBorderClass, pinnedCellStyle, formatAggregateValue } from '../core/utils';
import type { RowData } from '@tanstack/react-table';
import type { BorderStyle, ColumnDef, DataTableLabels, Density } from '../core/types';

interface DataTableBodyProps<TData extends RowData> {
	columns: ColumnDef<TData>[];
	density: Density;
	enableRowSelection?: boolean;
	/** Show the expand/collapse toggle column */
	enableRowExpansion?: boolean;
	/** Full-width detail row rendered below an expanded row */
	renderSubComponent?: (props: { row: TData; index: number }) => React.ReactNode;
	labels?: DataTableLabels;
	rowKey: keyof TData & string;
	onRowClick?: (row: TData) => void;
	borderStyle?: BorderStyle;
	striped?: boolean;
}

const densityMap: Record<Density, string> = {
	compact: 'h-8 px-3 py-0',
	comfortable: 'h-10 px-3 py-1.5',
	spacious: 'h-12 px-3 py-2.5',
};

// Horizontal row separators per style; vertical (column) borders are shared
// with the header via `columnBorderCellClass`.
const borderCellClass: Record<BorderStyle, string> = {
	row: 'border-b',
	all: cn('border-b', columnBorderCellClass.all),
	column: columnBorderCellClass.column,
	none: '',
};

const borderRowClass: Record<BorderStyle, string> = {
	row: '',
	all: '',
	column: '',
	none: '',
};

/**
 * Background classes for sticky cells. Sticky cells need an opaque background
 * so scrolled content doesn't show through, and they must mirror the row's
 * own zebra/selected/hover states (the row's `:hover` can't paint through an
 * opaque child cell). Tints are layered as gradients over an opaque
 * `bg-background` base so the cell stays fully opaque in every state.
 */
export function cellBackgroundClass(selected: boolean, rowBg: string): string {
	return cn(
		'bg-background',
		selected
			? '[background-image:linear-gradient(color-mix(in_oklab,var(--primary)_5%,transparent),color-mix(in_oklab,var(--primary)_5%,transparent))] group-hover:[background-image:linear-gradient(color-mix(in_oklab,var(--primary)_10%,transparent),color-mix(in_oklab,var(--primary)_10%,transparent))]'
			: cn(
					rowBg &&
						'[background-image:linear-gradient(color-mix(in_oklab,var(--muted)_50%,transparent),color-mix(in_oklab,var(--muted)_50%,transparent))]',
					'group-hover:[background-image:linear-gradient(color-mix(in_oklab,var(--muted)_40%,transparent),color-mix(in_oklab,var(--muted)_40%,transparent))]',
				),
	);
}

export function DataTableBody<TData extends RowData>({
	columns,
	density,
	enableRowSelection = false,
	enableRowExpansion = false,
	renderSubComponent,
	labels,
	onRowClick,
	borderStyle = 'row',
	striped = false,
}: DataTableBodyProps<TData>) {
	const { table, isLoading, error, rows } = useProcessedData<TData>();

	// The expand toggle acts as the left-most sticky column when there is no
	// selection checkbox to anchor the table.
	const expandSticky = enableRowExpansion && !enableRowSelection;

	// Width of the sticky control columns (selection checkbox / expand toggle)
	// that anchor the left edge — left-pinned columns must be offset past them
	// so they don't overlap the controls while scrolling.
	const controlOffset = (enableRowSelection ? CONTROL_COLUMN_WIDTH : 0) + (expandSticky ? CONTROL_COLUMN_WIDTH : 0);

	// Use TanStack header groups — returns columns in pinned order
	// (left-pinned first, center, right-pinned last) plus columnOrder & visibility.
	// Computed inline (not memoized) so it reacts to pinning/order state changes.
	const colMap = new Map(columns.map((c) => [c.id, c]));
	const visibleColumns = (table.getHeaderGroups()[0]?.headers ?? [])
		.map((h) => colMap.get(h.column.id))
		.filter(Boolean) as ColumnDef<TData>[];

	// Total rendered cells per row — data columns plus leading control columns
	const colSpan = visibleColumns.length + (enableRowSelection ? 1 : 0) + (enableRowExpansion ? 1 : 0);

	// ── Loading ──────────────────────────────────────────
	if (isLoading) {
		return (
			<tbody data-slot="datatable-body">
				{Array.from({ length: 5 }).map((_, rowIdx) => (
					<tr key={rowIdx} className={cn('bg-background', borderRowClass[borderStyle])}>
						{enableRowSelection && (
							<td className="px-3">
								<Skeleton className="size-4 rounded-sm" />
							</td>
						)}
						{enableRowExpansion && (
							<td className="px-2">
								<Skeleton className="size-4 rounded-sm" />
							</td>
						)}
						{visibleColumns.map((col) => (
							<td key={col.id} className={cn(densityMap[density], borderCellClass[borderStyle])}>
								<Skeleton className="h-4 w-[80%] rounded" />
							</td>
						))}
					</tr>
				))}
			</tbody>
		);
	}

	// ── Error ────────────────────────────────────────────
	if (error) {
		return (
			<tbody data-slot="datatable-body">
				<tr className="bg-background">
					<td colSpan={colSpan} className="p-8 text-center">
						<div className="flex flex-col items-center gap-2 text-muted-foreground">
							<span className="text-sm font-medium">{labels?.errorTitle ?? 'Failed to load data'}</span>
							<span className="text-xs">{error}</span>
						</div>
					</td>
				</tr>
			</tbody>
		);
	}

	// ── Empty ────────────────────────────────────────────
	if (rows.length === 0) {
		return (
			<tbody data-slot="datatable-body">
				<tr className="bg-background">
					<td colSpan={colSpan} className="p-12 text-center">
						<div className="flex flex-col items-center gap-2 text-muted-foreground">
							<svg className="size-10 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={1.5}
									d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
								/>
							</svg>
							<span className="text-sm font-medium">{labels?.empty ?? 'No results.'}</span>
						</div>
					</td>
				</tr>
			</tbody>
		);
	}

	// ── Data ─────────────────────────────────────────────
	return (
		<tbody data-slot="datatable-body">
			{rows.map((row, rowIndex) => {
				const selected = row.getIsSelected();
				const isGroupedRow = row.getIsGrouped();
				// Zebra striping — bg-muted/50 is clearly visible in light mode.
				// Group rows get a slightly stronger tint so they read as headers.
				const rowBg = isGroupedRow ? 'bg-muted/30' : striped && rowIndex % 2 === 1 ? 'bg-muted/50' : '';

				return (
					<React.Fragment key={row.id}>
						<tr
							data-slot={isGroupedRow ? 'datatable-group-row' : 'datatable-row'}
							data-state={selected ? 'selected' : undefined}
							className={cn(
								'group bg-background transition-colors',
								selected ? 'bg-primary/5 hover:bg-primary/10' : cn(rowBg, 'hover:bg-muted/40', borderRowClass[borderStyle]),
								isGroupedRow && 'cursor-default',
								onRowClick && !isGroupedRow && 'cursor-pointer',
							)}
							onClick={(e) => {
								// Group rows have no underlying record (`row.original` is undefined).
								if (isGroupedRow) return;
								if ((e.target as HTMLElement).closest('[role="checkbox"]')) return;
								if (onRowClick) onRowClick(row.original);
							}}
						>
							{enableRowExpansion && (
								<td
									className={cn(
										'w-10 px-2 align-middle transition-colors',
										borderCellClass[borderStyle],
										expandSticky && cellBackgroundClass(selected, rowBg),
									)}
									style={expandSticky ? { position: 'sticky', left: 0, zIndex: 1 } : undefined}
								>
									{row.getCanExpand() ? (
										<button
											type="button"
											data-slot="datatable-row-expand"
											aria-label={
												row.getIsExpanded()
													? isGroupedRow
														? (labels?.groupCollapse ?? 'Collapse group')
														: 'Collapse row'
													: isGroupedRow
														? (labels?.groupExpand ?? 'Expand group')
														: 'Expand row'
											}
											aria-expanded={row.getIsExpanded()}
											onClick={(e) => {
												e.stopPropagation();
												row.toggleExpanded();
											}}
											className="flex size-6 cursor-pointer items-center justify-center rounded transition-colors hover:bg-muted-foreground/15"
											style={{ marginLeft: row.depth * 16 }}
										>
											<ChevronRightIcon
												className={cn('size-4 text-muted-foreground transition-transform duration-200', row.getIsExpanded() && 'rotate-90')}
											/>
										</button>
									) : (
										<span aria-hidden="true" className="block size-6" style={{ marginLeft: row.depth * 16 }} />
									)}
								</td>
							)}
							{enableRowSelection && (
								<td
									className={cn(
										'w-10 px-3 align-middle transition-colors',
										borderCellClass[borderStyle],
										cellBackgroundClass(selected, rowBg),
									)}
									style={{ position: 'sticky', left: 0, zIndex: 1 }}
								>
									<Checkbox checked={selected} onCheckedChange={() => row.toggleSelected()} aria-label={`Select row ${row.id}`} />
								</td>
							)}
							{visibleColumns.map((column) => {
								const pinnedStyle = pinnedCellStyle<TData>(table, column.id, controlOffset);
								const pinnedBorderClass = pinnedColumnBorderClass<TData>(table, column.id);

								// Grouped rows: the grouping column shows the group value + count;
								// other columns show their aggregated value (when `aggregationFn` is
								// set) or stay blank. `row.original` is undefined on group rows, so
								// the custom `cell` renderer is never invoked for them.
								if (isGroupedRow) {
									const isGroupingColumn = column.id === row.groupingColumnId;
									// Grouping column → group value; other columns → aggregated value
									// when `aggregationFn` is set (row.getValue returns it), else blank.
									const value = isGroupingColumn ? row.getGroupingValue(column.id) : row.getValue(column.id);

									return (
										<td
											key={column.id}
											data-slot="datatable-cell"
											className={cn(
												densityMap[density],
												'align-middle text-sm leading-6.5',
												borderCellClass[borderStyle],
												column.cellClassName,
												pinnedBorderClass,
												pinnedStyle && cn('transition-colors', cellBackgroundClass(selected, rowBg)),
											)}
											style={{
												width: column.width,
												minWidth: column.minWidth,
												maxWidth: column.maxWidth,
												textAlign: column.align,
												...pinnedStyle,
											}}
										>
											{isGroupingColumn ? (
												<span className="font-semibold" style={{ fontSize: '0.8rem' }}>
													{String(value ?? '\u2014')} <span className="font-normal text-muted-foreground">({row.subRows.length})</span>
												</span>
											) : value != null ? (
												formatAggregateValue(value)
											) : null}
										</td>
									);
								}

								const cellValue = row.getValue(column.id);

								return (
									<td
										key={column.id}
										data-slot="datatable-cell"
										className={cn(
											densityMap[density],
											'align-middle text-sm leading-6.5',
											borderCellClass[borderStyle],
											column.cellClassName,
											pinnedBorderClass,
											pinnedStyle && cn('transition-colors', cellBackgroundClass(selected, rowBg)),
										)}
										style={{
											width: column.width,
											minWidth: column.minWidth,
											maxWidth: column.maxWidth,
											textAlign: column.align,
											...pinnedStyle,
										}}
									>
										{column.cell
											? column.cell({
													row: {
														original: row.original,
														index: rowIndex,
														getValue: () => row.getValue(column.id),
													},
													value: cellValue,
													index: rowIndex,
												})
											: cellValue != null
												? String(cellValue)
												: '\u2014'}
									</td>
								);
							})}
						</tr>
						{renderSubComponent && row.getIsExpanded() && (
							<tr data-slot="datatable-expanded-row" className={cn('bg-muted/20', borderRowClass[borderStyle])}>
								<td colSpan={colSpan} className={cn('px-4 py-3', borderCellClass[borderStyle])}>
									{renderSubComponent({ row: row.original, index: rowIndex })}
								</td>
							</tr>
						)}
					</React.Fragment>
				);
			})}
		</tbody>
	);
}
