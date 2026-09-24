'use client';

import * as React from 'react';
import { cn } from '@/utils';
import { useProcessedData } from '../datatable-context';
import { columnBorderCellClass, CONTROL_COLUMN_WIDTH, pinnedColumnBorderClass, pinnedCellStyle } from '../core/utils';
import type { BorderStyle, ColumnDef, Density } from '../core/types';
import type { RowData } from '@tanstack/react-table';
import type { LegacyColumn, LegacyTable } from '@tanstack/react-table/legacy';

interface DataTableFooterProps<TData extends RowData> {
	columns: ColumnDef<TData>[];
	density: Density;
	enableRowSelection?: boolean;
	enableRowExpansion?: boolean;
	borderStyle?: BorderStyle;
}

const densityMap: Record<Density, string> = {
	compact: 'h-8 px-3 py-0',
	comfortable: 'h-10 px-3 py-1.5',
	spacious: 'h-12 px-3 py-2.5',
};

const borderCellClass: Record<BorderStyle, string> = {
	row: 'border-t',
	all: cn('border-t', columnBorderCellClass.all),
	column: cn('border-t', columnBorderCellClass.column),
	none: '',
};

/**
 * Aggregate footer (`<tfoot>`) rendered from `table.getFooterGroups()` when
 * `showFooter` is enabled. Each column's `footer` (string or render prop) is
 * rendered per footer group; with grouping active, TanStack computes aggregated
 * footer values for columns that have an `aggregationFn`.
 *
 * Purely presentational — all values come from the column defs / table state.
 */
export function DataTableFooter<TData extends RowData>({
	columns,
	density,
	enableRowSelection = false,
	enableRowExpansion = false,
	borderStyle = 'row',
}: DataTableFooterProps<TData>) {
	const { table } = useProcessedData<TData>();

	const footerGroups = table.getFooterGroups();
	// Render nothing when no column defines a footer (an empty footer row would
	// just add visual noise to tables that don't opt into summaries).
	const hasFooterContent = footerGroups.some((fg) => fg.headers.some((h) => h.column.columnDef.footer != null));
	if (!hasFooterContent) return null;

	// The expand toggle acts as the left-most sticky column when there is no
	// selection checkbox to anchor the table (mirrors DataTableBody).
	const expandSticky = enableRowExpansion && !enableRowSelection;
	const controlOffset = (enableRowSelection ? CONTROL_COLUMN_WIDTH : 0) + (expandSticky ? CONTROL_COLUMN_WIDTH : 0);

	const colMap = new Map(columns.map((c) => [c.id, c]));

	return (
		<tfoot data-slot="datatable-footer">
			{footerGroups.map((footerGroup) => (
				<tr key={footerGroup.id} data-slot="datatable-footer-row" className="bg-muted/40">
					{enableRowExpansion && (
						<td
							className={cn('w-10 px-2', borderCellClass[borderStyle])}
							style={expandSticky ? { position: 'sticky', left: 0, zIndex: 1 } : undefined}
						/>
					)}
					{enableRowSelection && (
						<td className={cn('w-10 px-3', borderCellClass[borderStyle])} style={{ position: 'sticky', left: 0, zIndex: 1 }} />
					)}
					{footerGroup.headers.map((header) => {
						const col = colMap.get(header.column.id);
						const pinnedStyle = pinnedCellStyle<TData>(table, header.column.id, controlOffset);
						const pinnedBorderClass = pinnedColumnBorderClass<TData>(table, header.column.id);
						const footer = header.column.columnDef.footer;
						const renderFooter =
							typeof footer === 'function'
								? (footer as (props: {
										table: LegacyTable<TData>;
										column: LegacyColumn<TData, unknown>;
										header?: { id: string };
									}) => React.ReactNode)
								: undefined;

						return (
							<td
								key={header.id}
								data-slot="datatable-footer-cell"
								className={cn(
									densityMap[density],
									'align-middle text-sm font-medium text-muted-foreground',
									borderCellClass[borderStyle],
									pinnedBorderClass,
									pinnedStyle && 'bg-background',
								)}
								style={{
									width: col?.width,
									minWidth: col?.minWidth,
									maxWidth: col?.maxWidth,
									textAlign: col?.align,
									...pinnedStyle,
								}}
							>
								{renderFooter
									? renderFooter({ table, column: header.column, header: { id: header.id } })
									: typeof footer === 'string'
										? footer
										: ''}
							</td>
						);
					})}
				</tr>
			))}
		</tfoot>
	);
}
