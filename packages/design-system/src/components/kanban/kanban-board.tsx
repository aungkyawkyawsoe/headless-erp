'use client';

import * as React from 'react';
import {
	DndContext,
	DragOverlay,
	PointerSensor,
	KeyboardSensor,
	useSensor,
	useSensors,
	pointerWithin,
	closestCorners,
	type DragStartEvent,
	type DragEndEvent,
	type DragOverEvent,
} from '@dnd-kit/core';
import {
	SortableContext,
	useSortable,
	verticalListSortingStrategy,
	horizontalListSortingStrategy,
	sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { cn } from '@/utils';
import { ScrollArea } from '@/scroll-area';
import { ViewModeToggle } from './core/view-mode-toggle';
import { KanbanBoardHeader } from './kanban-board-header';
import { KanbanColumn, DefaultEmptyColumn } from './kanban-column';
import type {
	KanbanBoardProps,
	KanbanColumnDef,
	KanbanCardRenderProps,
	KanbanColumnHeaderProps,
	KanbanItem,
	KanbanDragOverlayProps,
	ViewMode,
} from './core/types';
import { moveItemBetweenColumns, reorderItemsInColumn, reorderColumns as reorderColumnsUtil, findColumnByItemId } from './core/utils';

// ─────────────────────────────────────────────────────────────
// Sortable Card Wrapper
// ─────────────────────────────────────────────────────────────

interface SortableCardProps<TItem extends KanbanItem> {
	item: TItem;
	columnId: string;
	index: number;
	totalInColumn: number;
	disabled: boolean;
	renderCard: (props: KanbanCardRenderProps<TItem>) => React.ReactNode;
	onCardClick?: (item: TItem, columnId: string) => void;
}

function SortableCard<TItem extends KanbanItem>({
	item,
	columnId,
	index,
	totalInColumn,
	disabled,
	renderCard,
	onCardClick,
}: SortableCardProps<TItem>) {
	const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: `task-${item.id}`,
		data: { type: 'item', columnId, item },
		disabled,
	});

	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		// Promote to a compositor layer while transformed so the sortable
		// animation stays on the GPU (no repaint per frame)
		willChange: transform ? 'transform' : undefined,
		// The DragOverlay clone is the only visual that follows the pointer.
		// Hide the original item entirely (rather than dimming it) so the board
		// shows a clean gap and the solid clone has zero visual competition.
		opacity: isDragging ? 0 : undefined,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			{...listeners}
			data-slot="kanban-card-wrapper"
			className={cn('cursor-grab touch-none select-none', isDragging && 'cursor-grabbing')}
		>
			{renderCard({
				item,
				columnId,
				index,
				totalInColumn,
				isDragging,
				onCardClick,
			})}
		</div>
	);
}

// ─────────────────────────────────────────────────────────────
// Sortable Column Wrapper
// ─────────────────────────────────────────────────────────────

interface SortableColumnWrapperProps<TItem extends KanbanItem> {
	column: KanbanColumnDef<TItem>;
	isColumnDraggable: boolean;
	isItemDraggable: boolean;
	columnWidth: string;
	columnMinWidth: string;
	renderCard: (props: KanbanCardRenderProps<TItem>) => React.ReactNode;
	onCardClick?: (item: TItem, columnId: string) => void;
	renderColumnHeader?: (props: KanbanColumnHeaderProps<TItem>) => React.ReactNode;
	renderEmptyColumn?: (props: import('./core/types').KanbanEmptyColumnProps<TItem>) => React.ReactNode;
	labels?: import('./core/types').KanbanLabels;
	isDragOver?: boolean;
	activeDragType?: 'item' | 'column' | null;
}

function SortableColumnWrapper<TItem extends KanbanItem>({
	column,
	isColumnDraggable,
	isItemDraggable,
	columnWidth,
	columnMinWidth,
	renderCard,
	renderColumnHeader,
	renderEmptyColumn,
	labels,
	isDragOver,
	activeDragType,
	onCardClick,
}: SortableColumnWrapperProps<TItem>) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: `column-${column.id}`,
		data: { type: 'column', column },
		disabled: !isColumnDraggable || activeDragType === 'item',
	});

	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		// Promote to a compositor layer while transformed
		willChange: transform ? 'transform' : undefined,
		// The DragOverlay clone is the only thing that should follow the pointer.
		// Hide the original column completely (rather than dimming it) so the
		// board shows a clean gap where the column will land.
		opacity: isDragging ? 0 : undefined,
	};

	// Build clean drag handle props for the column grip
	const columnDragHandleProps: React.HTMLAttributes<HTMLElement> | undefined = isColumnDraggable
		? {
				...attributes,
				...listeners,
				role: undefined,
				tabIndex: undefined,
				'aria-label': undefined,
				'aria-describedby': undefined,
				'aria-roledescription': undefined,
				'aria-pressed': undefined,
				'aria-disabled': undefined,
			}
		: undefined;

	const columnItems = column.items;
	const itemIds = columnItems.map((item) => `task-${item.id}`);
	const isEmpty = columnItems.length === 0;

	return (
		<div ref={setNodeRef} style={style} data-slot="kanban-column-wrapper">
			<KanbanColumn<TItem>
				column={column}
				isColumnDraggable={isColumnDraggable}
				columnDragHandleProps={columnDragHandleProps}
				isDragging={isDragging}
				isEmpty={isEmpty}
				isDragOver={isDragOver}
				renderColumnHeader={renderColumnHeader}
				renderEmptyColumn={renderEmptyColumn}
				labels={labels}
				columnWidth={columnWidth}
				columnMinWidth={columnMinWidth}
			>
				{isItemDraggable ? (
					<SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
						{columnItems.map((item, idx) => (
							<SortableCard<TItem>
								key={item.id}
								item={item}
								columnId={column.id}
								index={idx}
								totalInColumn={columnItems.length}
								disabled={activeDragType === 'column'}
								renderCard={renderCard}
								onCardClick={onCardClick}
							/>
						))}
					</SortableContext>
				) : (
					columnItems.map((item, idx) => (
						<React.Fragment key={item.id}>
							{renderCard({
								item,
								columnId: column.id,
								index: idx,
								totalInColumn: columnItems.length,
								isDragging: false,
								onCardClick,
							})}
						</React.Fragment>
					))
				)}
			</KanbanColumn>
		</div>
	);
}

// ─────────────────────────────────────────────────────────────
// Collision detection:
// - Column drags: a purpose-built horizontal algorithm. Corner/rect
//   distance metrics are unstable for tall columns (vertical distance
//   dominates, so the target "sticks" to the adjacent column), and they
//   can never reach every position. The pointer's X against the original
//   column spans is the only signal that is stable, predictable and
//   reaches every slot (including the far ends).
// - Item drags: closestCorners (stable for vertical lists), with
//   pointerWithin as a fallback for large droppables.
// ─────────────────────────────────────────────────────────────

/** Vertical tolerance so the pointer may dip slightly above/below the board. */
const COLUMN_DRAG_Y_TOLERANCE = 24;

function columnCollisionDetection(args: Parameters<typeof closestCorners>[0]) {
	const { active, collisionRect, droppableContainers, droppableRects, pointerCoordinates } = args;

	// Only consider OTHER columns as drop targets for column drags (cards
	// inside the columns would otherwise be reported as the drop target).
	const candidates = droppableContainers.filter((container) => container.data.current?.type === 'column' && container.id !== active.id);
	if (candidates.length === 0) return [];

	const pointerX = pointerCoordinates?.x ?? collisionRect.left + collisionRect.width / 2;
	const pointerY = pointerCoordinates?.y ?? collisionRect.top + collisionRect.height / 2;

	// Dead zone: while the pointer is still over the dragged column's own
	// span, no other column is a valid target. This prevents the layout from
	// swapping the instant the user grabs the grip.
	const activeRect = droppableRects.get(active.id);
	if (activeRect && pointerX >= activeRect.left && pointerX <= activeRect.right) {
		return [];
	}

	let minTop = Number.POSITIVE_INFINITY;
	let maxBottom = Number.NEGATIVE_INFINITY;
	let closestId: string | null = null;
	let closestDistance = Number.POSITIVE_INFINITY;

	for (const container of candidates) {
		const rect = droppableRects.get(container.id);
		if (!rect) continue;

		minTop = Math.min(minTop, rect.top);
		maxBottom = Math.max(maxBottom, rect.bottom);

		// Horizontal distance from the pointer to the column's span — a column
		// is targeted as soon as the pointer enters it, or by proximity while
		// between columns.
		const distance = pointerX < rect.left ? rect.left - pointerX : pointerX > rect.right ? pointerX - rect.right : 0;

		if (distance < closestDistance) {
			closestDistance = distance;
			closestId = String(container.id);
		}
	}

	// Dropping above/below the whole board is a no-op, not a reorder.
	if (Number.isFinite(minTop) && (pointerY < minTop - COLUMN_DRAG_Y_TOLERANCE || pointerY > maxBottom + COLUMN_DRAG_Y_TOLERANCE)) {
		return [];
	}

	return closestId ? [{ id: closestId }] : [];
}

function kanbanCollisionDetection(args: Parameters<typeof closestCorners>[0]) {
	const { active } = args;

	if (active.data.current?.type === 'column') {
		return columnCollisionDetection(args);
	}

	// pointerWithin first — the "over" target follows the pointer, so a
	// stationary pointer yields a stable over result. Rect-based detectors
	// like closestCorners measure the dragged card's rect, which shifts as
	// the board re-lays out during optimistic moves and can re-target "over"
	// in a feedback loop (setColumns → re-layout → onDragOver → setColumns…)
	// that exceeds React's update depth limit.
	const pointerCollisions = pointerWithin(args);
	if (pointerCollisions.length > 0) {
		return pointerCollisions;
	}
	// Fall back to closestCorners — keeps the drop preview visible while
	// hovering the spacing between cards or columns.
	return closestCorners(args);
}

// ─────────────────────────────────────────────────────────────
// KanbanBoard
// ─────────────────────────────────────────────────────────────

function KanbanBoard<TItem extends KanbanItem = KanbanItem>({
	columns: initialColumns,
	renderCard,
	renderColumnHeader,
	renderBoardHeader,
	renderEmptyColumn,
	renderDragOverlay,
	renderTableView,
	viewMode: viewModeProp,
	defaultViewMode = 'kanban',
	onViewModeChange,
	columnWidth = '20rem',
	columnMinWidth = '17.5rem',
	columnGap = '1rem',
	maxHeight,
	reorderColumns = false,
	reorderItems = false,
	collisionDetection,
	sensors: customSensors,
	onCardClick,
	onItemMove,
	onColumnMove,
	title,
	subtitle,
	headerActions,
	className,
	id,
	labels,
}: KanbanBoardProps<TItem>) {
	// ── Card click handler (stable reference) ─────────────
	const handleCardClick = React.useCallback(
		(item: TItem, columnId: string) => {
			onCardClick?.(item, columnId);
		},
		[onCardClick],
	);
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
	const viewModeToggle = renderTableView ? <ViewModeToggle viewMode={viewMode} onViewModeChange={handleViewModeChange} /> : null;

	// ── State with ref to avoid stale closures ─────────────────
	const [columns, setColumns] = React.useState<KanbanColumnDef<TItem>[]>(initialColumns);
	const columnsRef = React.useRef(columns);
	// Keep ref in sync — in effect, not during render
	React.useEffect(() => {
		columnsRef.current = columns;
	}, [columns]);

	const [activeId, setActiveId] = React.useState<string | null>(null);
	const [activeDragType, setActiveDragType] = React.useState<'item' | 'column' | null>(null);
	const [dragOverColumnId, setDragOverColumnId] = React.useState<string | null>(null);

	// Drag snapshot — used to revert optimistic moves on cancel
	const dragStartColumnsRef = React.useRef<KanbanColumnDef<TItem>[] | null>(null);
	const dragStartSourceColumnRef = React.useRef<string | null>(null);
	// Pointer delta of the last cross-container optimistic move. Guards
	// against layout-driven bounce-backs: when a move re-lays out the board,
	// dnd-kit can fire onDragOver again with the same delta (no real pointer
	// movement) targeting the column we just moved from.
	const lastDragOverMoveDeltaRef = React.useRef<{
		x: number;
		y: number;
	} | null>(null);

	// Sync external columns — only when reference changes
	const initialColumnsRef = React.useRef(initialColumns);
	React.useEffect(() => {
		// Only reset if the reference actually changed (not just re-created)
		if (initialColumnsRef.current !== initialColumns) {
			initialColumnsRef.current = initialColumns;
			setColumns(initialColumns);
		}
	}, [initialColumns]);

	const dragEnabled = reorderColumns || reorderItems;

	// ── Sensors ────────────────────────────────────────────────
	const defaultSensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 5 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	const sensors = customSensors ?? defaultSensors;

	// ── Column IDs for SortableContext ─────────────────────────
	const columnIds = React.useMemo(() => columns.map((col) => `column-${col.id}`), [columns]);

	// ── Drag Handlers (use columnsRef for current state) ──────
	const handleDragStart = React.useCallback((event: DragStartEvent) => {
		const { active } = event;
		setActiveId(String(active.id));

		const dragType = active.data.current?.type === 'column' ? 'column' : 'item';
		setActiveDragType(dragType);

		// Snapshot for optimistic-move rollback
		const currentColumns = columnsRef.current;
		dragStartColumnsRef.current = currentColumns;
		lastDragOverMoveDeltaRef.current = null;

		if (dragType === 'item') {
			const activeItemId = String(active.id).replace('task-', '');
			dragStartSourceColumnRef.current = currentColumns.find((c) => c.items.some((i) => i.id === activeItemId))?.id ?? null;
		} else {
			dragStartSourceColumnRef.current = null;
		}
	}, []);

	const handleDragOver = React.useCallback((event: DragOverEvent) => {
		const { active, over } = event;

		// Defensive: never process a move onto the item itself
		if (!over || String(over.id) === String(active.id) || active.data.current?.type !== 'item') {
			setDragOverColumnId(null);
			return;
		}

		const currentColumns = columnsRef.current;
		const activeItemId = String(active.id).replace('task-', '');
		const activeContainer = currentColumns.find((c) => c.items.some((i) => i.id === activeItemId))?.id;

		const overData = over.data.current;
		let overContainer: string | null = null;
		let overItemId: string | null = null;

		if (overData?.type === 'item') {
			overContainer = overData.columnId;
			overItemId = overData.item?.id ?? String(over.id).replace('task-', '');
		} else if (overData?.type === 'column') {
			overContainer = overData.column?.id ?? null;
		}

		setDragOverColumnId(overContainer);

		// Same column — dnd-kit sortable handles the reflow animation already
		if (!activeContainer || !overContainer || activeContainer === overContainer) {
			return;
		}

		const sourceCol = currentColumns.find((c) => c.id === activeContainer);
		const targetCol = currentColumns.find((c) => c.id === overContainer);
		if (!sourceCol || !targetCol) return;

		const activeIndex = sourceCol.items.findIndex((i) => i.id === activeItemId);
		if (activeIndex === -1) return;

		let newIndex: number;
		if (overData?.type === 'column') {
			// Dropping on the column body — append to the end
			newIndex = targetCol.items.length;
		} else {
			const overIndex = targetCol.items.findIndex((i) => i.id === overItemId);
			// Insert before or after the hovered item based on pointer position
			const translatedTop = (active.rect.current as { translated?: { top: number } } | null)?.translated?.top;
			const isBelowOverItem = translatedTop != null && over.rect != null && translatedTop > over.rect.top + over.rect.height;
			const modifier = isBelowOverItem ? 1 : 0;
			newIndex = overIndex >= 0 ? overIndex + modifier : targetCol.items.length;
		}

		// Optimistically move the item — dnd-kit animates the target column's
		// cards apart smoothly via sortable transforms. The same-delta guard
		// prevents a stationary pointer from ping-ponging the card between
		// columns (see lastDragOverMoveDeltaRef).
		const lastDelta = lastDragOverMoveDeltaRef.current;
		if (lastDelta && lastDelta.x === event.delta.x && lastDelta.y === event.delta.y) {
			return;
		}
		lastDragOverMoveDeltaRef.current = event.delta;

		const next = currentColumns.map((col) => {
			if (col.id === activeContainer) {
				return { ...col, items: col.items.filter((i) => i.id !== activeItemId) };
			}
			if (col.id === overContainer) {
				const items = [...col.items];
				items.splice(newIndex, 0, sourceCol.items[activeIndex]);
				return { ...col, items };
			}
			return col;
		});

		columnsRef.current = next;
		setColumns(next);
	}, []);

	const handleDragCancel = React.useCallback(() => {
		setActiveId(null);
		setActiveDragType(null);
		setDragOverColumnId(null);
		lastDragOverMoveDeltaRef.current = null;
		// Revert optimistic moves made during the drag
		if (dragStartColumnsRef.current) {
			columnsRef.current = dragStartColumnsRef.current;
			setColumns(dragStartColumnsRef.current);
		}
	}, []);

	const handleDragEnd = React.useCallback(
		(event: DragEndEvent) => {
			const { active, over } = event;
			const currentColumns = columnsRef.current;

			setActiveId(null);
			setActiveDragType(null);
			setDragOverColumnId(null);
			lastDragOverMoveDeltaRef.current = null;

			if (!over) {
				// Dropped outside any droppable — revert optimistic moves
				if (dragStartColumnsRef.current) {
					columnsRef.current = dragStartColumnsRef.current;
					setColumns(dragStartColumnsRef.current);
				}
				return;
			}

			const activeData = active.data.current;
			const overData = over.data.current;

			// ── Column reorder ──────────────────────────────────
			if (reorderColumns && activeData?.type === 'column' && overData?.type === 'column') {
				const activeColId = activeData.column.id;
				const overColId = overData.column.id;

				if (activeColId !== overColId) {
					const oldIndex = currentColumns.findIndex((c) => c.id === activeColId);
					const newIndex = currentColumns.findIndex((c) => c.id === overColId);

					if (oldIndex !== -1 && newIndex !== -1) {
						const newColumns = reorderColumnsUtil(currentColumns, oldIndex, newIndex);
						columnsRef.current = newColumns;
						setColumns(newColumns);
						onColumnMove?.({ columnId: activeColId, newIndex });
					}
				}
				return;
			}

			// ── Item move ───────────────────────────────────────
			if (reorderItems && activeData?.type === 'item') {
				const activeItemId = String(active.id).replace('task-', '');
				const activeContainer = currentColumns.find((c) => c.items.some((i) => i.id === activeItemId))?.id;
				if (!activeContainer) return;

				const sourceColumnId = dragStartSourceColumnRef.current ?? activeContainer;

				let overContainer: string | null = null;
				let overItemId: string | null = null;
				if (overData?.type === 'item') {
					overContainer = overData.columnId;
					overItemId = overData.item?.id ?? String(over.id).replace('task-', '');
				} else if (overData?.type === 'column') {
					overContainer = overData.column?.id ?? null;
				}
				if (!overContainer) return;

				if (activeContainer === overContainer) {
					// Same column — finalize reorder (cross moves were already
					// applied optimistically in handleDragOver)
					if (overData?.type === 'item') {
						const oldIndex = currentColumns.find((c) => c.id === activeContainer)?.items.findIndex((i) => i.id === activeItemId);
						const newIndex = currentColumns.find((c) => c.id === activeContainer)?.items.findIndex((i) => i.id === overItemId);

						if (oldIndex !== undefined && newIndex !== undefined && oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
							const next = reorderItemsInColumn(currentColumns, activeContainer, oldIndex, newIndex);
							const movedItem = next.find((c) => c.id === activeContainer)?.items[newIndex];
							if (!movedItem) return;
							columnsRef.current = next;
							setColumns(next);
							onItemMove?.({
								item: movedItem,
								sourceColumnId,
								targetColumnId: activeContainer,
								newIndex,
							});
						}
					}
				} else {
					// Cross-column — the item was moved during dragOver; ensure it
					// ended up in the target column (safety net) and emit the event
					const targetCol = currentColumns.find((c) => c.id === overContainer);
					const sourceCol = currentColumns.find((c) => c.id === activeContainer);
					if (!targetCol || !sourceCol) return;

					const itemIndex = targetCol.items.findIndex((i) => i.id === activeItemId);

					let next = currentColumns;
					let newIndex = itemIndex;

					if (itemIndex === -1) {
						// Safety net: item wasn't moved during dragOver — move it now
						const sourceIndex = sourceCol.items.findIndex((i) => i.id === activeItemId);
						if (sourceIndex === -1) return;

						let targetIndex: number;
						if (overData?.type === 'column') {
							targetIndex = targetCol.items.length;
						} else {
							const overIndex = targetCol.items.findIndex((i) => i.id === overItemId);
							targetIndex = overIndex >= 0 ? overIndex : targetCol.items.length;
						}

						try {
							const result = moveItemBetweenColumns(currentColumns, activeItemId, overContainer, targetIndex);
							next = result.columns;
							newIndex = targetIndex;
						} catch {
							return;
						}
					}

					const movedItem = next.find((c) => c.id === overContainer)?.items.find((i) => i.id === activeItemId);
					if (!movedItem) return;

					columnsRef.current = next;
					setColumns(next);
					onItemMove?.({
						item: movedItem,
						sourceColumnId,
						targetColumnId: overContainer,
						newIndex,
					});
				}
			}
		},
		[reorderColumns, reorderItems, onItemMove, onColumnMove],
	);

	// ── Drag overlay item ──────────────────────────────────────
	const activeItem = React.useMemo(() => {
		if (!activeId || activeDragType !== 'item') return null;
		for (const col of columns) {
			const found = col.items.find((i) => `task-${i.id}` === activeId);
			if (found) return found;
		}
		return null;
	}, [activeId, activeDragType, columns]);

	const activeColumn = React.useMemo(() => {
		if (!activeId || activeDragType !== 'column') return null;
		const colId = activeId.replace('column-', '');
		return columns.find((c) => c.id === colId) ?? null;
	}, [activeId, activeDragType, columns]);

	// ── Default drag overlay render ────────────────────────────
	const defaultDragOverlay = React.useCallback(
		(props: KanbanDragOverlayProps<TItem>) => {
			if (props.type === 'item' && props.item) {
				const sourceCol = findColumnByItemId(columns, props.item.id);
				const colId = sourceCol?.id ?? '';
				const idx = props.item && sourceCol ? sourceCol.items.findIndex((i) => i.id === props.item!.id) : 0;
				return renderCard({
					item: props.item,
					columnId: colId,
					index: idx,
					totalInColumn: sourceCol?.items.length ?? 0,
					isDragging: false,
					isOverlay: true,
					onCardClick: handleCardClick,
				});
			}
			if (props.type === 'column' && props.column) {
				const col = props.column;
				const isEmpty = col.items.length === 0;
				return (
					<div
						className={cn(
							'pointer-events-none flex shrink-0 rotate-2 flex-col rounded-sm',
							// Match the board column exactly (including its muted surface) so
							// the lifted clone looks identical — not like a different-colored
							// block. The shadow/ring is what reads as "lifted".
							'border border-primary/30 bg-muted/25 shadow-2xl ring-1 ring-primary/20',
							'dark:bg-muted/10',
						)}
						style={{ width: columnWidth, minWidth: columnMinWidth }}
					>
						{renderColumnHeader ? (
							renderColumnHeader({ column: col, itemCount: col.items.length })
						) : (
							<h3 className="truncate px-3 pt-3 pb-2 text-sm font-semibold">{col.title}</h3>
						)}
						<div className="flex flex-1 flex-col gap-2 px-3 pb-3">
							{isEmpty ? (
								renderEmptyColumn ? (
									renderEmptyColumn({ column: col, isDragOver: false })
								) : (
									<DefaultEmptyColumn column={col} isDragOver={false} labels={labels} />
								)
							) : (
								col.items.map((item, idx) => (
									<React.Fragment key={item.id}>
										{renderCard({
											item,
											columnId: col.id,
											index: idx,
											totalInColumn: col.items.length,
											isDragging: false,
											// The column is the overlay — its cards must render
											// exactly as they do on the board (no per-card ghost
											// opacity/rotation/shadow).
											isOverlay: false,
											onCardClick: handleCardClick,
										})}
									</React.Fragment>
								))
							)}
						</div>
					</div>
				);
			}
			return null;
		},
		[renderCard, renderColumnHeader, renderEmptyColumn, labels, columns, columnWidth, columnMinWidth, handleCardClick],
	);

	// ── Shared header (default or consumer-provided) ──────────
	const boardHeader =
		renderBoardHeader === null ? null : renderBoardHeader ? (
			renderBoardHeader({ columns, title, subtitle, viewModeToggle })
		) : (
			<KanbanBoardHeader<TItem> columns={columns} headerActions={headerActions} viewModeToggle={viewModeToggle} />
		);

	// ── Table view — consumer-supplied alternative presentation ──
	const tableView = renderTableView ? (
		<div data-slot="kanban-table-view" className="w-full">
			{renderTableView({
				items: columns.flatMap((c) => c.items),
				columns,
			})}
		</div>
	) : null;

	// ── Static mode — no DnD at all ───────────────────────────
	if (!dragEnabled) {
		if (viewMode === 'table' && tableView) {
			return (
				<div data-slot="kanban-board" id={id} className={cn('flex w-full flex-col', className)}>
					{boardHeader}
					{tableView}
				</div>
			);
		}
		return (
			<div data-slot="kanban-board" id={id} className={cn('flex w-full flex-col', className)}>
				{boardHeader}
				<ScrollArea data-slot="kanban-board-scroll" className="flex-1" style={maxHeight ? { maxHeight } : undefined}>
					<div data-slot="kanban-board-columns" className="flex items-start" style={{ gap: columnGap, paddingRight: columnGap }}>
						{columns.map((column) => {
							const isEmpty = column.items.length === 0;
							return (
								<KanbanColumn<TItem>
									key={column.id}
									column={column}
									isColumnDraggable={false}
									isEmpty={isEmpty}
									renderColumnHeader={renderColumnHeader}
									renderEmptyColumn={renderEmptyColumn}
									labels={labels}
									columnWidth={columnWidth}
									columnMinWidth={columnMinWidth}
								>
									{column.items.map((item, idx) => (
										<React.Fragment key={item.id}>
											{renderCard({
												item,
												columnId: column.id,
												index: idx,
												totalInColumn: column.items.length,
												isDragging: false,
												onCardClick: handleCardClick,
											})}
										</React.Fragment>
									))}
								</KanbanColumn>
							);
						})}
					</div>
				</ScrollArea>
			</div>
		);
	}

	// ── DnD mode ───────────────────────────────────────────────
	const boardContent =
		viewMode === 'table' && tableView ? (
			<div data-slot="kanban-board" id={id} className={cn('flex w-full flex-col', className)}>
				{boardHeader}
				{tableView}
			</div>
		) : (
			<div data-slot="kanban-board" id={id} className={cn('flex w-full flex-col', className)}>
				{/* Header */}
				{boardHeader}

				{/* Columns — horizontally scrollable */}
				<ScrollArea data-slot="kanban-board-scroll" className="flex-1" style={maxHeight ? { maxHeight } : undefined}>
					<div data-slot="kanban-board-columns" className="flex items-start" style={{ gap: columnGap, paddingRight: columnGap }}>
						<SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
							{columns.map((column) => (
								<SortableColumnWrapper<TItem>
									key={column.id}
									column={column}
									isColumnDraggable={reorderColumns}
									isItemDraggable={reorderItems}
									columnWidth={columnWidth}
									columnMinWidth={columnMinWidth}
									renderCard={renderCard}
									renderColumnHeader={renderColumnHeader}
									renderEmptyColumn={renderEmptyColumn}
									labels={labels}
									isDragOver={dragOverColumnId === column.id}
									activeDragType={activeDragType}
									onCardClick={handleCardClick}
								/>
							))}
						</SortableContext>
					</div>
				</ScrollArea>
			</div>
		);

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={collisionDetection ?? kanbanCollisionDetection}
			onDragStart={handleDragStart}
			onDragOver={handleDragOver}
			onDragEnd={handleDragEnd}
			onDragCancel={handleDragCancel}
		>
			{boardContent}

			<DragOverlay>
				{activeDragType &&
					(renderDragOverlay
						? renderDragOverlay({
								item: activeItem,
								column: activeColumn,
								type: activeDragType,
							})
						: defaultDragOverlay({
								item: activeItem,
								column: activeColumn,
								type: activeDragType,
							}))}
			</DragOverlay>
		</DndContext>
	);
}

export { KanbanBoard };
