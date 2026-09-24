import type { MmbixClient } from '@mmbix/sdk';

import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { LIST_PAGE_SIZE, SEARCH_LIMIT } from '@/shared/constants';
import { fetchAllPages } from '@/shared/api/fetch-all';
import { sdk } from '@/shared/api/sdk';
import { MRO_LOCATION_LABELS, postMro } from '@/shared/mro';
import type { MroLocation } from '@/shared/mro';
import { personOf } from '@/modules/store-requests/data/types';
import { outboundFormSeedOf } from './edit';
import { isOutboundType } from './meta';
import { outboundDocStatusOf } from './status';
import type {
	CreateOutboundDraft,
	MroOutboundLineRow,
	MroOutboundRow,
	MroOutboundType,
	OutboundCardModel,
	OutboundFormSeed,
	UpdateOutboundDraft,
} from './types';

/**
 * The outbound flow's typed client — the same local-cast pattern as the
 * store-requests / mro-categories modules: the app-wide client is typed against
 * the placeholder generated `Schema`, so reads here go through a locally-typed
 * view of the same instance. Only the MRO master + document collections are
 * read; there are no shared-master joins (the card renders header fields only).
 */
type OpsSchema = {
	mro_outbounds: MroOutboundRow;
	mro_outbound_lines: MroOutboundLineRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** The header projection every list read shares (one doc = one card). */
const HEADER_FIELDS = [
	'id',
	'display_number',
	'doc_status',
	'type',
	'effective_date',
	'location',
	'request',
	// The goods-issue DESTINATION — read through DOTTED paths (the same rule as the
	// line's `item_model`): the expanded label the card shows, resolved server-side.
	'to_vehicle.plate_no',
	'to_employee.name_en',
	'issued_by',
	'note',
	'total_qty',
	'line_count',
	'total_amount',
	'confirmed_at',
	'created_at',
] as const;

/** The line projection the detail page reads. The `item_model` m2o is requested
 *  through DOTTED paths (`name_en` / `name_mm` / `item_name.tracking`) — asking
 *  for the bare relation ALONGSIDE a dotted path makes the engine narrow the
 *  expansion to only the requested subfields, which drops the names and leaves
 *  every line blank. */
const LINE_FIELDS = [
	'id',
	'item_model.name_en',
	'item_model.name_mm',
	'item_model.item_name.tracking',
	'qty',
	'unit_price',
	'serials',
	'note',
] as const;

/** Resolve a linked source requisition for the card — the engine expands the
 *  `request` m2o to the related `mro_requisitions` row; a bare id (shouldn't
 *  occur on these reads) still yields a usable link id. `display_number` is the
 *  `REQ-…` number the compact reference line shows. */
function requestRefOf(row: MroOutboundRow) {
	if (!row.request) return null;
	if (typeof row.request === 'string') {
		return { id: row.request, label: row.request, requisitionStatus: undefined };
	}
	const id = row.request.id ?? null;
	const label = row.request.display_number?.trim() || row.request.id || null;
	return {
		id,
		label,
		requisitionStatus: row.request.requisition_status ?? undefined,
	};
}

/** The label of the holder a goods issue handed its units to — the truck's plate
 *  or the person's name. Null when the doc names no destination at all (a
 *  write-off / disposal), and when the reference is an unexpanded bare id with
 *  nothing to show (never the raw UUID — an id is not an answer). */
function destinationOf(row: MroOutboundRow): string | null {
	const vehicle = row.to_vehicle;
	const employee = row.to_employee;
	const labelOf = (ref: { plate_no?: string | null; name_en?: string | null } | string | null | undefined): string | null => {
		if (!ref || typeof ref === 'string') return null;
		return ref.plate_no?.trim() || ref.name_en?.trim() || null;
	};
	return labelOf(vehicle) ?? labelOf(employee) ?? null;
}

/** One header row → the list card (labels resolved against the shared maps). */
export function outboundCardOf(row: MroOutboundRow): OutboundCardModel {
	const type = isOutboundType(row.type) ? row.type : 'goods_issue';
	return {
		id: row.id,
		displayNumber: row.display_number?.trim() || null,
		docStatus: outboundDocStatusOf(row.doc_status),
		type,
		location: row.location?.trim() || null,
		locationLabel: row.location ? (MRO_LOCATION_LABELS[row.location] ?? null) : null,
		effectiveDate: row.effective_date?.trim() || null,
		requestRef: requestRefOf(row),
		issuedBy: personOf(row.issued_by),
		note: row.note?.trim() || null,
		totalQty: row.total_qty ?? null,
		lineCount: row.line_count ?? null,
		totalAmount: row.total_amount ?? null,
		destination: destinationOf(row),
	};
}

/** One page of ONE type + store's documents — `LIST_PAGE_SIZE` rows, newest first. */
export async function fetchOutboundPage(
	type: MroOutboundType,
	location: MroLocation,
	cursor?: string,
): Promise<CursorPage<OutboundCardModel>> {
	const res = await ops.items('mro_outbounds').list({
		fields: HEADER_FIELDS,
		filter: { type: { _eq: type }, location: { _eq: location } },
		sort: '-created_at',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return {
		rows: res.data.map(outboundCardOf),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/** The toolbar search — a server-side `?search=` read across the doc's text
 *  fields (`display_number` + `note`), still scoped to the page's type + store
 *  and mapped to the SAME card as the list so results always match it. */
export async function fetchOutboundSearch(type: MroOutboundType, location: MroLocation, query: string): Promise<OutboundCardModel[]> {
	const res = await ops.items('mro_outbounds').list({
		fields: HEADER_FIELDS,
		filter: { type: { _eq: type }, location: { _eq: location } },
		search: query,
		limit: SEARCH_LIMIT,
	});
	return res.data.map(outboundCardOf);
}

/**
 * The header projection the DOCUMENT PAGE reads: the list header's facts (labels,
 * lifecycle, the money it carries) PLUS the raw relation ids the form's pickers
 * must be seeded with.
 *
 * The `.id` paths sit beside the already-requested `to_vehicle.plate_no` /
 * `to_employee.name_en` deliberately: asking for a bare relation ALONGSIDE a
 * dotted path makes the engine narrow the expansion to only the paths named, so
 * both sides are spelled out — otherwise the holder picker would seed from an id
 * the wire never sent.
 */
const EDITOR_FIELDS = [...HEADER_FIELDS, 'to_vehicle.id', 'to_employee.id'] as const;

/** The document page's read model: the issue as FACTS, and the same issue as form
 *  FIELDS. One read, so the card and the form can never describe two different
 *  revisions of the document. */
export interface OutboundDocEditor {
	card: OutboundCardModel;
	seed: OutboundFormSeed;
}

/**
 * ONE outbound document for the detail page — its header + its child lines in one
 * request pair, mapped twice: `card` for the display face, `seed` for the prefilled
 * edit form.
 *
 * The two are read TOGETHER on purpose. The form seeds its state once at mount, so
 * the page mounts it only after this resolves — a form that mounted on the header
 * alone and then received lines would render an empty document and save it back
 * empty.
 */
export async function fetchOutboundDocEditor(id: string): Promise<OutboundDocEditor | null> {
	const [header, lines] = await Promise.all([
		ops.items('mro_outbounds').list({
			fields: EDITOR_FIELDS,
			filter: { id: { _eq: id } },
			limit: 1,
		}),
		fetchOutboundLines(id),
	]);
	const row = header.data[0];
	if (!row) return null;
	return { card: outboundCardOf(row), seed: outboundFormSeedOf(row, lines) };
}

/** One outbound document's child lines — read per `parent_id` (the lines of a
 *  single header), so the card under ပမာဏ can expand to the item detail.
 *  Direct table reads resolve each line's `item_model` m2o into its expanded
 *  `{ id, name_en, name_mm, tracking }` row (so no separate name lookup is needed). */
export async function fetchOutboundLines(parentId: string): Promise<MroOutboundLineRow[]> {
	return fetchAllPages((cursor, pageSize) =>
		ops.items('mro_outbound_lines').list({
			fields: LINE_FIELDS,
			filter: { parent_id: { _eq: parentId } },
			sort: 'id',
			limit: pageSize,
			cursor,
		}),
	);
}

/**
 * Create a DRAFT outbound document — header + nested lines in one request
 * (`POST /api/entities/mro_outbounds`). Stock moves only when the user later
 * confirms the draft from the list (`/api/mro/outbounds/:id/confirm`).
 *
 * The nested `lines` child key is not part of the header row's local type — the
 * cast mirrors the module-level `as unknown as MmbixClient` boundary.
 */
export async function createOutboundDoc(draft: CreateOutboundDraft): Promise<MroOutboundRow> {
	return ops.items('mro_outbounds').create(draft as unknown as Partial<MroOutboundRow>);
}

/**
 * SAVE an edited DRAFT — header + the complete nested line set
 * (`PUT /api/entities/mro_outbounds/:id`).
 *
 * `lines` is a child table: the engine REPLACES its children with the payload
 * inside the same request, so a line the operator removed on screen really leaves
 * the draft and re-sending the untouched rows is idempotent. There is no per-line
 * diff to get wrong, which is why the form always holds the whole set.
 *
 * A posted or cancelled issue can never come through here: the collection's own
 * `writes.freeze_when { doc_status: ['confirmed','cancelled'] }` answers 403 to ANY
 * update — the reason the form renders read-only for one.
 */
export async function updateOutboundDoc(id: string, draft: UpdateOutboundDraft): Promise<MroOutboundRow> {
	return ops.items('mro_outbounds').update(id, draft as unknown as Partial<MroOutboundRow>);
}

/**
 * NOTE — there is no `cancelOutboundDraft` here on purpose. Cancelling is ONE verb
 * across the stock documents (a draft flips, a POSTED issue is reversed, a replay
 * is a no-op) and a posted document cannot be reached by a generic `doc_status`
 * write at all (`writes.freeze_when`), so it goes through
 * `POST /api/mro/outbounds/:id/cancel` — `mroApi.cancel('outbounds', id)`.
 * See `@/shared/hooks/use-doc-cancel`.
 */

/**
 * Confirm (issue) a draft outbound — `POST /api/mro/outbounds/:id/confirm` with
 * the issuing employee id (login) as `issued_by`, so the service can attribute
 * the stock move and — when the doc carries a `request` ref — recompute that
 * request's accumulated `issued_qty` and advance its lifecycle to
 * `partially_issued` / `fulfilled`. Goes through the shared `postMro` write
 * helper (Bearer auth + an Idempotency-Key), so a retried issue can't move stock
 * twice.
 */
export function confirmOutbound(docId: string, issuerId: string): Promise<unknown> {
	return postMro(`/mro/outbounds/${docId}/confirm`, { issued_by: issuerId });
}

/** The browser-safe inverse of store-requests' `encodePrefillJson` — a UTF-8
 *  base64 JSON back to its original value (the goods-issue create `?prefill=`).
 *  Replaces the Node-only global `Buffer` so the module stays browser-safe. */
export function decodePrefillJson<T>(raw: string): T | null {
	try {
		return JSON.parse(decodeURIComponent(atob(raw.trim()))) as T;
	} catch {
		return null;
	}
}
