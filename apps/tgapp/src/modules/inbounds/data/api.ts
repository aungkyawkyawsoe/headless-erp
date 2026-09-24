import type { MmbixClient } from '@mmbix/sdk';

import { fetchAllPages } from '@/shared/api/fetch-all';
import { sdk } from '@/shared/api/sdk';
import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { LIST_PAGE_SIZE, SEARCH_LIMIT } from '@/shared/constants';
import { MRO_LOCATION_LABELS } from '@/shared/mro';
import { deleteMro, postMro } from '@/shared/mro';
import type { MroLocation } from '@/shared/mro';
import { inboundDocStatusOf } from './status';
import { inboundFormSeedOf } from './edit';
import type { InboundPaymentModel, InboundPaymentStatus, MroInboundPaymentRow } from './payments';
import type {
	CreateInboundDraft,
	InboundCardModel,
	InboundFormSeed,
	InboundType,
	MroInboundLineRow,
	MroInboundRow,
	UpdateInboundDraft,
} from './types';

/**
 * The inbounds module's typed client — the same local-cast pattern as every
 * sibling MRO module: the app-wide client is typed against the placeholder
 * typegen `Schema` (no `mro_*` collections), so entity reads here go through a
 * locally-typed view of the same instance. Only the engine-native inbound doc
 * collections are read here; the supplier + item-model masters are the SHARED
 * whole-set reads (`shared/hooks/use-mro-masters` / `use-mro-item-models`) and
 * the supplier master's write is the shared `createMroSupplier`, so this module
 * keeps no supplier surface of its own.
 */
type OpsSchema = {
	mro_inbounds: MroInboundRow;
	mro_inbound_lines: MroInboundLineRow;
	mro_inbound_payments: MroInboundPaymentRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** The header projection every list read shares (one doc = one card). */
const HEADER_FIELDS = [
	'id',
	'display_number',
	'doc_status',
	'type',
	'purchase_date',
	'location',
	'supplier.name',
	'handed_by.name_en',
	'total_amount',
	'paid_amount',
	'payment_status',
	'fully_paid_on',
	'note',
	'total_qty',
	'line_count',
	'confirmed_at',
	'created_at',
] as const;

/** The line projection a card's expandable detail reads. The `item_model` m2o is
 *  requested through DOTTED paths (`name_en` / `name_mm` / `item_name.tracking`)
 *  — asking for the bare relation ALONGSIDE a dotted path makes the engine narrow
 *  the expansion to only the requested subfields, which drops the names and leaves
 *  every line blank. The policy lives on the item NAME, not the SKU. */
const LINE_FIELDS = [
	'id',
	'item_model.name_en',
	'item_model.name_mm',
	'item_model.item_name.tracking',
	'qty',
	'unit_price',
	'batch_no',
	'expiry_date',
	'serials',
	'location',
	'note',
] as const;

/** One header row → the list card (labels resolved against the shared maps). */
export function inboundCardOf(row: MroInboundRow): InboundCardModel {
	const type = row.type === 'legacy' || row.type === 'return' ? row.type : 'purchase';
	const supplier = typeof row.supplier === 'object' && row.supplier ? row.supplier.name?.trim() || null : null;
	const handedBy = typeof row.handed_by === 'object' && row.handed_by ? row.handed_by.name_en?.trim() || null : null;
	return {
		id: row.id,
		displayNumber: row.display_number?.trim() || null,
		docStatus: inboundDocStatusOf(row.doc_status),
		type,
		location: row.location?.trim() || null,
		locationLabel: row.location ? (MRO_LOCATION_LABELS[row.location] ?? null) : null,
		purchaseDate: row.purchase_date?.trim() || null,
		supplierName: supplier,
		handedByName: handedBy,
		note: row.note?.trim() || null,
		totalQty: row.total_qty ?? null,
		lineCount: row.line_count ?? null,
		totalAmount: row.total_amount ?? null,
		paidAmount: row.paid_amount ?? null,
		paymentStatus: paymentStatusOf(row.payment_status),
		fullyPaidOn: row.fully_paid_on?.trim() || null,
	};
}

/** The header's `payment_status` as a known status — anything else (including a
 *  pre-migration row) reads as `unpaid`, the safe direction on a money figure. */
function paymentStatusOf(value: unknown): InboundPaymentStatus {
	return value === 'paid' || value === 'partial' ? value : 'unpaid';
}

/**
 * ONE receipt's payment ledger, newest payment first — what the card's payment
 * sheet renders and what makes "which day we paid how much" answerable. Ledger
 * rows are engine-owned mirrors of real payments; the receipt's `paid_amount` /
 * `payment_status` / `fully_paid_on` are derived from exactly this set.
 */
export async function fetchInboundPayments(inboundId: string): Promise<InboundPaymentModel[]> {
	const res = await ops.items('mro_inbound_payments').list({
		fields: PAYMENT_FIELDS,
		filter: { parent_id: { _eq: inboundId } },
		sort: '-paid_on',
		limit: LIST_PAGE_SIZE,
	});
	return res.data.map(paymentModelOf);
}

/**
 * The ledger projection — ONE list, shared by the read and the create response.
 * Narrow on purpose: the sheet shows the DAY, the amount and who booked it, so
 * `method` / `reference` are not even pulled off the wire (their owner is Studio /
 * the CLI / imports, which file through the generic collection API).
 */
const PAYMENT_FIELDS = ['id', 'parent_id', 'paid_on', 'amount', 'note', 'recorded_by.name_en', 'created_at'] as const;

function paymentModelOf(row: MroInboundPaymentRow): InboundPaymentModel {
	const recorder = typeof row.recorded_by === 'object' && row.recorded_by ? row.recorded_by.name_en?.trim() || null : null;
	return {
		id: row.id,
		paidOn: row.paid_on?.trim() || null,
		amount: Number(row.amount ?? 0),
		note: row.note?.trim() || null,
		recordedByName: recorder,
	};
}

/**
 * FILE one payment against a receipt (the `mro_inbound_payments` ledger).
 *
 * Goes through `POST /api/mro/inbounds/:id/payments` rather than the generic
 * entity create: the route runs the SAME engine write (so every validation and
 * policy applies) and then AWAITS the receipt's mirror derivation, so the
 * response already carries the new `paid_amount` / `payment_status` /
 * `fully_paid_on` — a money figure the operator's screen must never render stale.
 * The recorder is stamped from the session by the engine
 * (`policies.actor_fields`), so a client can never book a payment as someone else.
 *
 * The payload is exactly the two facts the operator enters — the DAY and the
 * AMOUNT. `method` is schema-required with a declared default, so the ENGINE
 * fills it; the mini app neither asks for nor displays it.
 */
export async function createInboundPayment(input: {
	parentId: string;
	paidOn: string;
	amount: number;
	note?: string;
}): Promise<InboundPaymentModel> {
	const row = await postMro<MroInboundPaymentRow>(`/mro/inbounds/${input.parentId}/payments`, {
		paid_on: input.paidOn,
		amount: input.amount,
		...(input.note?.trim() ? { note: input.note.trim() } : {}),
	});
	return paymentModelOf(row);
}

/**
 * REMOVE a wrong ledger entry (soft delete — the row leaves the live set and the
 * receipt's mirror is re-derived). The money columns are FROZEN against edits, so
 * correcting a mistake is exactly this: remove the entry, then file the right one
 * — never rewrite what was actually paid.
 *
 * Goes through `DELETE /api/mro/inbounds/:id/payments/:paymentId` rather than the
 * generic entity delete, for the same reason FILING goes through its POST twin:
 * the generic API is RBAC-gated on the ledger collection, and no operator role
 * carries `delete` there (the standard grant set is read/write/create/submit), so
 * a real storekeeper met `You do not have "delete" permission on
 * "mro_inbound_payments"`. The route gates on `write` for the RECEIPT — the
 * collection whose money changes — and answers with the re-derived mirror.
 */
export async function deleteInboundPayment(inboundId: string, paymentId: string): Promise<void> {
	await deleteMro(`/mro/inbounds/${encodeURIComponent(inboundId)}/payments/${encodeURIComponent(paymentId)}`);
}

/** One page of ONE type + store's inbound documents — `LIST_PAGE_SIZE` rows, newest first. */
export async function fetchInboundPage(type: InboundType, location: MroLocation, cursor?: string): Promise<CursorPage<InboundCardModel>> {
	const res = await ops.items('mro_inbounds').list({
		fields: HEADER_FIELDS,
		filter: { type: { _eq: type }, location: { _eq: location } },
		sort: '-created_at',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return {
		rows: res.data.map(inboundCardOf),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/** The toolbar search — a server-side `?search=` read across the doc's text
 *  fields (`display_number` + `note`), still scoped to the page's inbound type
 *  + store and mapped to the SAME card as the list so results always match it. */
export async function fetchInboundSearch(type: InboundType, location: MroLocation, query: string): Promise<InboundCardModel[]> {
	const res = await ops.items('mro_inbounds').list({
		fields: HEADER_FIELDS,
		filter: { type: { _eq: type }, location: { _eq: location } },
		search: query,
		limit: SEARCH_LIMIT,
	});
	return res.data.map(inboundCardOf);
}

/**
 * The header projection the DOCUMENT PAGE reads: the list header's facts (money,
 * lifecycle, counterparty names) PLUS the raw counterparty ids the form's pickers
 * must be seeded with, and the draft-only `paid_at_receipt` flag.
 *
 * The `.id` paths sit beside the already-requested `supplier.name` /
 * `handed_by.name_en` deliberately: asking for a bare relation ALONGSIDE a dotted
 * path makes the engine narrow the expansion to only the paths named, so both
 * sides are spelled out — otherwise the pickers would seed from an id the wire
 * never sent.
 */
const EDITOR_FIELDS = [...HEADER_FIELDS, 'supplier.id', 'handed_by.id', 'paid_at_receipt'] as const;

/** The document page's read model: the receipt as FACTS, and the same receipt as
 *  form FIELDS. One read, so the card and the form can never describe two
 *  different revisions of the document. */
export interface InboundDocEditor {
	card: InboundCardModel;
	seed: InboundFormSeed;
}

/**
 * ONE inbound document for the detail page — its header + its child lines in one
 * request pair, mapped twice: `card` for the money/lifecycle face, `seed` for the
 * prefilled edit form.
 *
 * The two are read TOGETHER on purpose. The form seeds its state once at mount,
 * so the page mounts it only after this resolves — a form that mounted on the
 * header alone and then received lines would render an empty document and save it
 * back empty.
 */
export async function fetchInboundDocEditor(id: string): Promise<InboundDocEditor | null> {
	const [header, lines] = await Promise.all([
		ops.items('mro_inbounds').list({
			fields: EDITOR_FIELDS,
			filter: { id: { _eq: id } },
			limit: 1,
		}),
		fetchInboundLines(id),
	]);
	const row = header.data[0];
	if (!row) return null;
	return { card: inboundCardOf(row), seed: inboundFormSeedOf(row, lines) };
}

/**
 * SAVE an edited DRAFT — header + the complete nested line set
 * (`PUT /api/entities/mro_inbounds/:id`).
 *
 * `lines` is a child table: the engine REPLACES its children with the payload
 * inside the same request, so a line the operator removed on screen really leaves
 * the draft and re-sending the untouched rows is idempotent. There is no
 * per-line diff to get wrong, which is why the form always holds the whole set.
 *
 * A confirmed receipt can never come through here: `writes.freeze_when
 * { doc_status: ['confirmed'] }` answers 403 to ANY update of a posted receipt —
 * the reason the form renders read-only for one.
 */
export async function updateInboundDoc(id: string, draft: UpdateInboundDraft): Promise<MroInboundRow> {
	return ops.items('mro_inbounds').update(id, draft as unknown as Partial<MroInboundRow>);
}

/** One inbound document's child lines — read per `parent_id` (the lines of a
 *  single header). Direct table reads resolve each line's `item_model` m2o into
 *  its expanded `{ id, name_en, name_mm, tracking }` row (so no separate name
 *  lookup is needed). */
export async function fetchInboundLines(parentId: string): Promise<MroInboundLineRow[]> {
	return fetchAllPages((cursor, pageSize) =>
		ops.items('mro_inbound_lines').list({
			fields: LINE_FIELDS,
			filter: { parent_id: { _eq: parentId } },
			sort: 'id',
			limit: pageSize,
			cursor,
		}),
	);
}

/**
 * Create a DRAFT inbound document — header + nested lines in one request
 * (`POST /api/entities/mro_inbounds`). Stock lands only when the user later
 * confirms the draft from the list (`/api/mro/inbounds/:id/confirm`).
 */
export async function createInboundDoc(draft: CreateInboundDraft): Promise<MroInboundRow> {
	return ops.items('mro_inbounds').create(draft as unknown as Partial<MroInboundRow>);
}

/**
 * NOTE — there is no `cancelInboundDraft` here on purpose. Cancelling is ONE verb
 * with ONE meaning across the stock documents (a draft flips, a POSTED receipt is
 * reversed, a replay is a no-op), so it goes through
 * `POST /api/mro/inbounds/:id/cancel` — `mroApi.cancel('inbounds', id)` — rather
 * than a generic `doc_status` write. See `@/shared/hooks/use-doc-cancel`.
 */
