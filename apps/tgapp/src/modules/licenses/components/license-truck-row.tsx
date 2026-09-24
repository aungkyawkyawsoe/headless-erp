import { memo } from 'react';

import { OpenChip, TruckMatchCard, TruckMatchEmpty } from '@/shared/components/truck-match-card';

import { LicensePill } from './license-badge';
import { LicenseLine } from './license-line';
import type { LicenseTruckMatch } from '../data/types';

/**
 * ONE truck row of the license kiosk's matching list (`/app/licenses`) — a
 * plate search hit joined to its CURRENT permit, in the SAME card language as
 * the browse register's truck cards: plate chip + brand badge in the identity
 * row, the current permit's remaining-days pill at the row's right, and the
 * current license as the card's single line (number · expiry/place meta ·
 * period-year chip). The WHOLE card is the tap target — it opens the truck's
 * full-screen page (`/app/licenses/:id`), carrying the current permit number
 * through router state so the renewal form needs no read.
 *
 * A truck with NO permit on file shows a neutral hint line instead ("open to
 * add this truck's first permit") — the kiosk deliberately never claims a
 * permit state it has not read.
 */
export const LicenseTruckRow = memo(function LicenseTruckRow({
	match,
	onOpen,
}: {
	match: LicenseTruckMatch;
	onOpen: (match: LicenseTruckMatch) => void;
}) {
	const { record } = match;
	return (
		<TruckMatchCard
			plate={match.plate}
			brand={match.brand}
			hrefLabel={`${match.plate} — view or renew this truck's licenses`}
			onOpen={() => onOpen(match)}
			status={record ? <LicensePill size="md" tone={record.tone} remainingDays={record.remainingDays} /> : <OpenChip />}
		>
			{record ? (
				<LicenseLine license={record} showPill={false} />
			) : (
				<TruckMatchEmpty>No license on file — open to add this truck's first permit.</TruckMatchEmpty>
			)}
		</TruckMatchCard>
	);
});
