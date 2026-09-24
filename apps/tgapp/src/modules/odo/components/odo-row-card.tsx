import { memo } from 'react';
import { PlateChip } from '@/shared/components/plate-chip';
import { CARD_FRAME } from '@/shared/components/card';
import { ChevronRight, Gauge } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import type { OdoListModel } from '../data/types';
import { kmValueLabel } from '@/modules/fleets/data/status';
import { hapticSelection } from '@/shared/platform/haptics';
import { formatBurmeseMonthDay } from '@/shared/time/myanmar';

/**
 * Daily ODO list row — ONE vehicle card on `/app/daily-odo`:
 *
 *  ┌──────────────────────────────────────┐
 *  │ ┌─────────┐ HINO                 …km │
 *  │ │ 9D-2547 │                        › │
 *  │ └─────────┘        (latest reading)  │
 *  └──────────────────────────────────────┘
 *
 *  - **Left** — the plate in a bordered chip + the brand as quiet meta;
 *  - **Right** — the vehicle's last odometer (the master's `last_odo` on a
 *    provisioned DB — the value the fleet-care denorm keeps fresh on every
 *    Daily ODO write; the reading's date shows only when the child-read
 *    fallback still supplies it), or "No reading yet" when none is on file;
 *  - Whole row is ONE tap target → the vehicle's Daily ODO page (the month's
 *    readings load there, not on this list).
 */
export const OdoRowCard = memo(function OdoRowCard({ vehicle }: { vehicle: OdoListModel }) {
	const navigate = useNavigate();
	const open = () => {
		hapticSelection();
		// Hand the tapped row to the vehicle page through router state so it never
		// refetches the fleet master row for its header (same rule as the request
		// list → edit pattern). Deep links / refreshes carry no state — the page
		// falls back to a lean fleet read.
		navigate(`/app/daily-odo/${vehicle.id}`, { state: { row: vehicle } });
	};

	return (
		<li>
			<button
				type="button"
				onClick={open}
				aria-label={`${vehicle.plateNo} — open daily odo`}
				className={`block w-full ${CARD_FRAME} p-3.5 text-left shadow-card transition-transform duration-150 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.99]`}
			>
				<div className="flex items-center justify-between gap-3">
					<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
						<PlateChip>{vehicle.plateNo}</PlateChip>
						{vehicle.brandLabel && (
							<span className="text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-muted-foreground">
								{vehicle.brandLabel}
							</span>
						)}
					</div>
					<div className="flex shrink-0 items-center gap-1">
						<ChevronRight className="size-4 text-muted-foreground" aria-hidden />
					</div>
				</div>

				{/* The latest reading — the at-a-glance fact of the list. */}
				<div className="mt-3 flex items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-1.5">
						<Gauge className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
						<span className="truncate text-meta font-medium leading-myanmar text-muted-foreground">
							{vehicle.latestKm != null ? 'Last odo' : 'No reading yet'}
						</span>
					</div>
					{vehicle.latestKm != null ? (
						<span className="shrink-0 text-right">
							<span className="block text-sm font-bold tabular-nums leading-none text-foreground">{kmValueLabel(vehicle.latestKm)}</span>
							{vehicle.latestDate ? (
								<span className="mt-0.5 block text-[10px] leading-none text-muted-foreground">
									{formatBurmeseMonthDay(vehicle.latestDate)}
								</span>
							) : null}
						</span>
					) : null}
				</div>
			</button>
		</li>
	);
});
