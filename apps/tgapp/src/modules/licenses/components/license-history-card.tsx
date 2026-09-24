import { memo } from 'react';
import { Pencil } from 'lucide-react';

import { LicensePill, expiryLabel } from './license-badge';
import type { LicenseCardModel } from '../data/types';
import { LedgerRow } from '@/shared/components/ledger';
import { SupersededPill } from '@/shared/components/superseded-pill';
import { docYearLabel } from '@/shared/components/truck-groups';

/**
 * ONE permit of a truck's license LEDGER — the per-truck page's row.
 *
 *   YGN/26/100                   [214d]
 *   Period 2026 · Expires Jun 3, 2026 · Issued at Yangon
 *
 * The permit number is the anchor, the period/expiry/place facts the identity
 * line, and the renewal-urgency pill the right-hand status. The plate/brand live
 * in the page's hero above, so the row stays lean.
 *
 * STATUS IS A PROPERTY OF THE CURRENT RECORD: `current` (the head of the feed —
 * what the hero and the register show) carries the urgency pill; every older row
 * is replaced paperwork and carries the neutral `Superseded` chip instead, so a
 * renewed truck can never read as "Overdue" in its own history.
 *
 * `onEdit` (supplied only for the truck's NEWEST record) renders the correction
 * action; older rows stay read-only history.
 */
export const LicenseHistoryCard = memo(function LicenseHistoryCard({
	license,
	current = false,
	onEdit,
}: {
	license: LicenseCardModel;
	/** This row IS the truck's current permit — only then is urgency meaningful. */
	current?: boolean;
	onEdit?: (license: LicenseCardModel) => void;
}) {
	const year = docYearLabel(license.licenseNo, license.expiryDate);
	const meta = [
		year ? `Period ${year}` : null,
		license.expiryDate ? `Expires ${expiryLabel(license.expiryDate)}` : null,
		license.place ? `Issued at ${license.place}` : null,
	]
		.filter((part): part is string => Boolean(part))
		.join(' · ');

	return (
		<LedgerRow
			anchor={license.licenseNo ?? 'License record'}
			secondary={meta || 'No date on file'}
			status={current ? <LicensePill tone={license.tone} remainingDays={license.remainingDays} /> : <SupersededPill />}
			trailing={
				onEdit ? (
					<button
						type="button"
						onClick={() => onEdit(license)}
						aria-label="Edit license"
						className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm transition-transform duration-150 active:scale-95"
					>
						<Pencil className="size-4" strokeWidth={2.2} aria-hidden />
					</button>
				) : undefined
			}
		/>
	);
});
