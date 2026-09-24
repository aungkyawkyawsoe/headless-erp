import { LOOKUP_LIMIT } from '@/shared/constants';

/**
 * The wire shape a page-fetching function must return — the SDK's `ListResult`
 * minus the fields the walk doesn't need, so this helper stays typed loosely
 * (module `ops` clients return the full SDK `ListResult`, which satisfies it).
 */
export interface FetchAllPage<T> {
	data: T[];
	meta: { has_more: boolean; next_cursor?: string | null };
}

export interface FetchAllOptions {
	/** Rows per request — defaults to `LOOKUP_LIMIT` (the API's max page, 100). */
	pageSize?: number;
	/**
	 * Hard safety cap on the number of pages walked (500 × 100 = 50 000 rows).
	 * Exceeding it THROWS — an aggregate lookup must never silently truncate.
	 */
	maxPages?: number;
}

/**
 * Walk every page of a keyset-cursor list fetch.
 *
 * The entities API hard-caps `limit` at 100 rows and signals more rows via
 * `meta.has_more` + `meta.next_cursor`. A single `list({ limit: LOOKUP_LIMIT })`
 * therefore SILENTLY truncates any collection past 100 rows (the employee
 * directory has 238) — every lookup/picker/directory read that semantically
 * needs the whole set must walk the cursor instead. This helper is that walk:
 *
 *   const rows = await fetchAllPages((cursor, pageSize) =>
 *     ops.items('hr_employees').list({ ..., limit: pageSize, cursor }),
 *   );
 *
 * The walker OWNS the wire page size and hands it to the fetcher as the second
 * argument (`LOOKUP_LIMIT` = 100 by default): a caller that omits `limit:`
 * would silently page at the SDK's 25-row default and turn one whole-set read
 * into four requests, so the page size is injected here, never re-declared.
 *
 * It throws (never returns a partial set) when the server keeps saying
 * `has_more` past `maxPages`, or when `has_more` is true without a usable
 * cursor — both mean the set cannot be completed and a truncated result would
 * corrupt whatever the caller sums / picks from.
 *
 * This is the WHOLE-SET sibling of `walkPages` (shared/api/walk-pages.ts,
 * the early-exit "newest per group" resolver): fetchAllPages collects every
 * page and throws if the set can't be completed, walkPages stops as soon as
 * a per-page predicate resolves and returns nothing. Pick the one whose
 * semantics match the read — never a third variant.
 */
export async function fetchAllPages<T>(
	listFn: (cursor: string | undefined, pageSize: number) => Promise<FetchAllPage<T>>,
	options: FetchAllOptions = {},
): Promise<T[]> {
	const pageSize = options.pageSize ?? LOOKUP_LIMIT;
	const maxPages = options.maxPages ?? 500;
	const rows: T[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < maxPages; page++) {
		const res = await listFn(cursor, pageSize);
		rows.push(...res.data);
		if (!res.meta.has_more) return rows;
		cursor = res.meta.next_cursor ?? undefined;
		if (!cursor) {
			throw new Error(
				`fetchAllPages: the server reported more rows but gave no next cursor (page ${page + 1} of ${pageSize}/page) — refusing to return a truncated set.`,
			);
		}
	}
	throw new Error(`fetchAllPages: exceeded the ${maxPages}-page safety cap (${pageSize} rows/page) — refusing to return a truncated set.`);
}
