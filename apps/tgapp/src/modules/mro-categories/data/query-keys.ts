import { MASTER_STALE_MS } from '@/shared/constants';
import { STALE_MS } from '@/shared/api/invalidation';
import { MRO_SUPPLIERS_QUERY_KEY } from '@/shared/hooks/use-mro-masters';

/**
 * TanStack Query key factory for the အုပ်စု masters hub — the group-summary
 * cards come from ONE aggregate `/api/mro/catalog/groups` read (every master
 * with live SKUs + its count); `mro_suppliers` is read whole as the sibling
 * master tab.
 */

/** The master tabs reflect a row added via a '+' flow IMMEDIATELY because each
 *  create/edit invalidates the tab's key write-through — so they can sit on the
 *  shared MASTER tier instead of refetching on every mount (single source in
 *  shared/constants). */
export const MRO_MASTERS_STALE_MS = MASTER_STALE_MS;

/** The group aggregate is a confirmed-movement read — the shared `module` tier
 *  (single source in shared/api/invalidation.ts), so a visit right after a
 *  confirm still shows the new row (the confirm flows invalidate write-through). */
export const MRO_GROUPS_STALE_MS = STALE_MS.module;

export const qk = {
	/** The group-summary tab — one-shot read (no paging, always refetched). */
	groups: () => ['mro-categories', 'groups'] as const,
	/** The supplier-master tab — aliases the SHARED `['mro','suppliers']` cache
	 *  entry, so a supplier added here shows in the inbound form's picker and
	 *  vice versa (one cache, one write-through invalidation). */
	suppliers: () => MRO_SUPPLIERS_QUERY_KEY,
	/** The issue-type tab — the whole `veh_issue_types` directory (read-only:
	 *  no create/edit here, so the tab needs no write-through invalidation). */
	issueTypes: () => ['mro-categories', 'issue-types'] as const,
	/** ONE supplier row's edit-page read (`mro_suppliers` by id). */
	supplierEdit: (id: string) => ['mro-categories', 'supplier', 'edit', id] as const,
	/** ONE item-group (item-name) row's edit-page read (`mro_item_name` by id). */
	groupEdit: (id: string) => ['mro-categories', 'group', 'edit', id] as const,
};
