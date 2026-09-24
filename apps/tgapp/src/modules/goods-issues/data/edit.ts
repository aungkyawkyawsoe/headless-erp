import { MRO_LOCATIONS, policyOfModel } from '@/shared/mro';
import type { MroDocStatus, MroLocation, MroTracking } from '@/shared/mro';
import { isOutboundType } from './meta';
import { outboundDocStatusOf } from './status';
import type { MroOutboundLineRow, MroOutboundRow, MroOutboundType, OutboundFormSeed, OutboundLineSeed } from './types';

/**
 * The client's mirror of the ONE rule that decides whether a document can be
 * written at all: the collection's own
 * `writes.freeze_when { field: doc_status, values: ['confirmed','cancelled'] }`
 * (`schema-defs.json`) plus the engine's core doc_status rule that lets only a
 * draft reach `cancelled`. A `confirmed` issue is POSTED and a `cancelled` one is
 * terminal, so BOTH answer 403 to any update.
 *
 * The detail page renders the form READ-ONLY for exactly those, so the screen
 * never offers an edit the server would refuse — the same reason the status is
 * read from the row rather than passed in by a caller (the route's `?type=` only
 * says which TAB the operator came from, never what the document is).
 */
export function isOutboundEditable(docStatus: MroDocStatus): boolean {
	return docStatus === 'draft';
}

/** The doc's KIND — anything unexpected reads as the default `goods_issue`. */
function typeOf(value: unknown): MroOutboundType {
	return isOutboundType(value) ? value : 'goods_issue';
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
function serialsOf(value: MroOutboundLineRow['serials']): string[] {
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

/** The HOLDER's display label off the relation the document actually set — the
 *  truck's plate (`to_vehicle`) or the person's name (`to_employee`). Null for an
 *  unexpanded bare id, because a UUID is not an answer to "issued to whom". */
function holderLabelOf(value: unknown): string | null {
	if (!value || typeof value !== 'object') return null;
	const row = value as { plate_no?: unknown; name_en?: unknown };
	const label = typeof row.plate_no === 'string' ? row.plate_no : typeof row.name_en === 'string' ? row.name_en : '';
	return label.trim() || null;
}

/** ONE stored line → the form's row seed. `null` for a line that carries no
 *  `mro_item_model`: the editor cannot paint or re-submit such a row, and
 *  inventing a blank one would let a save quietly drop it. */
export function outboundLineSeedOf(line: MroOutboundLineRow): OutboundLineSeed | null {
	const modelId = idOf(line.item_model);
	if (!modelId) return null;
	const model = typeof line.item_model === 'object' && line.item_model ? line.item_model : null;
	return {
		modelId,
		modelName: model ? model.name_en?.trim() || model.name_mm?.trim() || null : null,
		tracking: trackingOf(model),
		qty: Number(line.qty ?? 0),
		unitPrice: line.unit_price ?? null,
		serials: serialsOf(line.serials),
	};
}

/** The stored lines, in their stored order — the order the editor shows them in,
 *  so an edit cannot silently reorder a document by opening it. */
export function outboundLineSeedsOf(lines: readonly MroOutboundLineRow[]): OutboundLineSeed[] {
	return lines.map(outboundLineSeedOf).filter((seed): seed is OutboundLineSeed => seed !== null);
}

/**
 * A document's header + its lines → the form's seed.
 *
 * The HOLDER is read off the column the document actually set — `to_vehicle`
 * first, else `to_employee` — and the KIND of holder becomes the seed's mode.
 * The two columns are mutually exclusive by the confirm service (it refuses a
 * write-off carrying one, and the form only ever sends one), so reading the pair
 * as a single mode is what keeps “which picker does this document use?” answered
 * in exactly one place.
 */
export function outboundFormSeedOf(row: MroOutboundRow, lines: readonly MroOutboundLineRow[]): OutboundFormSeed {
	const type = typeOf(row.type);
	const vehicleId = idOf(row.to_vehicle);
	const employeeId = vehicleId ? null : idOf(row.to_employee);
	const destinationKind = vehicleId ? 'fleet' : employeeId ? 'employee' : null;
	const holder = destinationKind === 'fleet' ? row.to_vehicle : destinationKind === 'employee' ? row.to_employee : null;
	return {
		id: row.id,
		type,
		effectiveDate: row.effective_date?.trim() || null,
		location: locationOf(row.location),
		note: row.note?.trim() ?? '',
		requestId: idOf(row.request),
		destinationKind,
		destinationId: vehicleId ?? employeeId,
		destinationLabel: holderLabelOf(holder),
		lines: outboundLineSeedsOf(lines),
		docStatus: outboundDocStatusOf(row.doc_status),
	};
}
