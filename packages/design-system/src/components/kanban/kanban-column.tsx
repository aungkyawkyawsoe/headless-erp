'use client';

import { cn } from '@/utils';
import type { KanbanColumnDef, KanbanColumnHeaderProps, KanbanEmptyColumnProps, KanbanItem, KanbanLabels } from './core/types';

// ── Inline SVG grip icon ─────────────────────────────────────
function GripVerticalIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={cn('shrink-0', className)}
			aria-hidden="true"
			{...props}
		>
			<circle cx="9" cy="5" r="1" />
			<circle cx="15" cy="5" r="1" />
			<circle cx="9" cy="12" r="1" />
			<circle cx="15" cy="12" r="1" />
			<circle cx="9" cy="19" r="1" />
			<circle cx="15" cy="19" r="1" />
		</svg>
	);
}

// ─────────────────────────────────────────────────────────────
// Default Column Header
// ─────────────────────────────────────────────────────────────

function DefaultColumnHeader<TItem extends KanbanItem = KanbanItem>({
	column,
	dragHandleProps,
}: KanbanColumnHeaderProps<TItem> & { labels?: KanbanLabels }) {
	return (
		<div data-slot="kanban-column-header" className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
			<h3 className="truncate text-sm font-semibold">{column.title}</h3>

			{dragHandleProps && (
				<button
					type="button"
					{...dragHandleProps}
					data-slot="kanban-column-grip"
					className={cn(
						'rounded p-0.5 text-muted-foreground/50 transition-all',
						'opacity-0 group-hover/kanban-column:opacity-100',
						'cursor-grab hover:text-foreground',
					)}
					tabIndex={-1}
					aria-label={`Drag column ${column.title}`}
				>
					<GripVerticalIcon className="size-4" />
				</button>
			)}
		</div>
	);
}

// ─────────────────────────────────────────────────────────────
// Default Empty Column State
// ─────────────────────────────────────────────────────────────

function DefaultEmptyColumn<TItem extends KanbanItem = KanbanItem>({
	isDragOver,
	labels,
}: KanbanEmptyColumnProps<TItem> & { labels?: KanbanLabels }) {
	const l = labels ?? {};
	return (
		<div
			data-slot="kanban-column-empty"
			className={cn(
				'flex flex-1 flex-col items-center justify-center gap-1 px-3 py-8 text-center',
				'rounded-sm border border-dashed transition-colors',
				isDragOver ? 'border-primary/40 bg-primary/5' : 'border-border/50 text-muted-foreground',
			)}
		>
			<p className="text-xs">{isDragOver ? (l.dropHere ?? 'Drop here') : (l.emptyColumn ?? 'No items')}</p>
		</div>
	);
}

// ─────────────────────────────────────────────────────────────
// KanbanColumn
// ─────────────────────────────────────────────────────────────

interface KanbanColumnProps<TItem extends KanbanItem = KanbanItem> {
	column: KanbanColumnDef<TItem>;
	/** Refs from the outer SortableContext for this column */
	sortableRef?: (node: HTMLElement | null) => void;
	/** True when column reordering is enabled */
	isColumnDraggable: boolean;
	/** Drag handle props (from outer DnD context) */
	columnDragHandleProps?: React.HTMLAttributes<HTMLElement>;
	isDragging?: boolean;
	isEmpty?: boolean;
	isDragOver?: boolean;

	/** Render props (from KanbanBoard) */
	renderColumnHeader?: (props: KanbanColumnHeaderProps<TItem>) => React.ReactNode;
	/** Render when a column is empty */
	renderEmptyColumn?: (props: KanbanEmptyColumnProps<TItem>) => React.ReactNode;
	children: React.ReactNode;
	labels?: KanbanLabels;

	/** Layout */
	columnWidth: string;
	columnMinWidth: string;
}

function KanbanColumn<TItem extends KanbanItem = KanbanItem>({
	column,
	sortableRef,
	isColumnDraggable,
	columnDragHandleProps,
	isDragging,
	isEmpty,
	isDragOver,
	renderColumnHeader,
	renderEmptyColumn,
	children,
	labels,
	columnWidth,
	columnMinWidth,
}: KanbanColumnProps<TItem>) {
	const headerProps: KanbanColumnHeaderProps<TItem> = {
		column,
		itemCount: column.items.length,
		dragHandleProps: isColumnDraggable ? columnDragHandleProps : undefined,
	};

	const emptyProps: KanbanEmptyColumnProps<TItem> = {
		column,
		isDragOver: isDragOver ?? false,
	};

	return (
		<div
			ref={sortableRef}
			data-slot="kanban-column"
			data-dragging={isDragging ? '' : undefined}
			data-variant={column.variant}
			className={cn(
				'group/kanban-column flex shrink-0 flex-col rounded-sm border border-border',
				'bg-muted/25 dark:bg-muted/10',
				// Dragging state — keep the column fully visible (items must not
				// look collapsed); use a ring/shadow to indicate the drag instead
				isDragging && 'border-primary/40 shadow-lg ring-2 ring-primary/20 dark:ring-primary/30',
				// Column width
				column.className,
			)}
			style={{
				width: columnWidth,
				minWidth: columnMinWidth,
			}}
		>
			{/* Column Header */}
			{renderColumnHeader ? renderColumnHeader(headerProps) : <DefaultColumnHeader {...headerProps} labels={labels} />}

			{/* Items list or empty state */}
			<div
				data-slot="kanban-column-items"
				className={cn('flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3', isEmpty && 'flex items-stretch')}
			>
				{isEmpty ? renderEmptyColumn ? renderEmptyColumn(emptyProps) : <DefaultEmptyColumn {...emptyProps} labels={labels} /> : children}
			</div>
		</div>
	);
}

export { KanbanColumn, DefaultColumnHeader, DefaultEmptyColumn };
