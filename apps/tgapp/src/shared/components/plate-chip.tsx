import type { ReactNode } from 'react';

/**
 * The vehicle PLATE chip — the identity anchor shared by every vehicle card
 * (fleet / insurance / license / incident), the kiosk match rows and the ODO /
 * fluid vehicle rows. ONE definition for the chip that had been copied across
 * eight files.
 *
 * The plate is the app's DISPLAY identity (`font-display`, Exo 2): the truck id
 * is the one string a scan lands on, and a plate is always Latin/numeric by
 * contract, so a display face with no Myanmar cut can never see a Burmese glyph
 * here.
 */
export function PlateChip({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<span
			className={`inline-flex items-center rounded-md border border-border/70 bg-muted/40 px-2 py-1 font-display text-base font-semibold leading-none tracking-wider text-foreground ${className ?? ''}`}
		>
			{children}
		</span>
	);
}

/** The muted all-caps brand badge beside a plate chip (fleet / kiosk identities).
 *  Part of the SAME vehicle-identity cluster as the plate, so it carries the same
 *  display face — a brand name is Latin by contract. */
export function BrandBadge({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex h-5 items-center rounded-md border border-border/60 bg-muted/50 px-2 pt-px font-display text-meta font-semibold uppercase leading-none tracking-[0.14em] text-muted-foreground">
			{children}
		</span>
	);
}
