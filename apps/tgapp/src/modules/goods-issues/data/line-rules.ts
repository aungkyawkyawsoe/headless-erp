import type { MroTracking } from '@/shared/mro';

/**
 * The pure rules an outbound draft LINE obeys — no React, no network. Kept out of
 * the form component so the submit gate is unit-testable in isolation (the same
 * seam `inbounds/data/line-rules.ts` uses for the receipt side): the form renders,
 * these decide whether a row can become a payload row.
 */

/** A parsable number from a qty input — null when blank/unparsable. */
export function parseQty(raw: string): number | null {
	if (raw.trim() === '') return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}

/** The row shape every rule below reads (the form's draft row satisfies it). */
export interface OutboundLineShape {
	/** The typed quantity input — a STANDARD / BATCH row's quantity. */
	qty: string;
	/** The picked units — a SERIAL row's quantity. */
	serials: readonly string[];
}

/**
 * ONE row's effective quantity — the SINGLE derivation behind the running total,
 * the submit gate and the submit payload, so a row can never read one way in the
 * total and another in the payload.
 *
 * A SERIAL row's quantity IS its picked units. That is the fix for "I can only
 * select one serial": the form used to hold the quantity twice — as the typed
 * `qty` AND as `serials.length` — and treated the typed one as a CAP on the picks,
 * so the first pick wrote `qty = 1` and locked the picker at a single unit.
 * Deriving the quantity from the picks makes the disagreement unrepresentable
 * (the engine refuses `serials.length !== qty` with a 409 at confirm).
 */
export function outboundLineQty(line: OutboundLineShape, tracking: MroTracking): number | null {
	if (tracking === 'serial') return line.serials.length > 0 ? line.serials.length : null;
	return parseQty(line.qty);
}

/** May this row become a payload row? A row needs an item and a positive quantity. */
export function outboundLineIsComplete(line: OutboundLineShape & { modelId: string | null }, tracking: MroTracking): boolean {
	if (line.modelId === null) return false;
	const qty = outboundLineQty(line, tracking);
	return qty !== null && qty > 0;
}
