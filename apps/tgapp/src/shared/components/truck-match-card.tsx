import type { ReactNode } from 'react';

import { CARD_FRAME } from './card';
import { BrandBadge, PlateChip } from './plate-chip';

/** The neutral "Open" chip — the status slot when there is no current record. */
export function OpenChip() {
	return (
		<span className="inline-flex items-center rounded-full border border-dashed border-border px-3.5 py-1.5 text-sub font-semibold leading-none text-muted-foreground">
			Open
		</span>
	);
}

/** The neutral "no record on file" hint line under the identity row. */
export function TruckMatchEmpty({ children }: { children: ReactNode }) {
	return <p className="px-4 py-3 text-sub font-medium leading-myanmar text-muted-foreground">{children}</p>;
}

interface TruckMatchCardProps {
	plate: string;
	brand?: string | null;
	/** The top-right status slot — a remaining-days pill, or `<OpenChip />`. */
	status: ReactNode;
	/** The whole-card button's accessible name. */
	hrefLabel: string;
	onOpen: () => void;
	/** The record's line below the dashed divider. */
	children: ReactNode;
}

/**
 * The kiosk truck-match card — a plate search hit with its current record. The
 * license and insurance kiosk rows were byte-for-byte identical apart from the
 * pill/line components and their types; this is the shared shell.
 */
export function TruckMatchCard({ plate, brand, status, hrefLabel, onOpen, children }: TruckMatchCardProps) {
	return (
		<li>
			<button
				type="button"
				onClick={onOpen}
				aria-label={hrefLabel}
				className={`block w-full overflow-hidden ${CARD_FRAME} py-1 text-left shadow-card transition-transform duration-150 outline-none active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
			>
				<div className="flex items-center justify-between gap-3 px-4 py-2.5">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<PlateChip>{plate}</PlateChip>
						{brand ? <BrandBadge>{brand}</BrandBadge> : null}
					</div>
					<span className="shrink-0">{status}</span>
				</div>
				<div aria-hidden className="border-t border-dashed border-border/70" />
				{children}
			</button>
		</li>
	);
}
