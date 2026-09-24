import type { MmbixClient } from '@mmbix/sdk';

import { sdk } from '@/shared/api/sdk';
import { fetchAllPages } from '@/shared/api/fetch-all';
import { createMroSupplier } from '@/shared/hooks/use-mro-masters';
import { mroApi, type MroTracking } from '@/shared/mro';
import type { MroIssueTypeRow, MroItemNameRow, MroModelGroup, MroSupplierRow } from './types';

/**
 * The MRO categories module's typed client — the same local-cast pattern as
 * the items / store-requests modules: the app-wide client is typed against the
 * placeholder typegen `Schema`, so entity reads here go through a
 * locally-typed view of the same instance. The masters hub reads the အုပ်စု
 * group directory from the aggregate `/api/mro/catalog/groups` report (ONE
 * server-scoped query — masters are bounded, so no cursor-walking) and the
 * `mro_suppliers` sibling master tab whole — the whole-set tab read lives in
 * `shared/hooks/use-mro-masters` (ONE shared cache entry per master, shared
 * with the item form's pickers + the inbound form's supplier picker), so only
 * the write / by-id lookups stay here.
 */

/** `veh_issue_types` wire row — `category` is an m2o whose related
 *  `mro_item_categories` row is expanded when the dotted path is requested (a
 *  bare read leaves it a raw id string). */
interface IssueTypeWireRow {
	id: string;
	name_en?: string | null;
	name_mm?: string | null;
	category?: string | { id?: unknown; name_en?: unknown; name_mm?: unknown } | null;
}

type OpsSchema = {
	mro_item_name: MroItemNameRow;
	mro_suppliers: MroSupplierRow;
	veh_issue_types: IssueTypeWireRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** A relation value → `{ id, nameEn, nameMm }` (the engine returns the expanded
 *  related row when the dotted path is requested, or a bare id string). */
function relationOf(value: unknown): { id: string | null; nameEn: string | null; nameMm: string | null } {
	if (typeof value === 'string') return { id: value, nameEn: null, nameMm: null };
	if (value && typeof value === 'object') {
		const row = value as { id?: unknown; name_en?: unknown; name_mm?: unknown };
		return {
			id: typeof row.id === 'string' ? row.id : null,
			nameEn: typeof row.name_en === 'string' && row.name_en ? row.name_en : null,
			nameMm: typeof row.name_mm === 'string' && row.name_mm ? row.name_mm : null,
		};
	}
	return { id: null, nameEn: null, nameMm: null };
}

/**
 * The whole အုပ်စု page read — ONE aggregate `GET /api/mro/catalog/groups`
 * fetch: every `mro_item_name` master that has at least one live SKU, with
 * that count, name-sorted server-side. (The hub used to DERIVE this by
 * cursor-walking the WHOLE `mro_item_model` catalogue and bucketing SKUs by
 * their expanded master — the aggregate replaces that walk with one query.)
 * The master's OWN `tracking` is NOT mapped: no card renders it any more.
 */
export async function fetchMroGroups(): Promise<MroModelGroup[]> {
	const { rows } = await mroApi.catalogGroups();
	return rows.map((row) => ({
		id: row.id,
		nameEn: (row.name_en ?? row.name ?? '').trim(),
		nameMm: row.name_mm ?? '',
		count: row.count,
		categoryId: row.category_id,
		categoryNameEn: row.category_name_en,
		categoryNameMm: row.category_name_mm,
	}));
}

/** Create one item-name master row — replay-safe via the SDK client's
 *  client-generated id. `tracking` is REQUIRED: the master owns its SKUs' stock
 *  policy and there is no per-SKU override to add later. */
export async function createItemName(nameEn: string, nameMm: string, tracking: MroTracking): Promise<MroItemNameRow> {
	return ops.items('mro_item_name').create({ name_en: nameEn, name_mm: nameMm, tracking });
}

/** The whole `veh_issue_types` set — the Master hub's Issues tab. Issue types
 *  are bounded, so the whole-set read is ONE paged walk (name-sorted). Master
 *  data is never created/edited here — the tab is a read-only directory — so a
 *  row's only job is to carry the name the card headlines (`name_mm`) and the
 *  `mro_item_categories` it files under (`category`, expanded to its names). */
export async function fetchMroIssueTypes(): Promise<MroIssueTypeRow[]> {
	const rows = await fetchAllPages((cursor, pageSize) =>
		ops.items('veh_issue_types').list({
			fields: ['id', 'name_en', 'name_mm', 'category.id', 'category.name_mm', 'category.name_en'],
			sort: 'name_en',
			limit: pageSize,
			cursor,
		}),
	);
	return rows.map((row) => {
		const category = relationOf(row.category);
		return {
			id: row.id,
			nameEn: row.name_en?.trim() || null,
			nameMm: row.name_mm?.trim() || null,
			categoryId: category.id,
			categoryNameEn: category.nameEn,
			categoryNameMm: category.nameMm,
		};
	});
}

/** One `mro_item_name` master by id — `null` when no such row (the rename form's lookup). */
export async function fetchItemNameById(id: string): Promise<MroItemNameRow | null> {
	const res = await ops.items('mro_item_name').list({
		filter: { id: { _eq: id } },
		fields: ['id', 'name_en', 'name_mm', 'tracking'],
		limit: 1,
	});
	return res.data[0] ?? null;
}

/** Rename one item-name master (`mro_item_name`) — the edit form's save. The
 *  `tracking` policy is set once at creation and deliberately NOT writable here:
 *  every SKU under the group has already inherited it. */
export async function renameItemName(id: string, nameEn: string, nameMm: string): Promise<MroItemNameRow> {
	return ops.items('mro_item_name').update(id, { name_en: nameEn, name_mm: nameMm });
}

/** Create one supplier master row (`mro_suppliers`) — the tab's create form.
 *  DELEGATES to the shared writer (`createMroSupplier`), which the inbound GRN
 *  picker's in-sheet add layout also uses: the supplier master has ONE create,
 *  so the two hosts can never drift on what a supplier is. `mobile` / `address`
 *  are optional contact facts the GRN flow reads. */
export const createSupplier = createMroSupplier;

/** One `mro_suppliers` master by id — `null` when no such row (the rename form's lookup). */
export async function fetchSupplierById(id: string): Promise<MroSupplierRow | null> {
	const res = await ops.items('mro_suppliers').list({
		filter: { id: { _eq: id } },
		fields: ['id', 'name', 'mobile', 'address'],
		limit: 1,
	});
	return res.data[0] ?? null;
}

/** Save one supplier master's details (`mro_suppliers`) — the edit form's save. */
export async function renameSupplier(id: string, input: { name: string; mobile?: string; address?: string }): Promise<MroSupplierRow> {
	return ops.items('mro_suppliers').update(id, input);
}

/** Soft-delete one item-name master (`mro_item_name`). The engine's RESTRICT guard
 *  refuses it (409) while any SKU still points at the group. */
export async function removeItemName(id: string): Promise<void> {
	await ops.items('mro_item_name').remove(id);
}

/** Soft-delete one supplier master (`mro_suppliers`). Refused (409) while any
 *  inbound document uses it. */
export async function removeSupplier(id: string): Promise<void> {
	await ops.items('mro_suppliers').remove(id);
}
