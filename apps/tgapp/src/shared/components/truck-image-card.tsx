import { Truck } from 'lucide-react';

import { DENSE_CARD_FRAME } from '@/shared/components/card';

/**
 * The **truck photo card** — the square tile every per-truck file screen leads
 * with (maintenance / incidents / fluids / licenses / insurances). It rides the
 * shared `veh_fleets` identity read (`fetchVehicleIdentity` projects `image`),
 * so the truck shows on EVERY open, and falls back to a truck glyph until a
 * photo is uploaded.
 */
export function TruckImageCard({ image, alt }: { image: string | null; alt: string }) {
	return (
		<div className={`${DENSE_CARD_FRAME} aspect-square w-full overflow-hidden shadow-card`}>
			{image ? (
				<img src={image} alt={`${alt} photo`} loading="lazy" className="h-full w-full object-cover" />
			) : (
				<div className="flex h-full w-full items-center justify-center bg-muted/40">
					<Truck className="size-10 text-muted-foreground/70" strokeWidth={1.5} aria-hidden />
				</div>
			)}
		</div>
	);
}
