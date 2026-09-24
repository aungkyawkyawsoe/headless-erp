import { useState } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';

import { STATUS_META } from '../data/request-meta';
import type { HrRequestStatus } from '../data/types';
import { GLASS_ICON_BUTTON, GLASS_ICON_BUTTON_ACTIVE, GLASS_ICON_BUTTON_IDLE } from '@/shared/components/bottom-action-bar';
import { hapticImpact } from '@/shared/platform/haptics';

/** The list-view status filter — `'all'` shows every status. */
export type RequestStatusFilterValue = HrRequestStatus | 'all';

const STATUS_OPTIONS: { value: RequestStatusFilterValue; label: string }[] = [
	{ value: 'all', label: 'All' },
	...Object.entries(STATUS_META).map(([status, meta]) => ({ value: status as HrRequestStatus, label: meta.label })),
];

interface RequestStatusFilterProps {
	value: RequestStatusFilterValue;
	onChange: (value: RequestStatusFilterValue) => void;
}

/**
 * The list-view filter control for the bottom action bar — a funnel trigger
 * (with an active-filter dot) that opens a single-select status bottom sheet.
 */
export function RequestStatusFilter({ value, onChange }: RequestStatusFilterProps) {
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
				aria-label="Filter"
				className={`${GLASS_ICON_BUTTON} ${isActive ? GLASS_ICON_BUTTON_ACTIVE : GLASS_ICON_BUTTON_IDLE}`}
			>
				<SlidersHorizontal className="size-5" aria-hidden />
				{isActive && <span className="absolute right-px top-px size-2 rounded-full bg-primary" aria-hidden />}
			</button>

			<Sheet open={open} onOpenChange={setOpen}>
				<SheetContent side="bottom">
					<SheetHeader className="pb-1">
						<SheetTitle>Filter by Status</SheetTitle>
					</SheetHeader>
					<div className="flex flex-col gap-0.5 px-4 pb-safe">
						{STATUS_OPTIONS.map((option) => {
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
									<span className={`text-sm font-medium ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>{option.label}</span>
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
