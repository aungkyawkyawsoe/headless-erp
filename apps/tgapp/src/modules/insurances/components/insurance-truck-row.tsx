import { memo } from 'react';

import { OpenChip, TruckMatchCard, TruckMatchEmpty } from '@/shared/components/truck-match-card';

import { InsurancePill } from './insurance-badge';
import { InsuranceLine } from './insurance-line';
import type { InsuranceTruckMatch } from '../data/types';

/**
 * ONE truck row of the insurance kiosk's matching list (`/app/insurances`) — a
 * plate search hit joined to its CURRENT policy, in the SAME card language as
 * the browse register's truck cards: plate chip + brand badge in the identity
 * row, the current policy's remaining-days pill at the row's right, and the
 * current policy as the card's single line (provider · expiry/policy/premium
 * meta · period-year chip). The WHOLE card is the tap target — it opens the
 * truck's full-screen page (`/app/insurances/:id`).
 *
 * A truck with NO policy on file shows a neutral hint line instead ("open to
 * add this truck's first policy") — the kiosk deliberately never claims a
 * policy state it has not read.
 */
export const InsuranceTruckRow = memo(function InsuranceTruckRow({
	match,
	onOpen,
}: {
	match: InsuranceTruckMatch;
	onOpen: (match: InsuranceTruckMatch) => void;
}) {
	const { record } = match;
	return (
		<TruckMatchCard
			plate={match.plate}
			brand={match.brand}
			hrefLabel={`${match.plate} — view or renew this truck's policies`}
			onOpen={() => onOpen(match)}
			status={record ? <InsurancePill size="md" status={record.status} remainingDays={record.remainingDays} /> : <OpenChip />}
		>
			{record ? (
				<InsuranceLine insurance={record} showPill={false} />
			) : (
				<TruckMatchEmpty>No policy on file — open to add this truck's first policy.</TruckMatchEmpty>
			)}
		</TruckMatchCard>
	);
});
