import { useState } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';

import { GLASS_ICON_BUTTON, GLASS_ICON_BUTTON_ACTIVE, GLASS_ICON_BUTTON_IDLE } from '@/shared/components/bottom-action-bar';
import { SegmentedTabs, type SegTabOption } from '@/shared/components/segmented-tabs';
import { hapticImpact, hapticSelection } from '@/shared/platform/haptics';

/** The two panes of the sheet, as the `SegmentedTabs` option VALUES. */
type Pane = 'first' | 'second';

/** One selectable row of a filter pane. */
export interface TwoPaneOption {
	value: string;
	label: string;
}

/** The applied values of the two panes — both SINGLE-select (one value each). */
export interface TwoPaneValue {
	first: string;
	second: string;
}

interface TwoPaneFilterTriggerProps {
	/** Current applied values — the opened sheet is seeded from them. */
	value: TwoPaneValue;
	/** Apply commits BOTH panes in one go — navigation/filters at once. */
	onApply: (next: TwoPaneValue) => void;
	/** The pane labels (e.g. `['Store', 'Status']`). */
	paneLabels: readonly [string, string];
	/** First pane rows — required, single-select. */
	firstOptions: readonly TwoPaneOption[];
	/** Second pane rows — required, single-select. */
	secondOptions: readonly TwoPaneOption[];
	/** What "Reset" returns to. */
	reset: TwoPaneValue;
	/** The sheet title shown above the segmented toggles. */
	sheetTitle: string;
	/** The trigger's accessible label. */
	buttonLabel?: string;
	/** The funnel dot shows an accent when any pane is off its default. */
	hasActive?: boolean;
}

/**
 * The reference two-pane FILTER bottom sheet — two segmented panes, each a
 * SINGLE-select list of radio rows. A Reset / Apply footer commits both panes in
 * one go (nothing applies until Apply; Reset restores the defaults and closes).
 *
 * Layout matches every other bottom sheet in the app (the shared `SheetContent`
 * framing, whose built-in top-right ✕ is the only close): the title sits
 * top-left, a segmented pill row switches the panes, the selectable rows share
 * the 16px gutter, and a Reset / Apply footer closes the sheet. Consumers
 * configure the panes (labels + option lists) — the stock browser uses it for
 * `Store` × `Status`.
 */
export function TwoPaneFilterTrigger({
	value,
	onApply,
	sheetTitle,
	buttonLabel = 'Filter',
	hasActive = false,
	paneLabels,
	firstOptions,
	secondOptions,
	reset,
}: TwoPaneFilterTriggerProps) {
	const [open, setOpen] = useState(false);
	const [pane, setPane] = useState<Pane>('first');
	const [first, setFirst] = useState(value.first);
	const [second, setSecond] = useState(value.second);

	const openSheet = () => {
		hapticImpact('light');
		setFirst(value.first);
		setSecond(value.second);
		setPane('first');
		setOpen(true);
	};

	const commit = () => {
		hapticImpact('medium');
		onApply({ first, second });
		setOpen(false);
	};

	const resetAll = () => {
		hapticImpact('medium');
		onApply(reset);
		setOpen(false);
	};

	const active = hasActive || value.first !== reset.first || value.second !== reset.second;
	const paneOptions: ReadonlyArray<SegTabOption<Pane>> = [
		{ value: 'first', label: paneLabels[0] },
		{ value: 'second', label: paneLabels[1] },
	];

	return (
		<>
			<button
				type="button"
				aria-label={buttonLabel}
				onClick={openSheet}
				className={`${GLASS_ICON_BUTTON} ${active ? GLASS_ICON_BUTTON_ACTIVE : GLASS_ICON_BUTTON_IDLE}`}
			>
				<SlidersHorizontal className="size-5" aria-hidden />
				{active && <span className="absolute right-px top-px size-2 rounded-full bg-primary" aria-hidden />}
			</button>

			<Sheet open={open} onOpenChange={setOpen}>
				<SheetContent side="bottom">
					<SheetHeader className="pb-0">
						<SheetTitle>{sheetTitle}</SheetTitle>
					</SheetHeader>

					<div className="mx-4 mt-2">
						<SegmentedTabs options={paneOptions} value={pane} onChange={setPane} ariaLabel={sheetTitle} />
					</div>

					<div className="flex max-h-[46vh] flex-col gap-0.5 overflow-y-auto px-4 pb-safe">
						{pane === 'first'
							? firstOptions.map((option) => (
									<CheckRow key={option.value} option={option} checked={first === option.value} onPick={() => setFirst(option.value)} />
								))
							: secondOptions.map((option) => (
									<CheckRow key={option.value} option={option} checked={second === option.value} onPick={() => setSecond(option.value)} />
								))}
					</div>

					<div className="flex gap-2.5 border-t border-border px-4 pb-safe pt-3">
						<button
							type="button"
							onClick={resetAll}
							className="flex-1 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							Reset
						</button>
						<button
							type="button"
							onClick={commit}
							disabled={active && first === reset.first && second === reset.second}
							className="flex-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							Apply
						</button>
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}

/** A radio row for a SINGLE-select pane — label left, the filled check circle right. */
function CheckRow({ option, checked, onPick }: { option: TwoPaneOption; checked: boolean; onPick: () => void }) {
	return (
		<button
			type="button"
			aria-pressed={checked}
			onClick={() => {
				hapticSelection();
				onPick();
			}}
			className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
				checked ? 'bg-primary/8 text-foreground' : 'text-muted-foreground hover:bg-muted/60'
			}`}
		>
			<span className="text-sm font-medium">{option.label}</span>
			<span
				className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
					checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 text-transparent'
				}`}
			>
				<Check className="size-3" strokeWidth={3} aria-hidden />
			</span>
		</button>
	);
}
