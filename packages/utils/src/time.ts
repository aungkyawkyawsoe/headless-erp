/**
 * Myanmar Standard Time (MMT, UTC+6:30) — THE cross-package definition.
 *
 * Timestamps are stored as UTC ISO strings; every "today" / window / expiry
 * decision on BOTH sides of the wire must bucket by the SAME wall clock. The
 * server (attendance windows, task digests, stock expiry horizons) and the mini
 * app (every date/clock/work-day label) each used to define the offset locally —
 * with comments asking the next reader to keep them in step — so a change in one
 * could silently skew the other. This module is the one source; import it,
 * never re-declare `6.5 * 3600_000`.
 */

/** MMT is UTC+6:30. */
export const MMT_OFFSET_MS = 6.5 * 60 * 60 * 1000;

/** One calendar day in ms — date-window math. */
export const DAY_MS = 86_400_000;

/** The MMT calendar date (`YYYY-MM-DD`) of a UTC ISO timestamp / epoch ms / Date. */
export function toMmtDate(value: string | number | Date): string {
	const ms = typeof value === 'number' ? value : new Date(value).getTime();
	return new Date(ms + MMT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today's MMT calendar date. */
export function todayMmtDate(now: number = Date.now()): string {
	return toMmtDate(now);
}

/**
 * The UTC instant of MMT midnight, `days` days AGO — the inclusive lower bound of
 * a "last N days (MMT)" window. Both the attendance summary and the client's own
 * window math use this, so the two ends of a query agree on where the window opens.
 */
export function mmtWindowStartIso(days: number, now: number = Date.now()): string {
	return new Date(Math.floor((now + MMT_OFFSET_MS) / DAY_MS) * DAY_MS - MMT_OFFSET_MS - days * DAY_MS).toISOString();
}

/** MMT midnight of the MMT "today" as a UTC ISO instant — the dedupe window for
 *  anything that must fire once per MMT day (e.g. a reminder digest). */
export function mmtDayStartIso(now: number = Date.now()): string {
	const mmtNow = new Date(now + MMT_OFFSET_MS);
	mmtNow.setUTCHours(0, 0, 0, 0);
	return new Date(mmtNow.getTime() - MMT_OFFSET_MS).toISOString();
}

/** `YYYY-MM-DD` + n days → `YYYY-MM-DD` (UTC calendar arithmetic, no DST edges). */
export function addDays(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/**
 * The `YYYY-MM-DD` DAY of a STORED date-ish value — the ONE definition of "which
 * day is this row on?", shared by every compiled guard and comparison that buckets
 * stored timestamps by day (an early-leave request's day, a requisition's request
 * day, a payment's `paid_on`).
 *
 * It accepts EITHER storage form, a bare `YYYY-MM-DD` DATE column or a full UTC
 * ISO timestamp, because the first 10 characters are the day in both — which is
 * precisely why a hand-rolled `<` / `<=` against a mixed pair can compare a date
 * with a timestamp and silently answer a different question. Returns `''` for a
 * non-string, so an absent value can never equal a real day.
 *
 * The SQL counterpart is `substr(<column>, 1, 10)` — keep the two in step.
 */
export function dayOf(value: unknown): string {
	return typeof value === 'string' ? value.slice(0, 10) : '';
}
