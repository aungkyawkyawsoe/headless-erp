/** Cursor list page size — every list page fetches 25 rows per cursor page, the
 *  API's OWN default page size (GET /api/meta `default_page_size`; mirrored by
 *  `SEARCH_LIMIT` below). One round trip returns a full screen of rows and the
 *  `LoadMoreSentinel` streams further 25-row pages as the user scrolls. One
 *  number for the whole app (previously re-declared per module). */
export const LIST_PAGE_SIZE = 25;

/** The shared single-shot list page size — every list read that does NOT
 *  cursor-walk (the attendance request/approval lists + every module's toolbar
 *  search results) caps its GET at this many rows. 25 matches the API's own
 *  default page size — the enterprise contract — so a response never pulls a
 *  bigger page than the engine's default. */
export const SEARCH_LIMIT = 25;

/** The page size for the shared cursor walk (`fetchAllPages` in
 *  `shared/api/fetch-all.ts`) — matched to the API's max page size (500, see
 *  `@mmbix/utils`), so a whole-set directory read (the employee directory has
 *  ~238 rows, SKU masters more) completes in ONE request instead of serial
 *  100-row pages. The cursor walk still exists for sets larger than 500. */
export const LOOKUP_LIMIT = 500;

/** Master-data (lookup) freshness — vehicles / employees / departments / item
 *  models change rarely, so every module's join lookups stay fresh for 5 min
 *  while the LIST query keeps its own tighter window (a revisit refetches only
 *  the rows, not the lookups). Previously each module re-declared a copy. */
export const MASTER_STALE_MS = 5 * 60 * 1000;

/**
 * The app-wide SERVER-SEARCH standard — ONE contract for every search that
 * resolves options/rows with a request: the bottom-sheet pickers (personnel,
 * vehicles, issue types, tyre serials…), the search-first kiosk pages
 * (accidents, fluids, odo, licenses, maintenance, movements, insurances, tyres)
 * and the list toolbar search.
 *
 *   • opening a surface issues NOTHING — a picker shows a blank prompt, a kiosk
 *     shows its search pill, never a directory dump;
 *   • a GATED search fires only once the term is at least `SEARCH_MIN_CHARS`
 *     long, so a one-character term (which would match half the table) never
 *     costs a round trip. A kiosk keeps an explicit Search action, so the
 *     operator can still resolve ANY length (e.g. a short plate) on demand; the
 *     list toolbar is NOT gated (it has no submit) and searches from 1 char;
 *   • the term settles for `SEARCH_DEBOUNCE_MS` before the query runs, so a
 *     typing burst collapses into ONE request per pause.
 *
 * Static / predefined lists (store locations, status filters, vendor type,
 * categories) are NOT affected — they have nothing to query and render as usual.
 */
export const SEARCH_MIN_CHARS = 3;

/** Search keystroke → query debounce (ms) — the ONE settle window app-wide. */
export const SEARCH_DEBOUNCE_MS = 600;
