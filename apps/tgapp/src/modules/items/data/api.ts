import type { MmbixClient } from '@mmbix/sdk';

import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { LIST_PAGE_SIZE, SEARCH_LIMIT } from '@/shared/constants';
import { sdk } from '@/shared/api/sdk';
import { MRO_TRACKING, type MroTracking } from '@/shared/mro';
import type { MroItemNameRow } from '@/shared/hooks/use-mro-masters';
import type { ItemCardModel, MasterPick, MroItemModelRow } from './types';

/**
 * The items module's typed client — the same local-cast pattern as the
 * store-requests / tyres modules: the app-wide client is typed against the
 * placeholder typegen `Schema` (no `mro_*` collections), so entity reads here
 * go through a locally-typed view of the same instance. The SKU reads ask only
 * for the columns they paint (see `CARD_FIELDS` / `MODEL_FIELDS` below): the card
 * expands `item_name.name_en` + `item_name.tracking` (its English label is the
 * GROUP name concatenated with the model's, and the stock policy lives on the
 * group), while the by-id form read additionally pulls the photo and the expiry
 * lead. The whole master collection (`mro_item_name`) is the
 * SHARED `['mro',…]` directory in `shared/hooks/use-mro-masters` (the inbound
 * form's pickers read it from ONE shared cache entry), so only the write /
 * by-id lookups stay here.
 */
type OpsSchema = {
	mro_item_model: MroItemModelRow;
	mro_item_name: MroItemNameRow & { name_en?: string | null };
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/**
 * The columns every CARD read asks for — exactly what `ItemCard` paints: the two
 * names, the GROUP's English label (the card's English line is
 * `"{group} {model}"`, so the group name rides in every row), the group's
 * `tracking` (the SKU's stock policy lives on the item NAME) and the SKU's
 * `image` (the card's left tile draws it, falling back to a monogram). The list +
 * search reads use THIS, not the wider `MODEL_FIELDS`: the card renders no expiry
 * lead, so requesting it would ship bytes every row discards.
 */
const CARD_FIELDS = ['id', 'name_en', 'name_mm', 'image', 'item_name.name_en', 'item_name.tracking'] as const;

/** The projection the by-id read (the EDIT form) needs — the card columns plus
 *  the expiry lead the form edits. Kept separate so a wider form need never widen
 *  the list payload. */
const MODEL_FIELDS = [...CARD_FIELDS, 'expiry_alert_days'] as const;

/** The SKU's stock policy — INHERITED from its item name (`item_name.tracking`);
 *  a read that did not expand the relation, or a master without a policy, reads
 *  as `standard` (the same fallback the engine applies). */
function trackingOf(row: MroItemModelRow): MroTracking {
	const raw = typeof row.item_name === 'object' && row.item_name ? row.item_name.tracking : null;
	return MRO_TRACKING.some((tracking) => tracking.value === raw) ? (raw as MroTracking) : 'standard';
}

/**
 * The display name of an m2o master value — a read that selected
 *  `item_name.name_en` receives the expanded object; any other
 *  read path (or a row written before classification) leaves the raw FK id or
 *  null. The master's name column differs per collection (`name_en` for
 *  `mro_item_name`), so the caller lists the keys to try.
 */
function relName(value: unknown, ...keys: string[]): string | null {
	if (!value || typeof value !== 'object') return null;
	for (const key of keys) {
		const name = (value as Record<string, unknown>)[key];
		if (typeof name === 'string' && name.trim()) return name.trim();
	}
	return null;
}

/**
 * A picker's selection — an m2o master value as the forms need it. Bare-FK-id
 *  reads (no name) and pruned `{ id, name }` reads both map here, so a form can
 *  round-trip an existing classification without ever clearing it.
 */
export function masterPickOf(value: unknown): MasterPick | null {
	if (typeof value === 'string' && value) return { id: value, name: null };
	if (value && typeof value === 'object') {
		const row = value as { id?: unknown };
		if (typeof row.id === 'string' && row.id) return { id: row.id, name: relName(row, 'name_en', 'name') };
	}
	return null;
}

/** One row → card: the English name (`name_en`), the Burmese name, the tracking
 *  badge's value (inherited from the item name) and the expiry-alert lead. The
 *  card's on-hand qty is NOT baked here — the list merges the
 *  (the card no longer shows a qty chip at all — the stock page owns that). */
export function itemCardOf(row: MroItemModelRow): ItemCardModel {
	const nameEn = typeof row.name_en === 'string' ? row.name_en.trim() : '';
	const nameMm = typeof row.name_mm === 'string' ? row.name_mm.trim() : '';
	// The English label is the GROUP name + the model name ("Air Filter AF-1001"),
	// so a bare model code never reads as an orphan on the catalog list. Each half
	// is optional in practice; the fallback chain keeps a nameless row printable.
	const groupEn = relName(row.item_name, 'name_en');
	return {
		id: row.id,
		name: [groupEn, nameEn].filter(Boolean).join(' ') || nameEn || '—',
		nameMm: nameMm || null,
		// The card's left tile prefers the real photo; a null image becomes the
		// monogram at render time (see `ItemThumb`).
		image: typeof row.image === 'string' && row.image ? row.image : null,
		tracking: trackingOf(row),
	};
}

/**
 * One page of the ပစ္စည်းများ list — `LIST_PAGE_SIZE` models at a time, sorted
 * by name (the catalog reads alphabetically). The list page streams pages via
 *  `useCursorList` + `LoadMoreSentinel` instead of loading the whole catalog up
 *  front. When `itemNameId` is given (a ပစ္စည်းအုပ်စု deep link), the read is
 *  server-filtered to that `mro_item_name` master.
 */
export async function fetchItemModelsPage(cursor?: string, itemNameId?: string): Promise<CursorPage<ItemCardModel>> {
	const res = await ops.items('mro_item_model').list({
		fields: CARD_FIELDS,
		sort: 'name_en',
		limit: LIST_PAGE_SIZE,
		cursor,
		filter: itemNameId ? { item_name: { _eq: itemNameId } } : undefined,
	});
	return {
		rows: res.data.map((row) => itemCardOf(row)),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/** The toolbar search — a server-side `?search=` read across the model's text
 *  fields (its name), mapped to the SAME card as the list so results always
 *  match it. A `?item_name=` deep link stays scoped: the search runs inside
 *  that master only. */
export async function fetchItemModelsSearch(query: string, itemNameId?: string): Promise<ItemCardModel[]> {
	const res = await ops.items('mro_item_model').list({
		fields: CARD_FIELDS,
		search: query,
		limit: SEARCH_LIMIT,
		filter: itemNameId ? { item_name: { _eq: itemNameId } } : undefined,
	});
	return res.data.map((row) => itemCardOf(row));
}

/** One model row by id — `null` when no such row exists (the lookup the card /
 *  edit flows use). */
export async function fetchItemModelById(id: string): Promise<MroItemModelRow | null> {
	const res = await ops.items('mro_item_model').list({
		filter: { id: { _eq: id } },
		fields: MODEL_FIELDS,
		limit: 1,
	});
	return res.data[0] ?? null;
}

/**
 * One `mro_item_name` master by id — `null` when no such row (the
 * `?item_name=` preselect lookup on the create form). The master's only name
 * column is the indexed `name_en`, which is normalized onto `name` exactly like
 * the shared whole-set directory, so the form and the picker show one label.
 */
export async function fetchItemNameById(id: string): Promise<MroItemNameRow | null> {
	const res = await ops.items('mro_item_name').list({
		filter: { id: { _eq: id } },
		fields: ['id', 'name_en', 'tracking'],
		limit: 1,
	});
	const row = res.data[0];
	if (!row) return null;
	return { id: row.id, name: row.name_en?.trim() || null, tracking: row.tracking ?? null };
}

/**
 * Quick-add one `mro_item_name` master (the picker sheet's "ထည့်မည်" row). The
 * POLICY is chosen here, at creation — it is a property of the master, not of a
 * SKU, and the whole point of the master-level rule is that it is set once.
 */
export async function createItemNameMaster(name: string, tracking: MroTracking): Promise<MroItemNameRow> {
	const row = await ops.items('mro_item_name').create({ name_en: name, tracking });
	return { id: row.id, name: row.name_en?.trim() || name, tracking: row.tracking ?? tracking };
}

/** The create form's payload — every field the model catalog can set. The stock
 *  tracking POLICY is deliberately absent: it belongs to the item name. */
export interface ItemModelCreateInput {
	/** The English display name — written to the indexed `name_en`. */
	name_en: string;
	/** The Burmese display name (`name_mm`) — null/empty = no translation. */
	name_mm?: string | null;
	/** Expiry-alert lead in days — null = never alert (an empty input). */
	expiry_alert_days: number | null;
	/** The photo — an R2 media URL (`/api/media/<key>`), or null to keep none. */
	image?: string | null;
	/** The classification master (`mro_item_name`) id — REQUIRED: it is also the
	 *  SKU's tracking policy, so a SKU can never be created without one. */
	item_name: string;
}

/** Create one model — replay-safe via the SDK client's client-generated id.
 *  Only the keys the form actually set are sent (empty optionals omitted, so
 *  the backend defaults stand for them). */
export async function createItemModel(input: ItemModelCreateInput): Promise<MroItemModelRow> {
	return ops.items('mro_item_model').create({
		name_en: input.name_en,
		item_name: input.item_name,
		...(input.name_mm ? { name_mm: input.name_mm } : {}),
		...(input.expiry_alert_days != null ? { expiry_alert_days: input.expiry_alert_days } : {}),
		...(input.image ? { image: input.image } : {}),
	});
}

/**
 * Update one model — the edit form's save. Unlike create, EMPTY optionals are
 *  sent EXPLICITLY as null so an operator can clear a classification/alert that
 *  a previous save set; neither `tracking` (it lives on the item name) nor
 *  `item_name` (required — it is the policy source) can be cleared.
 */
export async function updateItemModel(id: string, input: ItemModelCreateInput): Promise<MroItemModelRow> {
	return ops.items('mro_item_model').update(id, {
		name_en: input.name_en,
		name_mm: input.name_mm?.trim() ? input.name_mm.trim() : null,
		expiry_alert_days: input.expiry_alert_days,
		image: input.image ?? null,
		item_name: input.item_name,
	});
}

/** Upload a photo to R2 and return the media URL to store in `image`. The ONE
 *  upload client lives in `@/shared/api/media` (shared with the fleets truck
 *  photo); the items module keeps its historical name so callers don't churn. */
export { uploadImage as uploadItemImage } from '@/shared/api/media';
