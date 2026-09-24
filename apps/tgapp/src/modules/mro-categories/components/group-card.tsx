import { memo } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { Pencil } from 'lucide-react';

import { categoryIcon } from '@/shared/components/category-icon';
import type { MroModelGroup } from '../data/types';

interface GroupCardProps {
	group: MroModelGroup;
	/** Tap the card → the group's SKU list (`/app/items?item_name=<master id>`). */
	onOpen: () => void;
	/** Tap the pencil → this master's rename page. */
	onEdit: () => void;
}

/**
 * One ITEM-GROUP card on the Masters hub (`/app/mro-categories` → Item Groups).
 *
 * There is deliberately NO parent category card/accordion: a flat list scans
 * better on a phone, and each card CARRIES its category in its FOOTER row, so the
 * context travels with the item wherever it appears (search results included).
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ Battery                                  [✎] │  ← EN name — the primary line
 *   │ ဘက်ထရီ                                         │  ← MY name — its sub-label
 *   │ ⚡ လျှပ်စစ်နှင့် မီးချောင်း                      │  ← the item's category
 *   └──────────────────────────────────────────────┘
 *
 * The category reads in MYANMAR (the operator's language), falling back to the
 * English label when a category carries no `name_mm`.
 *
 * There is deliberately NO tracking-policy badge here either: the policy is
 * INHERITED by every SKU under the master, so a chip on the group card restated a
 * fact the SKU rows and the item's own form already carry — and it cost the
 * names the width they needed. Both names WRAP instead of truncating, because the
 * English name and the Burmese name are the two things that tell two masters
 * apart.
 */
export const GroupCard = memo(function GroupCard({ group, onOpen, onEdit }: GroupCardProps) {
	// Display the category in Burmese; the ICON still keys off the English name.
	const categoryEn = group.categoryNameEn?.trim() || null;
	const categoryLabel = group.categoryNameMm?.trim() || categoryEn || 'Uncategorized';
	const Icon = categoryIcon(categoryEn);

	return (
		<li className={`${CARD_FRAME} shadow-card`}>
			<div className="flex items-stretch">
				<button
					type="button"
					onClick={onOpen}
					aria-label={`${group.nameEn} — open its items`}
					className="min-w-0 flex-1 rounded-l-2xl p-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{/* The names: EN on its own primary line, MY as the muted sub-label under
					    it — each wrapping on its own row, so neither hides the other. */}
					<span className="block font-display text-base font-bold leading-myanmar text-foreground">{group.nameEn}</span>
					{group.nameMm ? <span className="mt-0.5 block text-xs leading-myanmar text-muted-foreground">{group.nameMm}</span> : null}

					{/* The footer chip: the item's CATEGORY (icon + Burmese label). */}
					<span className="mt-2 flex items-center gap-1.5">
						<span className="inline-flex min-w-0 items-center gap-1 rounded-lg bg-muted/70 px-1.5 py-0.5 text-[10px] font-semibold leading-myanmar text-muted-foreground">
							<Icon className="size-3 shrink-0" strokeWidth={2.2} aria-hidden />
							<span className="truncate">{categoryLabel}</span>
						</span>
					</span>
				</button>

				{/* Rename this master — its own target, aligned to the card's top-right. */}
				<button
					type="button"
					onClick={onEdit}
					aria-label={`${group.nameEn} — edit`}
					className="flex w-12 shrink-0 items-start justify-center rounded-r-2xl pt-3.5 text-muted-foreground outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
				>
					<Pencil className="size-4" strokeWidth={2} aria-hidden />
				</button>
			</div>
		</li>
	);
});
