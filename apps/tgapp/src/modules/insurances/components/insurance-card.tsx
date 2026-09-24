import { memo } from 'react';
import { PlateChip } from '@/shared/components/plate-chip';
import { CARD_FRAME } from '@/shared/components/card';

import { FactRowKV } from '@/shared/components/dotted-facts';

import { insuranceMoneyLabel } from '../data/status';
import { InsurancePill, endDateLabel } from './insurance-badge';
import type { InsuranceCardModel } from '../data/types';

/**
 * Insurance card — ONE policy row for the insurances (`/app/insurances`) list,
 * in the SAME card language as the license / incidents cards:
 *
 *  ┌──────────────────────────────────────────────┐
 *  │ [7S-6158] [HINO]                 214 days     │
 *  │ Provider ······················· AYA SOMPO    │
 *  │ Policy no ····················· AYA/YGN/118   │
 *  │ Expiry ························· Sep 30, 2026 │
 *  │ Premium ······················· 1,250,000 Ks  │
 *  │ ▏ Full cover incl. windscreen replacement     │
 *  └──────────────────────────────────────────────┘
 *
 *  - **Identity chips** — the plate in a bordered plate-style chip + the vehicle
 *    brand as a quiet uppercase chip (the fleet's license-plate convention);
 *  - **Remaining-days pill** — top-right, ROUNDED-FULL + tinted by expiry
 *    urgency (valid / expiring / expired): the color is the status, the text the
 *    precise days left;
 *  - **Fact rows** — Provider (always) + Expiry, then the OPTIONAL terms the
 *    policy actually carries — policy number, premium / sum insured / windscreen
 *    cover (Ks) and the betterment flag — each row renders only when its value
 *    is on the record (dotted leader, label muted left, value semibold right);
 *  - **Note footer** — the policy's note as a quiet quote line under the facts
 *    when one is written.
 *
 * A REGISTER card for a vehicle with NO current policy (`hasRecord === false`)
 * keeps the vehicle's plate + brand chips and swaps the policy facts for the
 * module's neutral "no policy yet" hint, so ALL vehicles can appear — the
 * register is vehicle-first.
 */

/** One dotted-leader fact row — the shared tight CARD variant. */
function FactRow({ label, value }: { label: string; value: string | null }) {
	return <FactRowKV label={label} value={value ?? '—'} />;
}

export const InsuranceCard = memo(function InsuranceCard({ insurance }: { insurance: InsuranceCardModel }) {
	const premium = insuranceMoneyLabel(insurance.premiumAmount);
	const sumInsured = insuranceMoneyLabel(insurance.sumInsured);
	const windscreenCover = insuranceMoneyLabel(insurance.windscreenCover);
	const hasRecord = insurance.hasRecord !== false;

	return (
		<li className={`${CARD_FRAME} p-4 shadow-card`}>
			<div className="flex min-w-0 items-start justify-between gap-3">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<PlateChip>{insurance.plateNo ?? '—'}</PlateChip>
					{insurance.brandLabel && (
						<span className="inline-flex items-center self-stretch text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
							{insurance.brandLabel}
						</span>
					)}
				</div>
				{hasRecord ? (
					<InsurancePill status={insurance.status} remainingDays={insurance.remainingDays} />
				) : (
					<span className="shrink-0 rounded-full border border-dashed border-border px-3 py-0.5 text-meta font-semibold leading-myanmar text-muted-foreground">
						No policy
					</span>
				)}
			</div>

			{hasRecord ? (
				<>
					<div className="mt-3 flex flex-col gap-1.5">
						<FactRow label="Provider" value={insurance.provider} />
						{insurance.policyNo && <FactRow label="Policy no" value={insurance.policyNo} />}
						<FactRow label="Expiry" value={endDateLabel(insurance.expiryDate)} />
						{premium && <FactRow label="Premium" value={premium} />}
						{sumInsured && <FactRow label="Sum insured" value={sumInsured} />}
						{windscreenCover && <FactRow label="Windscreen cover" value={windscreenCover} />}
						{insurance.betterment === true && <FactRow label="Betterment" value="Yes" />}
					</div>

					{insurance.note && (
						<p className="mt-2.5 border-l-2 border-border pl-2.5 text-xs leading-myanmar text-muted-foreground">{insurance.note}</p>
					)}
				</>
			) : (
				<p className="mt-3 text-sub font-medium leading-myanmar text-muted-foreground">No policy on file yet.</p>
			)}
		</li>
	);
});
