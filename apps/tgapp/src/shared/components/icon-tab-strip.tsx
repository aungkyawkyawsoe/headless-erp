import type { LucideIcon } from 'lucide-react';

import { hapticSelection } from '@/shared/platform/haptics';

/** One selectable icon tab — a glyph over a short label. */
export interface IconTab<T extends string> {
	value: T;
	label: string;
	icon: LucideIcon;
}

interface IconTabStripProps<T extends string> {
	tabs: readonly IconTab<T>[];
	value: T;
	onChange: (value: T) => void;
	/** Accessible name for the tablist (e.g. "Request type"). */
	ariaLabel: string;
	/**
	 * Tighter tile — a smaller glyph and a touch more breathing room between the
	 * glyph and its label. Opt-in so the masters hub keeps the large tile while a
	 * denser screen (the approval center) can shrink it.
	 */
	compact?: boolean;
}

/**
 * The app's ONE large icon-tab strip — a HORIZONTAL, snap-scrolling row of tiles,
 * each a glyph over a clamped label, the active tile tinted `primary`.
 *
 * It is the heavy sibling of `SegmentedTabs`: pick it when the tabs are few,
 * distinct destinations worth a glyph (masters hub categories, the approval
 * center's request types); use the pill row when the tabs are filters or labels
 * that outgrow a fixed tile. The tile markup lives HERE so both callers read the
 * same tile — never re-implement it per screen.
 */
export function IconTabStrip<T extends string>({ tabs, value, onChange, ariaLabel, compact = false }: IconTabStripProps<T>) {
	return (
		<div role="tablist" aria-label={ariaLabel} className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1">
			{tabs.map((tab) => {
				const selected = tab.value === value;
				const Icon = tab.icon;
				return (
					<button
						key={tab.value || 'all'}
						type="button"
						role="tab"
						aria-selected={selected}
						onClick={() => {
							hapticSelection();
							onChange(tab.value);
						}}
						className={`flex w-24 shrink-0 snap-start flex-col items-center rounded-xl px-1.5 py-2 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
							compact ? 'gap-3' : 'gap-2'
						} ${selected ? 'bg-primary/12 text-primary' : 'bg-muted/50 text-foreground'}`}
					>
						<Icon
							className={`${compact ? 'size-5' : 'size-6'} ${selected ? 'text-primary' : 'text-foreground/70'}`}
							strokeWidth={2}
							aria-hidden
						/>
						<span className="line-clamp-2 min-h-[2rem] text-xs font-medium leading-tight">{tab.label}</span>
					</button>
				);
			})}
		</div>
	);
}
