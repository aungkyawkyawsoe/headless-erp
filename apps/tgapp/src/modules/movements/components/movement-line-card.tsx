import { memo } from 'react';

import { MovementCardBody } from './movement-card-body';
import type { MovementLineRow } from '../data/types';

/**
 * ONE confirmed movement line on Screen 3 (`/app/movements/ledger/:modelId`) —
 * a STANDALONE card in the same mock "Inventory Movement Card" anatomy as the
 * Screen 2 feed cards (qty pill + direction tag + date on top, the model it
 * moved + doc line beneath, dashed divider, store/route + line total in the
 * footer). See `MovementCardBody` for the shared anatomy.
 *
 * The row `key` is `direction:line_id` (see the ledger page).
 *
 * With `onOpen` the WHOLE card becomes the tap target that opens this line's
 * SOURCE document — the ledger row stops being a dead end. Without it the card
 * is a plain, non-interactive row.
 */
import { CARD_FRAME } from '@/shared/components/card';

export const MovementLineCard = memo(function MovementLineCard({ line, onOpen }: { line: MovementLineRow; onOpen?: () => void }) {
	const cardClass = `${CARD_FRAME} shadow-card transition-colors duration-150 ` + (onOpen ? 'hover:bg-muted/20 active:bg-muted/30' : '');
	if (!onOpen) {
		return (
			<li className={`${cardClass} p-4`}>
				<MovementCardBody line={line} />
			</li>
		);
	}
	return (
		<li className={cardClass}>
			<button
				type="button"
				onClick={onOpen}
				aria-label={`${line.model_name?.trim() || 'Line'} — open document`}
				className="block w-full rounded-2xl p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
			>
				<MovementCardBody line={line} />
			</button>
		</li>
	);
});
