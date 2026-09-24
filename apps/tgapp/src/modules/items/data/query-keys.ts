import { STALE_MS } from '@/shared/api/invalidation';

/**
 * TanStack Query key factory for the ပစ္စည်းများ (MRO item models) list.
 *
 * Keyed under `['items', ...]` — its own namespace; the list is a single
 * self-contained read of `mro_item_model` (no joins), cursor-paginated.
 */

/** The model catalog changes as slowly as the store data — a modest freshness
 *  window (the shared `module` tier; single source in shared/api/invalidation.ts). */
export const ITEMS_STALE_MS = STALE_MS.module;

export const qk = {
	/** The item-model card list — the ပစ္စည်းများ list (cursor-paginated). */
	items: () => ['items', 'list'] as const,
	/** ONE item model's edit-page read (`mro_item_model` by id) — seeds the form
	 *  and is patched after a save so a quick re-entry shows the new values. */
	itemEdit: (id: string) => ['items', 'edit', id] as const,
	/** The create form's `?item_name=` preselect display name — one `mro_item_name`
	 *  row fetched by id (the whole-set cache may not be warm yet). */
	preselectedItemName: (id: string) => ['items', 'preselected-item-name', id] as const,
};
