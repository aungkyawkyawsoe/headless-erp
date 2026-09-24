'use client';

import * as React from 'react';
import { cn } from '@/utils';
import { KanbanTaskCard } from '@/kanban';
import type { KanbanColumnDef, KanbanCardRenderProps } from '@/kanban';
import type { ColumnDef, KanbanTableConfig } from '../core/types';
import type { RowData } from '@tanstack/react-table';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Resolve a row value for a column, honoring accessorFn/accessorKey. */
function getColumnValue<TData extends RowData>(column: ColumnDef<TData>, row: TData, index: number): unknown {
	if (column.accessorFn) return column.accessorFn(row, index);
	if (column.accessorKey) return (row as Record<string, unknown>)[column.accessorKey];
	return (row as Record<string, unknown>)[column.id];
}

/** Render a cell using the column's `cell` renderer (same as the table). */
function renderCell<TData extends RowData>(column: ColumnDef<TData>, row: TData, index: number): React.ReactNode {
	const value = getColumnValue(column, row, index);
	if (column.cell) {
		return column.cell({
			row: { original: row, index, getValue: () => value },
			value,
			index,
		});
	}
	return value != null ? String(value) : '\u2014';
}

/** Compact summary cell wrapper — truncates and preserves cell renderers. */
function SummaryCell({ children }: { children: React.ReactNode }) {
	return <span className="inline-flex max-w-full min-w-0 items-center gap-1 truncate">{children}</span>;
}

// ─────────────────────────────────────────────────────────────
// Rows → Kanban columns
// ─────────────────────────────────────────────────────────────

export type KanbanViewItem<TData> = TData & { id: string };

/**
 * Build kanban columns from a set of table rows, grouped by the value of
 * `config.groupByColumnId`. Rows are wrapped with an `id` (from
 * `config.rowKey`, defaulting to the row's `id` property) so they satisfy
 * the kanban item contract.
 *
 * Column order: `config.columnOrder` → the groupBy column's `filter.options`
 * → first-seen row order. Column titles: `config.columnTitles` → raw value.
 */
export function createKanbanColumnsFromRows<TData extends RowData>(
	rows: TData[],
	columns: ColumnDef<TData>[],
	config: KanbanTableConfig<TData>,
): KanbanColumnDef<KanbanViewItem<TData>>[] {
	const groupByColumn = columns.find((c) => c.id === config.groupByColumnId);
	const rowKey = (config.rowKey ?? 'id') as keyof TData & string;
	const emptyGroupLabel = config.emptyGroupLabel ?? '(none)';

	const groupKey = (row: TData, index: number): string => {
		const value = groupByColumn ? getColumnValue(groupByColumn, row, index) : undefined;
		if (value == null || value === '') return emptyGroupLabel;
		return String(value);
	};

	// Build the column order: explicit → filter options → first-seen
	const order: string[] = [];
	const push = (key: string) => {
		if (key !== '' && !order.includes(key)) order.push(key);
	};
	config.columnOrder?.forEach(push);
	(groupByColumn?.filter?.options ?? []).forEach((o) => push(o.value));

	const groups = new Map<string, TData[]>();
	rows.forEach((row, index) => {
		const key = groupKey(row, index);
		push(key);
		const list = groups.get(key);
		if (list) list.push(row);
		else groups.set(key, [row]);
	});

	return order.map((key) => ({
		id: key,
		title: config.columnTitles?.[key] ?? key,
		items: (groups.get(key) ?? []).map((row) => ({
			...row,
			id: String(row[rowKey]),
		})),
	}));
}

// ─────────────────────────────────────────────────────────────
// Default card — reuses the column cell renderers
// ─────────────────────────────────────────────────────────────

interface DataTableKanbanCardProps<TData extends RowData> extends KanbanCardRenderProps<KanbanViewItem<TData>> {
	columns: ColumnDef<TData>[];
	config: KanbanTableConfig<TData>;
}

/**
 * Default card for the DataTable kanban view. Content mirrors the table's
 * column definitions:
 * - top-left: first summary column
 * - top-right: the groupBy column (e.g. status badge)
 * - content: the title column
 * - bottom-left / bottom-right: remaining summary columns
 *
 * Every cell reuses the column's `cell` renderer, so data formatting stays
 * identical between the table and kanban views.
 */
function DataTableKanbanCard<TData extends RowData>({
	item,
	columnId,
	columns,
	config,
	isDragging,
	isOverlay,
	onCardClick,
}: DataTableKanbanCardProps<TData>) {
	const titleColumnId = config.titleColumnId ?? columns.find((c) => c.id !== config.groupByColumnId)?.id;

	const summaryColumnIds = config.summaryColumnIds ?? [
		...columns.filter((c) => c.id !== titleColumnId && c.id !== config.groupByColumnId).map((c) => c.id),
	];
	const [topLeftId, bottomLeftId, bottomRightId] = summaryColumnIds;

	const colById = (id: string | undefined) => (id ? columns.find((c) => c.id === id) : undefined);

	const topLeftCol = colById(topLeftId);
	const bottomLeftCol = colById(bottomLeftId);
	const bottomRightCol = colById(bottomRightId);
	const titleCol = colById(titleColumnId);
	const groupCol = colById(config.groupByColumnId);

	return (
		<KanbanTaskCard<KanbanViewItem<TData>>
			item={item}
			isDragging={isDragging}
			isOverlay={isOverlay}
			onClick={onCardClick ? () => onCardClick(item, columnId) : undefined}
			renderTopLeft={topLeftCol ? (row) => <SummaryCell>{renderCell(topLeftCol, row, 0)}</SummaryCell> : undefined}
			renderTopRight={groupCol ? (row) => <SummaryCell>{renderCell(groupCol, row, 0)}</SummaryCell> : undefined}
			renderContent={
				titleCol
					? (row) => <span className="line-clamp-2 text-sm font-medium">{String(getColumnValue(titleCol, row, 0) ?? '') || '\u2014'}</span>
					: undefined
			}
			renderBottomLeft={bottomLeftCol ? (row) => <SummaryCell>{renderCell(bottomLeftCol, row, 0)}</SummaryCell> : undefined}
			renderBottomRight={bottomRightCol ? (row) => <SummaryCell>{renderCell(bottomRightCol, row, 0)}</SummaryCell> : undefined}
			className={cn('gap-1.5')}
		/>
	);
}

export { DataTableKanbanCard };
