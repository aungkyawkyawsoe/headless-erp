import { memo } from 'react';
import { BrandBadge, PlateChip } from '@/shared/components/plate-chip';
import { CARD_FRAME } from '@/shared/components/card';
import { ChevronRight } from 'lucide-react';

import type { TruckMaintenanceMatch } from '../data/types';

/**
 * Maintenance truck row — ONE plate on the maintenance kiosk's matching list
 * (`/app/maintenances`). The kiosk resolves the TRUCK only (one fleet search), so
 * the row is identity-only: the plate chip + the brand badge, with a chevron
 * inviting the tap. The truck's maintenance file is read when its page opens —
 * never on the row.
 */
export const MaintenanceTruckRow = memo(function MaintenanceTruckRow({
	match,
	onOpen,
}: {
	match: TruckMaintenanceMatch;
	onOpen: (match: TruckMaintenanceMatch) => void;
}) {
	return (
		<li>
			<button
				type="button"
				onClick={() => onOpen(match)}
				aria-label={`${match.plate} — open maintenance file`}
				className={`flex w-full items-center justify-between gap-3 ${CARD_FRAME} px-4 py-3.5 text-left shadow-card transition-transform duration-150 outline-none active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
			>
				<span className="flex min-w-0 flex-wrap items-center gap-2">
					<PlateChip>{match.plate}</PlateChip>
					{match.brandLabel && <BrandBadge>{match.brandLabel}</BrandBadge>}
				</span>
				<ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
			</button>
		</li>
	);
});
