/**
 * Minimal calendar locale definition.
 *
 * This replaces the date-fns `Locale` type previously re-exported by
 * react-day-picker. Only the fields the calendar actually needs are kept —
 * everything else is derived from the BCP 47 `code` at runtime via `Intl`.
 */
export interface CalendarLocale {
	/** BCP 47 language tag, e.g. "en-US" or "my-MM". */
	code: string;
	/** First day of the week: 0 = Sunday … 6 = Saturday. */
	weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
	/**
	 * The day of January that is always part of the first week of the year
	 * (1 or 4). 1 is the "US" convention, 4 the ISO 8601 convention.
	 */
	firstWeekContainsDate: 1 | 4;
}

/** US-English defaults, matching what react-day-picker used to ship. */
export const enUS: CalendarLocale = {
	code: 'en-US',
	weekStartsOn: 0,
	firstWeekContainsDate: 1,
};

/**
 * Builds a `CalendarLocale` from a BCP 47 tag.
 *
 * `weekStartsOn` / `firstWeekContainsDate` are read from
 * `Intl.Locale#getWeekInfo()` when available (modern browsers, Node ≥ 21),
 * falling back to US defaults otherwise.
 */
export function createLocale(code: string = 'en-US', overrides?: Partial<CalendarLocale>): CalendarLocale {
	let weekStartsOn: CalendarLocale['weekStartsOn'] = enUS.weekStartsOn;
	let firstWeekContainsDate: CalendarLocale['firstWeekContainsDate'] = enUS.firstWeekContainsDate;

	try {
		const localeWithWeekInfo = new Intl.Locale(code) as Intl.Locale & {
			getWeekInfo?: () => { firstDay?: number; minimalDays?: number };
		};
		const weekInfo = localeWithWeekInfo.getWeekInfo?.();
		if (weekInfo) {
			const start = weekInfo.firstDay as CalendarLocale['weekStartsOn'];
			const firstWeek = weekInfo.minimalDays as CalendarLocale['firstWeekContainsDate'];
			if (start >= 0 && start <= 6) weekStartsOn = start;
			if (firstWeek === 1 || firstWeek === 4) firstWeekContainsDate = firstWeek;
		}
	} catch {
		// Invalid language tag — fall back to defaults.
	}

	return { code, weekStartsOn, firstWeekContainsDate, ...overrides };
}

/** Merges a user-supplied partial locale with the given base. */
export function resolveLocale(locale?: Partial<CalendarLocale> | null): CalendarLocale {
	if (!locale) return enUS;
	if (locale.weekStartsOn !== undefined || locale.firstWeekContainsDate !== undefined) {
		return {
			code: locale.code ?? enUS.code,
			weekStartsOn: locale.weekStartsOn ?? enUS.weekStartsOn,
			firstWeekContainsDate: locale.firstWeekContainsDate ?? enUS.firstWeekContainsDate,
		};
	}
	return createLocale(locale.code ?? enUS.code, locale);
}
