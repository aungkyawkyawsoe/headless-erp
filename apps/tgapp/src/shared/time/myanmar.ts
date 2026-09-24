/**
 * Burmese formatting on top of the shared MMT clock. The MMT CORE (offset, day
 * length, calendar-date helpers) is the SAME rule the API computes with, so it
 * lives once in `@mmbix/utils` and is re-exported here — every existing
 * `@/shared/time/myanmar` import keeps working, and the server and the client can
 * never drift apart on what "today" or "midnight" means.
 */
import { DAY_MS, MMT_OFFSET_MS, toMmtDate, todayMmtDate } from '@mmbix/utils';

export { DAY_MS, MMT_OFFSET_MS, toMmtDate, todayMmtDate };

/**
 * A calendar `Date` → the `YYYY-MM-DD` a date FIELD submits. Read from the
 * LOCAL calendar parts (never `toISOString()`, which shifts the day for any
 * viewer east/west of UTC) — the inverse of `parseDateInput`.
 */
export function dateToInputValue(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` → LOCAL-midnight calendar `Date` — the inverse of
 *  `dateToInputValue`. `undefined` for blank/unparsable text, which is what the
 *  design-system `DatePicker` takes for "nothing selected". */
export function parseDateInput(value: string | null | undefined): Date | undefined {
	if (!value) return undefined;
	const [year, month, day] = value.split('-').map(Number);
	if (!year || !month || !day) return undefined;
	return new Date(year, month - 1, day);
}

/**
 * Whole days from the MMT calendar today until `date` (`YYYY-MM-DD`) —
 * negative when already past, NaN when the date can't be parsed. Both sides
 * parse as UTC midnight so the calendar day never shifts with the viewer's
 * timezone (same rule as `formatBurmeseMonthDay`).
 */
export function daysFromTodayMmt(date: string): number {
	return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayMmtDate()}T00:00:00Z`)) / DAY_MS);
}

/**
 * The COMPACT relative age — the same ladder as `formatRelativeTime`
 * (just now → m → h → d → w → mo → y) with a short suffix.
 *
 * `formatRelativeTime` is the prose form for a sentence ("Updated 5 minutes
 * ago"); this is the badge form for a tight corner, where the long wording
 * wraps or pushes neighbouring metadata off the line ("5 min"). Keep the two
 * ladders in step: both read one `age` and switch on the same unit boundaries.
 */
export function formatCompactRelativeTime(value: string | number | Date): string {
	const ms = typeof value === 'number' ? value : new Date(value).getTime();
	if (Number.isNaN(ms)) return '—';
	const age = Math.max(0, Date.now() - ms);
	const minutes = Math.floor(age / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} hr`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days} d`;
	if (days < 30) return `${Math.floor(days / 7)} w`;
	if (days < 365) return `${Math.floor(days / 30)} mo`;
	return `${Math.floor(days / 365)} y`;
}

/**
 * The due-date urgency, as a tone + short label for the due cell — derived
 * from `due_date` against today in MMT. `null` when there is no due date.
 *
 * A DONE task is never overdue: `done` carries no urgency (the deadline no
 * longer binds), which is why `state` is an input and not inferred here.
 */
export function dueUrgency(dueDate: string | null | undefined, state?: string | null): 'overdue' | 'today' | 'soon' | null {
	if (!dueDate) return null;
	if (state === 'done') return null;
	const days = daysFromTodayMmt(dueDate);
	if (days < 0) return 'overdue';
	if (days === 0) return 'today';
	if (days <= 2) return 'soon';
	return null;
}

/** A calendar-date urgency tone — the fleet's shared expiry-window rule. */
export type DateWindowTone = 'ok' | 'warn' | 'alert';

/**
 * The date-window tone for a `YYYY-MM-DD` deadline, computed against the MMT
 * calendar today (every module used to re-implement this rule with its own
 * UTC/MMT "today" — they disagreed on the day between 00:00–06:30 MMT):
 *  - missing / unparsable date, or today-or-earlier → `alert`;
 *  - within `warnDays` of today → `warn`;
 *  - otherwise → `ok`.
 * An explicit `expired` STATUS override lives at the call sites (they own
 * their status enums); this helper owns only the date window.
 */
export function dateWindowTone(date: string | null | undefined, warnDays = 30): DateWindowTone {
	if (!date) return 'alert';
	const days = daysFromTodayMmt(date);
	if (Number.isNaN(days) || days < 0) return 'alert';
	if (days <= warnDays) return 'warn';
	return 'ok';
}

const MYANMAR_DIGITS = '၀၁၂၃၄၅၆၇၈၉';

/** Arabic digits → Myanmar digits ("30" → "၃၀"). */
export function burmeseDigits(value: number): string {
	return String(value).replace(/\d/g, (d) => MYANMAR_DIGITS[Number(d)]);
}

const MONTHS_MM = [
	'ဇန်နဝါရီ',
	'ဖေဖော်ဝါရီ',
	'မတ်',
	'ဧပြီ',
	'မေ',
	'ဇွန်',
	'ဇူလိုင်',
	'ဩဂုတ်',
	'စက်တင်ဘာ',
	'အောက်တိုဘာ',
	'နိုဝင်ဘာ',
	'ဒီဇင်ဘာ',
];

/**
 * THE 12-hour clock renderer — the ONE place the app decides how a clock time
 * reads (zero-padded 12-hour hour, zero-padded minute[/second], `AM`/`PM`).
 * Every clock label — the live header clock, the shift rows, the punch cards,
 * the request/OT time spans — renders through this, so the format can never
 * drift between screens.
 */
export function formatClock12h(hours24: number, minutes: number, seconds?: number): string {
	const h = ((hours24 % 24) + 24) % 24;
	const h12 = h % 12 || 12;
	const ss = seconds == null ? '' : `:${String(seconds).padStart(2, '0')}`;
	return `${String(h12).padStart(2, '0')}:${String(minutes).padStart(2, '0')}${ss} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "07:51:08 PM" — 12-hour clock with seconds, matching the design header. */
export function formatClockTime(date: Date): string {
	return formatClock12h(date.getHours(), date.getMinutes(), date.getSeconds());
}

/**
 * "ဩဂုတ်လ ၃၁" — compact Burmese month + day (no weekday) for tight date
 * tracks like the history cards. Takes the MMT calendar date string
 * (`YYYY-MM-DD`), parsed as UTC so the calendar day never shifts with the
 * viewer's timezone (same rule as the weekday label in the history list).
 */
export function formatBurmeseMonthDay(date: string): string {
	const d = new Date(`${date}T00:00:00Z`);
	return `${MONTHS_MM[d.getUTCMonth()]} ${burmeseDigits(d.getUTCDate())}`;
}

/** "09:00 AM" — an `HH:MM` time as a 12-hour clock label (shift rows). */
export function formatShiftTime12h(hhmm: string | null | undefined): string {
	if (!hhmm) return '--:--';
	const [hRaw, mRaw] = hhmm.split(':');
	const h = Number(hRaw);
	const m = Number(mRaw ?? 0);
	if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
	return formatClock12h(h, m);
}

/** "09:00" + "17:00" → "09:00 AM → 05:00 PM" — shift range on the punch dialog. */
export function formatShiftRange(start?: string | null, end?: string | null): string {
	if (!start && !end) return '—';
	return `${formatShiftTime12h(start)} → ${formatShiftTime12h(end)}`;
}

/**
 * "10:00:00" + 6 → "10:00 AM - 04:00 PM" — the shift's working-hours range on
 * the employee form's အလုပ်ဆိုင်း cards, computed from the shift's `time_in`
 * + `working_hours` (12-hour clock with AM/PM). An overnight span (end past
 * midnight) wraps to the next morning. `—` when either input is missing.
 */
export function formatShiftRange12h(timeIn?: string | null, workingHours?: number | null): string {
	if (!timeIn || workingHours == null || workingHours <= 0) return '—';
	const [hRaw, mRaw] = timeIn.split(':');
	const h = Number(hRaw);
	const m = Number(mRaw ?? 0);
	if (!Number.isFinite(h) || !Number.isFinite(m)) return '—';
	const start = formatClock12h(h, m);
	const endTotal = h * 60 + m + Math.round(workingHours * 60);
	const endH = Math.floor(endTotal / 60) % 24;
	const endM = endTotal % 60;
	const end = formatClock12h(endH, endM);
	return `${start} - ${end}`;
}

const MONTHS_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The app's ONE date-FIELD format — “20 Sep 2026” — handed to the design-system
 * `DatePicker`'s `format` prop (a date-fns token string). Not the locale's long form
 * (“September 20, 2026”): a date field is a FIELD, and the stock-document header pairs
 * it beside another picker in a half-width cell, where a long month truncates. Day
 * first is also the order the Burmese dates beside it read in, so the two agree.
 */
export const APP_DATE_FORMAT = 'd MMM y';

/**
 * "12-Aug-2026" — a `YYYY-MM-DD` as a short English date, null when
 * missing/unparsable. Parsed as UTC so the calendar day never shifts with the
 * viewer's timezone (same rule as the Burmese month-day helpers above). Shared
 * by the fuelings / incidents / maintenance cards' date facts (previously
 * re-declared per module with a copy of `MONTHS_SHORT` each).
 */
export function formatEnglishDateLabel(date: string | null | undefined): string | null {
	if (!date) return null;
	const day = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(day.getTime())) return null;
	return `${String(day.getUTCDate()).padStart(2, '0')}-${MONTHS_SHORT_EN[day.getUTCMonth()]}-${day.getUTCFullYear()}`;
}

/**
 * "23 Aug" — a `YYYY-MM-DD` as a compact English day + short month (no year),
 * null when missing/unparsable. Parsed as UTC so the calendar day never shifts
 * with the viewer's timezone (same rule as the Burmese month-day helpers). The
 * Daily ODO record cards use this format for reading dates; Burmese stays for
 * the rest of the list/tile copy.
 */
export function formatEnglishDayMonth(date: string | null | undefined): string | null {
	if (!date) return null;
	const day = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(day.getTime())) return null;
	return `${day.getUTCDate()} ${MONTHS_SHORT_EN[day.getUTCMonth()]}`;
}

/** "just now" / "1 minute ago" / "4 days ago" — a UTC ISO timestamp (or epoch
 * ms / Date) as a short human-readable relative age (English):
 * just now → minute(s) → hour(s) → day(s) → week(s) → month(s) → year(s), the
 * long form with singular/plural. Ages under a minute (or in the future by
 * clock skew) clamp to "just now".
 */
export function formatRelativeTime(value: string | number | Date): string {
	const ms = typeof value === 'number' ? value : new Date(value).getTime();
	if (Number.isNaN(ms)) return '—';
	const age = Math.max(0, Date.now() - ms);
	const minutes = Math.floor(age / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
	if (days < 30) {
		const weeks = Math.floor(days / 7);
		return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
	}
	if (days < 365) {
		const months = Math.floor(days / 30);
		return `${months} month${months === 1 ? '' : 's'} ago`;
	}
	const years = Math.floor(days / 365);
	return `${years} year${years === 1 ? '' : 's'} ago`;
}
