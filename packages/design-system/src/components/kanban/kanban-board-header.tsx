'use client';

import type { KanbanBoardHeaderProps, KanbanItem } from './core/types';

// ─────────────────────────────────────────────────────────────
// Default Board Header
// ─────────────────────────────────────────────────────────────

interface KanbanBoardHeaderInternalProps<TItem extends KanbanItem = KanbanItem> extends KanbanBoardHeaderProps<TItem> {
	/** Consumer-provided actions (e.g. custom filter buttons, view switchers) */
	headerActions?: React.ReactNode;
}

/**
 * Default board header — deliberately minimal: it renders only the
 * consumer-provided `headerActions` and the Table/Kanban `viewModeToggle`.
 * Title, subtitle, and built-in action buttons are intentionally omitted;
 * use a custom `renderBoardHeader` if you need them.
 *
 * Returns `null` (no header at all) when there is nothing to render.
 */
function KanbanBoardHeader<TItem extends KanbanItem = KanbanItem>({
	headerActions,
	viewModeToggle,
}: KanbanBoardHeaderInternalProps<TItem>) {
	if (!headerActions && !viewModeToggle) return null;

	return (
		<header data-slot="kanban-board-header" className="flex w-full items-center justify-end gap-2 pb-4">
			{viewModeToggle}
			{headerActions}
		</header>
	);
}

export { KanbanBoardHeader };
