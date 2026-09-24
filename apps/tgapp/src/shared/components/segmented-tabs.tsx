import { useCallback, useEffect, useRef, useState } from 'react';

import { hapticSelection } from '@/shared/platform/haptics';

export interface SegTabOption<T extends string> {
	value: T;
	label: string;
	/**
	 * Optional live count shown as a small badge inside the pill — e.g. a tab that
	 * lists "Out of Stock" carrying its row count. `null` (or absent) renders no
	 * badge; `undefined` distinct from a genuine `0` is not needed here — pass a
	 * real number once you know it.
	 */
	count?: number | null;
}

interface SegmentedTabsProps<T extends string> {
	/** The tab row — order is the render order. */
	options: ReadonlyArray<SegTabOption<T>>;
	value: T;
	onChange: (value: T) => void;
	/** Accessible name for the tablist (e.g. "ထုတ်ပေးမှု အမျိုးအစား"). */
	ariaLabel: string;
	/**
	 * When true the row becomes a HORIZONTALLY SCROLLABLE strip of EQUAL segments.
	 * The segments split the row evenly while every label fits; the moment they
	 * would overflow, the strip scrolls instead of cramming — each pill keeps its
	 * FULL label, never a truncated tab. The selected pill is always scrolled into
	 * view, and the overflowing edge fades to mark the tabs beyond the fold.
	 *
	 * This is the standalone replacement for the old "content-width chips" strip:
	 * one shape that reads as a segmented control whether the labels are two or
	 * twelve.
	 */
	scrollable?: boolean;
	/**
	 * Opt the row into NOT rendering each pill's `count` badge (e.g. a design call
	 * to keep a tab row clean). Defaults to keeping the badges for existing callers.
	 */
	showCount?: boolean;
	/**
	 * Tapping the ALREADY-ACTIVE pill emits THIS value instead of the pill's own
	 * (a second tap on an active filter clears it — e.g. the movement direction
	 * pills, whose `all` = every line has no pill of its own). When set, `value`
	 * may be a state that no option renders (nothing stays highlighted). Leave
	 * off for classic radio-style tabs where one option is always selected.
	 */
	deselectValue?: T;
}

/** How far the fade runs into the row at a scrolling edge (px). */
const EDGE_FADE_PX = 24;

/** The mask that fades an overflowing edge of a scrollable tab strip — the hint
 *  that more tabs sit beyond the viewport. Callers only apply it while an edge
 *  actually overflows. */
function edgeFadeMask(start: boolean, end: boolean): string {
	const left = start ? `transparent 0, black ${EDGE_FADE_PX}px` : 'black 0';
	const right = end ? `black calc(100% - ${EDGE_FADE_PX}px), transparent 100%` : 'black 100%';
	return `linear-gradient(to right, ${left}, ${right})`;
}

function PillButton<T extends string>({
	option,
	active,
	onChange,
	showCount,
	deselectValue,
	fill = false,
	grow = false,
}: {
	option: SegTabOption<T>;
	active: boolean;
	onChange: (value: T) => void;
	showCount: boolean;
	/** (with `deselectValue` on the row) a re-tap of the active pill clears to it. */
	deselectValue?: T;
	/** Stretch to fill its grid cell (the non-scrollable equal-column row). */
	fill?: boolean;
	/** Take an equal share of the scrollable strip — floored at the label's own
	 *  width (`min-w-max`) so a tab is never truncated, only scrolled. */
	grow?: boolean;
}) {
	const sizing = fill ? 'w-full' : grow ? 'min-w-max flex-1' : 'shrink-0';
	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			onClick={() => {
				hapticSelection();
				// A second tap on the active pill = clear the filter (`deselectValue`).
				onChange(active && deselectValue !== undefined ? deselectValue : option.value);
			}}
			className={`inline-flex items-center justify-center rounded-full border px-3 py-2 text-xs font-semibold leading-myanmar whitespace-nowrap transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'border-transparent bg-primary text-primary-foreground shadow-sm' : 'border-border bg-card/80 text-foreground'} ${sizing}`}
		>
			{option.label}
			{showCount && option.count != null && (
				<span
					className={`ml-1.5 inline-flex min-w-4 items-center justify-center rounded-full px-1 py-px text-[10px] font-bold leading-none tabular-nums ${
						active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted/80 text-foreground/80'
					}`}
				>
					{option.count}
				</span>
			)}
		</button>
	);
}

/**
 * The app's ONE tab row. Two shapes:
 *
 *  - **grid** (default) — equal columns that always fill the row. For a fixed,
 *    short set of tabs (three inbound kinds, two filter panes) that fits any phone.
 *  - **`scrollable`** — the SAME equal segments, except the row scrolls instead of
 *    cramming once the labels outgrow the screen, so the tab count can grow past
 *    what a phone shows without truncating a label. The selected pill is scrolled
 *    fully into view (a deep link / reload can land on a tab past the right edge)
 *    and the overflowing edge fades as the "there is more" hint.
 *
 * Both shapes render the identical pill, so switching `scrollable` never changes
 * the tab language — only how the row behaves when it runs out of width.
 */
export function SegmentedTabs<T extends string>({
	options,
	value,
	onChange,
	ariaLabel,
	scrollable = false,
	showCount = true,
	deselectValue,
}: SegmentedTabsProps<T>) {
	const scrollerRef = useRef<HTMLDivElement>(null);
	// Which edges hide more tabs — drives the fade. Both false while the whole row
	// fits, so a fitting row renders with no mask at all.
	const [edges, setEdges] = useState({ start: false, end: false });

	const syncEdges = useCallback(() => {
		const node = scrollerRef.current;
		if (!node) return;
		const max = node.scrollWidth - node.clientWidth;
		setEdges({ start: node.scrollLeft > 1, end: max > 1 && node.scrollLeft < max - 1 });
	}, []);

	const activeIndex = options.findIndex((option) => option.value === value);

	// Keep the selected pill on screen whenever the selection or the row's shape
	// changes, and keep the edge fades in step with the pan. `inline: 'nearest'` is
	// a no-op while the pill is already fully visible, so this never fights the
	// user's own scrolling.
	useEffect(() => {
		if (!scrollable) return;
		const node = scrollerRef.current;
		if (!node) return;
		if (activeIndex >= 0) {
			// `scrollIntoView` is absent under jsdom — the optional call keeps the
			// component renderable in tests.
			node.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
		}
		syncEdges();
		node.addEventListener('scroll', syncEdges, { passive: true });
		window.addEventListener('resize', syncEdges);
		return () => {
			node.removeEventListener('scroll', syncEdges);
			window.removeEventListener('resize', syncEdges);
		};
	}, [scrollable, activeIndex, showCount, options.length, syncEdges]);

	// Non-scrollable = the classic equal-width grid that fills the row (each pill
	// `w-full` of its `1fr` column).
	if (!scrollable) {
		return (
			<div
				role="tablist"
				aria-label={ariaLabel}
				className="grid w-full gap-1.5"
				style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
			>
				{options.map((option) => (
					<PillButton
						key={option.value}
						option={option}
						active={option.value === value}
						onChange={onChange}
						showCount={showCount}
						deselectValue={deselectValue}
						fill
					/>
				))}
			</div>
		);
	}

	// Scrollable = the same equal segments in a panning row. `flex-1` splits the
	// width evenly while the labels fit; `min-w-max` floors each pill at its own
	// label width, so the moment they no longer fit the row overflows and scrolls
	// instead of truncating. `scroll-px-4` keeps the scroll-into-view clear of the
	// gutters the `-mx-4 px-4` bleed creates.
	const mask = edges.start || edges.end ? edgeFadeMask(edges.start, edges.end) : undefined;
	return (
		<div
			ref={scrollerRef}
			role="tablist"
			aria-label={ariaLabel}
			className="no-scrollbar -mx-4 flex scroll-px-4 gap-1.5 overflow-x-auto px-4"
			style={mask ? { WebkitMaskImage: mask, maskImage: mask } : undefined}
		>
			{options.map((option) => (
				<PillButton
					key={option.value}
					option={option}
					active={option.value === value}
					onChange={onChange}
					showCount={showCount}
					deselectValue={deselectValue}
					grow
				/>
			))}
		</div>
	);
}
