/** "1,200" / "1,200.5" — count display, no trailing zeros. */
export function formatCount(value: number | null): string {
	if (value == null || !Number.isFinite(value)) return '—';
	return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * "1,500,000 Ks" — the ONE money format every inbound surface shares (the card's
 * strip, the sheet's summary, every ledger row), so the same figure can never be
 * rendered two ways. '—' for a value that is absent or not a number (an unpriced
 * receipt), never "NaN".
 */
export function money(value: number | null | undefined): string {
	return value == null || !Number.isFinite(value) ? '—' : `${formatCount(value)} Ks`;
}

/** "Sep 12, 2026" — the app's date format (the runtime's en-US short-month
 *  order), '—' when unset or unparseable. Every inbounds surface shares it. */
export function dateLabel(date: string | null): string {
	if (!date) return '—';
	const day = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(day.getTime())) return '—';
	return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(day);
}

/** UTC midnight of a `YYYY-MM-DD` day — the TZ-proof anchor for day arithmetic. */
function utcDay(date: string): number | null {
	const t = new Date(`${date}T00:00:00Z`).getTime();
	return Number.isNaN(t) ? null : t;
}

const DAY_MS = 86_400_000;

/** "Sat" — the short weekday of a calendar day ('—' when unparseable). */
function weekdayLabel(date: string): string {
	const day = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(day.getTime())) return '—';
	return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(day);
}

/**
 * The day stamp a PAYMENT LEDGER row carries — always a real date, prefixed with
 * the word operators actually recognise on a recent entry:
 *
 *   "Today, Sep 20, 2026" · "Yesterday, Sep 19, 2026" · "Sat, Sep 12, 2026"
 *
 * The date is never dropped in favour of the relative word: "Today" stops being
 * true the moment someone reads the ledger tomorrow, and a posted payment record
 * is forever. `today` is injected (`todayMmtDate()` — the store's calendar day)
 * so the helper stays pure, deterministic and testable.
 */
export function paidOnLabel(date: string | null, today: string): string {
	const label = dateLabel(date);
	if (label === '—' || !date) return '—';
	const delta = utcDay(today) != null && utcDay(date) != null ? Math.round((utcDay(today)! - utcDay(date)!) / DAY_MS) : null;
	if (delta === 0) return `Today, ${label}`;
	if (delta === 1) return `Yesterday, ${label}`;
	return `${weekdayLabel(date)}, ${label}`;
}
