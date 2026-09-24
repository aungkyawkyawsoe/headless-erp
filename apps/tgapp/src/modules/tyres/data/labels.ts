import { mroItemModelLabel } from '@/shared/hooks/use-mro-item-models';

import type { TyreCardModel, TyreEventKind, TyreEventParty } from './types';

/**
 * The register card's display copy.
 *
 * A unit row names TWO things at once: the item NAME it belongs to ("Tyre", "Jack")
 * and the MODEL of that name ("11R 22.5") — one alone reads as an orphan (a bare
 * size code says nothing, and every row under a kind would print the same word).
 */

/** The last-resort copy for a unit whose SKU master says nothing at all. */
const KIND_FALLBACK: Record<TyreCardModel['kind'], string> = {
	tyre: 'Tyre',
	asset: 'Equipment',
};

/**
 * The ONE card title for a register unit: the item name over its MODEL — “Tyre ·
 * 11R 22.5”, the same label the item pickers show (`mroItemModelLabel`), so a SKU
 * reads identically on the card and in the form it was chosen in.
 *
 * The concatenation is NOT re-derived here: `mroItemModelLabel` owns it, including
 * the dedupe that matters in this catalog — a model literally named “Tyre 11R22.5”
 * under the item name “Tyre” must not read “Tyre · Tyre 11R22.5”. This adds only
 * what a CARD needs beyond a picker's label: a fallback when the SKU is unnamed
 * (a picker row always has a SKU to show, a card may not), so a row stays
 * identifiable instead of printing the em dash.
 *
 * The result is PLAIN TEXT — truncation, weight and the badge beside it belong to
 * the component.
 */
export function unitTitleOf(unit: Pick<TyreCardModel, 'kind' | 'itemNameEn' | 'itemNameMm' | 'modelName'>): string {
	const itemName = (unit.itemNameEn ?? unit.itemNameMm ?? '').trim();
	const model = (unit.modelName ?? '').trim();
	// No SKU name to show: the item name alone still says what this unit IS.
	if (!model) return itemName || KIND_FALLBACK[unit.kind];
	return mroItemModelLabel({ name_en: model, group_name_en: itemName || null });
}

/**
 * The ONE rule for the RIGHT half of a lifecycle row — the OTHER person behind the
 * movement, or nobody at all.
 *
 * The row's LEFT side already names the reporter, so this slot holds exactly one of
 * two facts: the AUTHORITY behind the movement (the approver recorded on the document
 * the event cites), or the PERSON it was handed to (a store issue / a governed move to
 * an employee). Precedence, and why:
 *   1. the APPROVER of the governing document — the authority behind the movement;
 *   2. the person it was HANDED TO — a mover that names a person says more than one
 *      that says only that no approval applied;
 *   3. `null` — the row renders no right-hand side at all.
 *
 * `null` is the common case and it is the honest one: nothing had to approve a kiosk
 * fit, an inspection or a receipt, and their `ref_doc` is the unit's own SERIAL rather
 * than any document's `display_number`. Stamping "No approval needed" over those rows
 * was pure noise — it restated what the row's kind already says and buried the rows
 * that DO carry a name, the only thing this slot exists to state.
 *
 * A name equal to the REPORTER's is skipped: the left side already names them, and a
 * person is not their own authority twice over.
 */
export function eventPartyOf(input: {
	kind: TyreEventKind;
	/** The reporter the row's LEFT side names — a party equal to them is skipped. */
	reporter: string | null;
	approvedBy: string | null;
	handedTo: string | null;
}): TyreEventParty | null {
	const { kind, reporter, approvedBy, handedTo } = input;
	// 1. The authority behind the movement.
	if (approvedBy && approvedBy !== reporter) return { label: 'Approved by', name: approvedBy };
	// 2. The person it went to — an issue or a governed move to an employee.
	if (handedTo && handedTo !== reporter && (kind === 'issued' || kind === 'reissued')) {
		return { label: kind === 'issued' ? 'Issued to' : 'Transferred to', name: handedTo };
	}
	// 3. Nobody but the reporter is on the row.
	return null;
}
