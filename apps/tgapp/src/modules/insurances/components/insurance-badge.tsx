import { englishDateLabel, RemainingDaysPill, remainingLabel, type RemainingDaysPillSize } from '@/shared/components/remaining-days-pill';

import type { InsuranceStatus } from '../data/status';

/**
 * The insurance badge vocabulary — the pill tint map (module-owned) built on the
 * SHARED remaining-days pill (`shared/components/remaining-days-pill.tsx`), so
 * the policy CARD and the per-truck LINE item can never drift apart.
 */

/** Pill tint per expiry urgency — soft bg + tone text, no border. */
export const INSURANCE_TONE_CLASS: Record<InsuranceStatus, string> = {
	valid: 'bg-status-success-soft text-status-success',
	expiring: 'bg-status-warning-soft text-status-warning',
	expired: 'bg-status-danger-soft text-status-danger',
};

/** "Sep 30, 2026" — a date in English (UTC-safe from `YYYY-MM-DD`). */
export const endDateLabel = englishDateLabel;

export { remainingLabel };

/** The ROUNDED-FULL remaining-days pill — tinted by expiry urgency. */
export function InsurancePill({
	status,
	remainingDays,
	size = 'sm',
}: {
	status: InsuranceStatus;
	remainingDays: number | null;
	size?: RemainingDaysPillSize;
}) {
	return <RemainingDaysPill toneClass={INSURANCE_TONE_CLASS[status]} remainingDays={remainingDays} size={size} />;
}
