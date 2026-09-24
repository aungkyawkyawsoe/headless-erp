import type { LicenseStatusTone } from './types';

/**
 * The licenses list's status filter — `'all'` shows every license. Values map
 * to the cards' derived renewal-urgency tones (ok / warn / alert).
 */
export type LicenseStatusFilterValue = LicenseStatusTone | 'all';

/** The tone label chips — English across the ops UI (like every store/fleet screen). */
export const LICENSE_STATUS_LABELS: Record<LicenseStatusFilterValue, string> = {
	all: 'All',
	ok: 'Valid',
	warn: 'Expiring',
	alert: 'Overdue',
};

/** The filter sheet's options — the single source both the sheet rows and the
 *  bar's center label read (labels derived from the map, never re-typed). */
export const LICENSE_STATUS_OPTIONS: ReadonlyArray<{ value: LicenseStatusFilterValue; label: string }> = (
	['all', 'ok', 'warn', 'alert'] as const
).map((value) => ({ value, label: LICENSE_STATUS_LABELS[value] }));

/**
 * A truck's renewal readiness — how its CURRENT permit gates the renew form:
 *  - `'first'` — nothing on file yet (a first permit is always allowed);
 *  - `'due'` — the current permit is already due or overdue (or carries no date
 *    to be "still valid" against), so filing the next annual permit is the
 *    expected action;
 *  - `'not-due'` — the current permit is still comfortably valid (its tone is
 *    `ok` — more than the 30-day due window ahead), so the renew form stays
 *    LOCKED (dimmed) to stop duplicate / premature renewals.
 */
export type LicenseRenewState = 'first' | 'due' | 'not-due';

export function licenseRenewStateOf(
	current: { tone: LicenseStatusTone; remainingDays: number | null } | null | undefined,
): LicenseRenewState {
	if (!current) return 'first';
	// An undated permit is never "still valid", and `ok` only exists past the
	// 30-day due window — either way only a dated `ok` permit is not-due.
	if (current.remainingDays == null || current.tone !== 'ok') return 'due';
	return 'not-due';
}
