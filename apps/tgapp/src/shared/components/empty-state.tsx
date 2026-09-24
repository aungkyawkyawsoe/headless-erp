import type { ReactNode } from 'react';

/**
 * The list pages' two empty states — ONE shared implementation for every
 * module (previously each list page carried its own local copy):
 *
 *  - `EmptyState` — the collection has NO rows at all ("ယာဉ်စာရင်း မရှိသေးပါ");
 *  - `FilteredEmptyState` — rows exist but none match the active filter, with
 *    the one-tap "clear filters" action.
 *
 * Both render the same dashed card anatomy; only the copy differs per module.
 */

interface EmptyStateProps {
	/** The bold first line (e.g. "ယာဉ်စာရင်း မရှိသေးပါ"). */
	title: string;
	/** The muted second line (e.g. "နောက်မှ ပြန်လာကြည့်ပေးပါ။"). */
	hint: string;
	/** Stretch the dashed CARD to its pane's full height rather than hugging its copy —
	 *  for an empty state that owns a whole flexed panel (a list body), where a compact
	 *  card leaves the pane looking half-built. Default: hug the copy. Covers BOTH panel
	 *  shapes: a scroll pane with a definite height (`min-h-full`) and a flex column,
	 *  where the card grows into the free space (`grow` — `min-h-full` cannot resolve
	 *  against a height that flex-grow derived). */
	fill?: boolean;
	/** Optional primary action rendered inside the card — e.g. a labelled "New item"
	 *  button wired to the same destination as the bar's `+`. An empty list is THE
	 *  moment the user wants to create, so the CTA belongs here (in an obvious,
	 *  labelled form) instead of only as a 40px icon at the screen edge. */
	action?: ReactNode;
}

export function EmptyState({ title, hint, fill, action }: EmptyStateProps) {
	return (
		<div
			className={`flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-4 py-10 text-center${fill ? ' min-h-full grow' : ''}`}
		>
			<p className="text-sm font-medium leading-myanmar text-foreground">{title}</p>
			<p className="text-xs leading-myanmar text-muted-foreground">{hint}</p>
			{action ? <div className="mt-3">{action}</div> : null}
		</div>
	);
}

interface FilteredEmptyStateProps {
	/** e.g. "စစ်ထုတ်ချက်နဲ့ ကိုက်ညီတဲ့ ယာဉ် မရှိပါ". */
	title: string;
	/** Clears the filter AND the toolbar search (the shared list clear). */
	onClear: () => void;
	/** Same as `EmptyState`'s — see there. */
	fill?: boolean;
}

export function FilteredEmptyState({ title, onClear, fill }: FilteredEmptyStateProps) {
	return (
		<div
			className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center${fill ? ' min-h-full grow' : ''}`}
		>
			<p className="text-sm font-medium leading-myanmar text-foreground">{title}</p>
			<button
				type="button"
				onClick={onClear}
				className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
			>
				Clear Filter
			</button>
		</div>
	);
}
