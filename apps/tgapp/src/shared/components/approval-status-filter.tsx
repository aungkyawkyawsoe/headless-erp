import { useState } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';

import { GLASS_ICON_BUTTON, GLASS_ICON_BUTTON_ACTIVE, GLASS_ICON_BUTTON_IDLE } from './bottom-action-bar';
import { hapticImpact } from '@/shared/platform/haptics';

/**
 * The approval center's status filter — exactly the three decision states:
 * To Approve (pending) / Approved / Rejected. Shared by the HR request panel and
 * the asset-transfer panel, so the two tabs of ONE approval center use the same
 * control and the same URL param (`?status=`).
 */
export type ApprovalStatusFilterValue = 'pending' | 'approved' | 'rejected';

export const APPROVAL_STATUS_META: Record<ApprovalStatusFilterValue, { label: string }> = {
	pending: { label: 'To Approve' },
	approved: { label: 'Approved' },
	rejected: { label: 'Rejected' },
};

const STATUS_OPTIONS: { value: ApprovalStatusFilterValue; label: string }[] = (
	Object.entries(APPROVAL_STATUS_META) as [ApprovalStatusFilterValue, { label: string }][]
).map(([value, meta]) => ({ value, label: meta.label }));

interface ApprovalStatusFilterProps {
	value: ApprovalStatusFilterValue;
	onChange: (value: ApprovalStatusFilterValue) => void;
}

/**
 * The approval center's filter control for the bottom action bar — a funnel
 * trigger (with an active-filter dot) that opens a single-select status sheet,
 * mirroring the request list pages' filter pattern.
 */
export function ApprovalStatusFilter({ value, onChange }: ApprovalStatusFilterProps) {
	const [open, setOpen] = useState(false);
	// The decide queue (To Approve) is the default — the dot signals a deviation.
	const isActive = value !== 'pending';

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
