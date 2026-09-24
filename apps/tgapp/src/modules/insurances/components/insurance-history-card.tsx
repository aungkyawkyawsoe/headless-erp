import { memo } from 'react';
import { Pencil } from 'lucide-react';

import { insuranceMoneyLabel } from '../data/status';
import { InsurancePill, endDateLabel } from './insurance-badge';
import type { InsuranceCardModel } from '../data/types';
import { LedgerRow, type LedgerDelta } from '@/shared/components/ledger';
import { SupersededPill } from '@/shared/components/superseded-pill';
import { docYearLabel } from '@/shared/components/truck-groups';

/**
 * ONE policy of a truck's insurance LEDGER — the per-truck page's row.
 *
 *   2025/26 · AYA SOMPO          [214d]
 *   Period 2026 · Expires Jun 3, 2026 · Policy AYA/1
 *   premium +70,000                        ← the renewal TRANSITION
 *
 * The provider is the anchor, the period/expiry/policy facts the identity line,
 * the paid premium the right-hand figure, and the premium change since the
 * previous period the transition line — so a renewal reads as a step in a series
 * rather than an isolated card.
 *
 * STATUS IS A PROPERTY OF THE CURRENT POLICY: `current` (the head of the feed —
 * what the hero and the register show) carries the valid/expiring/expired pill;
 * every older row is replaced paperwork and carries the neutral `Superseded`
 * chip instead, so a renewed truck can never read as "Expired" in its own
 * history.
 *
 * `onEdit` (supplied only for the truck's NEWEST record) renders the correction
 * action; older rows stay read-only history.
 */
export const InsuranceHistoryCard = memo(function InsuranceHistoryCard({
	insurance,
	current = false,
	onEdit,
	delta,
}: {
	insurance: InsuranceCardModel;
	/** This row IS the truck's current policy — only then is expiry meaningful. */
	current?: boolean;
	/** The premium change since the previous period — omitted when there is no
	 *  comparable previous record. */
	delta?: LedgerDelta;
	onEdit?: (insurance: InsuranceCardModel) => void;
}) {
	const year = docYearLabel(insurance.policyNo, insurance.expiryDate);
	const premium = insuranceMoneyLabel(insurance.premiumAmount);
	const meta = [
		year ? `Period ${year}` : null,
		insurance.expiryDate ? `Expires ${endDateLabel(insurance.expiryDate)}` : null,
		insurance.policyNo ? `Policy ${insurance.policyNo}` : null,
	]
		.filter((part): part is string => Boolean(part))
		.join(' · ');

	return (
		<LedgerRow
			anchor={insurance.provider ?? insurance.policyNo ?? 'Policy record'}
			secondary={meta || 'No date on file'}
			value={premium}
			status={current ? <InsurancePill status={insurance.status} remainingDays={insurance.remainingDays} /> : <SupersededPill />}
			delta={delta}
			trailing={
				onEdit ? (
					<button
						type="button"
						onClick={() => onEdit(insurance)}
						aria-label="Edit policy"
						className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm transition-transform duration-150 active:scale-95"
					>
						<Pencil className="size-4" strokeWidth={2.2} aria-hidden />
					</button>
				) : undefined
			}
		/>
	);
});
