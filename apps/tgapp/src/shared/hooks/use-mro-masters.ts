import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { MmbixClient } from '@mmbix/sdk';

import { fetchAllPages } from '@/shared/api/fetch-all';
import { readPersistedMasters, writePersistedMasters } from '@/shared/api/persisted-masters';
import { sdk } from '@/shared/api/sdk';
import { MASTER_STALE_MS } from '@/shared/constants';

/**
 * The canonical whole-set CLASSIFICATION-master directories — `mro_suppliers`
 * and `mro_item_name`. ONE cache entry per master
 * (`['mro','suppliers']` / `['mro','item-names']`, the
 * app-wide master freshness tier), shared by every module that joins them:
 * the item create/edit form's pickers (items), the masters-hub tabs
 * (mro-categories) and the inbound doc form's supplier picker (inbounds).
 *
 * Each of those modules used to cursor-walk the SAME rows under its own
 * module-scoped key — the same screen fetched the same masters two or three
 * times in one visit, and a master added in one module stayed invisible to
 * another module's pickers until its own key expired. Every whole-set read now
 * collides into one cached query, and every writer (the quick-add rows + the
 * masters-hub create/edit pages) invalidates the same key write-through.
 *
 * `mro_item_name` displays as a bilingual pair (`name_en` required + indexed,
 * `name_mm` Burmese) — there is no free-text `name` column anymore, so the
 * directory's `name` is its own normalized alias for `name_en`.
 */
export const MRO_SUPPLIERS_QUERY_KEY = ['mro', 'suppliers'] as const;
export const MRO_ITEM_NAMES_QUERY_KEY = ['mro', 'item-names'] as const;
export const MRO_CATEGORIES_QUERY_KEY = ['mro', 'categories'] as const;

/** `mro_item_categories` — one top-level category master (Engine & Gear Box…).
 *  Carries BOTH names so a reader can label in the operator's language (Myanmar)
 *  and still key its glyph off the stable English identity. */
export interface MroCategoryRow {
	id: string;
	/** The English display name — the icon key. */
	nameEn: string | null;
	/** The Burmese display name — the operator-facing label. */
	nameMm: string | null;
	/** Whether this category applies to issue TYPES (maintenance job families).
	 *  `false` (the default) marks a catalog-only category — the Maintenance hub's
	 *  Issues strip excludes those, while the part/stock strips keep them. */
	issuesType: boolean;
}

/** `mro_suppliers` — one supplier master row (Global Tyre, MM Auto Parts…). */
export interface MroSupplierRow {
	id: string;
	name?: string | null;
	/** The supplier's contact number (the Suppliers tab row + edit form's fact). */
	mobile?: string | null;
	/** The supplier's business address. */
	address?: string | null;
}

/** `mro_item_name` — one generic part-name master (Bulb, Clutch, Tyre…) PLUS the
 *  stock tracking policy every SKU under it inherits, as a picker needs it: a
 *  single normalized `name` (the fetch maps `name_en` onto it). */
export interface MroItemNameRow {
	id: string;
	/** The master's English display name (`name_en`, the only name column). */
	name?: string | null;
	/** The master's Burmese display name (`name_mm`) — null when unset. */
	nameMm?: string | null;
	/** `standard` | `batch` | `serial` — the policy every SKU inherits. */
	tracking?: string | null;
}

type MastersSchema = {
	mro_suppliers: MroSupplierRow;
	mro_item_name: MroItemNameRow & { name_en?: string | null; name_mm?: string | null };
	mro_item_categories: { id: string; name_en?: string | null; name_mm?: string | null; issues_type?: boolean | null };
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<MastersSchema>;

/** The whole `mro_suppliers` set, name-sorted. Carries the contact facts
 *  (`mobile` / `address`) the Suppliers tab rows + inbound picker show. */
export async function fetchMroSuppliers(): Promise<MroSupplierRow[]> {
	return fetchAllPages((cursor, pageSize) =>
		ops.items('mro_suppliers').list({ fields: ['id', 'name', 'mobile', 'address'], sort: 'name', limit: pageSize, cursor }),
	);
}

/**
 * Create ONE `mro_suppliers` master — the ONE writer for the supplier master.
 *
 * Both places that add a supplier go through here: the masters hub's
 * “New Supplier” page and the inbound (GRN) picker's in-sheet add layout. They
 * used to keep a copy each (one name-only, one with the contact facts), so the
 * two could drift on what a supplier IS. `name` is required, `mobile` /
 * `address` are the optional contact facts a receipt reads.
 *
 * The caller folds the returned row into the shared directory with
 * `upsertMasterDirectory(queryClient, MRO_SUPPLIERS_QUERY_KEY, row)` — the write
 * half of this file's cache contract, so the new row paints without a refetch.
 */
export async function createMroSupplier(input: { name: string; mobile?: string; address?: string }): Promise<MroSupplierRow> {
	return ops.items('mro_suppliers').create(input);
}

/**
 * The whole `mro_item_name` set — name-sorted by its indexed English name. The
 * free-text `name` column is gone, so `name_en` is both the sort key and the
 * display name (normalized onto `name` so consumers read ONE field).
 */
export async function fetchMroItemNames(): Promise<MroItemNameRow[]> {
	const rows = await fetchAllPages((cursor, pageSize) =>
		ops.items('mro_item_name').list({ fields: ['id', 'name_en', 'name_mm', 'tracking'], sort: 'name_en', limit: pageSize, cursor }),
	);
	return rows.map((row) => ({
		id: row.id,
		name: row.name_en?.trim() || null,
		nameMm: row.name_mm?.trim() || null,
		tracking: row.tracking ?? null,
	}));
}

/** The whole-set item-name directory — cached for the app-wide master window.
 *  Pass `enabled: false` to skip the read entirely (e.g. a screen whose rows
 *  already carry their Burmese name needs no directory join). */
export function useMroItemNames(options: { enabled?: boolean } = {}) {
	// Device seed — a returning open paints the directory instantly; stale seeds
	// revalidate in the background (see `persisted-masters`).
	const seed = useMemo(() => readPersistedMasters<MroItemNameRow[]>('mro_item_name'), []);
	return useQuery({
		queryKey: MRO_ITEM_NAMES_QUERY_KEY,
		queryFn: async () => {
			const data = await fetchMroItemNames();
			writePersistedMasters('mro_item_name', data);
			return data;
		},
		staleTime: MASTER_STALE_MS,
		enabled: options.enabled ?? true,
		initialData: seed?.data,
		initialDataUpdatedAt: seed?.at,
	});
}

/** The whole `mro_item_categories` set — name-sorted, bilingual. Read by the
 *  category STRIP on the stock browser and the masters hub (the on-hand report
 *  carries the id + an English-first label; the strip labels in Myanmar from THIS
 *  shared directory, so both category selectors read the same names). Each row
 *  also carries `issues_type`, the flag distinguishing the maintenance job
 *  families from catalog-only categories. */
export async function fetchMroCategories(): Promise<MroCategoryRow[]> {
	const rows = await fetchAllPages((cursor, pageSize) =>
		ops
			.items('mro_item_categories')
			.list({ fields: ['id', 'name_en', 'name_mm', 'issues_type'], sort: 'name_en', limit: pageSize, cursor }),
	);
	return rows.map((row) => ({
		id: row.id,
		nameEn: row.name_en?.trim() || null,
		nameMm: row.name_mm?.trim() || null,
		issuesType: row.issues_type === true,
	}));
}

/** The whole-set category directory — cached for the app-wide master window. */
export function useMroCategories() {
	const seed = useMemo(() => readPersistedMasters<MroCategoryRow[]>('mro_item_categories'), []);
	return useQuery({
		queryKey: MRO_CATEGORIES_QUERY_KEY,
		queryFn: async () => {
			const data = await fetchMroCategories();
			writePersistedMasters('mro_item_categories', data);
			return data;
		},
		staleTime: MASTER_STALE_MS,
		initialData: seed?.data,
		initialDataUpdatedAt: seed?.at,
	});
}

// ── Write-through (the write half of the cache contract) ───────────────────
//
// The one perceived-latency rule for these whole-set directories: a write pays
// exactly ONE network round trip (the POST/PUT/DELETE itself) — never a second
// refetch to "see" the change. The server already returns the exact row it
// wrote, so the writer folds it into the shared directory here (setQueryData,
// re-stamped as fresh) instead of the old invalidate-only dance that marked the
// entry stale and made the hub's next mount refetch the whole set over a mobile
// RTT before the row painted (~1s of dead air on every add/rename/delete).
//
// FOLD-SAFETY RULE (which writers may use these helpers):
//   FOLD when the mutation response IS the cached row (the name-only masters).
//   INVALIDATE when a list's rows are a derived shape the raw write response
//   cannot provide (m2o expansions, joins, line tables, report aggregates) —
//   folding there would paint wrong data. The refetch behind the paint is the
//   honest cost for derived readers; the cached list still paints instantly.
//
// Sorting mirrors the server's `sort: 'name'` ASC (SQLite code-unit order), so a
// folded row sits exactly where the next real fetch would place it — the view
// never drifts from the truth, it just skips the refetch.

/** Ascending code-unit `name` order — mirrors the server's `sort: 'name'`. */
const byServerName = (a: { name?: string | null }, b: { name?: string | null }): number => {
	const an = a.name ?? '';
	const bn = b.name ?? '';
	return an === bn ? 0 : an < bn ? -1 : 1;
};

function readDirectory(queryClient: QueryClient, key: readonly unknown[]): { id: string; name?: string | null }[] | undefined {
	return queryClient.getQueryData<{ id: string; name?: string | null }[]>(key);
}

/**
 * Fold one master row into a whole-set directory — create or rename (matched by
 * id). Back-compat only when the directory is not cached yet: the next reader
 * fetches the truth, so invalidating is right; when it IS cached the row is
 * written through and the entry re-stamped fresh (no refetch).
 */
export function upsertMasterDirectory<R extends { id: string; name?: string | null }>(
	queryClient: QueryClient,
	key: readonly unknown[],
	row: R,
): void {
	const cached = readDirectory(queryClient, key);
	if (!cached) {
		void queryClient.invalidateQueries({ queryKey: key, refetchType: 'active' });
		return;
	}
	const kept = cached.filter((r) => r.id !== row.id);
	queryClient.setQueryData(key, [...kept, row].sort(byServerName));
}

/** Drop one master row from a whole-set directory (the delete path). */
export function dropMasterFromDirectory(queryClient: QueryClient, key: readonly unknown[], id: string): void {
	const cached = readDirectory(queryClient, key);
	if (!cached) {
		void queryClient.invalidateQueries({ queryKey: key, refetchType: 'active' });
		return;
	}
	queryClient.setQueryData(
		key,
		cached.filter((r) => r.id !== id),
	);
}
