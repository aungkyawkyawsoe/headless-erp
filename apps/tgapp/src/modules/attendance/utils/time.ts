import { DAY_MS, MMT_OFFSET_MS, formatClock12h, toMmtDate } from '@/shared/time/myanmar';
import type { AttendancePunch } from '../data/types';

/** 04:00 MMT — the work-day boundary: a workday runs 4 AM → 3:59:59 AM next day. */
export const WORK_DAY_START_HOUR = 4;

/** The minimum wait after a check-in before a check-out may be recorded. */
export const MIN_CHECKOUT_WAIT_MS = 15 * 60_000;

/**
 * Milliseconds still to wait before a check-out is allowed for `checkIn` at
 * `now`. `0` when there is no check-in, its timestamp is unparsable, or the wait
 * has already elapsed.
 */
export function checkOutWaitRemainingMs(checkIn: string | null | undefined, now: number = Date.now()): number {
	if (!checkIn) return 0;
	const start = Date.parse(checkIn);
	if (!Number.isFinite(start)) return 0;
	return Math.max(0, start + MIN_CHECKOUT_WAIT_MS - now);
}

/** "12m" / "45s" / "1h 05m" — a short remaining-wait label for the card hint. */
export function formatWaitRemaining(ms: number): string {
	const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const totalMinutes = Math.ceil(totalSeconds / 60);
	if (totalMinutes < 60) return `${totalMinutes}m`;
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/**
 * The 4 AM-boundary WORK-DAY label (`YYYY-MM-DD`) of any instant — the SAME
 * window `todayWorkDate()` describes for "now". A punch struck between 00:00 and
 * 03:59 MMT (e.g. a night shift's 00:31 check-in) belongs to the PREVIOUS
 * calendar day's work window, so bucketing it only by `toMmtDate` would strand
 * it on a date the cards/history never render. Shifting the instant back
 * `WORK_DAY_START_HOUR` before taking the MMT calendar date aligns a punch with
 * the work-day label the page renders.
 */
export function toWorkDate(value: string | number | Date): string {
	const ms = typeof value === 'number' ? value : new Date(value).getTime();
	return toMmtDate(new Date(ms - WORK_DAY_START_HOUR * 3_600_000));
}

/** "07:51 PM" — a punch's MMT clock time, or "--:--" when absent/invalid. */
export function formatPunchTime(iso: string | null | undefined): string {
	if (!iso) return '--:--';
	const ms = new Date(iso).getTime();
	if (Number.isNaN(ms)) return '--:--';
	const d = new Date(ms + MMT_OFFSET_MS);
	return formatClock12h(d.getUTCHours(), d.getUTCMinutes());
}

/**
 * Milliseconds worked in a work window — check-in → check-out, or check-in →
 * `now` while still on the clock. `0` without a check-in (or an unparsable /
 * backwards pair, which would otherwise read as negative time).
 */
export function workedMs(checkIn: string | null | undefined, checkOut: string | null | undefined, now = Date.now()): number {
	if (!checkIn) return 0;
	const start = Date.parse(checkIn);
	const end = checkOut ? Date.parse(checkOut) : now;
	if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
	return end - start;
}

/**
 * "1h 04m" — a worked duration for the Hours Today metric (minutes zero-padded
 * so the value never jitters between one- and two-digit widths as it ticks).
 */
export function formatWorkedDuration(ms: number): string {
	const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/**
 * The MMT calendar date of the current work window. Before 04:00 MMT the
 * previous day's punches still belong to "today", so the window date lags one
 * day — at 04:00 MMT it flips and the cards reset to `--:--` for the new day.
 */
export function todayWorkDate(): string {
	const shifted = new Date(Date.now() + MMT_OFFSET_MS);
	if (shifted.getUTCHours() < WORK_DAY_START_HOUR) {
		return new Date(shifted.getTime() - DAY_MS).toISOString().slice(0, 10);
	}
	return shifted.toISOString().slice(0, 10);
}

/**
 * The current work window's latest check-in / check-out (MMT) from summary rows —
 * the summary is sorted newest-first, so the first matching punch per type is
 * the latest. `workDate` defaults to the 4 AM-boundary work date.
 */
export function latestPunchesToday(
	rows: AttendancePunch[],
	workDate: string = todayWorkDate(),
): { checkIn: string | null; checkOut: string | null } {
	let checkIn: string | null = null;
	let checkOut: string | null = null;
	for (const row of rows) {
		if (!row.timestamp || toWorkDate(row.timestamp) !== workDate) continue;
		if (row.type === 'check-in' && !checkIn) checkIn = row.timestamp;
		else if (row.type === 'check-out' && !checkOut) checkOut = row.timestamp;
	}
	return { checkIn, checkOut };
}

/**
 * The current work window's latest check-in PUNCH ROW (same newest-first
 * semantics as `latestPunchesToday`). Its `shift_id` is the shift the employee
 * started the day with — the check-out punch must continue that same shift.
 */
export function latestCheckInPunch(rows: AttendancePunch[], workDate: string = todayWorkDate()): AttendancePunch | null {
	for (const row of rows) {
		if (!row.timestamp || toWorkDate(row.timestamp) !== workDate) continue;
		if (row.type === 'check-in') return row;
	}
	return null;
}
