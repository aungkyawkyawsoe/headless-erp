import { useMemo } from 'react';
import { MapPin } from 'lucide-react';

import { DAY_MS, formatBurmeseMonthDay } from '@/shared/time/myanmar';
import { Shimmer } from '@/shared/components/skeletons';
import { formatPunchTime, toWorkDate } from '../utils/time';
import { HISTORY_DAYS } from '../data/query-keys';
import type { AttendancePunch, HrRequest } from '../data/types';

/**
 * Attendance Records — the attendance history list: one card per work day
 * (today + the last `HISTORY_DAYS` previous days), NEWEST FIRST — the Today row
 * sits on top — with the day's latest check-in / check-out and a state badge
 * (labels in English: Present / Leave / Absent / Today).
 *
 * Real-data successor of the demo-only list removed with the API integration:
 * rows derive from the SAME summary the cards read (the `hrm_attendances` punch
 * rows + approved `hrm_leaves` — see `fetchAttendanceSummary` in `data/api.ts`)
 * — punches grouped by their work date (same `toWorkDate` semantics as
 * `latestPunchesToday`) and approved leaves (Leave badge) overlaying the window.
 *
 * Status precedence per day: Leave (an approved leave covers it) → Today (the
 * current work date) → Present (a check-in exists) → Absent (past day, no check-in).
 */
type DayStatus = 'present' | 'leave' | 'absent' | 'today';

export interface HistoryDay {
	/** `YYYY-MM-DD` — the 4 AM-boundary work date (same semantics as the cards). */
	date: string;
	/** The work day's latest check-in punch (UTC ISO) — `--:--` when absent. */
	checkIn: string | null;
	checkOut: string | null;
	/** "lat,lng" of the day's check-in punch — null when the punch carried no fix. */
	checkInGeo: string | null;
	/** "lat,lng" of the day's check-out punch — null when the punch carried no fix. */
	checkOutGeo: string | null;
	/** An approved leave covers this day. */
	leave: boolean;
}

// Status-tone tokens, never raw Tailwind palette: the raw `emerald-500/15`
// pair measured 2.9:1 in dark mode (and ignored the theme entirely), while the
// tokens are tuned per scheme to stay ≥4.5:1.
const STATUS_META: Record<DayStatus, { label: string; className: string }> = {
	present: { label: 'Present', className: 'bg-status-success-soft text-status-success' },
	leave: { label: 'Leave', className: 'bg-status-info-soft text-status-info' },
	absent: { label: 'Absent', className: 'bg-status-danger-soft text-status-danger' },
	today: { label: 'Today', className: 'bg-muted text-muted-foreground' },
};

const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Wed" — English weekday of a `YYYY-MM-DD` date. */
function formatDayLabel(date: string): string {
	const d = new Date(`${date}T00:00:00Z`);
	return WEEKDAYS_EN[d.getUTCDay()];
}

/** The last `days` work dates ending at `workDate` — ascending; render reversed for newest-first. */
function recentDates(workDate: string, days: number): string[] {
	const end = Date.parse(`${workDate}T00:00:00Z`);
	return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

interface AttendanceHistoryProps {
	/** Today's punch rows (summary, newest-first) — grouped per work date below. */
	punches: AttendancePunch[];
	/** Approved leaves (summary) — days they cover get the Leave badge. */
	leaves: HrRequest[];
	/** The current 4 AM-boundary work date — the Today row (rendered first). */
	workDate: string;
	/** Work days to render (today + this many before). Defaults to the home
	 *  dashboard's short window; the Team Tracking detail asks for 7. */
	days?: number;
	/** While the summary is fetching, render shimmer rows instead of the list. */
	loading?: boolean;
	/** Tapping a day with a located punch opens its location sheet (Team
	 *  Tracking). Omit on the home dashboard — rows stay static there. */
	onOpenDay?: (day: HistoryDay) => void;
}

export function AttendanceHistory({ punches, leaves, workDate, days = HISTORY_DAYS + 1, loading, onOpenDay }: AttendanceHistoryProps) {
	const rows = useMemo<HistoryDay[]>(() => {
		// Newest first — today (workDate) on top, then each previous day below.
		const dates = recentDates(workDate, days).reverse();
		const byDate = new Map(
			dates.map((date) => [date, { date, checkIn: null, checkOut: null, checkInGeo: null, checkOutGeo: null, leave: false } as HistoryDay]),
		);
		// Punches — newest-first input, so the first match per type per day is the
		// day's LATEST punch (same rule the cards use for today).
		for (const p of punches) {
			if (!p.timestamp) continue;
			const day = byDate.get(toWorkDate(p.timestamp));
			if (!day) continue;
			if (p.type === 'check-in' && !day.checkIn) {
				day.checkIn = p.timestamp;
				day.checkInGeo = p.location ?? null;
			} else if (p.type === 'check-out' && !day.checkOut) {
				day.checkOut = p.timestamp;
				day.checkOutGeo = p.location ?? null;
			}
		}
		// Approved leaves — any day inside a leave's range gets the Leave badge.
		for (const l of leaves) {
			if (!l.from_date || !l.to_date) continue;
			for (const day of byDate.values()) {
				if (day.date >= l.from_date && day.date <= l.to_date) day.leave = true;
			}
		}
		return dates.map((date) => byDate.get(date)!);
	}, [punches, leaves, workDate, days]);

	return (
		<section className="mt-5">
			<h2 className="mb-3 text-sm font-semibold leading-myanmar text-foreground">Attendance Records</h2>
			{loading ? (
				<div className="flex flex-col gap-2.5" aria-hidden>
					{Array.from({ length: Math.min(days, 7) }, (_, i) => (
						<div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card/50 px-3.5 py-3">
							<Shimmer className="h-8 w-24 shrink-0 rounded" />
							<Shimmer className="h-8 flex-1 rounded" />
							<Shimmer className="h-5 w-12 shrink-0 rounded-full" />
						</div>
					))}
				</div>
			) : (
				<div className="flex flex-col gap-2.5">
					{rows.map((day) => {
						// Leave wins the badge — a leave-covered day reads as leave even when
						// it is today (half-day leaves may still carry punch times below).
						const status: DayStatus = day.leave ? 'leave' : day.date === workDate ? 'today' : day.checkIn ? 'present' : 'absent';
						const meta = STATUS_META[status];
						const located = Boolean(day.checkInGeo || day.checkOutGeo);
						const clickable = Boolean(onOpenDay) && located;
						const cardClass = 'flex items-center gap-3 rounded-xl border border-border bg-card/50 px-3.5 py-3';
						const body = (
							<>
								{/* Date block — fixed track + nowrap so every card's time grid starts on the same x */}
								<div className="w-29 shrink-0">
									<div className="truncate text-sm font-medium leading-myanmar text-foreground">{formatDayLabel(day.date)}</div>
									<div className="truncate text-xs leading-myanmar text-muted-foreground">{formatBurmeseMonthDay(day.date)}</div>
								</div>

								{/* Punch rows — label + time grouped tightly, aligned across all cards */}
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<PunchRow label="In" time={day.checkIn} />
									<PunchRow label="Out" time={day.checkOut} />
									{day.checkInGeo ? (
										<div className="flex min-w-0 items-center gap-1 text-meta leading-myanmar text-muted-foreground">
											<MapPin className="size-3 shrink-0" strokeWidth={2.2} aria-hidden />
											<span className="truncate">{day.checkInGeo}</span>
										</div>
									) : null}
								</div>

								{/* Status badge — fixed min width so badges line up down the list */}
								<span
									className={`inline-flex min-w-12 shrink-0 items-center justify-center rounded-full px-2 py-px text-meta font-medium leading-myanmar ${meta.className}`}
								>
									{meta.label}
								</span>
							</>
						);

						return clickable ? (
							<button
								key={day.date}
								type="button"
								onClick={() => onOpenDay?.(day)}
								aria-label={`Punch locations for ${day.date}`}
								className={`${cardClass} w-full text-left transition-transform duration-150 active:scale-[0.99]`}
							>
								{body}
							</button>
						) : (
							<article key={day.date} className={cardClass}>
								{body}
							</article>
						);
					})}
				</div>
			)}
		</section>
	);
}

/** One punch line — fixed-width label track keeps times aligned across cards. */
function PunchRow({ label, time }: { label: string; time: string | null }) {
	const hasPunch = time !== null;
	return (
		<div className="flex items-center gap-2">
			<span className="w-12 shrink-0 text-xs leading-myanmar text-muted-foreground">{label}</span>
			{hasPunch ? (
				<span className="text-xs font-medium tabular-nums text-foreground">{formatPunchTime(time)}</span>
			) : (
				<span className="text-xs tabular-nums text-muted-foreground">--:--</span>
			)}
		</div>
	);
}
