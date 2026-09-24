import { sdk } from './sdk';

/**
 * The global search API (`GET /api/search/global`) — the engine's single
 * unified multi-entity search (FTS5 index + server-side LIKE fallback, RBAC
 * filtered). See `docs/backend-api/search.md`.
 *
 * Routed through the app-wide SDK client's generic `request` escape hatch
 * (entity CRUD doesn't cover custom routes) — so the SAME session token,
 * 401 self-heal and error funnel apply as every other `/api/*` call.
 */

/** One hit of `GET /api/search/global` (see `GlobalSearchResult` in the API's
 *  `search.service.ts`). */
export interface GlobalSearchHit {
	collection: string;
	collection_label?: string;
	id: string;
	title: string;
	snippet?: string;
	fields?: Record<string, unknown>;
	score?: number;
}

export async function searchGlobal(params: {
	q: string;
	/** Restrict the search to these collection slugs (default: all). */
	collections?: string[];
	/** Max hits (API default 25, max 100). */
	limit?: number;
}): Promise<GlobalSearchHit[]> {
	const query: Record<string, string> = { q: params.q };
	if (params.collections?.length) query.collections = params.collections.join(',');
	if (params.limit) query.limit = String(params.limit);
	return sdk.request<GlobalSearchHit[]>('/search/global', { query });
}

/** The global-search query key — one cache entry per (collection, term).
 *  Transient: a new term is a NEW key, so it needs no write-through invalidation. */
export function globalSearchKey(collection: string, term: string) {
	return ['search', 'global', collection, term] as const;
}
