import { memo } from 'react';
import { DENSE_CARD_FRAME } from '@/shared/components/card';

import type { ItemCardModel } from '../data/types';
import { ItemThumb } from '@/shared/components/item-thumb';

interface ItemCardProps {
	item: ItemCardModel;
	/** Tap the card → the SKU's EDIT FORM. The PAGE owns the destination (see
	 *  `items-page.tsx`) so the card stays a dumb row. */
	onOpen?: () => void;
}

/**
 * Item-model card — ONE list row for the ပစ္စည်းများ (`/app/items`) list, the
 * MRO SKU catalog:
 *
 *  ┌──────┬───────────────────────────────────────┐
 *  │ img  │ Air Filter AF-1001                    │  ← EN label (group + model)
 *  │      │ လေစစ်ဇကာ AF-1001                       │  ← Myanmar name (reserved line)
 *  └──────┴───────────────────────────────────────┘
 *
 * The LEFT tile is the SKU's identity: its R2 photo (`image`) when it has one,
 * else the shared `ItemThumb` monogram — the SAME glyph the stock-lines page
 * (`/app/stocks/item/:id`) draws, so the catalog and the stock app never disagree
 * about what a row's avatar is (see `ItemThumb`). It is FLUSH to the card (full
 * height, no inset), with the card's own radius clipping its left corners — the
 * tile fills the row it belongs to instead of floating inside padding.
 *
 * Deliberately MINIMAL — the list is for finding a SKU, and every extra element
 * was costing something:
 *  - the TWO NAMES are the whole card: the English label (group + model) over the
 *    Myanmar name (a muted second line, ALWAYS rendered — reserved with a
 *    non-breaking space when a SKU has none — so no card sits below the floor
 *    height). Both WRAP instead of truncating: "Air Filter AF-1001 / လေစစ်ဇကာ" IS
 *    the identity an operator is hunting for, and an ellipsis hides precisely the
 *    characters that tell two SKUs of one group apart.
 *  - NO tracking-policy badge. The policy belongs to the item NAME, and it is
 *    already stated everywhere it is actionable — the list's own `?tracking=`
 *    FILTER, the SKU pickers (a storeman must know a line needs a batch/serial),
 *    the item form's inherited-policy field. Printing it on every row was the
 *    same fact a fourth time, paid for with the width the names needed.
 *  - NO on-hand figure and NO stock lines: stock belongs to the stock app, which
 *    shows the lines where they live — the catalog's one tap opens the SKU's
 *    EDIT FORM (`/app/items/:id/edit`);
 *  - NO ⋮ menu: with one destination there is nothing for a menu to hold.
 *
 * The card body is the single affordance: it opens the SKU's edit form.
 */

/** The FLOOR every catalog card keeps. A one-line pair is exactly this high
 *  (`leading-myanmar` is `line-height: 2`, so padding 10 + name 28 + Myanmar 24 +
 *  padding 10 = 72); a WRAPPED name grows the card and the tile's `self-stretch`
 *  follows it, so the row is never taller than its own content needs. */
const CARD_MIN_HEIGHT = 'min-h-[72px]';

export const ItemCard = memo(function ItemCard({ item, onOpen }: ItemCardProps) {
	const body = (
		<>
			{/* Full-bleed tile — stretches the row height, card radius clips its corners. */}
			<ItemThumb name={item.name} image={item.image} className="flex w-[72px] shrink-0 self-stretch" />
			<div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-2.5 pr-2.5">
				<p className="font-display text-sm font-semibold leading-myanmar text-foreground">{item.name}</p>
				{/* Reserved even when empty — the line box is what holds every card at
				    the same floor height (a non-breaking space keeps it open). */}
				<p className="text-xs leading-myanmar text-muted-foreground">{item.nameMm || '\u00A0'}</p>
			</div>
		</>
	);

	if (!onOpen) {
		return <li className={`flex ${CARD_MIN_HEIGHT} items-stretch gap-2.5 overflow-hidden ${DENSE_CARD_FRAME} shadow-card`}>{body}</li>;
	}

	return (
		<li className={`${DENSE_CARD_FRAME} shadow-card`}>
			<button
				type="button"
				onClick={onOpen}
				aria-label={`Edit ${item.name}`}
				className={`flex w-full ${CARD_MIN_HEIGHT} items-stretch gap-2.5 overflow-hidden rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring`}
			>
				{body}
			</button>
		</li>
	);
});
