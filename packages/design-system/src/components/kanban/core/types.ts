/**
 * Core types for the generic Kanban system.
 *
 * The board knows only about **columns** and **items with an id**.
 * Everything else — card rendering, column styling, drag overlay appearance —
 * is injected via render props so there is zero domain coupling.
 */

import type * as React from 'react';
import type { CollisionDetection, SensorDescriptor, SensorOptions } from '@dnd-kit/core';

// ─────────────────────────────────────────────────────────────
// View Mode
// ─────────────────────────────────────────────────────────────

/** The two supported data-presentation modes (Table / Kanban). */
export type ViewMode = 'table' | 'kanban';

// ─────────────────────────────────────────────────────────────
// Minimal Item Contract
// ─────────────────────────────────────────────────────────────

/**
 * The absolute minimum an item must satisfy: it has an `id`.
 * Consumers extend this via their own generics.
 */
export interface KanbanItem {
	id: string;
}

// ─────────────────────────────────────────────────────────────
// Column
// ─────────────────────────────────────────────────────────────

/**
 * A column in the board. `TItem` can be any shape that satisfies `KanbanItem`.
 *
 * @example
 * ```ts
 * const columns: KanbanColumnDef<MyTask>[] = [
 *   { id: "todo", title: "To Do", items: [...] },
 * ]
 * ```
 */
export interface KanbanColumnDef<TItem extends KanbanItem = KanbanItem> {
	/** Unique column identifier */
	id: string;
	/** Display title for the column header */
	title: string;
	/** Items in this column */
	items: TItem[];
	/**
	 * Optional semantic variant label. Passed through to column renderers.
	 * The board itself does not interpret this — it's purely for the consumer.
	 */
	variant?: string;
	/**
	 * Optional CSS class applied directly to the column container.
	 * Use this for one-off styling without a variant system.
	 */
	className?: string;
	/**
	 * Arbitrary metadata bag. Use for counts, permissions, filters, etc.
	 * Available in all render prop callbacks.
	 */
	meta?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// Render Prop Interfaces
// ─────────────────────────────────────────────────────────────

/**
 * Props passed to `renderCard`. Contains everything needed to render
 * a card — including optional drag handle props for grip-based activation.
 */
export interface KanbanCardRenderProps<TItem extends KanbanItem = KanbanItem> {
	/** The item data */
	item: TItem;
	/** The column this card belongs to */
	columnId: string;
	/** Index within the column */
	index: number;
	/** Total items in the column (useful for "last item" styling) */
	totalInColumn: number;
	/** True when this card is being dragged */
	isDragging: boolean;
	/** True when this card is rendered inside the DragOverlay (clone) */
	isOverlay?: boolean;
	/** Called when the card is clicked. Provided by the board's onCardClick. */
	onCardClick?: (item: TItem, columnId: string) => void;
}

/**
 * Props passed to `renderColumnHeader`.
 */
export interface KanbanColumnHeaderProps<TItem extends KanbanItem = KanbanItem> {
	/** The column data */
	column: KanbanColumnDef<TItem>;
	/** Number of items in the column */
	itemCount: number;
	/** Spread onto a grip element to make the column header draggable */
	dragHandleProps?: React.HTMLAttributes<HTMLElement>;
}

/**
 * Props passed to `renderBoardHeader`.
 */
export interface KanbanBoardHeaderProps<TItem extends KanbanItem = KanbanItem> {
	/** All columns in the board */
	columns: KanbanColumnDef<TItem>[];
	/** Board title (from props) */
	title?: string;
	/** Board subtitle (from props) */
	subtitle?: string;
	/**
	 * The Table/Kanban view-mode toggle. Present when `renderTableView` is
	 * provided to the board — render it anywhere in a custom header.
	 */
	viewModeToggle?: React.ReactNode;
}

/**
 * Props passed to `renderEmptyColumn`.
 */
export interface KanbanEmptyColumnProps<TItem extends KanbanItem = KanbanItem> {
	/** The empty column */
	column: KanbanColumnDef<TItem>;
	/** True while an item is being dragged over this column */
	isDragOver: boolean;
}

/**
 * Props passed to `renderDragOverlay`. The overlay is shown while
 * a card or column is actively being dragged.
 */
export interface KanbanDragOverlayProps<TItem extends KanbanItem = KanbanItem> {
	/** The item being dragged, or null if dragging a column */
	item: TItem | null;
	/** The column being dragged, or null if dragging an item */
	column: KanbanColumnDef<TItem> | null;
	/** "item" or "column" — what's being dragged */
	type: 'item' | 'column';
}

// ─────────────────────────────────────────────────────────────
// Drag Events
// ─────────────────────────────────────────────────────────────

export interface KanbanItemMoveEvent<TItem extends KanbanItem = KanbanItem> {
	/** The item that was moved */
	item: TItem;
	/** Column the item came from */
	sourceColumnId: string;
	/** Column the item landed in (may be the same) */
	targetColumnId: string;
	/** Index within the target column after the move */
	newIndex: number;
}

export interface KanbanColumnMoveEvent {
	/** The column id that was moved */
	columnId: string;
	/** New index position */
	newIndex: number;
}

// ─────────────────────────────────────────────────────────────
// Labels (i18n)
// ─────────────────────────────────────────────────────────────

export interface KanbanLabels {
	/** Board header "New task" button. Default: "New task" */
	newTask?: string;
	/** Board header "Filters" button. Default: "Filters" */
	filters?: string;
	/** Board header "Share" button. Default: "Share" */
	share?: string;
	/** Empty column placeholder. Default: "No items" */
	emptyColumn?: string;
	/** Drop target hint while dragging over empty column. Default: "Drop here" */
	dropHere?: string;
	/** Screen reader announcement for item count. Use {count} as placeholder. */
	itemCount?: string;
}

/**
 * Props passed to `renderTableView` — the consumer-supplied alternative
 * presentation (typically a table built from the same items).
 */
export interface KanbanTableViewProps<TItem extends KanbanItem = KanbanItem> {
	/** Every item across all columns, flattened in board order */
	items: TItem[];
	/** The board's columns (with their items) */
	columns: KanbanColumnDef<TItem>[];
}

// ─────────────────────────────────────────────────────────────
// Board Props
// ─────────────────────────────────────────────────────────────

export interface KanbanBoardProps<TItem extends KanbanItem = KanbanItem> {
	// ── Data ───────────────────────────────────────────────────
	/** Columns with their items */
	columns: KanbanColumnDef<TItem>[];

	// ── Rendering (all injected — zero hardcoding) ─────────────
	/**
	 * Render a card. This is the only required render prop.
	 * The board NEVER knows what a card looks like.
	 */
	renderCard: (props: KanbanCardRenderProps<TItem>) => React.ReactNode;

	/** Render the column header area. Default: title + item count */
	renderColumnHeader?: (props: KanbanColumnHeaderProps<TItem>) => React.ReactNode;

	/**
	 * Render the board header. Default: view-mode toggle + `headerActions`
	 * (right-aligned). Set to `null` to hide the header entirely.
	 */
	renderBoardHeader?: ((props: KanbanBoardHeaderProps<TItem>) => React.ReactNode) | null;

	/** Render when a column is empty */
	renderEmptyColumn?: (props: KanbanEmptyColumnProps<TItem>) => React.ReactNode;

	/**
	 * Render the drag overlay. By default, the board re-uses `renderCard`
	 * for item overlays and `renderColumnHeader` for column overlays.
	 * Override for custom drag previews.
	 */
	renderDragOverlay?: (props: KanbanDragOverlayProps<TItem>) => React.ReactNode;

	// ── Layout Configuration ───────────────────────────────────
	/** Fixed column width (CSS value). Default: "20rem" */
	columnWidth?: string;
	/** Minimum column width (CSS value). Default: "17.5rem" */
	columnMinWidth?: string;
	/** Gap between columns (CSS value). Default: "1rem" */
	columnGap?: string;
	/** Maximum height of the board (CSS value). Enables vertical scrolling. */
	maxHeight?: string;

	// ── DnD Configuration ──────────────────────────────────────
	/**
	 * Enable column reordering via drag-and-drop.
	 * When false, columns are rendered in their provided order.
	 * @default false
	 */
	reorderColumns?: boolean;
	/**
	 * Enable item reordering (within and across columns) via drag-and-drop.
	 * When false, items are rendered in their provided order.
	 * @default false
	 */
	reorderItems?: boolean;
	/**
	 * Custom collision detection algorithm.
	 * Defaults to `closestCorners` for items, `closestCenter` for columns.
	 */
	collisionDetection?: CollisionDetection;
	/**
	 * Custom sensors for dnd-kit. Useful for adding touch support or
	 * adjusting activation distance.
	 */
	sensors?: SensorDescriptor<SensorOptions>[];

	// ── Callbacks ──────────────────────────────────────────────
	/** Called when a card is clicked */
	onCardClick?: (item: TItem, columnId: string) => void;
	/** Called after a drag-and-drop move completes */
	onItemMove?: (event: KanbanItemMoveEvent<TItem>) => void;
	/** Called after a column reorder completes */
	onColumnMove?: (event: KanbanColumnMoveEvent) => void;

	// ── Board Header Configuration ─────────────────────────────
	/** Board title (passed through to `renderBoardHeader`; unused by the default header) */
	title?: string;
	/** Board subtitle (passed through to `renderBoardHeader`; unused by the default header) */
	subtitle?: string;
	/**
	 * Custom actions rendered in the header (right side).
	 * E.g. filter buttons, create buttons, view switchers.
	 */
	headerActions?: React.ReactNode;

	// ── View Mode (Table / Kanban) ─────────────────────────────
	/**
	 * Controlled view mode. When omitted, the board tracks `defaultViewMode`
	 * internally. Only meaningful when `renderTableView` is provided.
	 */
	viewMode?: ViewMode;
	/** Uncontrolled initial view mode. Defaults to `"kanban"`. */
	defaultViewMode?: ViewMode;
	/** Called when the user switches view mode. */
	onViewModeChange?: (mode: ViewMode) => void;
	/**
	 * Render the items as a table (or any alternative view). When provided,
	 * the board header shows the Table/Kanban toggle and the board can switch
	 * between the kanban columns and this view.
	 */
	renderTableView?: (props: KanbanTableViewProps<TItem>) => React.ReactNode;

	// ── Misc ───────────────────────────────────────────────────
	className?: string;
	/** ID for the board container */
	id?: string;
	/** Override default labels for i18n */
	labels?: KanbanLabels;
}

// ─────────────────────────────────────────────────────────────
// Preset Card Props (for KanbanTaskCard convenience component)
// ─────────────────────────────────────────────────────────────

/**
 * Props for the built-in KanbanTaskCard preset.
 * Each slot accepts a render function. When omitted, falls back to
 * a default presentation based on common `TaskItem` fields.
 */
export interface KanbanTaskCardProps<TItem extends KanbanItem = KanbanItem> {
	item: TItem;
	isDragging: boolean;
	isOverlay?: boolean;
	onClick?: () => void;

	/** Slot: top-left area (e.g. category badge, code, priority) */
	renderTopLeft?: (item: TItem) => React.ReactNode;
	/** Slot: top-right area (e.g. status pill) */
	renderTopRight?: (item: TItem) => React.ReactNode;
	/** Slot: middle area (e.g. title) */
	renderContent?: (item: TItem) => React.ReactNode;
	/** Slot: bottom-left area (e.g. assignee) */
	renderBottomLeft?: (item: TItem) => React.ReactNode;
	/** Slot: bottom-right area (e.g. due date, progress) */
	renderBottomRight?: (item: TItem) => React.ReactNode;

	className?: string;
}

// ─────────────────────────────────────────────────────────────
// Progress Ring Props
// ─────────────────────────────────────────────────────────────

export interface KanbanProgressRingProps {
	/** Progress value from 0 to 100 */
	percentage: number;
	/** Diameter in CSS pixels. Default: 24 */
	size?: number;
	/** Stroke width. Default: 2.5 */
	strokeWidth?: number;
	/** Track (background) color class. Default: "text-muted/20" */
	trackClassName?: string;
	/** Progress arc color class. Default: "text-primary" */
	progressClassName?: string;
	className?: string;
}
