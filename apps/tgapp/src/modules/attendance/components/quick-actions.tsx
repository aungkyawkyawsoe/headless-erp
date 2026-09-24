import { useNavigate } from 'react-router-dom';
import { CARD_FRAME } from '@/shared/components/card';
import { CalendarOff, Clock, LogOut, type LucideIcon } from 'lucide-react';

import { hapticImpact } from '@/shared/platform/haptics';

interface QuickAction {
	key: string;
	label: string;
	icon: LucideIcon;
	href: string;
}

interface QuickActionsProps {
	/**
	 * Actions to disable, keyed by action key — e.g. `early` without a check-in,
	 * `ot` without a full check-in/check-out day. Disabled pills stay visible
	 * but inert (same treatment as the disabled check-out card).
	 */
	disabled?: Partial<Record<QuickAction['key'], boolean>>;
}

/**
 * The quick actions — three vertical icon-over-label cards in one row (the
 * design reference's Early Leave / Leave / Overtime block). The glyphs keep a
 * flat primary tint to stay distinct from the launcher's gradient app icons.
 * Press scale + haptic retained.
 *
 * Each action opens its ENTRY FORM first (`.../+`); the form's bottom bar has a
 * list-view toggle into that type's request list.
 *
 * Labels stay BURMESE (the crew's own words for these requests — same wording
 * as the `HrRequestType` doc in `data/types.ts`); the rest of the app is English.
 */
export const QUICK_ACTIONS: QuickAction[] = [
	{
		key: 'early',
		label: 'စောပြန်ခွင့်',
		icon: LogOut,
		href: '/app/attendance/early-leave/+',
	},
	{
		key: 'leave',
		label: 'ခွင့်',
		icon: CalendarOff,
		href: '/app/attendance/leave/+',
	},
	{
		key: 'ot',
		label: 'အချိန်ပို',
		icon: Clock,
		href: '/app/attendance/overtime/+',
	},
];

export function QuickActions({ disabled }: QuickActionsProps) {
	const navigate = useNavigate();

	const open = (action: QuickAction) => {
		if (disabled?.[action.key]) return;
		hapticImpact('light');
		navigate(action.href);
	};

	return (
		// One row, full width — three vertical icon-over-label cards.
		<div className="grid grid-cols-3 gap-2.5">
			{QUICK_ACTIONS.map((action) => {
				const Icon = action.icon;
				const isDisabled = disabled?.[action.key] ?? false;
				return (
					<button
						key={action.key}
						type="button"
						onClick={() => open(action)}
						disabled={isDisabled}
						className={`flex flex-col items-center justify-center gap-1.5 ${CARD_FRAME} px-2 py-3 shadow-sm transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100`}
					>
						<Icon className="size-5 shrink-0 text-primary" strokeWidth={2.1} aria-hidden />
						<span className="truncate text-meta font-semibold leading-myanmar text-foreground">{action.label}</span>
					</button>
				);
			})}
		</div>
	);
}
