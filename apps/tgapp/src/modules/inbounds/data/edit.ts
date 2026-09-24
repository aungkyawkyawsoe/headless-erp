import { MRO_LOCATIONS, policyOfModel } from '@/shared/mro';
import type { MroDocStatus, MroLocation, MroTracking } from '@/shared/mro';
import { inboundDocStatusOf } from './status';
import type { InboundFormSeed, InboundLineSeed, InboundType, MroInboundLineRow, MroInboundRow } from './types';

/**
 * The client's mirror of the ONE rule that decides whether a document can be
 * written at all: the collection's own
 * `writes.freeze_when { field: doc_status, values: ['confirmed'] }`
 * (`schema-defs.json`) plus the engine's core doc_status rule that lets only a
 * draft reach `cancelled`. A `confirmed` row is POSTED and a `cancelled` one is
 * terminal, so BOTH answer 403 to any update.
 *
 * The detail page renders the form READ-ONLY for exactly those, so the screen
 * never offers an edit the server would refuse — the same reason the status is
 * read from the row rather than passed in by a caller.
 */
export function isInboundEditable(docStatus: MroDocStatus): boolean {
	return docStatus === 'draft';
}

/** The doc's KIND — anything unexpected reads as the default `purchase`. */
function typeOf(value: unknown): InboundType {
	return value === 'legacy' || value === 'return' ? value : 'purchase';
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

/** The counterparty's display name off the same cell (`supplier.name` on a
 *  vendor, `handed_by.name_en` on an employee). */
function nameOf(value: unknown): string | null {
	if (!value || typeof value !== 'object') return null;
	const row = value as { name?: unknown; name_en?: unknown };
	const name = typeof row.name === 'string' ? row.name : typeof row.name_en === 'string' ? row.name_en : '';
	return name.trim() || null;
}

/** A stored `location` as a known store — an unknown/absent value falls back to
 *  the default store, the same safe direction the store picker takes. */
function locationOf(value: unknown): MroLocation {
	const raw = typeof value === 'string' ? value.trim() : '';
	return MRO_LOCATIONS.find((option) => option.value === raw)?.value ?? 'main_store';
}

/** The stored `serials` column → the units. A JSON column, so the read may hand
 *  back either the decoded array or its text; anything unreadable is empty. */
function serialsOf(value: MroInboundLineRow['serials']): string[] {
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
export function inboundLineSeedOf(line: MroInboundLineRow): InboundLineSeed | null {
	const modelId = idOf(line.item_model);
	if (!modelId) return null;
	const model = typeof line.item_model === 'object' && line.item_model ? line.item_model : null;
	return {
		modelId,
		modelName: model ? model.name_en?.trim() || model.name_mm?.trim() || null : null,
		tracking: trackingOf(model),
		qty: Number(line.qty ?? 0),
		unitPrice: line.unit_price ?? null,
		batchNo: line.batch_no?.trim() ?? '',
		expiryDate: line.expiry_date?.trim() ?? '',
		serials: serialsOf(line.serials),
	};
}

/** The stored lines, in their stored order — the order the editor shows them in,
 *  so an edit cannot silently reorder a document by opening it. */
export function inboundLineSeedsOf(lines: readonly MroInboundLineRow[]): InboundLineSeed[] {
	return lines.map(inboundLineSeedOf).filter((seed): seed is InboundLineSeed => seed !== null);
}

/**
 * A document's header + its lines → the form's seed. The counterparty is read
 * from the column the KIND owns (`supplier` for a purchase, `handed_by`
 * otherwise) rather than “whichever is set”: the two are mutually exclusive by
 * schema, and reading the wrong one would seed a picker with the other kind's
 * counterparty.
 */
export function inboundFormSeedOf(row: MroInboundRow, lines: readonly MroInboundLineRow[]): InboundFormSeed {
	const type = typeOf(row.type);
	const party = type === 'purchase' ? row.supplier : row.handed_by;
	return {
		id: row.id,
		type,
		purchaseDate: row.purchase_date?.trim() || null,
		partyId: idOf(party),
		partyName: nameOf(party),
		location: locationOf(row.location),
		note: row.note?.trim() ?? '',
		paidAtReceipt: row.paid_at_receipt === true,
		lines: inboundLineSeedsOf(lines),
		docStatus: inboundDocStatusOf(row.doc_status),
	};
}
