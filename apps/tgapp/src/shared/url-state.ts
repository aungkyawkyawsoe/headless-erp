/**
 * tgapp URL view-state contract — the ONE vocabulary for query params.
 *
 * Every screen's view state (which tab is open, the status/store filters, the
 * search text…) lives in the URL so a reload or a pasted link restores the
 * EXACT same view. This module is the single source of truth for that contract:
 * the canonical KEYS (`URL_PARAM`) and the canonical PARSERS, so a page can
 * never invent a new spelling (`?store=` here, `?location=` there) or a new
 * default. It mirrors the Studio's `useViewState()` philosophy — dynamic state
 * is URL-backed, `nuqs` replaces the current history entry (never pushes), so a
 * screen owns exactly one back-press.
 *
 * ## Key rules
 *
 * 1. **lowercase snake_case** — never camelCase (`request_ref`, not `requestRef`).
 * 2. **one key per concept, app-wide** — the segmented pane is ALWAYS `tab`,
 *    the store scope is ALWAYS `location`, the subtype filter is ALWAYS `type`.
 *    A key may mean the same thing on every route; it may never mean two things.
 * 3. **defaults are omitted** — a parser's `withDefault(...)` value never lands
 *    in the URL, so a clean URL always means "the default view".
 * 4. **`replace`, never push** — a `?param` change is not navigation (`nuqs`
 *    default; do not pass `{ history: 'push' }`).
 * 5. **context ids are singular nouns** — `vehicle`, `group`, `request`.
 * 6. **one container per screen** — a screen reads/writes its view state through
 *    the `useViewState(schema)` container, never N × `useQueryState`.
 *
 * ## The state model (3 tiers — do not mix)
 *
 * | tier        | owner                        | examples                                   |
 * | ----------- | ---------------------------- | ------------------------------------------ |
 * | server data | TanStack Query (`qk` keys)   | rows, reports, lookups — the fetch cache   |
 * | view state  | URL via `useViewState`       | open tab, filters, search text, page       |
 * | ephemeral   | `useState` (in the component)| sheet open flag, a pre-debounce input      |
 *
 * **SVOT:** a value has ONE home. Never mirror a URL value into `useState` (read
 * it from `view` directly), and never cache server data outside TanStack Query.
 * A one-shot URL prefill read at mount (`useLocation().search`) is the ONLY
 * exception, and it must say so in a comment.
 *
 * ## The keys
 *
 * | key           | meaning                                             |
 * | ------------- | --------------------------------------------------- |
 * | `q`           | free-text search text (the toolbar/launcher search)  |
 * | `page`        | zero-based page index (paged grids)                  |
 * | `tab`         | the active segmented pane (record/history, tyres…)   |
 * | `status`      | record status filter                                 |
 * | `type`        | subtype / kind filter (inbound kind, unit type…)     |
 * | `location`    | MRO store / location scope                           |
 * | `direction`   | movement direction (in/out/trf)                      |
 * | `category`    | category filter (single enum or a `a,b` list)        |
 * | `severity`    | incident severity filter                             |
 * | `tracking`    | item tracking-mode filter (serial/batch/standard)    |
 * | `vehicle`     | a bound vehicle id (create/prefill context)          |
 * | `serial`      | a bound `mro_stock_serials` unit id (a view acting on ONE unit) |
 * | `item_name`   | a bound `mro_item_name` id (filter/prefill context)  |
 * | `group`       | a bound movement group id                            |
 * | `project`     | a bound project id (task create/prefill context)     |
 * | `request`     | a bound source requisition id                        |
 * | `request_ref` | a source requisition's display number (`REQ-…`)      |
 * | `scope`       | an asset-scope hint (`tyre` · `equipment`)           |
 * | `prefill`     | a base64-encoded prefill payload                     |
 */
import {
	parseAsArrayOf,
	parseAsInteger,
	parseAsString,
	parseAsStringEnum,
	useQueryStates,
	type UseQueryStatesKeysMap,
	type UseQueryStatesReturn,
} from 'nuqs';

/** The canonical query-param keys — the ONLY spellings allowed in view state. */
export const URL_PARAM = {
	search: 'q',
	page: 'page',
	tab: 'tab',
	status: 'status',
	type: 'type',
	location: 'location',
	direction: 'direction',
	category: 'category',
	severity: 'severity',
	tracking: 'tracking',
	vehicle: 'vehicle',
	itemName: 'item_name',
	serial: 'serial',
	group: 'group',
	project: 'project',
	request: 'request',
	requestRef: 'request_ref',
	scope: 'scope',
	prefill: 'prefill',
} as const;

/** A canonical param key — `useQueryState(URL_PARAM.tab, …)`. */
export type UrlParamKey = (typeof URL_PARAM)[keyof typeof URL_PARAM];

/** Search text — `?q=`. Empty string = "not searching" and is omitted. */
export const searchParam = parseAsString.withDefault('');

/** Zero-based page index — `?page=`. Page 0 is omitted. */
export const pageParam = parseAsInteger.withDefault(0);

/** A free-string context value (`?vehicle=`, `?group=`…) — absent ⇒ `null`. */
export const stringParam = parseAsString;

/** A free-string context value whose "absent" state is the empty string
 *  (`?group=` — a screen that tests `value !== ''`). */
export const stringOrEmptyParam = parseAsString.withDefault('');

/** A string list (`?category=a,b`) — empty list is omitted. */
export const stringListParam = parseAsArrayOf(parseAsString).withDefault([] as string[]);

/**
 * An enum view-state key (tab / status / type / location / direction…) — an
 * unknown value falls back to `fallback`, which is also the value omitted from
 * the URL. ONE builder so every enum filter parses identically.
 */
export function enumParam<T extends string>(values: readonly T[], fallback: T) {
	return parseAsStringEnum<T>([...values]).withDefault(fallback);
}

/**
 * THE view-state container — one call per screen, over ONE schema object.
 *
 * A screen declares its whole URL view state as a single module-level schema
 * keyed by the canonical `URL_PARAM` names, then reads/writes it here:
 *
 * ```ts
 * // the screen's single source of truth for "where am I in this view"
 * const STOCK_VIEW = {
 * 	[URL_PARAM.tab]: TAB_PARAM,
 * 	[URL_PARAM.location]: STORE_PARAM,
 * } as const;
 *
 * const [view, setView] = useViewState(STOCK_VIEW);
 * view.tab;                 // typed, defaults applied, never null when a default exists
 * setView({ tab: 'out' });  // ONE batched URL write (replace — never push)
 * ```
 *
 * Why a container and not N × per-key calls:
 *  • **SSOT** — the screen's view state is ONE object, not a scavenger hunt of
 *    inline calls; the schema is the declaration.
 *  • **one write** — several keys change in one interaction ⇒ one history
 *    `replace` and one render, not N.
 *  • **no drift** — keys come from `URL_PARAM`, parsers from this module, and
 *    defaults are omitted from the URL (`clearOnDefault`).
 *
 * This is VIEW state only. Server data belongs to TanStack Query; ephemeral UI
 * (a sheet's open flag, an input before its debounce) stays in `useState`.
 */
export function useViewState<KeyMap extends UseQueryStatesKeysMap>(schema: KeyMap): UseQueryStatesReturn<KeyMap> {
	return useQueryStates(schema, { history: 'replace', clearOnDefault: true });
}
