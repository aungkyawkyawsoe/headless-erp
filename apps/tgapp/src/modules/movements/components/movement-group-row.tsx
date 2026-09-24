import { memo } from 'react';
import { DENSE_CARD_FRAME } from '@/shared/components/card';
import { ChevronRight } from 'lucide-react';

import type { MovementGroupRow as MovementGroupRowModel } from '../data/types';

/** The row's display name — `name_en` → the raw `name` → `name_mm` (never the id). */
export function movementGroupDisplay(group: MovementGroupRowModel): string {
	return group.name_en?.trim() || group.name?.trim() || group.name_mm?.trim() || group.id;
}

interface MovementGroupRowProps {
	group: MovementGroupRowModel;
	/** Tap → the group's moving models (Screen 2). */
	onOpen: () => void;
}

/**
 * ONE item-group row on the Movement screens — the item-name masters that have
 * CONFIRMED movement (server-scoped `/movement/groups`, unlike the
 * mro-categories hub's whole catalog), deliberately stripped to the directory
 * itself. Shared by the kiosk's answer list (`/app/movements` search results)
 * and the browse-all register (`/app/movements/browse`):
 *
 *  ┌────────────────────────────────────┐
 *  │ Bulb                            ›  │  ← name_en (bold)
 *  │  မီးသီး                            │  ← name_mm (muted)
 *  └────────────────────────────────────┘
 *
 * No count pill, no member aggregates — only the two display-name lines and the
 * right chevron. Tapping the row opens that group's movement feed.
 */
export const MovementGroupRow = memo(function MovementGroupRow({ group, onOpen }: MovementGroupRowProps) {
	const primary = movementGroupDisplay(group);
	return (
		<li className={`${DENSE_CARD_FRAME} pl-4 pr-3 shadow-card`}>
			<button
				type="button"
				onClick={onOpen}
				aria-label={`${primary} — open movements`}
				className="flex w-full items-center gap-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<div className="min-w-0 flex-1">
					<p className="font-display text-sm font-semibold leading-myanmar text-foreground">{primary}</p>
					{group.name_mm && group.name_mm.trim() ? (
						<p className="mt-0.5 text-xs leading-myanmar text-muted-foreground">{group.name_mm}</p>
					) : null}
				</div>
				<ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
			</button>
		</li>
	);
});
