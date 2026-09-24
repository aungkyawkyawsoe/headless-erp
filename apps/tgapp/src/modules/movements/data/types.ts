/**
 * Row shapes for the ပစ္စည်းလှုပ်ရှားမှု (Movement) launcher app — a read-only
 * parts-movement ledger over CONFIRMED inbound (IN), outbound (OUT) and
 * location-transfer (TRF) lines. The wire contract is the verified mirror of the
 * engine's `/api/mro/movement/*` routes (`apps/api/src/domain-modules/mro/
 * inventory.service.ts`), typed here because the generated headless `Schema`
 * knows no `mro_*` collections.
 *
 * The three screens: the moving item groups (Screen 1, `/movement/groups` — a
 * server-scoped keyset-paged directory of item-name masters with confirmed
 * movement) → the group's CONFIRMED line feed (Screen 2, `/movement/lines`) →
 * ONE model's line ledger (Screen 3, `/movement/ledger`).
 */
import type { MroLocation } from '@/shared/mro';

/**
 * The ledger's segmented direction scope — the tab row value AND the server's
 * `direction` query param. `all` = every confirmed line; the three concrete
 * values narrow the set server-side to that direction's lines only.
 */
export type MovementDirection = 'all' | 'in' | 'out' | 'trf';

/** A confirmed line's actual movement direction — never `all`. */
export type MovementLineDirection = 'in' | 'out' | 'trf';

/**
 * The store scope shared by Screen 2 + 3 — `''` (empty string) = ALL stores
 * (the URL `location` param is then simply absent); otherwise one of the MRO
 * locations. The server treats a missing/empty location as "no store filter".
 */
export type MovementStoreScope = MroLocation | '';

/** `mro_item_model` — the lean master read behind the ledger header's name. */
export interface MovementModelMaster {
	id: string;
	/** English display name (`name_en`) — the header's preferred label. */
	name_en?: string | null;
	/** Burmese display name (`name_mm`) — used when there is no English name. */
	name_mm?: string | null;
}

/** `mro_item_name` — the item-name master behind Screen 2's app-bar title. */
export interface MovementGroupMaster {
	id: string;
	/** The group's English display name (`name_en`, e.g. "Battery terminal"). */
	name_en?: string | null;
}

/** ONE `/movement/groups` row (Screen 1) — an item-name master with CONFIRMED
 *  movement. Raw master columns: the client resolves the display name from
 *  `name_en` → `name` → `name_mm` (never the id). */
export interface MovementGroupRow {
	id: string;
	name?: string | null;
	name_en?: string | null;
	name_mm?: string | null;
}

/** ONE `/movement/groups` response — a keyset-cursor page only. */
export interface MovementGroupsFeed {
	rows: MovementGroupRow[];
	/** The opaque next-page key — `null` = no more groups. */
	nextCursor: string | null;
}

/** Screen 3 rows — one CONFIRMED movement line of the model. */
export interface MovementLineRow {
	direction: MovementLineDirection;
	line_id: string;
	/** The line's item model id — the Screen 3 drill target from a group feed. */
	model: string | null;
	/** The source doc's type — `purchase` | `legacy` | `return` (inbound),
	 *  `goods_issue` | `write_offs` | `defects_missing` (outbound), `transfer`. */
	kind: string | null;
	/** `INB-…` / `OUT-…` / `TRF-…` — the source document's engine number. */
	doc_no: string | null;
	/** The source document's id — lets a ledger row open the doc it came from
	 *  (`inbound` / `outbound` detail, or the transfer / adjustment list). */
	doc_id: string | null;
	/** `YYYY-MM-DD` — the source doc's effective/purchase/transfer date. */
	date: string | null;
	/** The receiving store (IN/OUT) — null on TRF lines (they carry the route). */
	location: string | null;
	/** TRF only — the transfer's source store. */
	from_location: string | null;
	/** TRF only — the transfer's destination store. */
	to_location: string | null;
	model_name: string | null;
	qty: number | null;
	/** Per-unit cost (IN/OUT only; transfers carry none). */
	unit_price: number | null;
	/** Batch models only — the moved lot no. */
	batch_no: string | null;
	/** Serial models only — the moved units as a JSON array string. */
	serials: string | null;
	note: string | null;
	/** The doc's creator, named from the employee directory — the same employee
	 *  name whether they signed in from Telegram or with an email + password. */
	created_name: string | null;
}

/** The header summary the ledger computes over the SAME active scope (minus the
 *  page key) so the top line never disagrees with the rows below it. */
export interface MovementSummary {
	total_in: number;
	total_out: number;
	total_trf: number;
	doc_count: number;
	line_count: number;
	/** The model's current on-hand over the scope — one store's balance when a
	 *  store filter is active, the total across stores otherwise. */
	on_hand: number | null;
}

/** ONE `/movement/ledger` response — a keyset-cursor page + the scope summary. */
export interface MovementLedger {
	rows: MovementLineRow[];
	/** The opaque next-page key — `null` = no more lines. */
	nextCursor: string | null;
	summary: MovementSummary;
}

/** ONE `/movement/lines` response (Screen 2) — a keyset-cursor page only (the
 *  group feed has no header summary; every row names its own model). */
export interface MovementGroupFeed {
	rows: MovementLineRow[];
	/** The opaque next-page key — `null` = no more lines. */
	nextCursor: string | null;
}

/**
 * Screen 2's list reading: the group's SKUs (`models` — the default register) or
 * its confirmed lines (`lines` — the transaction feed behind the second tab).
 */
export type MovementView = 'models' | 'lines';

/** ONE `/movement/models` row — one SKU of the group with its aggregated
 *  movement, so the group screen reads as a register of MODELS instead of a flat
 *  dump of every line (each row taps through to that SKU's ledger). */
export interface MovementModelRow {
	model: string;
	model_name: string | null;
	/** Σ qty over the scope's IN lines. */
	total_in: number;
	/** Σ qty over the scope's OUT lines. */
	total_out: number;
	/** Σ qty over the scope's TRF lines. */
	total_trf: number;
	/** How many movement lines those totals came from. */
	line_count: number;
	/** Distinct source documents (a doc with two lines counts once). */
	doc_count: number;
	/** `YYYY-MM-DD` of the newest line — `null` when the lines carry no date. */
	last_date: string | null;
}

/** ONE `/movement/models` response — a keyset-cursor page only. */
export interface MovementModelsFeed {
	rows: MovementModelRow[];
	/** The opaque next-page key — `null` = no more models. */
	nextCursor: string | null;
}
