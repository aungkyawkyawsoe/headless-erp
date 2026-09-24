import type { LucideIcon } from 'lucide-react';
import { CalendarDays, Clock, LogOut } from 'lucide-react';

import { formatEnglishDayMonth, formatRelativeTime } from '@/shared/time/myanmar';
import type { HrRequestType } from '../../data/types';

// Re-export the shared shift-time formatter used by the per-type row builders.
export { formatShiftTime12h } from '@/shared/time/myanmar';

/** Type glyph per request kind — mirrors the quick-action icons. */
export const TYPE_ICON: Record<HrRequestType, LucideIcon> = {
	leave: CalendarDays,
	ot: Clock,
	early: LogOut,
};

/** `hr_requests.ot_type` — the labels shown BOTH on the overtime request card
 *  and in the overtime form's type select (single source — the form builds its
 *  options from this map, so the two surfaces can never drift apart). */
export const OT_TYPE_LABELS: Record<string, string> = {
	weekday: 'Weekday',
	weekend: 'Weekend',
	holiday: 'Public Holiday',
	thingyan: 'Thingyan Holiday',
};

/** `hr_requests.start_period` / `end_period` — the range's first/last-day work window
 *  (the create form's Work Period), shown INLINE like single-day leaves:
 *  "→ 4, Afternoon". */
export const DAY_PERIOD_LABELS: Record<string, string> = {
	morning: 'Morning',
	evening: 'Afternoon',
};

/** "3 → 3 days", 0.5 → "Half day", 1.5 → "1.5 days" — leave duration in English. */
export function leaveDaysLabel(days: number | null | undefined): string {
	if (days == null) return '—';
	if (days === 0.5) return 'Half day';
	return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** OT total shown as hours + minutes — e.g. 1.43 → “1 hour 26 min”, 2.5 → “2 hours 30 min”. */
export function otHoursLabel(days: number | null | undefined): string | null {
	if (days == null) return null;
	const totalMinutes = Math.round(days * 60);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	const h = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
	return minutes > 0 ? `${h} ${minutes} min` : h;
}

/** A `YYYY-MM-DD` as "3 Sep" — the card's date value (UTC-parsed so the calendar
 *  day never shifts with the viewer's timezone). `—` when missing. */
export function requestDate(date: string | null | undefined): string {
	if (!date) return '—';
	return formatEnglishDayMonth(date) ?? '—';
}

/* ── Leave date range ────────────────────────────────────────────────────────
 * The Leave date value in English, e.g.
 *     30 Sep, Morning → 2 Oct, Afternoon
 * Each date is a short "3 Sep" token; the range spans with an arrow (→) and a
 * range tail repeats its date so it never reads as a bare day number. */

/** `hr_requests.start_period` / `end_period` → the period word (Morning / Afternoon). */
function periodWord(period: string | null | undefined): string | null {
	return DAY_PERIOD_LABELS[period as keyof typeof DAY_PERIOD_LABELS] ?? null;
}

/** One date+window token — the short "3 Sep" date plus its period word when the
 *  row carries one (e.g. “2 Oct, Afternoon”). */
function leaveEndLabel(date: string, period: string | null | undefined): string {
	const base = requestDate(date);
	const word = periodWord(period);
	return word ? `${base}, ${word}` : base;
}

/**
 * English Leave date value:
 *  - RANGE same-month  → "15 Sep → 17 Sep, Afternoon"
 *  - RANGE cross-month → "30 Sep → 2 Oct, Afternoon"
 *  - single            → "1 Sep, Morning"
 *  - absent            → "—"
 */
export function leaveDateRangeLabel(
	from?: string | null,
	to?: string | null,
	startPeriod?: string | null,
	endPeriod?: string | null,
): string {
	if (from == null) return '—';
	if (to == null || to === from) return leaveEndLabel(from, startPeriod);
	// The tail keeps its full date — a bare day number reads ambiguously in English.
	const start = leaveEndLabel(from, startPeriod);
	const end = leaveEndLabel(to, endPeriod);
	return `${start} → ${end}`;
}

/** "4 days ago" — the submitted age, human-readable and relative (English). */
export function submittedLabel(iso?: string | null): string {
	if (!iso) return '—';
	return formatRelativeTime(iso);
}
