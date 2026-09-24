/**
 * TanStack Query key factory for the ပစ္စည်းလှုပ်ရှားမှု (Movement) module.
 *
 * Every key starts with the `mro-movements` DOMAIN prefix — the segment the
 * whole-app write-through map invalidates (shared/api/invalidation.ts): when a
 * goods-issue/inbound/transfer confirm lands in another module, one
 * `invalidateDomain(qc, 'mro-movements')` refreshes ALL of these reads.
 *
 * The module itself is read-only (confirmed lines are written by the IN/OUT/TRF
 * doc flows, never here); the stale tier is the shared `STALE_MS.module`
 * window, so remounts stay cheap while a brand-new confirm still shows on the
 * next visit (the confirm flows invalidate write-through).
 *
 * Screen 1's moving-group directory is a SERVER-SCOPED read of its own
 * (`/mro/movement/groups`, keyset-paged) — it does NOT share the mro-categories
 * hub's whole-catalog walk, so each screen keeps its own freshness window.
 */
import { STALE_MS } from '@/shared/api/invalidation';

import type { MovementDirection, MovementStoreScope } from './types';

/** Confirmed lines never change inside this module — the shared read-only
 *  module tier keeps remounts cheap while a confirm still refreshes on the
 *  next visit via write-through invalidation. */
export const MOVEMENT_STALE_MS = STALE_MS.module;

export const qk = {
	/** Screen 1 — the moving item-name masters directory (`/movement/groups`). */
	groups: () => ['mro-movements', 'groups'] as const,
	/** The kiosk's type-ahead — the settled `?search=` term narrows the SAME
	 *  `/movement/groups` read server-side (one key per term, so re-typing a term
	 *  a user already looked at is served from cache; the browse register keeps the
	 *  unscoped `groups()` key above). */
	groupsSearch: (term: string) => ['mro-movements', 'groups', 'search', term] as const,
	/** Screen 2's item-name group — the ONE `mro_item_name` master behind the
	 *  app-bar title (a lean by-id lookup, NOT the whole-set catalog walk the
	 *  Screen 1 directory needs). */
	group: (id: string) => ['mro-movements', 'group', id] as const,
	/** Screen 2 — one item-name group's CONFIRMED line feed over the scope
	 *  (`/movement/lines`). Direction + store scope are IN the key, so each
	 *  tab/store choice caches under its own entry and a revisit never
	 *  refetches what the user already scrolled through. */
	groupLines: (group: string, direction: MovementDirection, location: MovementStoreScope) =>
		['mro-movements', 'lines', group, direction, location] as const,
	/** Screen 2's DEFAULT tab — one item-name group's SKU rows with their
	 *  aggregated movement (`/movement/models`). Scope-keyed exactly like the line
	 *  feed, so switching tabs or stores never mixes two scopes' pages. */
	groupModels: (group: string, direction: MovementDirection, location: MovementStoreScope) =>
		['mro-movements', 'models', group, direction, location] as const,
	/** Screen 3's ledger — one model's line pages over the direction + store scope. */
	ledger: (model: string, direction: MovementDirection, location: MovementStoreScope) =>
		['mro-movements', 'ledger', model, direction, location] as const,
	/** The `mro_item_model` master read behind the ledger header's display name. */
	model: (id: string) => ['mro-movements', 'model', id] as const,
};
