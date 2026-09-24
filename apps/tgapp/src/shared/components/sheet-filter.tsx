import { useState } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';

import { GLASS_ICON_BUTTON, GLASS_ICON_BUTTON_ACTIVE, GLASS_ICON_BUTTON_IDLE } from '@/shared/components/bottom-action-bar';
import { hapticImpact } from '@/shared/platform/haptics';

/** One sheet row — `'all'` (All) first, then the domain values. */
export interface SheetFilterOption<T extends string> {
	value: T;
	label: string;
}

interface SingleSelectSheetFilterProps<T extends string> {
	/** All selectable values, the leading `'all'` entry included. */
	options: ReadonlyArray<SheetFilterOption<T>>;
	/** The current selection (`'all'` = inactive — no dot on the funnel). */
	value: T;
	onChange: (value: T) => void;
	/** The bottom sheet's title (e.g. "Filter by Status"). */
	sheetTitle: string;
	/** The funnel trigger's accessible label. */
	buttonLabel?: string;
}

/**
 * The list-view filter control for the bottom action bar — a funnel trigger
 * (with an active-filter dot) that opens a single-select bottom sheet. Every
 * list page's filter (status / severity / fuel type / category / reason) was
 * its own copy of this component; the only real differences were the option
 * list and the sheet title — both now props. Options come from each module's
 * own meta (e.g. `FUEL_TYPE_META`), so the sheet's wording and the card
 * badges can never disagree.
 */
export function SingleSelectSheetFilter<T extends string>({
	options,
	value,
	onChange,
	sheetTitle,
	buttonLabel = 'Filter',
}: SingleSelectSheetFilterProps<T>) {
	const [open, setOpen] = useState(false);
	const isActive = value !== 'all';

	return (
		<>
			<button
				type="button"
				onClick={() => {
					hapticImpact('light');
					setOpen(true);
				}}
				aria-label={buttonLabel}
				className={`${GLASS_ICON_BUTTON} ${isActive ? GLASS_ICON_BUTTON_ACTIVE : GLASS_ICON_BUTTON_IDLE}`}
			>
				<SlidersHorizontal className="size-5" aria-hidden />
				{isActive && <span className="absolute right-px top-px size-2 rounded-full bg-primary" aria-hidden />}
			</button>

			<Sheet open={open} onOpenChange={setOpen}>
				<SheetContent side="bottom">
					<SheetHeader className="pb-1">
						<SheetTitle>{sheetTitle}</SheetTitle>
					</SheetHeader>
					<div className="flex flex-col gap-0.5 px-4 pb-safe">
						{options.map((option) => {
							const selected = option.value === value;
							return (
								<button
									key={option.value}
									type="button"
									onClick={() => {
										hapticImpact('light');
										onChange(option.value);
										setOpen(false);
									}}
									className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<span className={`text-sm font-medium leading-myanmar ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
										{option.label}
									</span>
									{selected && <Check className="size-4 text-primary" aria-hidden />}
								</button>
							);
						})}
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}
