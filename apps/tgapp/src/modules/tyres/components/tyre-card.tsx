import { memo } from 'react';
import { CARD_FRAME } from '@/shared/components/card';

import type { TyreCardModel } from '../data/types';
import { TyreStatusPill as StatusPill } from './tyre-status-pill';

/**
 * Tyre card — ONE serial-unit row for the တာယာ Serial units lookup
 * (`/app/tyres/serial`). A lean per-unit snapshot of the REAL MRO serial stock
 * (one `mro_stock_serials` row per physical serial-tracked tyre):
 *
 *  ┌────────────────────────────────────────────────┐
 *  │ 265 70R 19.5 F                        [Issued] │
 *  │ S/N: TR-1TLR-4882-396                         │
 *  │ ────────────────────────────────────────────── │
 *  │ [1TLR-4882]  steer-left · Vehicle store        │
 *  └────────────────────────────────────────────────┘
 *
 *  - **Header** — the tyre model (SKU name) bold on the left, with the unit's
 *    serial lifecycle pill (In Stock / Issued / Scrapped) on the right;
 *  - **Serial** — the unit's serial number, the register's primary identity;
 *  - **Footer** — the bound vehicle's plate in a plate-style chip (a vehicle
 *    register convention) + its fitting slot when the tyre is mounted, with the
 *    holding store label alongside; units with no plate just list the store.
 *
 * English-first technical labels; NO chevron (display-only today).
 */

/** The footer's meta line — plate chip + slot when mounted, else just the store. */
function UnitFooter({ tyre }: { tyre: TyreCardModel }) {
	const plateSlot = tyre.plateNo ? (
		<span className="inline-flex items-baseline gap-1.5">
			<span className="inline-flex shrink-0 items-center rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-meta font-semibold leading-none tracking-wider text-foreground">
				{tyre.plateNo}
			</span>
			{tyre.slot && <span className="text-meta font-medium text-muted-foreground">{tyre.slot}</span>}
		</span>
	) : null;
	return (
		<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
			<div className="flex min-w-0 items-center gap-2">
				{plateSlot}
				{tyre.locationLabel && <span className="text-meta font-medium text-muted-foreground">{tyre.locationLabel}</span>}
			</div>
			{!plateSlot && !tyre.locationLabel && <span className="text-meta font-medium italic text-muted-foreground">Not fitted</span>}
		</div>
	);
}

/** The tyre SKU + serial identity is shown on the card header already. */
interface TyreCardProps {
	/** The `mro_stock_serials` unit — the register card data. */
	tyre: TyreCardModel;
	/** Called when the card is tapped — the page opens the tyre's full-screen
	 *  lifecycle-history page. */
	onOpen?: (tyre: TyreCardModel) => void;
}

export const TyreCard = memo(function TyreCard({ tyre, onOpen }: TyreCardProps) {
	return (
		<li>
			<button
				type="button"
				onClick={() => onOpen?.(tyre)}
				className={`block w-full ${CARD_FRAME} p-4 text-left shadow-card transition-transform duration-150 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-ring outline-none`}
				aria-label={`${tyre.modelName ?? tyre.serialNo ?? 'Tyre'} — view history`}
			>
				{/* Header — the tyre model bold with the serial lifecycle pill top-right. */}
				<div className="flex min-w-0 items-center justify-between gap-3">
					<span className="min-w-0 truncate text-key font-bold leading-tight tracking-tight text-foreground capitalize">
						{tyre.modelName ?? '—'}
					</span>
					<StatusPill status={tyre.status} />
				</div>

				{/* Serial — the unit's identity, under the model line. */}
				<p className="mt-1.5 truncate text-xs font-medium text-muted-foreground">
					<span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">S/N</span> {tyre.serialNo ?? '—'}
				</p>

				{/* Footer — the mounted plate (+ slot) or just the holding store. */}
				<div className="mt-3 border-t border-dashed border-border/70 pt-2.5">
					<UnitFooter tyre={tyre} />
				</div>
			</button>
		</li>
	);
});
