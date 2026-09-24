import type { MmbixClient } from '@mmbix/sdk';

import { fetchAllPages } from '@/shared/api/fetch-all';
import { sdk } from '@/shared/api/sdk';
import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { LIST_PAGE_SIZE, SEARCH_LIMIT } from '@/shared/constants';
import { MRO_LOCATION_LABELS, postMro } from '@/shared/mro';
import { transferFormSeedOf } from './edit';
import { transferDocStatusOf } from './status';
import type { TransferStatusFilterValue } from './status';
import { personOf } from './types';
import type {
	CreateTransferDraft,
	MroTransferLineRow,
	MroTransferRow,
	TransferCardModel,
	TransferFormSeed,
	UpdateTransferDraft,
} from './types';

/**
 * The stock-moves module's typed client — the same local-cast pattern as every
 * sibling MRO module: the app-wide client is typed against the placeholder
 * typegen `Schema` (no `mro_*` collections), so entity reads here go through a
 * locally-typed view of the same instance. Only the engine-native transfer doc
 * collection + the item-model master are read.
 */
type OpsSchema = {
	mro_transfers: MroTransferRow;
	mro_transfer_lines: MroTransferLineRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** The header projection every list read shares (one doc = one card). */
const HEADER_FIELDS = [
	'id',
	'display_number',
	'doc_status',
	'from_location',
	'to_location',
	'transfer_date',
	'note',
	'reported_by',
	'approved_by',
	'total_qty',
	'line_count',
	'confirmed_at',
	'created_at',
] as const;

/** One header row → the list card (labels resolved against the shared maps). */
export function transferCardOf(row: MroTransferRow): TransferCardModel {
	return {
		id: row.id,
		displayNumber: row.display_number?.trim() || null,
		docStatus: transferDocStatusOf(row.doc_status),
		fromLabel: row.from_location ? (MRO_LOCATION_LABELS[row.from_location] ?? row.from_location) : null,
		toLabel: row.to_location ? (MRO_LOCATION_LABELS[row.to_location] ?? row.to_location) : null,
		transferDate: row.transfer_date?.trim() || null,
		note: row.note?.trim() || null,
		reported: personOf(row.reported_by),
		approved: personOf(row.approved_by),
		totalQty: row.total_qty ?? null,
		lineCount: row.line_count ?? null,
	};
}

/** The engine filter the list/search scope by — absent for `'all'`, else a
 *  server-side `doc_status` equality. Pushing it to the API (instead of
 *  filtering the loaded rows) keeps paging honest: a status whose rows sit past
 *  page 1 must still page onward to find them. `doc_status` is a NOT NULL system
 *  column defaulting to `draft`, so an `_eq` can never miss a row. */
function statusScope(status: TransferStatusFilterValue) {
	return status === 'all' ? undefined : { doc_status: { _eq: status } };
}

/** One page of transfer documents, scoped to one `status` (`'all'` = unfiltered)
 *  — `LIST_PAGE_SIZE` rows, newest first. */
export async function fetchTransferPage(status: TransferStatusFilterValue, cursor?: string): Promise<CursorPage<TransferCardModel>> {
	const res = await ops.items('mro_transfers').list({
		fields: HEADER_FIELDS,
		filter: statusScope(status),
		sort: '-created_at',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return {
		rows: res.data.map(transferCardOf),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/** The toolbar search — a server-side `?search=` read across the doc's text
 *  fields (`display_number` + `note`), scoped to the SAME status as the list and
 *  mapped to the SAME card, so results always match it. */
export async function fetchTransferSearch(status: TransferStatusFilterValue, query: string): Promise<TransferCardModel[]> {
	const res = await ops.items('mro_transfers').list({
		fields: HEADER_FIELDS,
		filter: statusScope(status),
		search: query,
		limit: SEARCH_LIMIT,
	});
	return res.data.map(transferCardOf);
}

/** The line projection the document page reads. The `item_model` m2o is requested
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
	'batch_no',
	'serials',
	'note',
] as const;

/**
 * The header projection the DOCUMENT PAGE reads. It is deliberately the SAME set
 * the list reads: every field this form edits (`transfer_date`, both locations,
 * the note) already rides `HEADER_FIELDS`, and the two people columns are
 * display-only — an edit never writes `reported_by` (see `UpdateTransferDraft`)
 * and `approved_by` belongs to the confirm. There is no relation picker on the
 * header at all, so nothing needs a dotted `.id` path the way the inbound /
 * outbound editors do for their counterparty / destination pickers.
 */
export const EDITOR_FIELDS = HEADER_FIELDS;

/** The document page's read model: the move as FACTS, and the same move as form
 *  FIELDS. One read, so the card and the form can never describe two different
 *  revisions of the document. */
export interface TransferDocEditor {
	card: TransferCardModel;
	seed: TransferFormSeed;
}

/**
 * ONE transfer document for the detail page — its header + its child lines in one
 * request pair, mapped twice: `card` for the display face, `seed` for the prefilled
 * edit form.
 *
 * The two are read TOGETHER on purpose. The form seeds its state once at mount, so
 * the page mounts it only after this resolves — a form that mounted on the header
 * alone and then received lines would render an empty document and save it back
 * empty.
 */
export async function fetchTransferDocEditor(id: string): Promise<TransferDocEditor | null> {
	const [header, lines] = await Promise.all([
		ops.items('mro_transfers').list({
			fields: EDITOR_FIELDS,
			filter: { id: { _eq: id } },
			limit: 1,
		}),
		fetchTransferLines(id),
	]);
	const row = header.data[0];
	if (!row) return null;
	return { card: transferCardOf(row), seed: transferFormSeedOf(row, lines) };
}

/** One transfer document's child lines — read per `parent_id` (the lines of a
 *  single header), so the form can seed every moved SKU. The direct read resolves
 *  each line's `item_model` m2o into its expanded row plus the nested
 *  `item_name.tracking` (no separate name lookup needed). */
async function fetchTransferLines(parentId: string): Promise<MroTransferLineRow[]> {
	return fetchAllPages((cursor, pageSize) =>
		ops.items('mro_transfer_lines').list({
			fields: LINE_FIELDS,
			filter: { parent_id: { _eq: parentId } },
			sort: 'id',
			limit: pageSize,
			cursor,
		}),
	);
}

/**
 * Create a DRAFT transfer document — header + nested lines in one request
 * (`POST /api/entities/mro_transfers`). Stock moves only when the user later
 * confirms the draft from the list (`/api/mro/transfers/:id/confirm`).
 */
export async function createTransferDoc(draft: CreateTransferDraft): Promise<MroTransferRow> {
	return ops.items('mro_transfers').create(draft as unknown as Partial<MroTransferRow>);
}

/**
 * SAVE an edited DRAFT — header + the complete nested line set
 * (`PUT /api/entities/mro_transfers/:id`).
 *
 * `lines` is a child table: the engine REPLACES its children with the payload
 * inside the same request, so a line the operator removed on screen really leaves
 * the draft and re-sending the untouched rows is idempotent. There is no per-line
 * diff to get wrong, which is why the form always holds the whole set.
 *
 * A posted or cancelled move can never come through here: the collection's own
 * `writes.freeze_when { doc_status: ['confirmed','cancelled'] }` answers 403 to ANY
 * update — the reason the form renders read-only for one. The payload carries no
 * `reported_by` (the type cannot express it): the collection declares it an
 * `actor_field`, so an update would let an admin reassign the reporter.
 */
export async function updateTransferDoc(id: string, draft: UpdateTransferDraft): Promise<MroTransferRow> {
	return ops.items('mro_transfers').update(id, draft as unknown as Partial<MroTransferRow>);
}

/**
 * Confirm a draft transfer — `POST /api/mro/transfers/:id/confirm` with the
 * approving employee id. The engine needs an approver DIFFERENT from the
 * reporter (409 otherwise) and 400s when no approver is passed. `approved_by`
 * is an m2o — only the employee id goes over the wire; the API expands it
 * (name + avatar) on the refreshed read. Goes through the shared `postMro` write
 * helper (Bearer auth + an Idempotency-Key), so a retried confirm can't move
 * stock twice.
 */
export function confirmTransferDoc(docId: string, approverId: string): Promise<unknown> {
	return postMro(`/mro/transfers/${docId}/confirm`, { approved_by: approverId });
}
