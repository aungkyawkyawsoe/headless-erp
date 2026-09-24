import { memo } from 'react';

import { docYearLabel } from '@/shared/components/truck-groups';

import { LicensePill, expiryLabel } from './license-badge';
import type { LicenseCardModel } from '../data/types';

/**
 * License LINE — one belonging license under its truck on the licenses
 * (`/app/licenses`) per-truck card, and one row of a truck's LICENSE HISTORY
 * (the truck page's history list / the Unassigned rows). The plate/brand chips
 * live on the truck header above, so each line stays lean: the license number
 * as the primary text, a muted meta line with the expiry + issuing place, a
 * period-year chip (read from the license number, e.g. `YGN/26/100` → 2026)
 * when one can be read, and the remaining-days pill (tint = renewal urgency).
 *
 * The truck CARD's current line hides the pill (`showPill={false}`) — there the
 * pill lives in the truck header band instead, and the line keeps just the
 * period-year chip. History rows (truck page / Unassigned) keep the pill.
 *
 *  ┌──────────────────────────────────────────────────────┐
 *  │ YGN/26/100 · Expires Jun 3, 2026        [2026] [Overdue] │
 *  └──────────────────────────────────────────────────────┘
 */
export const LicenseLine = memo(function LicenseLine({ license, showPill = true }: { license: LicenseCardModel; showPill?: boolean }) {
	const year = docYearLabel(license.licenseNo, license.expiryDate);
	const meta = [
		license.expiryDate ? `Expires ${expiryLabel(license.expiryDate)}` : null,
		license.place ? `Issued at ${license.place}` : null,
	]
		.filter((part): part is string => Boolean(part))
		.join(' · ');

	return (
		<div className="flex items-center justify-between gap-3 px-4 py-3">
			<div className="min-w-0">
				<p className="truncate text-sm font-semibold leading-myanmar text-foreground">{license.licenseNo ?? 'License record'}</p>
				<p className="mt-0.5 truncate text-meta leading-myanmar text-muted-foreground">{meta || 'No date on file'}</p>
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				{year && (
					<span className="inline-flex items-center rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-muted-foreground">
						{year}
					</span>
				)}
				{showPill && <LicensePill tone={license.tone} remainingDays={license.remainingDays} />}
			</div>
		</div>
	);
});
