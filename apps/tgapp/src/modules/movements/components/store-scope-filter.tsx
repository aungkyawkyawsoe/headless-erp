import { useState } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';

import { GLASS_ICON_BUTTON, GLASS_ICON_BUTTON_ACTIVE, GLASS_ICON_BUTTON_IDLE } from '@/shared/components/bottom-action-bar';
import { hapticImpact } from '@/shared/platform/haptics';
import { MOVEMENT_STORE_OPTIONS } from '../data/meta';
import type { MovementStoreScope } from '../data/types';

interface StoreScopeFilterProps {
	/** The active scope — `''` = all stores (the inactive state). */
	value: MovementStoreScope;
	onChange: (value: MovementStoreScope) => void;
	/** The bottom sheet's title (e.g. "Select store"). */
	sheetTitle: string;
	/** The funnel trigger's accessible label. */
	buttonLabel?: string;
}

/**
 * The Movement screens' bottom-bar store filter — the app's bottom-sheet filter
 * pattern (funnel trigger + single-select Sheet) with one deliberate variation:
 * the "all stores" sentinel is the EMPTY STRING (the wire contract's
 * `location=''` = every store), not the shared component's `'all'`. The shared
 * `SingleSelectSheetFilter` hardcodes its active-dot on `value !== 'all'`, so
 * this module keeps its own copy of that anatomy with the dot keyed off
 * `value !== ''` — the sheet rows (အားလုံး first, then every MRO location) and
 * the trigger styling are otherwise identical.
 */
export function StoreScopeFilter({ value, onChange, sheetTitle, buttonLabel = 'Filter' }: StoreScopeFilterProps) {
	const [open, setOpen] = useState(false);
	const isActive = value !== '';

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
						{MOVEMENT_STORE_OPTIONS.map((option) => {
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
