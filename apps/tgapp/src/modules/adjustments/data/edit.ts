import { MRO_LOCATIONS, policyOfModel } from '@/shared/mro';
import type { MroDocStatus, MroLocation, MroTracking } from '@/shared/mro';
import { adjustmentDocStatusOf } from './status';
import type { AdjustmentFormSeed, AdjustmentLineSeed, MroAdjustmentLineRow, MroAdjustmentRow } from './types';

/**
 * The client's mirror of the ONE rule that decides whether an adjustment can be
 * written at all: the collection's own
 * `writes.freeze_when { field: doc_status, values: ['confirmed','cancelled'] }`
 * (`apps/api/src/domain-modules/mro/schema-defs.json`) plus the engine's core
 * doc_status rule that lets only a draft reach `cancelled`. An APPROVED
 * adjustment is applied and a cancelled one is terminal, so BOTH answer 403 to
 * any update.
 *
 * The detail page renders the form READ-ONLY for exactly those, so the screen
 * never offers a write the server would refuse — the same reason the status is
 * read from the row rather than passed in by a caller.
 */
export function isAdjustmentEditable(docStatus: MroDocStatus): boolean {
	return docStatus === 'draft';
}

/** A relation cell as an id — a bare id, an expanded `{ id }` row, or nothing.
 *  Handles both shapes on purpose: the engine returns whichever the `?fields=`
 *  projection asked for, and a picker seeded with `undefined` would silently
 *  look unset. */
function idOf(value: unknown): string | null {
	if (typeof value === 'string') return value.trim() || null;
	if (value && typeof value === 'object' && 'id' in value) {
		const id = (value as { id?: unknown }).id;
		return typeof id === 'string' && id.trim() ? id : null;
	}
	return null;
}

/** A stored `location` as a known store — an unknown/absent value falls back to
 *  the default store, the same safe direction the store picker takes. */
function locationOf(value: unknown): MroLocation {
	const raw = typeof value === 'string' ? value.trim() : '';
	return MRO_LOCATIONS.find((option) => option.value === raw)?.value ?? 'main_store';
}

/** The stored `serials` column → the units. A JSON column, so the read may hand
 *  back either the decoded array or its text; anything unreadable is empty. */
function serialsOf(value: MroAdjustmentLineRow['serials']): string[] {
	if (Array.isArray(value)) return value.map((unit) => `${unit}`.trim()).filter(Boolean);
	if (typeof value !== 'string' || !value.trim()) return [];
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.map((unit) => `${unit}`.trim()).filter(Boolean) : [];
	} catch {
		return [];
	}
}

/** The SKU's tracking policy off the expanded `item_model` relation — the policy
 *  lives on the item NAME, so `policyOfModel` reads the nested `item_name`. */
function trackingOf(value: unknown): MroTracking {
	return value && typeof value === 'object' ? policyOfModel(value as Parameters<typeof policyOfModel>[0]) : 'standard';
}

/** A stored `direction` — anything but an explicit `remove` reads as `add`, the
 *  same default the column's own options carry. */
function directionOf(value: unknown): 'add' | 'remove' {
	return value === 'remove' ? 'remove' : 'add';
}

/**
 * ONE stored line → the form's row seed. `null` for a line that carries no
 * `mro_item_model`: the editor could neither paint nor re-submit such a row, and
 * inventing a blank one would let a save quietly drop it.
 *
 * The batch identity is read for an `add` ONLY. On a `remove` the engine ignores
 * `batch_no` outright — it allocates FEFO and records the lots it actually took in
 * `mro_adjustment_lots` — so a stored value there is a claim the stock ledger never
 * honoured. Seeding it would hand that claim back to the operator to re-submit, and
 * dropping it is the honest answer: the line's real provenance is its lot trace,
 * not a number typed beside it.
 */
export function adjustmentLineSeedOf(line: MroAdjustmentLineRow): AdjustmentLineSeed | null {
	const modelId = idOf(line.item_model);
	if (!modelId) return null;
	const model = typeof line.item_model === 'object' && line.item_model ? line.item_model : null;
	const direction = directionOf(line.direction);
	const namedLot = direction === 'add';
	return {
		modelId,
		modelName: model ? model.name_en?.trim() || model.name_mm?.trim() || null : null,
		tracking: trackingOf(model),
		direction,
		qty: Number(line.qty ?? 0),
		batchNo: namedLot ? (line.batch_no?.trim() ?? '') : '',
		expiryDate: namedLot ? (line.expiry_date?.trim() ?? '') : '',
		unitCost: line.unit_cost ?? null,
		serials: serialsOf(line.serials),
	};
}

/** The stored lines, in their stored order — the order the editor shows them in,
 *  so an edit cannot silently reorder a document by opening it. */
export function adjustmentLineSeedsOf(lines: readonly MroAdjustmentLineRow[]): AdjustmentLineSeed[] {
	return lines.map(adjustmentLineSeedOf).filter((seed): seed is AdjustmentLineSeed => seed !== null);
}

/** A document's header + its lines → the form's seed. */
export function adjustmentFormSeedOf(row: MroAdjustmentRow, lines: readonly MroAdjustmentLineRow[]): AdjustmentFormSeed {
	return {
		id: row.id,
		adjustmentDate: row.adjustment_date?.trim() || null,
		location: locationOf(row.location),
		description: row.description?.trim() ?? '',
		lines: adjustmentLineSeedsOf(lines),
		docStatus: adjustmentDocStatusOf(row.doc_status),
	};
}
