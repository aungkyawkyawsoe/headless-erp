/**
 * Date/time functions — pure, deterministic (ISO-8601 string in/out).
 *
 * Inputs are ISO date strings ("2026-01-31" or full timestamps); outputs are
 * ISO date strings so they stay JSON-serializable and D1-safe. Business-calendar
 * helpers (NET_WORKDAYS/WORKDAY) skip Saturdays + Sundays and an optional
 * holiday list (a JSON field array works).
 */

import type { EvalFunction } from '@mmbix/core';

const DAY_MS = 86_400_000;

function toDate(v: unknown): Date | null {
	if (typeof v !== 'string') return null;
	const d = new Date(v);
	return isNaN(d.getTime()) ? null : d;
}

function toIso(d: Date): string {
	return d.toISOString().split('T')[0];
}

/** Whole days between two ISO dates: DAYS_BETWEEN(from, to) — positive when to > from. */
export function daysBetween(from: unknown, to: unknown): number {
	const a = toDate(from);
	const b = toDate(to);
	if (!a || !b) return NaN;
	return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** Add months to an ISO date: ADD_MONTHS(date, n) → ISO date (clamped to month end). */
export function addMonths(date: unknown, months: unknown): string {
	const d = toDate(date);
	const n = Number(months);
	if (!d || isNaN(n)) return '';
	const day = d.getUTCDate();
	d.setUTCDate(1);
	d.setUTCMonth(d.getUTCMonth() + n);
	const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
	d.setUTCDate(Math.min(day, lastDay));
	return toIso(d);
}

/** Last day of the month: EOMONTH(date, monthsOffset?) → ISO date. */
export function endOfMonth(date: unknown, monthsOffset?: unknown): string {
	const d = toDate(date);
	const offset = monthsOffset === undefined ? 0 : Number(monthsOffset);
	if (!d || isNaN(offset)) return '';
	return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset + 1, 0)));
}

/** YEAR(date) */
export function yearOf(date: unknown): number {
	const d = toDate(date);
	return d ? d.getUTCFullYear() : NaN;
}

/** MONTH(date) — 1–12 */
export function monthOf(date: unknown): number {
	const d = toDate(date);
	return d ? d.getUTCMonth() + 1 : NaN;
}

/** DAY(date) — 1–31 */
export function dayOf(date: unknown): number {
	const d = toDate(date);
	return d ? d.getUTCDate() : NaN;
}

/** ISO week number: ISOWEEKNUM(date) */
export function isoWeekNum(date: unknown): number {
	const d = toDate(date);
	if (!d) return NaN;
	// Thursday of the current week defines the ISO week-year.
	const thursday = new Date(d.getTime());
	thursday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
	const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
	if (firstThursday.getUTCDay() !== 4) {
		firstThursday.setUTCDate(1 + ((4 - firstThursday.getUTCDay() + 7) % 7));
	}
	return Math.round(1 + (thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
}

/** QUARTER(date) — 1–4 */
export function quarterOf(date: unknown): number {
	const m = monthOf(date);
	return isNaN(m) ? NaN : Math.floor((m - 1) / 3) + 1;
}

/** Excel DATEDIF: unit in {Y, M, D, YM, YD, MD} */
export function datedif(start: unknown, end: unknown, unit: unknown): number {
	const a = toDate(start);
	const b = toDate(end);
	if (!a || !b || a.getTime() > b.getTime()) return NaN;
	const u = String(unit ?? 'D').toUpperCase();
	const y0 = a.getUTCFullYear();
	const m0 = a.getUTCMonth();
	const d0 = a.getUTCDate();
	const y1 = b.getUTCFullYear();
	const m1 = b.getUTCMonth();
	const d1 = b.getUTCDate();
	switch (u) {
		case 'Y':
			return y1 - y0 - (m1 < m0 || (m1 === m0 && d1 < d0) ? 1 : 0);
		case 'M':
			return (y1 - y0) * 12 + (m1 - m0) - (d1 < d0 ? 1 : 0);
		case 'D':
			return Math.round((b.getTime() - a.getTime()) / DAY_MS);
		case 'YM':
			return ((m1 - m0 + 12) % 12) - (d1 < d0 ? 1 : 0);
		case 'YD': {
			const sameYear = new Date(Date.UTC(y1, m0, d0));
			return Math.round((b.getTime() - sameYear.getTime()) / DAY_MS);
		}
		case 'MD': {
			const prevMonthEnd = new Date(Date.UTC(y1, m1 + 1, 0)).getUTCDate();
			const effectiveD0 = Math.min(d0, prevMonthEnd);
			return d1 - effectiveD0;
		}
		default:
			return NaN;
	}
}

/** Working days between two dates (inclusive): NET_WORKDAYS(start, end, holidays?) */
export function netWorkdays(start: unknown, end: unknown, holidays?: unknown): number {
	const a = toDate(start);
	const b = toDate(end);
	if (!a || !b) return NaN;
	const hol = holidaySet(holidays);
	let count = 0;
	const cur = new Date(Math.min(a.getTime(), b.getTime()));
	const target = Math.max(a.getTime(), b.getTime());
	const step = a.getTime() <= b.getTime() ? DAY_MS : -DAY_MS;
	while (cur.getTime() <= target) {
		const dow = cur.getUTCDay();
		if (dow !== 0 && dow !== 6 && !hol.has(cur.toISOString().split('T')[0])) count++;
		cur.setTime(cur.getTime() + step);
	}
	return count;
}

/** Date after `days` workdays: WORKDAY(start, days, holidays?) → ISO date. */
export function workday(start: unknown, days: unknown, holidays?: unknown): string {
	const a = toDate(start);
	const n = Number(days);
	if (!a || isNaN(n)) return '';
	const hol = holidaySet(holidays);
	const cur = new Date(a.getTime());
	let remaining = Math.abs(n);
	const dir = n >= 0 ? 1 : -1;
	while (remaining > 0) {
		cur.setTime(cur.getTime() + dir * DAY_MS);
		const dow = cur.getUTCDay();
		if (dow !== 0 && dow !== 6 && !hol.has(cur.toISOString().split('T')[0])) remaining--;
	}
	return toIso(cur);
}

function holidaySet(holidays: unknown): Set<string> {
	const out = new Set<string>();
	if (!Array.isArray(holidays)) return out;
	for (const h of holidays) {
		const d = toDate(h);
		if (d) out.add(toIso(d));
	}
	return out;
}

// ─── Calendar helpers ────────────────────────────────────

/** Excel WEEKDAY: 1=Sunday … 7=Saturday. */
export function weekdayOf(date: unknown): number {
	const d = toDate(date);
	return d ? d.getUTCDay() + 1 : NaN;
}

/** First day of the month: START_OF_MONTH(date) → ISO date. */
export function startOfMonth(date: unknown): string {
	const d = toDate(date);
	return d ? toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))) : '';
}

/** Last day of the quarter: END_OF_QUARTER(date) → ISO date. */
export function endOfQuarter(date: unknown): string {
	const d = toDate(date);
	if (!d) return '';
	const q = Math.floor(d.getUTCMonth() / 3);
	return toIso(new Date(Date.UTC(d.getUTCFullYear(), (q + 1) * 3, 0)));
}

/** Last day of the year: END_OF_YEAR(date) → ISO date. */
export function endOfYear(date: unknown): string {
	const d = toDate(date);
	return d ? toIso(new Date(Date.UTC(d.getUTCFullYear(), 12, 0))) : '';
}

/** Signed hours between two ISO timestamps: HOURS_BETWEEN(from, to). */
export function hoursBetween(from: unknown, to: unknown): number {
	const a = toDate(from);
	const b = toDate(to);
	if (!a || !b) return NaN;
	return (b.getTime() - a.getTime()) / 3_600_000;
}

/** Signed minutes between two ISO timestamps: MINUTES_BETWEEN(from, to). */
export function minutesBetween(from: unknown, to: unknown): number {
	const a = toDate(from);
	const b = toDate(to);
	if (!a || !b) return NaN;
	return (b.getTime() - a.getTime()) / 60_000;
}

/** True when the date falls on Saturday or Sunday. */
export function isWeekend(date: unknown): boolean {
	const d = toDate(date);
	return d ? d.getUTCDay() === 0 || d.getUTCDay() === 6 : false;
}

/** Completed years between a birthdate and an optional as-of date. */
export function ageYears(birth: unknown, asOf?: unknown): number {
	const b = toDate(birth);
	const a = toDate(asOf ?? new Date().toISOString());
	if (!b || !a) return NaN;
	let years = a.getUTCFullYear() - b.getUTCFullYear();
	const m = a.getUTCMonth() - b.getUTCMonth();
	const d = a.getUTCDate() - b.getUTCDate();
	if (m < 0 || (m === 0 && d < 0)) years--;
	return Math.max(0, years);
}

export const datetimeFunctions: Array<[string, EvalFunction]> = [
	['DAYS_BETWEEN', (args) => daysBetween(args[0], args[1])],
	['ADD_MONTHS', (args) => addMonths(args[0], args[1])],
	['EOMONTH', (args) => endOfMonth(args[0], args[1])],
	['YEAR', (args) => yearOf(args[0])],
	['MONTH', (args) => monthOf(args[0])],
	['DAY', (args) => dayOf(args[0])],
	['ISOWEEKNUM', (args) => isoWeekNum(args[0])],
	['QUARTER', (args) => quarterOf(args[0])],
	['DATEDIF', (args) => datedif(args[0], args[1], args[2])],
	['NET_WORKDAYS', (args) => netWorkdays(args[0], args[1], args[2])],
	['WORKDAY', (args) => workday(args[0], args[1], args[2])],
	['WEEKDAY', (args) => weekdayOf(args[0])],
	['START_OF_MONTH', (args) => startOfMonth(args[0])],
	['END_OF_QUARTER', (args) => endOfQuarter(args[0])],
	['END_OF_YEAR', (args) => endOfYear(args[0])],
	['HOURS_BETWEEN', (args) => hoursBetween(args[0], args[1])],
	['MINUTES_BETWEEN', (args) => minutesBetween(args[0], args[1])],
	['IS_WEEKEND', (args) => isWeekend(args[0])],
	['AGE_YEARS', (args) => ageYears(args[0], args[1])],
];
