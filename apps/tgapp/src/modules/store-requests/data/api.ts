import { serializeQuery, type MmbixClient } from '@mmbix/sdk';

import { sdk } from '@/shared/api/sdk';
import { LIST_PAGE_SIZE, SEARCH_LIMIT } from '@/shared/constants';
import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { MRO_LOCATION_LABELS, postMro } from '@/shared/mro';
import { formatRelativeTime } from '@/shared/time/myanmar';
import type { MroLocation } from '@/shared/mro';
import { requisitionStatusOf, REQUISITION_APPROVAL_SCOPE, type RequisitionApprovalStatus, type RequisitionFilterValue } from './status';
import {
	personOf,
	type CreateRequisitionInput,
	type MroRequisitionCardModel,
	type MroRequisitionDetailModel,
	type MroRequisitionLineRow,
	type MroRequisitionRow,
	type RequisitionStatus,
	type RequisitionView,
} from './types';

/**
 * The store-requests module's typed client — the same local-cast pattern as
 * every sibling module: the app-wide client is typed against the placeholder
 * `Schema = {}`, so entity reads/writes here go through a locally-typed view
 * of the same instance. The module's own reads touch `mro_requisitions` (the
 * SKU directory its create form picks from is the SHARED `['mro','item-models']`
 * read — see `shared/hooks/use-mro-item-models`).
 */
type OpsSchema = {
	mro_requisitions: MroRequisitionRow;
	mro_requisition_lines: MroRequisitionLineRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** The list/search projection — every column the requisition card renders.
 *  Exported so the maintenances module (which re-renders these records as the
 *  truck-maintenance history) can read the same rows with the same columns.
 *  `requested_by` / `approved_by` / `vehicle` use DOT-paths: a bare m2o arrives
 *  as a uuid (the requester/approver name would be null), while `name_en`/
 *  `name_mm`/`avatar`/`plate_no` make the engine expand the related row (its
 *  `id` is always included — see `RelationResolver.pruneRow`). */
export const REQUISITION_FIELDS = [
	'id',
	'display_number',
	'doc_status',
	'location',
	'request_date',
	'requested_by.name_en',
	'requested_by.name_mm',
	'requested_by.avatar',
	'approved_by.name_en',
	'approved_by.name_mm',
	'approved_by.avatar',
	'requisition_status',
	'close_reason',
	'issued_qty',
	'note',
	'vehicle.plate_no',
	'total_qty',
	'line_count',
	'confirmed_at',
	'created_at',
] as const;

/** The child-lines projection — every column the item summary / detail lines need.
 *  `item_model.item_name.*` is a depth-2 m2o expansion (the SKU → its parent item
 *  NAME), which is where the card label's group word AND the tracking policy live. */
const REQUISITION_LINE_FIELDS = [
	'id',
	'parent_id',
	'item_model.name_en',
	'item_model.name_mm',
	'item_model.item_name.name_en',
	'item_model.item_name.name_mm',
	'item_model.item_name.tracking',
	'qty',
	'note',
] as const;

/** Resolve a requisition's `vehicle` m2o (requested as the DOTTED `vehicle.plate_no`
 *  field, so the API joins the related `veh_fleets` row in the SAME read) to the
 *  bound truck's id + plate. A bare uuid (dangling FK) still yields the id. */
function vehicleRefOf(vehicle: MroRequisitionRow['vehicle']): { vehicleId: string | null; vehiclePlate: string | null } {
	const expanded = vehicle && typeof vehicle === 'object' ? vehicle : null;
	const vehicleId = expanded ? expanded.id : typeof vehicle === 'string' ? vehicle : null;
	const expandedPlate = expanded?.plate_no?.trim() || '';
	return { vehicleId: vehicleId ?? null, vehiclePlate: expandedPlate || null };
}

/** "5 Sep 2026" — the request date in English, the raw date string as fallback. */
function requestDateLabelOf(date: string | null | undefined): string | null {
	if (!date) return null;
	const parsed = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return date;
	return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed);
}

/** "1 week ago" — the relative `created_at` age, null when unset/unparseable. */
function ageLabelOf(createdAt: string | null | undefined): string | null {
	if (!createdAt) return null;
	const ms = Date.parse(createdAt);
	if (Number.isNaN(ms)) return null;
	return formatRelativeTime(ms);
}

/** "3 items · Total 12" — null until the doc has computed totals (drafts
 *  carry none until confirm writes them). */
function summaryLabelOf(lineCount: number | null | undefined, totalQty: number | null | undefined): string | null {
	const parts: string[] = [];
	if (lineCount) parts.push(`${lineCount} item${lineCount === 1 ? '' : 's'}`);
	if (totalQty) parts.push(`Total ${totalQty}`);
	return parts.length > 0 ? parts.join(' · ') : null;
}

/** Map one requisition page to cards — number, lifecycle status, actor names,
 *  issued-so-far progress, location label, date, totals summary, note + age.
 *  Exported for the same maintenances join reads (the kiosk truck matches map
 *  their rows through this ONE card mapper). */
export function requisitionCardsOf(rows: MroRequisitionRow[]): MroRequisitionCardModel[] {
	return rows.map((row) => {
		const docStatus = row.doc_status === 'confirmed' || row.doc_status === 'cancelled' ? row.doc_status : 'draft';
		const vehicle = vehicleRefOf(row.vehicle);
		return {
			id: row.id,
			displayNumber: row.display_number?.trim() || null,
			status: docStatus,
			requisitionStatus: requisitionStatusOf(row.requisition_status, docStatus),
			requestedBy: personOf(row.requested_by),
			approvedBy: personOf(row.approved_by),
			vehicleId: vehicle.vehicleId,
			vehiclePlate: vehicle.vehiclePlate,
			issuedQty: typeof row.issued_qty === 'number' ? row.issued_qty : null,
			requestedQty: typeof row.total_qty === 'number' ? row.total_qty : null,
			locationLabel: row.location ? (MRO_LOCATION_LABELS[row.location] ?? row.location) : null,
			requestDateLabel: requestDateLabelOf(row.request_date),
			lineCount: row.line_count ?? null,
			totalQty: row.total_qty ?? null,
			summaryLabel: summaryLabelOf(row.line_count, row.total_qty),
			note: row.note?.trim() || null,
			closeReason: row.close_reason?.trim() || null,
			ageLabel: ageLabelOf(row.created_at),
		};
	});
}

/**
 * The toolbar search — a server-side `?search=` read across the requisition's
 * text fields (`display_number`/`note`), still scoped to the page's lifecycle
 * tab and mapped to the SAME card as the list so results always match it.
 */
export async function fetchRequisitionsSearch(status: RequisitionFilterValue, query: string): Promise<MroRequisitionCardModel[]> {
	const res = await ops.items('mro_requisitions').list({
		fields: REQUISITION_FIELDS,
		filter: requisitionStatusFilter(status),
		search: query,
		limit: SEARCH_LIMIT,
	});
	return requisitionCardsOf(res.data);
}

/**
 * One page of ONE lifecycle group's store-requests list — `LIST_PAGE_SIZE`
 * requisitions at a time (newest first), SERVER-side scoped to the tab's
 * `requisition_status` (the page streams pages via `useCursorList` +
 * `LoadMoreSentinel` instead of loading the whole document set up front).
 */
export async function fetchRequisitionsPage(status: RequisitionFilterValue, cursor?: string): Promise<CursorPage<MroRequisitionCardModel>> {
	const res = await ops.items('mro_requisitions').list({
		fields: REQUISITION_FIELDS,
		filter: requisitionStatusFilter(status),
		sort: '-created_at',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return {
		rows: requisitionCardsOf(res.data),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/**
 * ONE truck's maintenance file page — a CURSOR page of that truck's truck-bound
 * requisitions (newest first, EVERY lifecycle — a request bound to a vehicle IS
 * its maintenance record, and the per-truck maintenance screen shows the whole
 * history). Read by `/app/maintenances/vehicle/:id`. Deliberately separate from
 * the status-group lists above: this history keeps its own cache (keyed under
 * the requisitions PREFIX, so approve/issue/create invalidations still reach it)
 * and never shares — or evicts — a status tab's pages.
 */
export async function fetchVehicleRequisitionPage(vehicleId: string, cursor?: string): Promise<CursorPage<MroRequisitionCardModel>> {
	const res = await ops.items('mro_requisitions').list({
		fields: REQUISITION_FIELDS,
		filter: { vehicle: { _eq: vehicleId } },
		sort: '-created_at',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return {
		rows: requisitionCardsOf(res.data),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/**
 * The server-side scope ONE lifecycle tab's reads send — the tab's API call
 * returns exactly the rows the client classifies into it.
 *
 * `requested` is the OPEN queue — a FLAT OR of `requested`, `approved` (decided
 * but nothing issued yet) and a still-open `draft`: rows written before the
 * workflow column carry no `requisition_status`, and the card classifies such a
 * draft as requested (`requisitionStatusOf`). The entity API OR-groups FLAT (no
 * nested “(B AND C)” groups), and a draft's `requisition_status` is only set when
 * the doc leaves draft, so the flat OR is exact for service-written rows.
 *
 * `completed` ORs the two issued states — the tab merges `partially_issued`
 * and `fulfilled`, so its read must too or the list would silently drop every
 * partially-issued doc. A flat OR of two value equalities is exactly that
 * union (each doc holds one status, so no row can be double-counted).
 *
 * `rejected` matches the single closed value (`cancelled`) alone.
 */
function requisitionStatusFilter(status: RequisitionFilterValue): FilterShape | undefined {
	if (status === 'requested') {
		// The OPEN queue: awaiting a decision OR still-open draft OR approved but not
		// yet issued. All three are "not moving yet" — one tab, ONE cursor stream.
		return {
			_or: [{ requisition_status: { _eq: 'requested' } }, { requisition_status: { _eq: 'approved' } }, { doc_status: { _eq: 'draft' } }],
		};
	}
	if (status === 'completed') {
		return { _or: [{ requisition_status: { _eq: 'partially_issued' } }, { requisition_status: { _eq: 'fulfilled' } }] };
	}
	// rejected (the only remaining tab) — a refusal CLOSES the doc (`cancelled`).
	return { requisition_status: { _eq: 'cancelled' } };
}

/** The filter subset this module sends — structurally the engine's `Filter`
 *  shape for `mro_requisitions` (kept local so the SDK type stays at the
 *  `ops.items(...)` call site). `requisition_status` carries the FULL lifecycle
 *  vocabulary (the cancelled value included) — the approval center's rejected
 *  scope filters on it. */
type FilterShape = {
	requisition_status?: { _eq: RequisitionStatus };
	doc_status?: { _eq: 'draft' };
	_or?: FilterShape[];
};

/**
 * The engine's PRE-FLIGHT answer for a basket — the same-day duplicate WARNING
 * (`POST /api/mro/requisitions/check-duplicate`). The rule is the compiled
 * guard's, so a "no duplicate" answer here can never be contradicted by the
 * create; when `duplicate` is true the form shows `message` and, if the user
 * confirms, files the request with the returned `ack` token (see
 * `createRequisition`). `ack` is opaque — the token is the server's.
 */
export interface RequisitionDuplicateCheck {
	duplicate: boolean;
	message: string | null;
	displayNumber: string | null;
	ack: string | null;
}

/** The wire shape of the pre-flight read (snake_case, server-owned). */
interface DuplicateCheckWire {
	duplicate: boolean;
	message: string | null;
	display_number: string | null;
	ack: string | null;
}

/**
 * Ask the store whether this basket repeats one the SAME requester already filed
 * today. Read-only and cheap (bounded: ≤25 same-day headers + one lines read),
 * and the ONLY source of the warning copy — the form renders the returned
 * `message` verbatim rather than carrying its own text.
 */
export async function checkRequisitionDuplicate(input: {
	request_date: string;
	requested_by: string;
	lines: Array<{ item_model: string; qty: number }>;
}): Promise<RequisitionDuplicateCheck> {
	const data = await postMro<DuplicateCheckWire>('/mro/requisitions/check-duplicate', input);
	return {
		duplicate: data?.duplicate === true,
		message: data?.message ?? null,
		displayNumber: data?.display_number ?? null,
		ack: data?.ack ?? null,
	};
}

/**
 * Create a REQUISITION — one engine-native multi-line POST: the engine assigns
 * `display_number`/`doc_status` and inserts the child lines. The payload always
 * carries the current login employee as `requested_by` and opens the doc with
 * `requisition_status: 'requested'` (the workflow's first lifecycle state).
 * Errors (e.g. a `lines` validation) throw with the engine's message.
 *
 * `ack` confirms the same-day duplicate warning the pre-flight read reported, so
 * the engine files the repeat request the user explicitly asked for instead of
 * refusing it; without it the guard keeps refusing (the default).
 */
export async function createRequisition(input: CreateRequisitionInput, options: { ack?: string } = {}): Promise<MroRequisitionRow> {
	return ops.items('mro_requisitions').create(input, options.ack ? { ack: options.ack } : undefined);
}

/** The amend payload — only the fields a requester may change while the request
 *  is still `requested`. `lines` is the FULL replacement set (the engine's child
 *  sync deletes + recreates the rows). Deliberately omits `requested_by` /
 *  `requisition_status` / `doc_status` / totals — those are engine/service-owned. */
export interface UpdateRequisitionInput {
	request_date: string;
	location: MroLocation;
	vehicle?: string;
	note?: string;
	lines: Array<{ item_model: string; qty: number; note?: string }>;
}

/**
 * Amend a REQUESTED requisition — the engine's generic update (`PUT /api/entities/
 * mro_requisitions/:id`). The `lines` table field is replaced wholesale (the engine's
 * `ChildTableService` deletes + recreates the child set), so the caller must send
 * every line to keep. Safe only while the doc is un-approved: `mro_requisitions`
 * declares `writes.freeze_when = doc_status ∈ [confirmed]`, so an approved request
 * (or any later lifecycle state) is refused by the engine with a 403. `requested_by`
 * is an `actor_field`, so the engine re-stamps it from the session and ignores any
 * value sent here.
 */
export async function updateRequisition(docId: string, input: UpdateRequisitionInput): Promise<MroRequisitionRow> {
	return ops.items('mro_requisitions').update(docId, input);
}

/**
 * Approve (confirm) a requested requisition — `POST /api/mro/requisitions/:id/
 * confirm` with the approving store keeper's employee id (login). The workflow
 * requires an approver DIFFERENT from the requester (409 otherwise) and 400s
 * when no approver is passed. The confirm NEVER touches stock — it flips the
 * doc to `doc_status: confirmed`, sets `approved_by` and moves the lifecycle to
 * `approved`. Goes through the shared `postMro` write helper (Bearer auth + an
 * Idempotency-Key).
 */
export function approveRequisition(docId: string, approverId: string): Promise<unknown> {
	return postMro(`/mro/requisitions/${docId}/confirm`, { approved_by: approverId });
}

/** A browser-safe base64 encode of a UTF-8 JSON value (the goods-issue create
 *  prefill). Replaces the Node-only global `Buffer` so the module stays browser-
 *  safe — `encodeURIComponent` keeps every code point 1-2 ASCII chars that
 *  `btoa` can encode, and the goods side decodes with the matching inverse. */
export function encodePrefillJson<T>(value: T): string {
	return btoa(encodeURIComponent(JSON.stringify(value)));
}

/** Map ONE requisition header row to the DETAIL model — the list projection plus
 *  the raw store value (`location`) so a goods-issue draft issued from this page
 *  targets the correct shelf. Errors (e.g. a filter with no match) throw so the
 *  page's query surfaces a retryable failure. */
function requisitionDetailOf(row: MroRequisitionRow): MroRequisitionDetailModel {
	const docStatus = row.doc_status === 'confirmed' || row.doc_status === 'cancelled' ? row.doc_status : 'draft';
	const location = row.location && (MRO_LOCATION_LABELS[row.location] ?? null) ? (row.location as MroLocation) : null;
	const vehicle = vehicleRefOf(row.vehicle);
	return {
		id: row.id,
		displayNumber: row.display_number?.trim() || null,
		docStatus,
		requisitionStatus: requisitionStatusOf(row.requisition_status, docStatus),
		location,
		locationLabel: row.location ? (MRO_LOCATION_LABELS[row.location] ?? null) : null,
		requestDate: row.request_date?.trim() || null,
		requestDateLabel: requestDateLabelOf(row.request_date),
		requestedBy: personOf(row.requested_by),
		approvedBy: personOf(row.approved_by),
		vehicleId: vehicle.vehicleId,
		vehiclePlate: vehicle.vehiclePlate,
		issuedQty: typeof row.issued_qty === 'number' ? row.issued_qty : null,
		requestedQty: typeof row.total_qty === 'number' ? row.total_qty : null,
		lineCount: row.line_count ?? null,
		note: row.note?.trim() || null,
		closeReason: row.close_reason?.trim() || null,
	};
}

/**
 * The `/app/store-requests/:id` DETAIL VIEW — ONE `POST /api/query` round trip
 * that runs the header read (`mro_requisitions` by id) and the child-lines read
 * (`mro_requisition_lines` by `parent_id`) in PARALLEL server-side, each with
 * its relations joined in the SAME batch (`vehicle.plate_no` on the header;
 * `item_model.name_en` + `item_model.name_mm` + `item_model.item_name.tracking` on
 * every line — the policy lives on the item NAME, not the SKU). Returns null when
 * no row matches the id. A header failure throws (the
 * page surfaces a retryable error); a lines failure degrades to an empty list
 * (matching the pre-batch silent-empty read) so a keeper can still decide/approve
 * on the header alone.
 */
export async function fetchRequisitionView(id: string): Promise<RequisitionView> {
	const res = await ops.queryMany([
		{
			key: 'header',
			collection: 'mro_requisitions',
			query: serializeQuery<MroRequisitionRow>({ fields: REQUISITION_FIELDS, filter: { id: { _eq: id } }, limit: 1 }),
		},
		{
			key: 'lines',
			collection: 'mro_requisition_lines',
			query: serializeQuery<MroRequisitionLineRow>({
				fields: REQUISITION_LINE_FIELDS,
				filter: { parent_id: { _eq: id } },
				sort: 'id',
				limit: SEARCH_LIMIT,
			}),
		},
	]);
	const byKey = new Map(res.results.map((result) => [result.key, result]));
	const header = byKey.get('header');
	if (!header?.ok) throw new Error(header?.error ?? 'Could not read this request.');
	const lines = byKey.get('lines');
	if (!lines?.ok) console.warn('[store-requests] line read failed for this request', lines?.error);
	const rows = (header.data as MroRequisitionRow[] | undefined) ?? [];
	return {
		header: rows[0] ? requisitionDetailOf(rows[0]) : null,
		lines: lines?.ok ? ((lines.data as MroRequisitionLineRow[] | undefined) ?? []) : [],
	};
}

/**
 * Reject / close a requisition that can't proceed — `POST /api/mro/
 *  requisitions/:id/reject` with an optional close reason (`fulfilled`/`stock_low`/
 *  `cancelled`), flips the lifecycle to `cancelled`. Mirrors `approveRequisition`'s
 *  fetch envelope style so a non-2xx (or a body `error`) throws the engine message;
 *  the reject endpoint may not be wired to the worker yet — the call is a forward
 *  reference that degrades to a surfaced engine error until then. */
export function rejectRequisition(docId: string, closeReason?: string): Promise<unknown> {
	return postMro(`/mro/requisitions/${docId}/reject`, closeReason ? { close_reason: closeReason } : {});
}

/**
 * ISSUE stock against an approved requisition — `POST /api/mro/requisitions/:id/
 * issue`. ONE server call creates the goods-issue outbound AND confirms it
 * (moving stock), so the client never has to chain create→confirm and a browser
 * abort between them can no longer strand an orphaned DRAFT. The issuer is bound
 * to the session server-side; `issuedById` only matters for an admin acting on
 * someone's behalf.
 */
export function issueRequisition(docId: string, lines: Array<{ item_model: string; qty: number }>, issuedById?: string): Promise<unknown> {
	return postMro(`/mro/requisitions/${docId}/issue`, {
		...(issuedById ? { issued_by: issuedById } : {}),
		lines,
	});
}

/**
 * The APPROVAL CENTER's requisition scope — the shared three-chip decision filter
 * folded onto the requisition lifecycle through `REQUISITION_APPROVAL_SCOPE`. Each
 * chip's values become one flat `_or` group, which is exact because a doc holds
 * exactly one `requisition_status` (no row can be double-counted) and the engine's
 * `_or` groups are flat. `pending` additionally ORs a still-open DRAFT — a doc
 * keeps no `requisition_status` until it leaves draft, and that queue must not
 * hide an un-confirmed request.
 */
function requisitionApprovalFilter(status: RequisitionApprovalStatus): FilterShape | undefined {
	const groups: FilterShape[] = REQUISITION_APPROVAL_SCOPE[status].map((value) => ({ requisition_status: { _eq: value } }));
	if (status === 'pending') groups.push({ doc_status: { _eq: 'draft' } });
	return groups.length === 1 ? groups[0] : { _or: groups };
}

/**
 * ONE page of the approval center's requisition queue — the same cursor page as
 * the store-requests list, scoped by the DECISION chip instead of the registry's
 * list tabs. HEADER ONLY: the requested line items live on the DETAIL page
 * (`/app/store-requests/:id`), so the queue pays no second (lines) read.
 */
export async function fetchRequisitionApprovalPage(
	status: RequisitionApprovalStatus,
	cursor?: string,
): Promise<CursorPage<MroRequisitionCardModel>> {
	const res = await ops.items('mro_requisitions').list({
		fields: REQUISITION_FIELDS,
		filter: requisitionApprovalFilter(status),
		sort: '-created_at',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return {
		rows: requisitionCardsOf(res.data),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/** The approval center's toolbar search — a server-side `?search=` read (number /
 *  note) inside the SAME decision scope as the list. Header only, like the list. */
export async function fetchRequisitionApprovalSearch(status: RequisitionApprovalStatus, query: string): Promise<MroRequisitionCardModel[]> {
	const res = await ops.items('mro_requisitions').list({
		fields: REQUISITION_FIELDS,
		filter: requisitionApprovalFilter(status),
		search: query,
		limit: SEARCH_LIMIT,
	});
	return requisitionCardsOf(res.data);
}
