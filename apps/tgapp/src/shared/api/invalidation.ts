/**
 * Whole-app cache policy — the ONE registry that decides what a write must
 * invalidate and how stale each data kind may be between writes.
 *
 * The rule behind everything here: the TanStack Query cache is the app's only
 * server-data store, staleness numbers only govern PASSIVE revisits, and
 * freshness is owned by write-through invalidation. A mutation invalidates the
 * exact queries it changed — by collection (sdk-react `invalidateCollection`)
 * or by custom domain (this module) — so nothing lingers past the moment it is
 * known to be wrong, and staleTime never needs to be 0 "just in case".
 */
import type { QueryClient } from '@tanstack/react-query';
import { MASTER_STALE_MS } from '@/shared/constants';

/**
 * The app's staleness tiers (ms) — one number per data kind, referenced by
 * every module's key factory instead of re-declared copies.
 *
 * | Tier    | Value | Covers                                                        |
 * | ------- | ----- | ------------------------------------------------------------- |
 * | live    | 0     | data that changes outside this screen and must be pixel-fresh |
 * | list    | 30 s  | interactive lists (the sdk-react `createQueryClient` default) |
 * | module  | 60 s  | module doc lists + read-only feeds (confirmed movement lines) |
 * | master  | 5 min | masters / directories (shared `MASTER_STALE_MS`)              |
 *
 * `module` is the read-only-feeds tier in practice: the module never writes
 * those rows itself, so a modest window makes revisits cheap — and the confirm
 * flows below still invalidate write-through, so a brand-new confirmed line
 * shows on the next visit instead of waiting out the window.
 */
export const STALE_MS = {
	live: 0,
	list: 30_000,
	module: 60_000,
	master: MASTER_STALE_MS,
} as const;

/**
 * Custom (pattern-C) read-only feed domains → the source collections whose
 * writes change their payload. The key is the FIRST segment of every query key
 * the domain owns (the movement keys are `['mro-movements', …]`), so a domain
 * invalidate is a plain prefix match.
 *
 * This registry is the single map that lets a write know every domain it
 * affects without any module knowing another module's keys:
 *   confirm an inbound → `invalidateDomain(qc, 'mro-movements')` refreshes the
 *   movement group directory AND the line feeds/ledger in one call.
 */
const FEED_SOURCES: Record<string, readonly string[]> = {
	'mro-movements': [
		'mro_inbounds',
		'mro_inbound_lines',
		'mro_outbounds',
		'mro_outbound_lines',
		'mro_transfers',
		'mro_transfer_lines',
		'mro_item_model',
		'mro_item_name',
		'mro_inventory',
	],
	// The stock dashboard (`['stock', …]` — the raw on-hand + expiry reports).
	// Balances move only when a doc is CONFIRMED (drafts touch nothing), so the
	// domain sources are the four stock-moving confirm writers (+ `mro_item_model`
	// for the model-name display columns the reports join in).
	stock: [
		'mro_item_model',
		'mro_inbounds',
		'mro_inbound_lines',
		'mro_outbounds',
		'mro_outbound_lines',
		'mro_transfers',
		'mro_transfer_lines',
		'mro_adjustments',
		'mro_adjustment_lines',
		// The balance table ITSELF — the items list's `GROUP BY model` totals read
		// `mro_inventory` directly, so a write to a balance row must refresh it too.
		'mro_inventory',
	],
	// The requisitions hub (`['store-requests', …]`). The rows are written by the
	// hub's own approve/reject/create AND by a CONFIRMED goods-issue outbound that
	// carries a `request` ref (the engine advances issued_qty + lifecycle there).
	'store-requests': ['mro_requisitions', 'mro_requisition_lines'],
	// The approval center's transfer feed (`['asset-transfers', …]`). Rows are
	// written by the generic entity create (a requester files) AND by the service
	// decide/execute routes (raw fetches — those call `invalidateDomain` directly).
	'asset-transfers': ['mro_asset_requests'],
	// The tyre / asset registers (`['tyres', …]`). They derive from the serial
	// snapshot AND its immutable event log, so an entity write to either must
	// refresh them — `invalidateDomain(qc, 'tyres')` is also the lever the raw
	// serial routes use to refresh the registers after a move.
	tyres: ['mro_stock_serials', 'mro_serial_events'],
};

/**
 * Invalidate every cached read of ONE custom domain — the write-through lever
 * for feeds that don't map to a single collection. Prefix-matches every query
 * whose key starts with `domain`, so one call refreshes the whole module:
 *
 *   await invalidateDomain(queryClient, 'mro-movements');
 *
 * Only ACTIVE queries refetch on the spot; cached-but-unmounted queries are
 * merely marked stale and refetch on their next mount (the desired cost for a
 * confirm that happens on a different screen).
 */
export function invalidateDomain(queryClient: QueryClient, domain: string): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: [domain] });
}

/**
 * Every custom domain that reads `collection`, invalidated together. This is
 * the automatic counterpart of `invalidateDomain` for callers that only know
 * WHICH collection they wrote (e.g. an sdk-react mutation hook) — the inverse
 * lookup over `FEED_SOURCES`. Unknown collections invalidate nothing.
 */
export async function invalidateDomainsReading(queryClient: QueryClient, collection: string): Promise<void> {
	const domains = Object.entries(FEED_SOURCES)
		.filter(([, sources]) => sources.includes(collection))
		.map(([domain]) => domain);
	await Promise.all(domains.map((domain) => invalidateDomain(queryClient, domain)));
}
