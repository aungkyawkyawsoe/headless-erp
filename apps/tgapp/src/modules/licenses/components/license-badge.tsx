import { englishDateLabel, RemainingDaysPill, remainingLabel, type RemainingDaysPillSize } from '@/shared/components/remaining-days-pill';

import type { LicenseStatusTone } from '../data/types';

/**
 * The license badge vocabulary — the pill tint map (module-owned) built on the
 * SHARED remaining-days pill (`shared/components/remaining-days-pill.tsx`), so
 * the license CARD and the per-truck LINE item can never drift apart.
 */

/** Pill tint per renewal urgency — soft bg + tone text, no border. */
export const LICENSE_TONE_CLASS: Record<LicenseStatusTone, string> = {
	ok: 'bg-status-success-soft text-status-success',
	warn: 'bg-status-warning-soft text-status-warning',
	alert: 'bg-status-danger-soft text-status-danger',
};

/** "Aug 26, 2026" — a date in English (UTC-safe from `YYYY-MM-DD`). */
export const expiryLabel = englishDateLabel;

export { remainingLabel };

/** The ROUNDED-FULL remaining-days pill — tinted by renewal urgency. */
export function LicensePill({
	tone,
	remainingDays,
	size = 'sm',
}: {
	tone: LicenseStatusTone;
	remainingDays: number | null;
	size?: RemainingDaysPillSize;
}) {
	return <RemainingDaysPill toneClass={LICENSE_TONE_CLASS[tone]} remainingDays={remainingDays} size={size} />;
}
