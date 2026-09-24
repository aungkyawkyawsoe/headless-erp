import { memo } from 'react';
import { PlateChip } from '@/shared/components/plate-chip';
import { CARD_FRAME } from '@/shared/components/card';

import { FactRowKV } from '@/shared/components/dotted-facts';

import { LicensePill, expiryLabel } from './license-badge';
import type { LicenseCardModel } from '../data/types';

/**
 * License card — ONE list row for the licenses (`/app/licenses`) list, in the
 * SAME card language as the incidents / store cards:
 *
 *  ┌──────────────────────────────────────────────┐
 *  │ [7S-6158] [HINO]                 214 days     │
 *  │ License No ···················· LIC-2026-118  │
 *  │ Expiry ························ Aug 26, 2026  │
 *  └──────────────────────────────────────────────┘
 *
 *  - **Identity chips** — the plate in a bordered plate-style chip + the vehicle
 *    brand as a quiet uppercase chip (the fleet's license-plate convention);
 *  - **Remaining-days pill** — top-right, ROUNDED-FULL + tinted by renewal
 *    urgency (valid / expiring / overdue): the color is the status, the text the
 *    precise days left ("214 days" / "Due today" / "Overdue");
 *  - **Fact rows** — the license number and the expiry date as dotted-leader
 *    rows (label muted left, value semibold right), uppercase English labels;
 *  - **Issued-place footer** — where the license was issued (a quiet line under
 *    a left quote border when the permit carries a place).
 *
 * A REGISTER card for a vehicle with NO current license (`hasRecord === false`)
 * keeps the vehicle's plate + brand chips and swaps the document facts for the
 * module's neutral "no license yet" hint, so ALL vehicles can appear — the
 * register is vehicle-first.
 */

/** One dotted-leader fact row — the shared tight CARD variant. */
function FactRow({ label, value }: { label: string; value: string | null }) {
	return <FactRowKV label={label} value={value ?? '—'} />;
}

export const LicenseCard = memo(function LicenseCard({ license }: { license: LicenseCardModel }) {
	const hasRecord = license.hasRecord !== false;
	return (
		<li className={`${CARD_FRAME} p-4 shadow-card`}>
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<PlateChip>{license.plate ?? '—'}</PlateChip>
					{license.brand && (
						<span className="inline-flex items-center self-stretch text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
							{license.brand}
						</span>
					)}
				</div>
				{hasRecord ? (
					<LicensePill tone={license.tone} remainingDays={license.remainingDays} />
				) : (
					<span className="shrink-0 rounded-full border border-dashed border-border px-3 py-0.5 text-meta font-semibold leading-myanmar text-muted-foreground">
						No license
					</span>
				)}
			</div>

			{hasRecord ? (
				<>
					<div className="mt-3 flex flex-col gap-1.5">
						{license.licenseNo && <FactRow label="License No" value={license.licenseNo} />}
						<FactRow label="Expiry" value={expiryLabel(license.expiryDate)} />
					</div>

					{license.place && (
						<p className="mt-2.5 border-l-2 border-border pl-2.5 text-xs leading-myanmar text-muted-foreground">
							Issued at {license.place}
						</p>
					)}
				</>
			) : (
				<p className="mt-3 text-sub font-medium leading-myanmar text-muted-foreground">No license on file yet.</p>
			)}
		</li>
	);
});
