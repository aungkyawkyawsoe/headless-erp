import type { MroTracking } from '@/shared/mro';

/** A picker's master selection — `{ id, name }` as the SKU forms hold it. */
export interface MasterPick {
	/** The master row's uuid (`mro_item_name`). */
	id: string;
	/** The master's display name — null when only the FK id was read. */
	name: string | null;
}

/**
 * Row shapes for the ပစ္စည်းများ (MRO item models) module — the MRO
 * stock-keeping unit IS the `mro_item_model` collection.
 *
 * The row is hand-declared because the typegen `Schema` the app-wide SDK client
 * is typed against has no `mro_*` collections (see `data/api.ts`'s local-cast
 * pattern). There is NO `mro_items` / `mro_category` / `store_items` collection
 * this backend — `mro_item_model` is the SKU plus its classification m2o fields:
 * `item_name` → `mro_item_name` (the generic part name AND the owner of the
 * stock tracking policy). Reads that ask for `item_name.name_en` receive that m2o
 * field EXPANDED as `{ id, … }`; a read that never selects the relation leaves the
 * raw FK id — both shapes can arrive on the wire, so the field type allows both.
 */

/** `mro_item_model` — one MRO stock-keeping unit (SKU). */
export interface MroItemModelRow {
	id: string;
	/** The English display name (required, indexed) — the SKU's primary label. */
	name_en?: string | null;
	/** The Burmese display name — null when no translation is set yet. */
	name_mm?: string | null;
	/** Expiry-alert lead in days (read by `/api/mro/stock/expiring`) — null = no alert. */
	expiry_alert_days?: number | null;
	/** The photo — an R2 media URL (`/api/media/<key>`). Nullable: a SKU may
	 *  have no picture yet. */
	image?: string | null;
	/** The classification master — the `mro_item_name` row (Bulb, Clutch,
	 *  Tyre…) as a bare id OR the expanded object. It is ALSO the SKU's stock
	 *  tracking policy: the SKU has no `tracking` column, the policy is read from
	 *  `item_name.tracking`. Required — a SKU with no item name has no policy. */
	item_name?: string | { id: string; name_en?: string | null; tracking?: string | null } | null;
	created_at?: string | null;
	updated_at?: string | null;
}

/** One item card row — the SKU's English name and its Burmese name. Deliberately
 *  carries NOTHING the card does not paint: the list read asks only for these
 *  columns (`CARD_FIELDS` in `data/api.ts`) — `tracking` rides along for the
 *  list's `?tracking=` FILTER, not for a badge on the card. */
export interface ItemCardModel {
	id: string;
	/** English display name (`name_en`) — falls back to "—" when the row has none. */
	name: string;
	/** Burmese display name (`name_mm`) — null when no translation is set. */
	nameMm: string | null;
	/** The SKU's photo URL (`/api/media/<key>`), or null — the card then draws
	 *  the item's monogram instead (`ItemThumb`). */
	image: string | null;
	/** The policy INHERITED from the SKU's item name — the client-side FILTER key
	 *  on the items list. The card itself paints no badge for it. */
	tracking: MroTracking;
}
