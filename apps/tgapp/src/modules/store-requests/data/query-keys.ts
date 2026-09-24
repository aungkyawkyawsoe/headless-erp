/**
 * TanStack Query key factory for the တောင်းခံလွှာ (MRO requisition) module.
 *
 * Requisitions live under their own `['store-requests', ...]` namespace: the
 * list is a cursor-paginated read of `mro_requisitions`. The SKU directory its
 * create form picks from is NOT keyed here — it is the shared `['mro',
 * 'item-models']` read owned by `shared/hooks/use-mro-item-models` (one cache
 * entry across every MRO module's pickers).
 */

import { STALE_MS } from '@/shared/api/invalidation';
import type { RequisitionApprovalStatus, RequisitionFilterValue } from './status';

/** Draft documents move through a workflow (draft → confirmed), so the list
 *  refreshes more eagerly than the slow-moving fleet overviews — approving a
 *  draft must flip its card promptly. The shared read-only-feed tier
 *  (`STALE_MS.module`), single source in shared/api/invalidation.ts. */
export const REQUISITIONS_STALE_MS = STALE_MS.module;

export const qk = {
	/** ONE lifecycle group's cursor-paginated requisition list — the တောင်းခံလွှာ
	 *  card list. The `status` is a SERVER-side `requisition_status` scope (the
	 *  page's tab: requested | approved | completed — `completed` is a two-status
	 *  OR, see `requisitionStatusFilter`). */
	requisitions: (status: RequisitionFilterValue) => ['store-requests', 'requisitions', status] as const,
	/** The APPROVAL CENTER's requisition queue — one cache per decision chip, keyed
	 *  UNDER the `requisitions` prefix so every existing approve/issue/create
	 *  invalidation (`requisitionsAll`) reaches it with no extra wiring. */
	approvalRequisitions: (status: RequisitionApprovalStatus) => ['store-requests', 'requisitions', 'approval', status] as const,
	/** ONE truck's whole maintenance file — cursor-paginated, newest first, every
	 *  lifecycle (the per-truck maintenance screen `/app/maintenances/vehicle/:id`).
	 *  Keyed UNDER the requisitions prefix so the shared approve/issue/create
	 *  invalidations (`requisitionsAll`) reach it too. */
	vehicleRequisitions: (vehicleId: string) => ['store-requests', 'requisitions', 'vehicle', vehicleId] as const,
	/** Prefix of EVERY lifecycle group's list — invalidate after create / approve /
	 *  issue / reject so each status cache refreshes in one call. */
	requisitionsAll: () => ['store-requests', 'requisitions'] as const,
	/** The `/app/store-requests/:id` DETAIL VIEW — header + child lines fetched in
	 *  ONE `POST /api/query` batch (`fetchRequisitionView`), keyed per doc so the
	 *  detail page renders + acts on it from a single cache entry. */
	requisitionView: (id: string) => ['store-requests', 'requisition', id] as const,
};
