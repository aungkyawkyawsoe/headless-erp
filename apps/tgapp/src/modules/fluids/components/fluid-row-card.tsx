import { memo } from 'react';
import { PlateChip } from '@/shared/components/plate-chip';
import { CARD_FRAME } from '@/shared/components/card';
import { ChevronRight, Fuel, Gauge } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { KM_LEFT_TONE_CLASS, kmLeftLabel, kmLeftTone, kmValueLabel } from '@/modules/fleets/data/status';
import type { FluidListModel } from '../data/types';
import { hapticSelection } from '@/shared/platform/haptics';

/**
 * Fluid list row — ONE vehicle card on `/app/fluid`:
 *
 *  ┌──────────────────────────────────────┐
 *  │ ┌─────────┐ HINO       64,800 km ›  │
 *  │ │ 9D-2547 │            (current odo) │
 *  │ └─────────┘                           │
 *  │ 🛢 Engine oil · 1,300 km left          │
 *  │ 🛢 Gear oil · No service yet           │
 *  └──────────────────────────────────────┘
 *
 *  - **Left** — the plate in a bordered chip + the brand as quiet meta;
 *  - **Right top** — the vehicle's CURRENT odometer (its newest-date reading,
 *    or a muted '—' when none is on file) before the chevron;
 *  - **Chips** — one per km-serviced fluid: the km-left pill (green ≥ 1 000 ·
 *    amber 0–999 · red past due), or a neutral "No service yet" pill when a
 *    chip can't be computed yet (no fill / interval / odo on file);
 *  - Whole row is ONE tap target → the vehicle's Fluid page.
 */
export const FluidRowCard = memo(function FluidRowCard({ vehicle }: { vehicle: FluidListModel }) {
	const navigate = useNavigate();
	const open = () => {
		hapticSelection();
		// Hand the tapped row to the vehicle page through router state so it never
		// refetches the fleet master row for its header (the same rule as the Daily
		// ODO list→vehicle page). Deep links / refreshes carry no state — the page
		// falls back to one lean fleet read for the header.
		navigate(`/app/fluid/${vehicle.id}`, { state: { row: vehicle } });
	};

	return (
		<li>
			<button
				type="button"
				onClick={open}
				aria-label={`${vehicle.plateNo} — open fluid care`}
				className={`block w-full ${CARD_FRAME} p-3.5 text-left shadow-card transition-transform duration-150 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.99]`}
			>
				<div className="flex items-start justify-between gap-3">
					<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
						<PlateChip>{vehicle.plateNo}</PlateChip>
						{vehicle.brandLabel && (
							<span className="text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-muted-foreground">
								{vehicle.brandLabel}
							</span>
						)}
					</div>
					<div className="flex shrink-0 items-center gap-1">
						{/* The current odometer — the card's at-a-glance odo fact (a muted
							'—' when the vehicle has no reading on file yet). */}
						<span
							className={`inline-flex items-center gap-1.5 text-sm tabular-nums leading-none ${vehicle.currentOdo != null ? 'font-bold text-foreground' : 'font-medium text-muted-foreground'}`}
						>
							<Gauge className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
							{kmValueLabel(vehicle.currentOdo)}
						</span>
						<ChevronRight className="size-4 text-muted-foreground" aria-hidden />
					</div>
				</div>

				{/* The km-left chips — one per fluid kind (always shown; neutral when
					the vehicle has nothing on file to compute from yet). */}
				<div className="mt-3 flex flex-wrap gap-1.5">
					<FluidKindChip label="Engine oil" kmLeft={vehicle.engineOilKmLeft} />
					<FluidKindChip label="Gear oil" kmLeft={vehicle.gearOilKmLeft} />
				</div>
			</button>
		</li>
	);
});

/** One fluid kind's chip — km-left pill (green ≥ 1 000 · amber 0–999 · red past
 *  due); a neutral muted pill when the value can't be computed yet. */
function FluidKindChip({ label, kmLeft }: { label: string; kmLeft: number | null }) {
	const tone = kmLeftTone(kmLeft);
	const tint = kmLeft == null ? 'bg-muted text-muted-foreground' : KM_LEFT_TONE_CLASS[tone];
	return (
		<span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-meta font-semibold leading-none ${tint}`}>
			<Fuel className="size-3 shrink-0" aria-hidden />
			<span className="min-w-0 truncate">
				{label} · {kmLeftLabel(kmLeft)}
			</span>
		</span>
	);
}
