/**
 * MRO catalogue read — the item-group directory the item-groups hub renders, with
 * its own short-TTL response cache (the tags listed there are what keep the cache
 * correct). Moved verbatim out of `stock-reads.ts`; the facade delegates here.
 */
import type { D1Client } from '@mmbix/core';
import { readCacheKey, readCached, storeCached } from '@mmbix/core';
import type { CatalogGroupRow, Tables } from './types';

export class CatalogReads {
	constructor(
		private readonly db: D1Client,
		private readonly tables: Tables,
	) {}
	/**
	 * The whole catalogue's item-group directory — every item-name master that has
	 * at least one live (non-deleted) SKU, with that SKU count, name-sorted. The
	 * item-groups hub (tgapp `/app/mro-categories`) used to DERIVE this on the
	 * client by cursor-walking the WHOLE `mro_item_model` catalogue; this is the
	 * same result in ONE aggregate query (masters are bounded, SKUs are not). A
	 * master with no live models is STILL listed, with `count: 0` — the hub is the
	 * only place a group can be managed, so a freshly created (SKU-less) group must
	 * appear there rather than vanish until its first SKU exists.
	 */
	async catalogGroups(): Promise<{ rows: CatalogGroupRow[] }> {
		// A WHOLE-CATALOGUE aggregate (every group + its live SKU count) that runs on
		// every visit to the item-groups hub. Its inputs are the three masters, which
		// only admin edits touch — so the result is cached and TAGGED with each of
		// them. A write to ANY of the three drops this entry through the `readdep:`
		// tag (`invalidateCollectionReads` already clears those), so the cache can
		// never serve a stale count, with no TTL guesswork. The key carries no auth
		// fingerprint because the directory is identical for every role (the query
		// has no row filter).
		const cacheKey = readCacheKey('mro_catalog_groups', 'shared', 'catalog-groups');
		const cached = readCached<{ rows: CatalogGroupRow[] }>(cacheKey);
		if (cached) return cached;

		const t = this.tables;
		// Category-major read (the hub groups the nav by category). A deployment
		// whose schema predates `mro_item_categories` / the `category` column must
		// still list the directory — the category columns simply come back NULL and
		// the client folds everything into its trailing "Uncategorized" section.
		const GROUP_QUERY = (
			withCategory: boolean,
		) => `SELECT G.id AS id, COALESCE(NULLIF(G.name_en, ''), G.name_mm) AS name, G.name_en AS name_en, G.name_mm AS name_mm,
			             G.tracking AS tracking, COUNT(M.id) AS count${
											withCategory
												? `,
			             C.id AS category_id, C.name_en AS category_name_en, C.name_mm AS category_name_mm`
												: `,
			             NULL AS category_id, NULL AS category_name_en, NULL AS category_name_mm`
										}
			        FROM ${t.group} G
			        LEFT JOIN ${t.model} M ON M.item_name = G.id AND M.deleted_at IS NULL${
								withCategory ? `\n			        LEFT JOIN ${t.category} C ON C.id = G.category AND C.deleted_at IS NULL` : ''
							}
			       WHERE G.deleted_at IS NULL
			       GROUP BY G.id
			       ORDER BY ${withCategory ? 'C.name_en IS NULL, C.name_en COLLATE NOCASE ASC, ' : ''}G.name_en COLLATE NOCASE ASC, G.id ASC`;
		let rows: Record<string, unknown>[];
		try {
			rows = await this.db.all<Record<string, unknown>>({ sql: GROUP_QUERY(true), bindings: [] });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!/no such (table|column)/i.test(message)) throw error;
			rows = await this.db.all<Record<string, unknown>>({ sql: GROUP_QUERY(false), bindings: [] });
		}
		const result = {
			rows: rows.map((r) => ({
				id: String(r.id ?? ''),
				name: r.name == null ? null : String(r.name),
				name_en: r.name_en == null ? null : String(r.name_en),
				name_mm: r.name_mm == null ? null : String(r.name_mm),
				tracking: r.tracking == null ? null : String(r.tracking),
				count: Number(r.count ?? 0),
				category_id: r.category_id == null ? null : String(r.category_id),
				category_name_en: r.category_name_en == null ? null : String(r.category_name_en),
				category_name_mm: r.category_name_mm == null ? null : String(r.category_name_mm),
			})),
		};
		storeCached(cacheKey, result, 60_000, ['mro_item_name', 'mro_item_model', 'mro_item_categories']);
		return result;
	}
}
