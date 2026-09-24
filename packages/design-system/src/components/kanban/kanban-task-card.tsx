'use client';

import { cn } from '@/utils';
import type { KanbanItem, KanbanTaskCardProps } from './core/types';

// ── Inline SVG arrow icon ────────────────────────────────────
function ArrowRightIcon({ className }: { className?: string }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={cn('shrink-0', className)}
			aria-hidden="true"
		>
			<path d="M5 12h14M12 5l7 7-7 7" />
		</svg>
	);
}

// ─────────────────────────────────────────────────────────────
// KanbanTaskCard — Convenience preset, fully slot-overridable
// ─────────────────────────────────────────────────────────────

/**
 * A ready-to-use task card with a 3-row layout.
 *
 * Every visual section is a render prop slot. When a slot is omitted,
 * it renders nothing — there are **zero** hardcoded assumptions about
 * the shape of `TItem`. The card is purely a visual shell.
 *
 * When rendered inside a draggable `KanbanBoard`, the whole card area
 * is draggable (no grip handle is rendered).
 *
 * Use it as:
 * ```tsx
 * <KanbanBoard
 *   renderCard={(props) => (
 *     <KanbanTaskCard
 *       {...props}
 *       renderTopLeft={(item) => <CategoryBadge category={item.category} />}
 *       renderContent={(item) => <span>{item.title}</span>}
 *     />
 *   )}
 * />
 * ```
 */
function KanbanTaskCard<TItem extends KanbanItem = KanbanItem>({
	item,
	isDragging,
	isOverlay,
	onClick,
	renderTopLeft,
	renderTopRight,
	renderContent,
	renderBottomLeft,
	renderBottomRight,
	className,
}: KanbanTaskCardProps<TItem>) {
	const hasTopRow = renderTopLeft || renderTopRight;
	const hasBottomRow = renderBottomLeft || renderBottomRight;

	return (
		<article
			data-slot="kanban-task-card"
			data-dragging={isDragging ? '' : undefined}
			data-overlay={isOverlay ? '' : undefined}
			tabIndex={onClick ? 0 : undefined}
			onClick={onClick}
			onKeyDown={
				onClick
					? (e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								onClick();
							}
						}
					: undefined
			}
			className={cn(
				// Base card
				'group/kanban-card relative flex flex-col gap-2 rounded-sm border border-border bg-card p-3 text-sm',
				'transition-all duration-150 select-none',
				// Hover
				!isDragging && !isOverlay && 'hover:border-foreground/20 hover:shadow-sm',
				// Dragging state
				isDragging && 'opacity-50',
				// Overlay state (clone follows the cursor)
				isOverlay && 'rotate-2 cursor-grabbing shadow-xl',
				// Clickable
				onClick && 'cursor-pointer',
				className,
			)}
		>
			{/* ── Top Row ── */}
			{hasTopRow && (
				<div data-slot="kanban-card-top" className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-1.5 overflow-hidden">{renderTopLeft?.(item)}</div>
					<div className="flex shrink-0 items-center gap-1.5">{renderTopRight?.(item)}</div>
				</div>
			)}

			{/* ── Content (Middle Row) ── */}
			{renderContent && (
				<div data-slot="kanban-card-content" className="group/kanban-card-title flex items-start gap-1">
					<span className="flex-1">{renderContent(item)}</span>
					{/* Arrow appears on hover when clickable */}
					{onClick && (
						<ArrowRightIcon className="mt-0.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover/kanban-card-title:opacity-100" />
					)}
				</div>
			)}

			{/* ── Bottom Row ── */}
			{hasBottomRow && (
				<div data-slot="kanban-card-bottom" className="flex items-center justify-between gap-2">
					<div className="flex min-w-0 items-center gap-1.5">{renderBottomLeft?.(item)}</div>
					<div className="flex shrink-0 items-center gap-2">{renderBottomRight?.(item)}</div>
				</div>
			)}
		</article>
	);
}

export { KanbanTaskCard };
