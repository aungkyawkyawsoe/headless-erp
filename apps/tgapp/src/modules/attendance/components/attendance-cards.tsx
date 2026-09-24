import { useEffect, useState } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { LogIn, LogOut } from 'lucide-react';

import { checkOutWaitRemainingMs, formatPunchTime, formatWaitRemaining } from '../utils/time';
import { Shimmer } from '@/shared/components/skeletons';

interface AttendanceCardsProps {
	/** Today's latest check-in punch (UTC ISO) — `--:--` when absent. */
	checkIn?: string | null;
	/** Today's latest check-out punch (UTC ISO) — `--:--` when absent. */
	checkOut?: string | null;
	/** While the summary is fetching, render shimmer cards instead of values. */
	loading?: boolean;
	onCheckInClick?: () => void;
	onCheckOutClick?: () => void;
}

/**
 * The two attendance punch cards — Check In and Check Out. Each is tappable and
 * opens the punch dialog (map + location + shift selector) — but only while its
 * punch is still missing for the current work window (one punch per direction
 * per day): no check-in yet → Check Out is inert; already checked in → Check In
 * is inert; already checked out → Check Out is inert.
 *
 * A check-out also has a MINIMUM wait: stock/field work can't be punched out the
 * instant you arrive, so the Check Out card stays inert for `MIN_CHECKOUT_WAIT_MS`
 * (15 min) after the check-in and shows the remaining wait on its face. The tick
 * runs only while that wait is pending, so a settled day costs no timer.
 *
 * A card FILLS (primary gradient + white text) once its punch is recorded, so
 * the day's progress reads at a glance — the recorded direction is highlighted
 * and the pending one stays plain. The inert card keeps the same look (never
 * dimmed); it simply stops accepting taps (`disabled`).
 */
export function AttendanceCards({ checkIn, checkOut, loading, onCheckInClick, onCheckOutClick }: AttendanceCardsProps) {
	// The clock the 15-min gate is measured against — advanced once a second only
	// while the wait is still pending (below), so the card unlocks on its own.
	const [now, setNow] = useState(() => Date.now());
	const waitMs = checkOutWaitRemainingMs(checkIn, now);
	const waitingForCheckOut = Boolean(checkIn) && !checkOut && waitMs > 0;

	useEffect(() => {
		if (!waitingForCheckOut) return;
		// Tick only while the Mini App is actually VISIBLE: this interval used to
		// run every second for the whole 15-minute wait, including while the app sat
		// backgrounded in the Telegram client, re-rendering this subtree for a clock
		// nobody could see. On resume the next tick re-reads `Date.now()` anyway, so
		// the card still unlocks on its own.
		const id = setInterval(() => {
			if (document.visibilityState === 'hidden') return;
			setNow(Date.now());
		}, 1000);
		return () => clearInterval(id);
	}, [waitingForCheckOut]);

	// A card goes inert once today's punch for its direction exists — tapping it
	// must not open a duplicate punch sheet — and Check Out additionally waits out
	// the minimum delay after the check-in.
	const checkInDisabled = Boolean(checkIn);
	const checkOutDisabled = !checkIn || Boolean(checkOut) || waitingForCheckOut;

	if (loading) {
		return (
			<div className="grid grid-cols-2 gap-3" aria-hidden>
				{[0, 1].map((i) => (
					<div key={i} className={`flex flex-col gap-2 ${CARD_FRAME} p-3.5`}>
						<Shimmer className="h-3 w-16 rounded" />
						<Shimmer className="h-6 w-20 rounded" />
					</div>
				))}
			</div>
		);
	}

	return (
		<div className="grid grid-cols-2 gap-3">
			<PunchCard
				label="ရုံးတက်"
				icon={LogIn}
				time={checkIn}
				filled={Boolean(checkIn)}
				disabled={checkInDisabled}
				onClick={onCheckInClick}
			/>
			<PunchCard
				label="ရုံးဆင်း"
				icon={LogOut}
				time={checkOut}
				filled={Boolean(checkOut)}
				disabled={checkOutDisabled}
				hint={waitingForCheckOut ? `Available in ${formatWaitRemaining(waitMs)}` : undefined}
				onClick={onCheckOutClick}
			/>
		</div>
	);
}

/** One punch card — a label + icon badge on top, the punch time below. */
function PunchCard({
	label,
	icon: Icon,
	time,
	filled,
	disabled,
	hint,
	onClick,
}: {
	label: string;
	icon: typeof LogIn;
	time?: string | null;
	filled: boolean;
	disabled: boolean;
	hint?: string;
	onClick?: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`flex flex-col rounded-2xl border p-3.5 text-left transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:active:scale-100 ${
				filled ? 'border-transparent bg-primary text-primary-foreground shadow-md' : 'border-border bg-card text-foreground'
			}`}
		>
			<div className="flex items-center justify-between gap-2">
				<span className={`text-xs font-semibold ${filled ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{label}</span>
				<span
					className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${
						filled ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/10 text-primary'
					}`}
				>
					<Icon className="size-4" strokeWidth={2.2} aria-hidden />
				</span>
			</div>
			<span className={`mt-2 text-xl font-bold tabular-nums ${filled ? 'text-primary-foreground' : 'text-foreground'}`}>
				{formatPunchTime(time)}
			</span>
			{hint ? (
				<span className={`mt-1 text-meta font-medium leading-myanmar ${filled ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
					{hint}
				</span>
			) : null}
		</button>
	);
}
