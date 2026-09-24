/**
 * Minimal 5-field cron parser (UTC) — mirrors the Cloudflare Cron Trigger
 * dialect for the common cases:
 *
 *   field      allowed values          chars
 *   minute     0-59                    * , - /
 *   hour       0-23                    * , - /
 *   day-month  1-31                    * , - / L
 *   month      1-12, JAN-DEC           * , - /
 *   day-week   0-7 (0/7 = Sunday)      * , - /   + 3-letter names SUN-SAT
 *
 * Also supports `a/n` (start at `a`, step to max, e.g. `10/20` → 10,30,50).
 * When BOTH day-of-month and day-of-week are restricted, a day matches if
 * EITHER matches (classic cron OR semantics).
 *
 * Not supported: `W`, `#`, and `L` on day-of-week. Search window is 10 years
 * (covers Feb-29 schedules); beyond that `nextCronRun` returns null.
 */

// ─── Name maps ─────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
	jan: 1,
	feb: 2,
	mar: 3,
	apr: 4,
	may: 5,
	jun: 6,
	jul: 7,
	aug: 8,
	sep: 9,
	oct: 10,
	nov: 11,
	dec: 12,
};
const DOW_NAMES: Record<string, number> = {
	sun: 0,
	mon: 1,
	tue: 2,
	wed: 3,
	thu: 4,
	fri: 5,
	sat: 6,
};

// ─── Field parsing ─────────────────────────────────────

interface ParsedField {
	all: boolean;
	/** Sorted allowed values (null when `all`). */
	values: Set<number> | null;
	/** DOM `L` → last day of the month. */
	lastDayOfMonth?: boolean;
}

function valueOf(raw: string, names: Record<string, number> | undefined, field: string): number {
	const t = raw.trim().toLowerCase();
	if (names && t in names) return names[t]!;
	const n = Number(t);
	if (!Number.isInteger(n)) throw new Error(`invalid value "${raw}" in "${field}"`);
	return n;
}

function stepOf(raw: string, field: string): number {
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1) throw new Error(`invalid step "/${raw}" in "${field}"`);
	return n;
}

function parseField(raw: string, min: number, max: number, field: string, names?: Record<string, number>): ParsedField {
	const f = raw.trim().toLowerCase();
	if (!f) throw new Error(`empty field in "${raw}"`);
	if (f === '*') return { all: true, values: null };
	if (f === 'l') {
		if (names) throw new Error(`"L" is only supported for day-of-month ("${raw}")`);
		return { all: false, values: new Set<number>(), lastDayOfMonth: true };
	}

	const values = new Set<number>();
	let lastDayOfMonth = false;

	for (const token of f.split(',')) {
		if (!token) throw new Error(`invalid cron field "${raw}"`);
		if (token === 'l') {
			if (names) throw new Error(`"L" is only supported for day-of-month ("${raw}")`);
			lastDayOfMonth = true;
			continue;
		}

		// Split off an optional /step suffix.
		const slash = token.indexOf('/');
		const base = slash === -1 ? token : token.slice(0, slash);
		const step = slash === -1 ? 1 : stepOf(token.slice(slash + 1), raw);

		if (base === '*') {
			for (let v = min; v <= max; v += step) values.add(v);
			continue;
		}

		const dash = base.indexOf('-');
		if (dash === -1) {
			const lo = valueOf(base, names, raw);
			if (lo < min || lo > max) throw new Error(`value ${lo} out of range in "${raw}"`);
			// `a/n` → start at a, step to max (cron dialect, e.g. 10/20 → 10,30,50).
			if (slash !== -1) {
				for (let v = lo; v <= max; v += step) values.add(v);
			} else {
				values.add(lo);
			}
			continue;
		}

		const lo = valueOf(base.slice(0, dash), names, raw);
		const hi = valueOf(base.slice(dash + 1), names, raw);
		if (lo < min || hi > max || lo > hi) throw new Error(`range ${lo}-${hi} invalid in "${raw}"`);
		for (let v = lo; v <= hi; v += step) values.add(v);
	}

	return { all: false, values, lastDayOfMonth };
}

// ─── Parsed cron ───────────────────────────────────────

export interface ParsedCron {
	minute: ParsedField;
	hour: ParsedField;
	dom: ParsedField;
	month: ParsedField;
	dow: ParsedField;
}

/** Parse a 5-field cron expression. Returns null when invalid. */
export function parseCron(cron: string): ParsedCron | null {
	const parts = cron.trim().split(/\s+/);
	if (parts.length !== 5) return null;
	try {
		const minute = parseField(parts[0], 0, 59, parts[0]);
		const hour = parseField(parts[1], 0, 23, parts[1]);
		const dom = parseField(parts[2], 1, 31, parts[2]);
		const month = parseField(parts[3], 1, 12, parts[3], MONTH_NAMES);
		const dow = parseField(parts[4], 0, 7, parts[4], DOW_NAMES);
		// Normalize 7 → 0 (both mean Sunday in the JS getDay() convention).
		if (dow.values?.has(7)) {
			dow.values.delete(7);
			dow.values.add(0);
		}
		// A field is empty only when it is restricted AND has no values — an `all`
		// field (values = null) is never empty.
		const isEmpty = (f: ParsedField) => !f.all && (f.values?.size ?? 0) === 0;
		if (isEmpty(minute) || isEmpty(hour)) return null;
		return { minute, hour, dom, month, dow };
	} catch {
		return null;
	}
}

/** True when `cron` is a syntactically valid 5-field expression. */
export function isValidCron(cron: string): boolean {
	return parseCron(cron) !== null;
}

// ─── Timezone-aware next run ───────────────────────────

const SEARCH_DAYS = 3660; // ~10 years — covers Feb-29 schedules

const tzFormatters = new Map<string, Intl.DateTimeFormat>();
const tzOffsetFormatters = new Map<string, Intl.DateTimeFormat>();

const TZ_WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

interface TzWall {
	year: number;
	month: number; // 1-12
	day: number;
	hour: number;
	minute: number;
	weekday: number; // 0=Sunday
}

function getTzFormatter(tz: string): Intl.DateTimeFormat {
	let f = tzFormatters.get(tz);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
			weekday: 'short',
		});
		tzFormatters.set(tz, f);
	}
	return f;
}

function getTzOffsetFormatter(tz: string): Intl.DateTimeFormat {
	let f = tzOffsetFormatters.get(tz);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
		tzOffsetFormatters.set(tz, f);
	}
	return f;
}

/** True when `tz` is a valid IANA timezone name (e.g. "Asia/Yangon"). */
export function isValidTimeZone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

/** Wall-clock components of the instant `ms` in `tz` (Intl-validated). */
function tzWall(tz: string, ms: number): TzWall {
	const parts = getTzFormatter(tz).formatToParts(new Date(ms));
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return {
		year: Number(get('year')),
		month: Number(get('month')),
		day: Number(get('day')),
		hour: Number(get('hour')),
		minute: Number(get('minute')),
		weekday: TZ_WEEKDAYS[get('weekday').slice(0, 3).toLowerCase()] ?? 0,
	};
}

/** UTC offset in ms of the instant `ms` in `tz` (e.g. +06:30 → 23_400_000). */
function tzOffsetMs(tz: string, ms: number): number {
	const tzName =
		getTzOffsetFormatter(tz)
			.formatToParts(new Date(ms))
			.find((p) => p.type === 'timeZoneName')?.value ?? '';
	const m = /(?:GMT)?([+-])(\d{2}):?(\d{2})?/.exec(tzName);
	if (!m) return 0; // "GMT" (UTC) or unknown
	const sign = m[1] === '-' ? -1 : 1;
	return sign * (Number(m[2] ?? 0) * 3_600_000 + Number(m[3] ?? 0) * 60_000);
}

/** UTC instant of midnight of the TZ-date (y, m, d) — refined offset guess. */
function tzMidnightUtc(tz: string, year: number, month: number, day: number): number {
	const nominal = Date.UTC(year, month - 1, day);
	const guess = nominal - tzOffsetMs(tz, nominal);
	// Refine once with the offset AT the guess (DST boundaries only) — the
	// wall time of (nominal - offset) is midnight, so subtract again is wrong.
	return nominal - tzOffsetMs(tz, guess);
}

/** Days in the TZ-month (y, m) — midnight-diff handles DST (23/25h days). */
function tzDaysInMonth(tz: string, year: number, month: number): number {
	const a = tzMidnightUtc(tz, year, month, 1);
	const [ny, nm] = month === 12 ? [year + 1, 1] : [year, month + 1];
	const b = tzMidnightUtc(tz, ny, nm, 1);
	return Math.round((b - a) / 86_400_000);
}

/** Weekday (0=Sunday) of the TZ-date (y, m, d). */
function tzWeekday(tz: string, year: number, month: number, day: number): number {
	return tzWall(tz, tzMidnightUtc(tz, year, month, day)).weekday;
}

/**
 * Convert a TZ wall-clock to a UTC instant. Returns null when the wall time
 * does not exist (DST spring-forward gap) — the result is always verified by
 * re-reading the wall clock, so it can never be an off-by-DST instant.
 */
function tzWallToUtc(tz: string, year: number, month: number, day: number, hour: number, minute: number): number | null {
	const nominal = Date.UTC(year, month - 1, day, hour, minute);
	const utc = nominal - tzOffsetMs(tz, nominal);
	const w = tzWall(tz, utc);
	if (w.year !== year || w.month !== month || w.day !== day || w.hour !== hour || w.minute !== minute) return null;
	return utc;
}

function domOkTz(field: ParsedField, tz: string, year: number, month: number, day: number): boolean {
	if (field.all) return true;
	if (field.values?.has(day)) return true;
	return field.lastDayOfMonth === true && day === tzDaysInMonth(tz, year, month);
}

/**
 * Next occurrence of `cron` strictly after `from`, with the cron fields read
 * as the wall clock of `timeZone` (IANA, e.g. "Asia/Yangon"). Returns null for
 * an invalid expression/timezone or when no occurrence exists in the window.
 */
export function nextCronRunInTz(cron: string, timeZone: string, from: Date = new Date()): Date | null {
	const parsed = parseCron(cron);
	if (!parsed || !isValidTimeZone(timeZone)) return null;
	const hours = sortedValues(parsed.hour, 0, 23);
	const minutes = sortedValues(parsed.minute, 0, 59);
	if (hours.length === 0 || minutes.length === 0) return null;

	const startMs = from.getTime() + 60_000;
	const startWall = tzWall(timeZone, startMs);
	let year = startWall.year;
	let month = startWall.month;
	let day = startWall.day;

	for (let d = 0; d < SEARCH_DAYS; d++) {
		if (!monthMatches(parsed.month, month)) {
			// Skip to the first day of the next TZ month.
			day = 1;
			month++;
			if (month > 12) {
				month = 1;
				year++;
			}
			continue;
		}

		const domOk = domOkTz(parsed.dom, timeZone, year, month, day);
		const dowOk = parsed.dow.all || (parsed.dow.values?.has(tzWeekday(timeZone, year, month, day)) ?? false);
		const domRestricted = !parsed.dom.all || parsed.dom.lastDayOfMonth === true;
		const dowRestricted = !parsed.dow.all;
		const dayOk = domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk;

		if (dayOk) {
			const firstDay = d === 0;
			for (const h of hours) {
				for (const m of minutes) {
					if (firstDay && (h < startWall.hour || (h === startWall.hour && m < startWall.minute))) continue;
					const utc = tzWallToUtc(timeZone, year, month, day, h, m);
					if (utc === null || utc < startMs) continue;
					return new Date(utc);
				}
			}
		}

		// Advance one TZ day.
		day++;
		if (day > tzDaysInMonth(timeZone, year, month)) {
			day = 1;
			month++;
			if (month > 12) {
				month = 1;
				year++;
			}
		}
	}

	return null;
}

function daysInMonth(year: number, monthIndex: number): number {
	return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function sortedValues(field: ParsedField, min: number, max: number): number[] {
	if (field.all) {
		const out: number[] = [];
		for (let v = min; v <= max; v++) out.push(v);
		return out;
	}
	return [...(field.values ?? [])].sort((a, b) => a - b);
}

function domMatches(field: ParsedField, year: number, monthIndex: number, day: number): boolean {
	if (field.all) return true;
	if (field.values?.has(day)) return true;
	return field.lastDayOfMonth === true && day === daysInMonth(year, monthIndex);
}

function monthMatches(field: ParsedField, month: number): boolean {
	return field.all || (field.values?.has(month) ?? false);
}

function firstAtOrAfter(sorted: number[], at: number): number | undefined {
	for (const v of sorted) if (v >= at) return v;
	return undefined;
}

/**
 * Compute the next occurrence of `cron` strictly after `from` (UTC).
 * Returns null when the expression is invalid or no occurrence exists
 * within the 10-year search window.
 */
export function nextCronRun(cron: string, from: Date = new Date()): Date | null {
	const parsed = parseCron(cron);
	if (!parsed) return null;

	const hours = sortedValues(parsed.hour, 0, 23);
	const minutes = sortedValues(parsed.minute, 0, 59);
	if (hours.length === 0 || minutes.length === 0) return null;

	// Start strictly after `from` (never re-run the current minute).
	const start = new Date(from.getTime() + 60_000);
	const startHour = start.getUTCHours();
	const startMinute = start.getUTCMinutes();

	const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));

	for (let i = 0; i < SEARCH_DAYS; i++) {
		const year = d.getUTCFullYear();
		const monthIndex = d.getUTCMonth();
		const day = d.getUTCDate();

		if (!monthMatches(parsed.month, monthIndex + 1)) {
			// Skip to the first day of the next month.
			d.setUTCDate(day + (daysInMonth(year, monthIndex) - day + 1));
			continue;
		}

		const domOk = domMatches(parsed.dom, year, monthIndex, day);
		const dowOk = parsed.dow.all || (parsed.dow.values?.has(d.getUTCDay()) ?? false);
		const domRestricted = !parsed.dom.all || parsed.dom.lastDayOfMonth === true;
		const dowRestricted = !parsed.dow.all;
		const dayOk = domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk;

		if (!dayOk) {
			d.setUTCDate(day + 1);
			continue;
		}

		const firstDay = i === 0;
		const hMin = firstDay ? startHour : 0;
		const mMin = firstDay ? startMinute : 0;

		for (const h of hours) {
			if (h < hMin) continue;
			const m = firstAtOrAfter(minutes, h === hMin ? mMin : 0);
			if (m === undefined) continue;
			return new Date(Date.UTC(year, monthIndex, day, h, m));
		}

		d.setUTCDate(day + 1);
	}

	return null;
}
