/**
 * Batched cursor-walk for "resolve the newest row PER group" reads.
 *
 * The generic engine has no per-group top-N (no "newest row per vehicle" in a
 * single request), so a set-resolution read must either take ONE global top-N
 * window (missing groups whose newest row ranks low) or fall back to a
 * targeted read per group — the request-per-group N+1 burst this helper
 * replaces. Instead each page is ONE `_in`-filtered request covering ALL
 * still-missing groups, cursor-walked until every group resolves, rows run
 * out, or the page cap hits.
 *
 * This is the EARLY-EXIT sibling of `fetchAllPages` (shared/api/fetch-all.ts,
 * the whole-set walk): walkPages stops as soon as `resolvePage` says every
 * group is done and returns nothing, so it is the right tool for a bounded
 * "newest per group" resolution. Do NOT use it to collect a full set (use
 * fetchAllPages) and do NOT fetch whole sets per group (use this).
 */

/**
 * Rows per walked page — the SDK's page-size clamp (`LOOKUP_LIMIT` = the API's
 * own `max_page_size`). Was 25, which forced a 200-row set to walk 8 SEQUENTIAL
 * round trips (a cursor cannot be prefetched, so the walk is strictly serial).
 * At 100 the same set is 2 trips, and every request stays within the clamp the
 * server enforces anyway — so this is pure latency removal, not a bigger query
 * than the API already permits.
 */
export const WALK_PAGE_SIZE = 100;

/** Hard page cap — each page is one request covering the whole missing set,
 *  so even the cap bounds requests far below the per-group loop it replaced. */
export const WALK_PAGE_CAP = 5;

/** One list page — the structural slice of the SDK's `list` result the walk
 *  needs (keeps the helper decoupled from any concrete client type). */
export interface WalkPage<Row> {
	data: Row[] | undefined;
	meta?: { has_more?: boolean; next_cursor?: string | null };
}

/**
 * Walk `fetchPage`'s cursor until `resolvePage` reports every group resolved
 * (returns true), a page comes back empty, `has_more` ends, or `WALK_PAGE_CAP`
 * pages have run. Rows MUST arrive sorted so each group's decisive (newest)
 * row precedes its older ones — then resolving a group on first sight is
 * correct even when its rows straddle a page boundary.
 */
export async function walkPages<Row>(
	fetchPage: (cursor?: string) => Promise<WalkPage<Row>>,
	resolvePage: (rows: Row[]) => boolean,
): Promise<void> {
	let cursor: string | undefined;
	for (let page = 0; page < WALK_PAGE_CAP; page++) {
		const batch = await fetchPage(cursor);
		const rows = batch.data ?? [];
		if (rows.length === 0) return;
		if (resolvePage(rows)) return;
		if (!batch.meta?.has_more) return;
		const next = batch.meta.next_cursor ?? null;
		if (!next) return;
		cursor = next;
	}
}
