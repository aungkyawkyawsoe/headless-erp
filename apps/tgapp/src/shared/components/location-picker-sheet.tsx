import { Check } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';

import { MRO_LOCATIONS } from '@/shared/mro';
import { hapticImpact } from '@/shared/platform/haptics';

/** One row this picker lists — a store's value + the English label the app renders. */
export interface LocationPickerOption {
	value: string;
	label: string;
}

/**
 * The shared "Select store" bottom sheet — the ONE store chooser for every form that
 * binds a store/location (an inbound/outbound receipt, an adjustment, a stock move,
 * and the custody RETURN on a tyre/asset transfer).
 *
 * Deliberately LIGHTER than its siblings: `VehiclePickerSheet` and
 * `PersonnelPickerSheet` are SEARCH-FIRST because their directories are unbounded
 * (hundreds of plates / people), while the store list is a fixed handful
 * (`MRO_LOCATIONS`). So there is no search field and no meta line — one label per
 * row, the store's own name — and the anatomy the three sheets share is kept: a
 * bottom sheet, a title, a check on the current value, and ONE tap that commits.
 *
 * Like its siblings, the sheet does not own the value: `onSelect` fires and the
 * CALLER commits it and closes the sheet (so a caller can wire extra consequences —
 * clearing a validation error, re-deriving a hint).
 */
export function LocationPickerSheet({
	open,
	onOpenChange,
	value,
	onSelect,
	title = 'Select store',
	options = MRO_LOCATIONS,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The currently-bound store value — its row renders the check mark. */
	value: string | null;
	/** Fired on a row tap — the caller commits the value and closes the sheet. */
	onSelect: (value: string) => void;
	title?: string;
	/** Override the list (defaults to the app's `MRO_LOCATIONS`). */
	options?: ReadonlyArray<LocationPickerOption>;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="bottom">
				<SheetHeader className="pb-1">
					<SheetTitle>{title}</SheetTitle>
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
									onSelect(option.value);
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
	);
}
