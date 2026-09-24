/**
 * The shared remaining-days pill vocabulary — the English date label, the
 * "214 days / Due today / Overdue" copy, the size scale and the pill shell.
 *
 * The insurance and license badges were byte-for-byte twins (same `MONTHS_EN`,
 * `remainingLabel`, `PILL_SIZES`); both now build on this one. The TONE map
 * stays module-owned (each module names its own statuses), so a pill only
 * supplies `toneClass`.
 */

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sep 30, 2026" — an English date label (UTC-safe from `YYYY-MM-DD`). */
export function englishDateLabel(date: string | null): string {
	if (!date) return '—';
	const [year, month, day] = date.split('-').map(Number);
	return `${MONTHS_EN[(month ?? 1) - 1] ?? month} ${day}, ${year}`;
}

/** "214 days" / "Due today" / "Overdue" — the pill's remaining-days text. */
export function remainingLabel(days: number | null): string {
	if (days === null) return 'No date';
	if (days < 0) return 'Overdue';
	if (days === 0) return 'Due today';
	return `${days} day${days === 1 ? '' : 's'}`;
}

/** The pill's size vocabulary — `sm` is the default line/card pill; `md` is the
 *  taller truck-card header pill (matches the plate chip's height). */
export type RemainingDaysPillSize = 'sm' | 'md';
const PILL_SIZES: Record<RemainingDaysPillSize, string> = {
	sm: 'px-3 py-0.5 text-meta leading-myanmar',
	md: 'px-3.5 py-1.5 text-sub leading-none',
};

/** The ROUNDED-FULL remaining-days pill — the module supplies its own tone class. */
export function RemainingDaysPill({
	toneClass,
	remainingDays,
	size = 'sm',
}: {
	toneClass: string;
	remainingDays: number | null;
	size?: RemainingDaysPillSize;
}) {
	return <span className={`shrink-0 rounded-full font-semibold ${PILL_SIZES[size]} ${toneClass}`}>{remainingLabel(remainingDays)}</span>;
}
