/**
 * Locale-aware date formatting built on `Intl.DateTimeFormat`.
 *
 * Replaces the small slice of `date-fns/format` the package used. Unknown
 * patterns fall back to a medium date style instead of throwing.
 */

const PATTERNS: Record<string, Intl.DateTimeFormatOptions> = {
	// "PPP" → "July 15, 2026"
	P: { year: 'numeric', month: 'numeric', day: 'numeric' },
	PP: { year: 'numeric', month: 'short', day: 'numeric' },
	PPP: { year: 'numeric', month: 'long', day: 'numeric' },
	// "LLL dd, y" → "Jul 15, 2026"
	'LLL dd, y': { year: 'numeric', month: 'short', day: '2-digit' },
	// "h:mm a" → "10:30 AM"
	'h:mm a': { hour: 'numeric', minute: '2-digit' },
	// "yyyy-MM-dd" → "2026-07-15"
	'yyyy-MM-dd': {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	},
};

/**
 * Patterns whose ORDER differs from the reader's locale — assembled from the parts, in
 * the pattern's own order, instead of handed to `Intl` (which always emits the locale's
 * own field order: `en-US` “Jul 15, 2026”, `en-GB` “15 Jul 2026”).
 *
 * `d MMM y` is the day-first short form a NARROW field states (“15 Jul 2026”), where the
 * locale's medium order would either read as a different date or truncate. The month
 * NAME still comes from the caller's locale, so only the order is forced.
 */
const ORDERED_PATTERNS: Record<string, (parts: { day: string; month: string; year: string }) => string> = {
	'd MMM y': ({ day, month, year }) => `${Number(day)} ${month} ${year}`,
};

export function formatDate(date: Date, pattern: string, localeCode?: string): string {
	const ordered = ORDERED_PATTERNS[pattern];
	if (ordered) {
		const parts = new Intl.DateTimeFormat(localeCode, { year: 'numeric', month: 'short', day: 'numeric' }).formatToParts(date);
		const partOf = (type: 'day' | 'month' | 'year') => parts.find((part) => part.type === type)?.value ?? '';
		return ordered({ day: partOf('day'), month: partOf('month'), year: partOf('year') });
	}
	const options = PATTERNS[pattern] ?? { dateStyle: 'medium' as const };
	return new Intl.DateTimeFormat(localeCode, options).format(date);
}

/** 12 long month names, e.g. ["January", …, "December"]. */
export function getMonthNames(code?: string): string[] {
	const formatter = new Intl.DateTimeFormat(code, { month: 'long' });
	return Array.from({ length: 12 }, (_, i) => formatter.format(new Date(2024, i, 1)));
}

/** 12 short month names, e.g. ["Jan", …, "Dec"]. */
export function getMonthNamesShort(code?: string): string[] {
	const formatter = new Intl.DateTimeFormat(code, { month: 'short' });
	return Array.from({ length: 12 }, (_, i) => formatter.format(new Date(2024, i, 1)));
}

/**
 * 7 weekday labels, always ordered Sunday → Saturday (index = `getDay()`),
 * e.g. ["Sunday", …, "Saturday"]. Rotate by `weekStartsOn` when rendering.
 */
export function getWeekdayNames(code?: string, width: 'narrow' | 'short' | 'long' = 'short'): string[] {
	const formatter = new Intl.DateTimeFormat(code, { weekday: width });
	// Jan 7 2024 is a Sunday, so index i maps to getDay() === i.
	return Array.from({ length: 7 }, (_, i) => formatter.format(new Date(2024, 0, 7 + i)));
}
