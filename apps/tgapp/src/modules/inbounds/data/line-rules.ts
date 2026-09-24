import type { MroTracking } from '@/shared/mro';

/**
 * The pure rules a draft receipt LINE obeys — no React, no network. Kept out of
 * the form component so the submit gate is unit-testable in isolation: the form
 * renders, these decide whether a row can become a payload row.
 */

/** A parsable number from the qty input — null when blank/unparsable. */
export function parseQty(raw: string): number | null {
	if (raw.trim() === '') return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}

/** The typed serials — split on commas (English/Burmese) or whitespace. */
export function parseSerials(text: string): string[] {
	return text
		.split(/[\s,၊]+/)
		.map((serial) => serial.trim())
		.filter(Boolean);
}

/** One typed unit that was REFUSED, and where it already lives. */
export interface SerialConflict {
	serial: string;
	/** The other line it is already on (`item 2`), or null when it repeats inside
	 *  the list it was being added to. */
	where: string | null;
}

/** What an Add did: the list afterwards, and what it would not take. */
export interface SerialAddOutcome {
	serials: string[];
	conflicts: SerialConflict[];
}

/**
 * Add the unit(s) a typist typed or pasted to a line's serial list.
 *
 * `parseSerials` splits the raw entry — ONE unit, or a whole column pasted in one
 * go — and a unit is REFUSED rather than re-added when it is already on this line
 * or anywhere else in the document: a serial number names ONE physical unit, so a
 * repeat either double-counts stock or makes the CONFIRM 409 long after the
 * typing is done. Comparison is case-insensitive, because `ty-1` and `TY-1` are
 * one unit to the engine's uniqueness check and must be one here too.
 *
 * Deliberately NOT capped at the line's qty: the count has to match the quantity,
 * and blocking the serial side would trap an operator whose QUANTITY is the typo.
 * The form shows which way the mismatch runs instead.
 */
export function addSerials(
	current: readonly string[],
	entry: string,
	others: readonly { serial: string; where: string }[] = [],
): SerialAddOutcome {
	const serials = [...current];
	const conflicts: SerialConflict[] = [];
	const normalize = (serial: string) => serial.trim().toUpperCase();
	for (const serial of parseSerials(entry)) {
		const candidate = normalize(serial);
		if (serials.some((existing) => normalize(existing) === candidate)) {
			conflicts.push({ serial, where: null });
			continue;
		}
		const elsewhere = others.find((other) => normalize(other.serial) === candidate);
		if (elsewhere) {
			conflicts.push({ serial, where: elsewhere.where });
			continue;
		}
		serials.push(serial);
	}
	return { serials, conflicts };
}

/** The shape the completeness rule reads (the form's draft row satisfies it). */
export interface InboundLineShape {
	modelId: string | null;
	qty: string;
	serialsText: string;
}

/**
 * May this row be submitted? A row needs a model and a positive qty; a
 * serial row additionally needs its typed units to match the qty exactly.
 */
export function inboundLineIsComplete(line: InboundLineShape, tracking: MroTracking): boolean {
	if (line.modelId === null) return false;
	const qty = parseQty(line.qty);
	if (qty === null || qty <= 0) return false;
	if (tracking === 'serial') return Number.isInteger(qty) && parseSerials(line.serialsText).length === qty;
	return true;
}
