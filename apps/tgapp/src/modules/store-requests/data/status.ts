import { MRO_DOC_STATUS_META } from '@/shared/mro';
import type { MroDocStatus } from '@/shared/mro';
import type { RequisitionStatus } from './types';

/**
 * Status copy + tints for a store-requisition card. The doc's user-facing state
 * is its workflow LIFECYCLE (`requisition_status`) — requested → approved →
 * partially_issued → fulfilled, or cancelled — NOT the engine `doc_status`
 * (which stays the draft→confirmed confirm guard, same as every sibling MRO doc).
 * The pill tints reuse the established `MRO_DOC_STATUS_META` tone family so a
 * Requested row reads like an in-flight "Draft" and an approved one like a
 * green "go".
 */
export const REQUISITION_STATUS_META: Record<RequisitionStatus, { label: string; className: string }> = {
	requested: { label: 'Requested', className: 'bg-status-warning-soft text-status-warning' },
	approved: { label: 'Approved', className: MRO_DOC_STATUS_META.confirmed.className },
	partially_issued: { label: 'Partially Issued', className: 'bg-status-info-soft text-status-info' },
	fulfilled: { label: 'Fulfilled', className: 'bg-primary/15 text-primary' },
	cancelled: { label: 'Cancelled', className: MRO_DOC_STATUS_META.cancelled.className },
};

/** Every lifecycle value — the union's membership list (used by the URL parse).
 *
 * The FULL five-value vocabulary is still the storage contract (the workflow
 * writes all five) — `cancelled` included. Only the LIST TABS are collapsed
 * (see `RequisitionFilterValue`); this array stays complete because the
 * card / detail / goods-issue readers validate a row's status against it. */
export const REQUISITION_STATUS_VALUES: readonly RequisitionStatus[] = [
	'requested',
	'approved',
	'partially_issued',
	'fulfilled',
	'cancelled',
];

/**
 * The list's segmented lifecycle filter — THREE tabs covering the full lifecycle.
 * `cancelled` (rejected/refused) has its own tab; `requested` MERGES the open
 * queue (see below); `completed` merges the two issued states.
 *   requested  the keeper's OPEN work — `requested` (awaiting a decision) **and**
 *              `approved` (decided but nothing issued yet), plus still-open
 *              drafts. The two are one "not yet moving" bucket to a keeper, so
 *              they share a tab and ONE cursor-paged stream.
 *   completed  PARTIALLY ISSUED **and** FULFILLED merged — "goods have started
 *              moving", which is one state to a keeper reading the list
 *   rejected   refused/closed requests (cancelled)
 */
export type RequisitionFilterValue = 'requested' | 'completed' | 'rejected';

/**
 * The APPROVAL CENTER's requisition scope — the shared three-chip decision filter
 * (`ApprovalStatusFilterValue`) folded onto this lifecycle. It is deliberately NOT
 * `RequisitionFilterValue`: the chips are decision states, not the registry's list
 * tabs, and the third one has no list tab at all.
 *
 *   pending   → `requested` (OR a still-open draft) — the keeper's decide queue
 *   approved  → approved + partially_issued + fulfilled — everything DECIDED and
 *               not refused, so an already-issued request never vanishes from
 *               the approval center the moment goods start moving
 *   rejected  → `cancelled` — a refusal CLOSES the doc, the workflow never writes
 *               a `rejected` status (see `requisitionStatusOf`)
 *
 * Structurally identical to `ApprovalStatusFilterValue` so the panel passes its
 * chip value straight through without a mapping table.
 */
export type RequisitionApprovalStatus = 'pending' | 'approved' | 'rejected';

/**
 * The approval center's chip → the lifecycle values it covers. Kept here (not
 * inline in the wire filter) so the SCOPE is one reviewable table and can be
 * pinned by a test — the chips must partition the lifecycle: every decided-and-
 * refused doc is `cancelled`, every issued one stays under `approved`.
 *
 * The `pending` chip also unions still-open DRAFTS at the wire layer (a doc has
 * no `requisition_status` until it leaves draft); that is a `doc_status`
 * exception, not a lifecycle value, so it lives with the filter builder.
 */
export const REQUISITION_APPROVAL_SCOPE: Record<RequisitionApprovalStatus, readonly RequisitionStatus[]> = {
	pending: ['requested'],
	approved: ['approved', 'partially_issued', 'fulfilled'],
	rejected: ['cancelled'],
};

/**
 * The close intents a keeper posts to the reject endpoint — the ONE source for
 * both the detail page and the Approval Center's inline decision, so the two
 * surfaces can never offer different reasons. "No longer needed" is the plain
 * cancel; "Stock too low" notes the request couldn't be fulfilled (a human
 * follow-up).
 */
export const REQUISITION_CLOSE_REASONS: ReadonlyArray<{ value: string; label: string; hint: string }> = [
	{ value: 'cancelled', label: 'No longer needed', hint: 'The requester no longer needs this stock.' },
	{ value: 'stock_low', label: 'Stock too low', hint: "The store can't fulfil it right now." },
];

/** Tab value → English label — the SegmentedTabs pills + the empty copy. */
export const REQUISITION_FILTER_LABELS: Record<RequisitionFilterValue, string> = {
	requested: 'Requested',
	completed: 'Completed',
	rejected: 'Rejected',
};

/** The tab row's options (English-only; the ordering is the render order). */
export const REQUISITION_FILTER_OPTIONS: ReadonlyArray<{ value: RequisitionFilterValue; label: string }> = (
	['requested', 'completed', 'rejected'] as const
).map((value) => ({ value, label: REQUISITION_FILTER_LABELS[value] }));

/**
 * The effective lifecycle for ONE row. Rows written after the workflow schema
 * carry `requisition_status` verbatim; LEGACY rows (pre-migration, or a plain
 * cancelled draft) have none and are classified from their `doc_status` so the
 * card + tabs never drop a document:
 *  - a still-open draft = `requested` (not yet approved / issued);
 *  - a confirmed (approved) doc with no status = `approved` (the pre-workflow
 *    meaning of "confirmed" on a requisition was the approve step);
 *  - cancelled stays cancelled.
 */
export function requisitionStatusOf(value: string | null | undefined, docStatus: MroDocStatus): RequisitionStatus {
	if (value && (REQUISITION_STATUS_VALUES as readonly string[]).includes(value)) {
		return value as RequisitionStatus;
	}
	switch (docStatus) {
		case 'cancelled':
			return 'cancelled';
		case 'confirmed':
			return 'approved';
		default:
			return 'requested';
	}
}
