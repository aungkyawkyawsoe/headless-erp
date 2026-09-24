import { memo } from 'react';
import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { CARD_FRAME } from '@/shared/components/card';
import { PlateChip } from '@/shared/components/plate-chip';
import { hapticSelection } from '@/shared/platform/haptics';

import type { MaintenanceTruckBrowseModel } from '../data/types';

/**
 * Maintenance register row — ONE truck card on `/app/maintenances/browse`:
 *
 *  ┌──────────────────────────────────────────┐
 *  │ [9D-2547]  HINO                       ›  │
 *  └──────────────────────────────────────────┘
 *
 *  - **Left** — the plate in a bordered chip + the brand as quiet meta;
 *  - **Right** — a chevron (the card is ONE tap target).
 *
 *  Deliberately IDENTITY-ONLY: the register is a pure `veh_fleets` read, so a
 *  truck with no maintenance record still appears (the record detail lives in
 *  the truck's own file — opened on tap).
 */
export const MaintenanceTruckCard = memo(function MaintenanceTruckCard({ truck }: { truck: MaintenanceTruckBrowseModel }) {
	const navigate = useNavigate();
	const open = () => {
		hapticSelection();
		// Hand the tapped row to the truck's file through router state so it never
		// refetches the fleet master row for its header (same rule as the Fluid /
		// ODO list → vehicle pages).
		navigate(`/app/maintenances/vehicle/${truck.id}`, {
			state: { row: { vehicleId: truck.id, plate: truck.plate, brand: truck.brand, lastOdo: null } },
		});
	};

	return (
		<li>
			<button
				type="button"
				onClick={open}
				aria-label={`${truck.plate} — open maintenance file`}
				className={`block w-full ${CARD_FRAME} p-3.5 text-left shadow-card transition-transform duration-150 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.99]`}
			>
				<div className="flex items-center justify-between gap-3">
					<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
						<PlateChip>{truck.plate}</PlateChip>
						{truck.brand && (
							<span className="text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-muted-foreground">
								{truck.brand}
							</span>
						)}
					</div>
					<ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
				</div>
			</button>
		</li>
	);
});
