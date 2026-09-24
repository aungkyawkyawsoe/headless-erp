import type { MmbixClient } from '@mmbix/sdk';

import { fetchAllPages } from '@/shared/api/fetch-all';
import { sdk } from '@/shared/api/sdk';
import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { LIST_PAGE_SIZE, SEARCH_LIMIT } from '@/shared/constants';
import { MRO_LOCATION_LABELS, postMro } from '@/shared/mro';
import { adjustmentDocStatusOf, type AdjustmentStatusFilterValue } from './status';
import { adjustmentFormSeedOf } from './edit';
import { personOf } from './types';
import type {
	AdjustmentCardModel,
	AdjustmentFormSeed,
	CreateAdjustmentDraft,
	MroAdjustmentLineRow,
	MroAdjustmentRow,
	UpdateAdjustmentDraft,
} from './types';

/**
 * The adjustments module's typed client — the same local-cast pattern as every
 * sibling MRO module: the app-wide client is typed against the placeholder
 * typegen `Schema` (no `mro_*` collections), so entity reads here go through a
 * locally-typed view of the same instance. Only the engine-native adjustment
 * collections + the item-model master are read. The approve/confirm route is
 * NOT entity CRUD — it goes through the raw `/api/mro/adjustments/:id/confirm`
 * fetch mirroring `shared/mro.ts`'s `mroFetch`, with the Bearer token from
 * `shared/auth`, posting the adjustment-only `{ approved_by }` (an m2o id) body.
 * The API expands `reported_by`/`approved_by` on read — the card reads the
 * reporter/approver name + avatar straight off those expanded m2o rows.
 */
type OpsSchema = {
	mro_adjustments: MroAdjustmentRow;
	mro_adjustment_lines: MroAdjustmentLineRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** The header projection every list read shares (one doc = one card). */
const HEADER_FIELDS = [
	'id',
	'display_number',
	'doc_status',
	'location',
	'adjustment_date',
	'description',
	'reported_by',
	'approved_by',
	'total_qty',
	'line_count',
	'confirmed_at',
	'created_at',
] as const;

/** The engine filter the list/search scope by — absent for `'all'`, else a
 *  server-side `doc_status` equality. Pushing it to the API (instead of
 *  filtering the loaded rows) keeps paging honest: a status with no rows on
 *  page 1 must still page onward to find them. `doc_status` is a NOT NULL
 *  system column defaulting to `draft`, so an `_eq` can never miss a row. */
function statusScope(status: AdjustmentStatusFilterValue) {
	return status === 'all' ? undefined : { doc_status: { _eq: status } };
}

/** The line projection a card's expandable detail reads. The `item_model` m2o is
 *  requested through DOTTED paths (`name_en` / `name_mm` / `item_name.tracking`)
 *  — asking for the bare relation ALONGSIDE a dotted path makes the engine narrow
 *  the expansion to only the requested subfields, which drops the names and leaves
 *  every line blank. The policy lives on the item NAME, not the SKU. */
const LINE_FIELDS = [
	'id',
	'parent_id',
	'item_model.name_en',
	'item_model.name_mm',
	'item_model.item_name.tracking',
	'direction',
	'qty',
	'batch_no',
	'expiry_date',
	'unit_cost',
	'serials',
	'note',
] as const;

/** One header row → the list card (labels resolved against the shared maps). */
export function adjustmentCardOf(row: MroAdjustmentRow): AdjustmentCardModel {
	return {
		id: row.id,
		displayNumber: row.display_number?.trim() || null,
		docStatus: adjustmentDocStatusOf(row.doc_status),
		location: row.location?.trim() || null,
		locationLabel: row.location ? (MRO_LOCATION_LABELS[row.location] ?? null) : null,
		adjustmentDate: row.adjustment_date?.trim() || null,
		description: row.description?.trim() || null,
		reported: personOf(row.reported_by),
		approved: personOf(row.approved_by),
		totalQty: row.total_qty ?? null,
		lineCount: row.line_count ?? null,
	};
}

/** One page of adjustment documents — EVERY store, scoped to one `status`
 *  (`'all'` = unfiltered), newest first (the ONE flat list, cursor-paginated at
 *  `LIST_PAGE_SIZE`). */
export async function fetchAdjustmentPage(status: AdjustmentStatusFilterValue, cursor?: string): Promise<CursorPage<AdjustmentCardModel>> {
	const res = await ops.items('mro_adjustments').list({
		fields: HEADER_FIELDS,
		filter: statusScope(status),
		sort: '-created_at',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return {
		rows: res.data.map(adjustmentCardOf),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/** The toolbar search — a server-side `?search=` read across the doc's text
 *  fields (`display_number` + `description`), scoped to the SAME status as the
 *  list and mapped to the SAME card, so results always match it. */
export async function fetchAdjustmentSearch(status: AdjustmentStatusFilterValue, query: string): Promise<AdjustmentCardModel[]> {
	const res = await ops.items('mro_adjustments').list({
		fields: HEADER_FIELDS,
		filter: statusScope(status),
		search: query,
		limit: SEARCH_LIMIT,
	});
	return res.data.map(adjustmentCardOf);
}

/**
 * The document page's read model: the correction as FACTS, and the same
 * correction as form FIELDS. One read, so the card and the form can never
 * describe two different revisions of the document.
 *
 * The header projection is the LIST's own `HEADER_FIELDS` — every field the form
 * seed needs (`location`, `adjustment_date`, `description`, `doc_status`) is
 * already on it, so unlike the outbound page there is no extra relation id to
 * spell out, and the card face and the form are literally the same row mapped
 * twice.
 */
export interface AdjustmentDocEditor {
	card: AdjustmentCardModel;
	seed: AdjustmentFormSeed;
}

/**
 * ONE adjustment document for the detail page — its header + its child lines in
 * one request pair, mapped twice: `card` for the display face, `seed` for the
 * prefilled edit form.
 *
 * The two are read TOGETHER on purpose. The form seeds its state once at mount,
 * so the page mounts it only after this resolves — a form that mounted on the
 * header alone and then received lines would render an empty document and save
 * it back empty.
 */
export async function fetchAdjustmentDocEditor(id: string): Promise<AdjustmentDocEditor | null> {
	const [header, lines] = await Promise.all([
		ops.items('mro_adjustments').list({
			fields: HEADER_FIELDS,
			filter: { id: { _eq: id } },
			limit: 1,
		}),
		fetchAdjustmentLines(id),
	]);
	const row = header.data[0];
	if (!row) return null;
	return { card: adjustmentCardOf(row), seed: adjustmentFormSeedOf(row, lines) };
}

/** Create a DRAFT adjustment (header + nested lines in one engine-native POST —
 *  `POST /api/entities/mro_adjustments`). Stock only moves when a different
 *  user later AUTHORIZES the draft from the list (confirmAdjustment). */
export async function createAdjustmentDoc(draft: CreateAdjustmentDraft): Promise<MroAdjustmentRow> {
	return ops.items('mro_adjustments').create(draft as unknown as Partial<MroAdjustmentRow>);
}

/**
 * SAVE an edited DRAFT — header + the complete nested line set
 * (`PUT /api/entities/mro_adjustments/:id`).
 *
 * `lines` is a child table: the engine REPLACES its children with the payload
 * inside the same request, so a line the operator removed on screen really leaves
 * the draft and re-sending the untouched rows is idempotent. There is no per-line
 * diff to get wrong, which is why the form always holds the whole set.
 *
 * The `reported_by` m2o is NOT part of the payload (it does not exist on
 * `UpdateAdjustmentDraft`): an edit must never rewrite who filed the report — the
 * two-person rule (`approved_by != reported_by`) is built on that column, and the
 * engine strips it from a non-admin update anyway, so a payload that carried it
 * would mean one thing to an admin and another to everyone else.
 *
 * An approved or cancelled adjustment can never come through here: the
 * collection's own `writes.freeze_when { doc_status: ['confirmed','cancelled'] }`
 * answers 403 to ANY update — the reason the form renders read-only for one.
 */
export async function updateAdjustmentDoc(id: string, draft: UpdateAdjustmentDraft): Promise<MroAdjustmentRow> {
	return ops.items('mro_adjustments').update(id, draft as unknown as Partial<MroAdjustmentRow>);
}

/** One adjustment doc's child lines — read per `parent_id` (the lines of a single
 *  header) for the document page's edit seed. Direct table reads resolve each
 *  line's `item_model` m2o into its expanded `{ id, name_en, name_mm, tracking }`
 *  row. Module-private: the lines of a document are only ever read WITH its header
 *  (`fetchAdjustmentDocEditor`), because the form is seeded from both at once. */
async function fetchAdjustmentLines(parentId: string): Promise<MroAdjustmentLineRow[]> {
	return fetchAllPages((cursor, pageSize) =>
		ops.items('mro_adjustment_lines').list({
			fields: LINE_FIELDS,
			filter: { parent_id: { _eq: parentId } },
			sort: 'id',
			limit: pageSize,
			cursor,
		}),
	);
}

/** The engine's success envelope is `{ success, data }`; errors `{ error }`. */

/**
 * Approve (apply) a draft adjustment — `POST /api/mro/adjustments/:id/confirm`
 * with the approving employee id. The engine needs an approver DIFFERENT from
 * the reporter (409 otherwise) and 400s when no approver is passed. `approved_by`
 * is an m2o — only the employee id goes over the wire; the API expands it
 * (name + avatar) on the refreshed read. Goes through the shared `postMro` write
 * helper (Bearer auth + an Idempotency-Key), so a retried confirm can't apply
 * twice.
 */
export function confirmAdjustment(docId: string, approverId: string): Promise<unknown> {
	return postMro(`/mro/adjustments/${docId}/confirm`, { approved_by: approverId });
}
