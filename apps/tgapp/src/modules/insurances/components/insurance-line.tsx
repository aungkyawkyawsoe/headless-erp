import { memo } from 'react';

import { docYearLabel } from '@/shared/components/truck-groups';

import { insuranceMoneyLabel } from '../data/status';
import { InsurancePill, endDateLabel } from './insurance-badge';
import type { InsuranceCardModel } from '../data/types';

/**
 * Insurance LINE — one belonging policy under its truck on the insurances
 * (`/app/insurances`) per-truck card, and one row of a truck's POLICY HISTORY
 * (the truck page's history list / the Unassigned rows). The plate/brand chips
 * live on the truck header above, so each line stays lean: a period-year chip
 * (read from the policy number, e.g. `AYA/YGN/26/040` → 2026) when one can be
 * read, the provider as the primary text, a muted meta line (expiry · policy no
 * · premium when one is on the record) and the remaining-days pill (tint =
 * expiry urgency).
 *
 * The truck CARD's current line hides the pill (`showPill={false}`) — there the
 * pill lives in the truck header band instead, and the line keeps just the
 * period-year chip. History rows (truck page / Unassigned) keep the pill.
 *
 *  ┌──────────────────────────────────────────────────────────┐
 *  │ AYA SOMPO · Expires Jul 28, 2026 …         [2026] [Overdue] │
 *  └──────────────────────────────────────────────────────────┘
 */
export const InsuranceLine = memo(function InsuranceLine({
	insurance,
	showPill = true,
}: {
	insurance: InsuranceCardModel;
	showPill?: boolean;
}) {
	const year = docYearLabel(insurance.policyNo, insurance.expiryDate);
	const premium = insuranceMoneyLabel(insurance.premiumAmount);
	const meta = [
		insurance.expiryDate ? `Expires ${endDateLabel(insurance.expiryDate)}` : null,
		insurance.policyNo ? `Policy ${insurance.policyNo}` : null,
		premium ? `Premium ${premium}` : null,
	]
		.filter((part): part is string => Boolean(part))
		.join(' · ');

	return (
		<div className="flex items-center justify-between gap-3 px-4 py-3">
			<div className="min-w-0">
				<p className="truncate text-sm font-semibold leading-myanmar text-foreground">
					{insurance.provider ?? insurance.policyNo ?? 'Policy record'}
				</p>
				<p className="mt-0.5 truncate text-meta leading-myanmar text-muted-foreground">{meta || 'No date on file'}</p>
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				{year && (
					<span className="inline-flex items-center rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-muted-foreground">
						{year}
					</span>
				)}
				{showPill && <InsurancePill status={insurance.status} remainingDays={insurance.remainingDays} />}
			</div>
		</div>
	);
});
