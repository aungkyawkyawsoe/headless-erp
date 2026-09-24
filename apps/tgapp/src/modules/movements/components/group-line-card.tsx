import { memo } from 'react';

import { MovementCardBody } from './movement-card-body';
import type { MovementLineRow } from '../data/types';

/**
 * ONE confirmed movement line on the group feed (Screen 2) — a STANDALONE card
 * (the mock "Inventory Movement Card" anatomy: qty pill + direction tag + date
 * on top, the model it moved + doc line beneath, dashed divider, store/route +
 * line total in the footer). See `MovementCardBody` for the shared anatomy.
 *
 * Tapping the whole card drills to that line's model Screen 3 ledger when the
 * row carries a model id (`onOpen` absent → a plain, non-tappable card).
 */
import { CARD_FRAME } from '@/shared/components/card';

export const GroupLineCard = memo(function GroupLineCard({ line, onOpen }: { line: MovementLineRow; onOpen?: () => void }) {
	const title = line.model_name?.trim() || '—';
	const cardClass = `${CARD_FRAME} shadow-card transition-colors duration-150 ` + (onOpen ? 'hover:bg-muted/20 active:bg-muted/30' : '');

	return (
		<li className={cardClass}>
			{onOpen ? (
				<button
					type="button"
					onClick={onOpen}
					aria-label={`${title} — open ledger`}
					className="block w-full rounded-2xl p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<MovementCardBody line={line} />
				</button>
			) : (
				<div className="rounded-2xl p-4">
					<MovementCardBody line={line} />
				</div>
			)}
		</li>
	);
});
