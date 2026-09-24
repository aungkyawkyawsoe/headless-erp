/**
 * Row shapes for the အုပ်စု (item-group) module — the launcher's "item groups"
 * screen, now a REAL master-data browser. The groups come from ONE aggregate
 * `GET /api/mro/catalog/groups` read (the server joins `mro_item_model` under
 * `mro_item_name` and counts): rows of the generic part-name master (Bulb,
 * Clutch, Tyre, Engine Oil, Bolt, Tools) appear once at least one SKU points
 * at them, and the SKUs that share a master are that group's members. An empty
 * master (one with no SKUs) is not shown.
 *
 * There is NO tracking-policy grouping here anymore — `tracking` (standard /
 * batch / serial) is a per-MASTER stock policy (declared once on `mro_item_name`
 * and inherited by every SKU under it). A group card deliberately does NOT render
 * it (see `GroupCard`), so the summary row does not carry it either: a field no
 * consumer reads is work done for nothing.
 * Rows are hand-declared like every module migrated to the new schema (the
 * typegen `Schema` has no `mro_*` collections).
 */

/** `mro_item_name` — one generic part-name master row (the group itself). */
export interface MroItemNameRow {
	id: string;
	/** The group's English display name (e.g. "Bulb"). */
	name_en?: string | null;
	/** The group's Myanmar display name (e.g. "မီးသီး"). */
	name_mm?: string | null;
	/** The stock policy every SKU under this group inherits. */
	tracking?: string | null;
}

/** `mro_suppliers` — one supplier master row (Global Tyre, MM Auto Parts…). */
export interface MroSupplierRow {
	id: string;
	/** The supplier's display name. */
	name?: string | null;
	/** The supplier's contact number — the GRN form's "call the vendor" quick fact. */
	mobile?: string | null;
	/** The supplier's business address. */
	address?: string | null;
}

/** One item-name master group — the summary card on the ပစ္စည်းအုပ်စု page. */
export interface MroModelGroup {
	/** The master row id — also the `?item_name=` deep-link value. */
	id: string;
	/** The group's English display name (name_en). */
	nameEn: string;
	/** The group's Myanmar display name (name_mm). */
	nameMm: string;
	/** Total SKUs under this master. */
	count: number;
	/** The parent category the hub files the group under (nav grouping). */
	categoryId: string | null;
	categoryNameEn: string | null;
	categoryNameMm: string | null;
}

/** One `veh_issue_types` row as the Master hub's Issues card — the Myanmar
 *  name front (the card's headline) and the `mro_item_categories` it belongs to
 *  behind it (the card's sublabel + the strip that filters the list). Read-only:
 *  issue types are curated in the Maintenance module, never here. */
export interface MroIssueTypeRow {
	id: string;
	/** The issue type's English display name (name_en) — the sort key. */
	nameEn: string | null;
	/** The issue type's Myanmar display name (name_mm) — the card's headline. */
	nameMm: string | null;
	/** The parent `mro_item_categories` id (m2o `category`) — the strip filter. */
	categoryId: string | null;
	categoryNameEn: string | null;
	categoryNameMm: string | null;
}
