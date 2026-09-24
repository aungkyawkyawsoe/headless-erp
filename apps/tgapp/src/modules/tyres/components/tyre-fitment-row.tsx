import { memo } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { ChevronRight, Truck } from 'lucide-react';

import type { VehicleBoardState } from '../data/board';

/**
 * Fitment truck row — ONE plate on a fleet list: the plate with its wheel count
 * up front, the truck's model/type beneath. Tapping it opens the full-screen
 * wheel-position page (`/app/tyres/vehicle/:id`). Plate-first identity in the
 * plate chip convention.
 *
 *  ┌───────────────────────────────────────────────┐
 *  │ [6S-2734]  6W                             ⏵  │
 *  │            fuso · box                        │
 *  └───────────────────────────────────────────────┘
 */
interface TyreFitmentRowProps {
	vehicle: VehicleBoardState;
	onOpen: (vehicle: VehicleBoardState) => void;
}

export const TyreFitmentRow = memo(function TyreFitmentRow({ vehicle, onOpen }: TyreFitmentRowProps) {
	const total = vehicle.seats.length;
	// The two facts this row leads with: how many wheels it seats, and what it is.
	const wheelLabel = `${total}W`;
	const modelText = [vehicle.brandLabel, vehicle.unitLabel].filter((part): part is string => Boolean(part)).join(' · ');

	return (
		<li>
			<button
				type="button"
				onClick={() => onOpen(vehicle)}
				className={`w-full ${CARD_FRAME} p-3.5 text-left shadow-card transition-transform duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]`}
				aria-label={`${vehicle.plateNo} — view fitment (${total} wheels)`}
			>
				<div className="flex items-center gap-3">
					{/* Plate icon + chip — the fleet identity convention. */}
					<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
						<Truck className="size-5" aria-hidden />
					</span>

					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
							<span className="inline-flex items-center rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-sm font-semibold leading-none tracking-wider text-foreground">
								{vehicle.plateNo}
							</span>
							<span className="text-meta font-bold leading-none tracking-wide tabular-nums text-muted-foreground">{wheelLabel}</span>
						</div>
						{modelText ? <p className="mt-1 text-meta font-medium leading-none text-muted-foreground">{modelText}</p> : null}
					</div>

					{/* Right — a chevron affordance. */}
					<ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
				</div>
			</button>
		</li>
	);
});
