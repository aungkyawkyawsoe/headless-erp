/**
 * Insurance expiry tone — the states an insurance card renders, derived from
 * the policy's remaining days (the fleet overview's expiry-window rule):
 *  - `expired` (red) — no end date on file, or past due;
 *  - `expiring` (amber) — within `WARN_WINDOW_DAYS` of expiry;
 *  - `valid` (green) — otherwise.
 */
import type { InsuranceStatus } from './types';

export type { InsuranceStatus };

/** A policy inside this many days of expiry shows the amber `expiring` tone. */
export const WARN_WINDOW_DAYS = 30;

/**
 * Derive a policy's display status from its remaining days — the single rule
 * shared by the card's pill and the list's status filter, so the two can never
 * disagree about what a policy "is".
 */
export function deriveStatus(remainingDays: number | null): InsuranceStatus {
	if (remainingDays === null || remainingDays < 0) return 'expired';
	if (remainingDays <= WARN_WINDOW_DAYS) return 'expiring';
	return 'valid';
}

/**
 * "1,250,000 Ks" — one policy money value (premium / sum insured / windscreen
 * cover) with thousands separators. Null when the stored value is missing or
 * unparseable, so callers never paint a fake 0.
 */
export function insuranceMoneyLabel(value: number | string | null | undefined): string | null {
	if (value == null || value === '') return null;
	const amount = typeof value === 'number' ? value : Number.parseFloat(String(value).replace(/[^0-9.-]/g, ''));
	if (!Number.isFinite(amount)) return null;
	return `${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} Ks`;
}

/** Numeric parse of a policy money value — null when missing/unparseable. */
export function insuranceMoneyValue(value: unknown): number | null {
	if (value == null || value === '') return null;
	const amount = typeof value === 'number' ? value : Number.parseFloat(String(value).replace(/[^0-9.-]/g, ''));
	return Number.isFinite(amount) ? amount : null;
}

/** The policy list's status filter — `'all'` shows every policy. */
export type InsuranceStatusFilterValue = InsuranceStatus | 'all';

/** English labels across the ops UI (the same tone vocabulary as every fleet screen). */
export const INSURANCE_STATUS_LABELS: Record<InsuranceStatusFilterValue, string> = {
	all: 'All',
	valid: 'Valid',
	expiring: 'Expiring',
	expired: 'Expired',
};

/** The filter sheet's options — the single source both the sheet rows and the
 *  bar's center label read (labels derived from the map, never re-typed). */
export const INSURANCE_STATUS_OPTIONS: ReadonlyArray<{ value: InsuranceStatusFilterValue; label: string }> = (
	['all', 'valid', 'expiring', 'expired'] as const
).map((value) => ({ value, label: INSURANCE_STATUS_LABELS[value] }));

/**
 * A truck's renewal readiness — how its CURRENT policy gates the renew form:
 *  - `'first'` — nothing on file yet (a first policy is always allowed);
 *  - `'due'` — the current policy is already expiring or expired (or carries no
 *    date to be "still valid" against), so buying the next policy is expected;
 *  - `'not-due'` — the current policy is still comfortably valid (its status is
 *    `valid` — more than the 30-day warning window ahead), so the renew form
 *    stays LOCKED (dimmed) to stop duplicate / premature renewals.
 */
export type InsuranceRenewState = 'first' | 'due' | 'not-due';

export function insuranceRenewStateOf(
	current: { status: InsuranceStatus; remainingDays: number | null } | null | undefined,
): InsuranceRenewState {
	if (!current) return 'first';
	// An undated policy derives `expired` (never "still valid"), and `valid` only
	// exists past the 30-day warning window — either way only a dated `valid`
	// policy is not-due.
	if (current.remainingDays == null || current.status !== 'valid') return 'due';
	return 'not-due';
}

/**
 * The predefined insurer options — a mirror of the `veh_insurances.provider`
 * SELECT the backend schema ships (the values are the engine-stored codes; the
 * labels are what an operator picks on the forms and what the cards display).
 * Keep this in lockstep with the backend field's options.
 */
export const INSURANCE_PROVIDER_OPTIONS = [
	{ value: 'AYI', label: 'AYA' },
	{ value: 'GGI', label: 'GGI' },
	{ value: 'EFI', label: 'EFI' },
	{ value: 'FNI', label: 'FNI' },
	{ value: 'GWI', label: 'GWI' },
	{ value: 'KBZMS', label: 'KBZMS' },
	{ value: 'A INSURANCE', label: 'A INSURANCE' },
] as const satisfies ReadonlyArray<{ value: string; label: string }>;

/**
 * The stored provider code's display label (AYI → AYA) — unknown / legacy raw
 * values (rows written before the field became a select) pass through as-is,
 * and null/empty means "no provider on file".
 */
export function insuranceProviderLabel(provider: string | null | undefined): string | null {
	if (!provider) return null;
	const option = INSURANCE_PROVIDER_OPTIONS.find((o) => o.value === provider);
	return option ? option.label : provider;
}
