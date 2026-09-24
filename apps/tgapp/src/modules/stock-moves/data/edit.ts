import { MRO_LOCATIONS, policyOfModel } from '@/shared/mro';
import type { MroDocStatus, MroLocation, MroTracking } from '@/shared/mro';
import { transferDocStatusOf } from './status';
import type { MroTransferLineRow, MroTransferRow, TransferFormSeed, TransferLineSeed } from './types';

/**
 * The client's mirror of the ONE rule that decides whether a document can be
 * written at all: the collection's own
 * `writes.freeze_when { field: doc_status, values: ['confirmed','cancelled'] }`
 * (`schema-defs.json`) plus the engine's core doc_status rule that lets only a
 * draft reach `cancelled`. A `confirmed` move is POSTED and a `cancelled` one is
 * terminal, so BOTH answer 403 to any update.
 *
 * The detail page renders the form READ-ONLY for exactly those, so the screen
 * never offers an edit the server would refuse — the same reason the status is
 * read from the row rather than passed in by a caller.
 */
export function isTransferEditable(docStatus: MroDocStatus): boolean {
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

/** A stored `location` as a known store — an unknown/absent/blank value reads as
 *  NULL, i.e. "nothing chosen yet". The two callers take opposite sides of that
 *  deliberately: the SOURCE store falls back to the form's own default (so a real
 *  document never opens with an empty source), while the DESTINATION stays
 *  unchosen rather than inventing a store the document never named. */
function locationOf(value: unknown): MroLocation | null {
	const raw = typeof value === 'string' ? value.trim() : '';
	return MRO_LOCATIONS.find((option) => option.value === raw)?.value ?? null;
}

/** The stored `serials` column → the units. A JSON column, so the read may hand
 *  back either the decoded array or its text; anything unreadable is empty. */
function serialsOf(value: MroTransferLineRow['serials']): string[] {
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

/** ONE stored line → the form's row seed. `null` for a line that carries no
 *  `mro_item_model`: the editor cannot paint or re-submit such a row, and
 *  inventing a blank one would let a save quietly drop it. */
export function transferLineSeedOf(line: MroTransferLineRow): TransferLineSeed | null {
	const modelId = idOf(line.item_model);
	if (!modelId) return null;
	const model = typeof line.item_model === 'object' && line.item_model ? line.item_model : null;
	return {
		modelId,
		modelName: model ? model.name_en?.trim() || model.name_mm?.trim() || null : null,
		tracking: trackingOf(model),
		qty: Number(line.qty ?? 0),
		// The stored batch restriction is carried through untouched: it is a real
		// column the confirm uses to pick the lot, so dropping it here would silently
		// widen a line to FEFO on the next save.
		batchNo: line.batch_no?.trim() ?? '',
		serials: serialsOf(line.serials),
	};
}

/** The stored lines, in their stored order — the order the editor shows them in,
 *  so an edit cannot silently reorder a document by opening it. */
export function transferLineSeedsOf(lines: readonly MroTransferLineRow[]): TransferLineSeed[] {
	return lines.map(transferLineSeedOf).filter((seed): seed is TransferLineSeed => seed !== null);
}

/**
 * A document's header + its lines → the form's seed.
 *
 * The reporter / approver are deliberately NOT part of it: an edit never writes
 * `reported_by` (`actor_fields` — the engine stamps it, and re-sending it could
 * reassign the reporter), and `approved_by` is written by the confirm, not by this
 * form. So the seed is exactly what the form can change and nothing else.
 */
export function transferFormSeedOf(row: MroTransferRow, lines: readonly MroTransferLineRow[]): TransferFormSeed {
	return {
		id: row.id,
		transferDate: row.transfer_date?.trim() || null,
		fromLocation: locationOf(row.from_location) ?? 'main_store',
		toLocation: locationOf(row.to_location),
		note: row.note?.trim() ?? '',
		lines: transferLineSeedsOf(lines),
		docStatus: transferDocStatusOf(row.doc_status),
	};
}
