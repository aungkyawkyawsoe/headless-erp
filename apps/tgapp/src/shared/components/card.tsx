import type { ReactNode } from 'react';

/**
 * The standard card shell — the app's floating surface.
 *
 * `rounded-2xl border border-border bg-card` was re-typed across dozens of
 * screens (and a second `rounded-xl` variant drifted in). `CARD_FRAME` is the
 * bare frame, `CARD_CLASS` the default surface with the soft shadow. A card that
 * needs a different frame (a dense ERP row, a hero) is a different component on
 * purpose — this is only the default surface.
 */
export const CARD_FRAME = 'rounded-2xl border border-border bg-card';
export const CARD_CLASS = `${CARD_FRAME} shadow-card`;

/** The DENSE frame — the tighter `rounded-xl` surface used by register rows,
 *  pickers and read-only tiles (the `erp-row`/`ledger`/`record-hero` family). */
export const DENSE_CARD_FRAME = 'rounded-xl border border-border bg-card';

/** The standard card as a `<section>`, with caller padding merged in. */
export function SectionCard({ className, children }: { className?: string; children: ReactNode }) {
	return <section className={`${CARD_CLASS} ${className ?? ''}`}>{children}</section>;
}
