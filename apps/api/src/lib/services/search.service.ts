/**
 * Full-Text Search Service (D1 FTS5 + LIKE fallback)
 *
 * Single, unified multi-entity search (v2):
 *   GET /api/search/global?q=keyword&collections=articles,products&limit=20
 *   POST /api/search/global-index  (admin — rebuild unified FTS5 index)
 *
 * The old v1 per-collection FTS5 search (`GET /api/search`, `POST /api/search/build`)
 * was removed — v2's unified `_search_index` table replaces it with one index,
 * one code path, and a LIKE fallback for non-FTS environments.
 */

import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { sanitizeIdentifier, SEARCHABLE_FIELD_TYPES } from '@mmbix/utils';
import type { EntitySchema } from '@mmbix/types';
import { DataFilterService } from '@/lib/services/data-filter.service';
import { findAllCollections } from '@/lib/services/schema-lookup';
import type { AuthContext } from '@/lib/services/auth.service';

// ─── Interfaces ────────────────────────────────────────

export interface GlobalSearchResult {
	collection: string;
	collection_label: string;
	id: string;
	title: string;
	snippet: string;
	fields: Record<string, unknown>;
	score: number;
}

export interface GlobalSearchOptions {
	query: string;
	collections?: string[];
	limit?: number;
	cursor?: string;
}

export interface GlobalSearchMeta {
	total: number;
	collection_counts: Record<string, number>;
	has_more?: boolean;
	next_cursor?: string | null;
}

// ─── Search Service ──────────────────────────────────────

export class SearchService {
	constructor(
		private db: D1Client,
		private auth?: AuthContext | null,
	) {}

	/**
	 * Every collection's schema, through the SHARED schema cache.
	 *
	 * Search used to run its own uncached `SELECT *` of `_entity_schemas` on every
	 * query — dragging every collection's whole `schema_json` blob over the wire
	 * for what is really a slug/name/field-type lookup. The cached registry read is
	 * the same row shape, drops the per-query D1 round-trip, and shares the one
	 * invalidation seam (`cache.invalidateCollection`) with every other reader.
	 */
	private collections(): Promise<EntitySchema[]> {
		return findAllCollections(this.db);
	}

	/**
	 * Row-level RBAC: return the subset of `ids` the caller's role is allowed to
	 * see in `collectionSlug` (admins and roles without a row filter see all).
	 */
	private async _filterIdsByRowAccess(collectionSlug: string, tableName: string, ids: string[]): Promise<Set<string>> {
		if (!this.auth || this.auth.is_admin) return new Set(ids);
		const uniqueIds = [...new Set(ids)];
		if (uniqueIds.length === 0) return new Set();
		const qb = QueryBuilder.from(tableName).select('id').whereIn('id', uniqueIds);
		await DataFilterService.applyRowFilter(qb, { db: this.db, auth: this.auth, collectionSlug });
		const rows = await this.db.all<{ id: string }>(qb.toSelect());
		return new Set(rows.map((r) => String(r.id)));
	}

	// ── Global Multi-Entity Search ────────────────────────

	/**
	 * Build a unified FTS5 search index across all collections.
	 * Creates `_search_index` virtual table with (entity_type, entity_id, title, body).
	 */
	async buildGlobalIndex(): Promise<number> {
		const collections = await this.collections();

		// Drop existing global FTS index
		await this.db.exec('DROP TABLE IF EXISTS _search_index');
		await this.db.exec('DROP TABLE IF EXISTS _search_content');

		// Create a content table to back the FTS index
		await this.db.exec(
			'CREATE TABLE IF NOT EXISTS _search_content (rowid INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT "", body TEXT NOT NULL DEFAULT "")',
		);

		// Bounded, cursor-paginated harvest: pages of BATCH rows per collection,
		// chunked multi-row inserts (25 rows × 4 cols = 100 params — D1's hard
		// limit). The old row-per-INSERT loop + unbounded SELECT * could blow
		// memory/CPU (Error 1102) on large tables.
		const BATCH = 1000;
		const CHUNK = 25;
		let total = 0;
		for (const c of collections) {
			const textFields = this._getTextFields(c);
			if (textFields.length === 0) continue;

			const safeTable = sanitizeIdentifier(c.table_name, 'SearchService.table');
			// Only the columns we actually index (+ id) — not SELECT *.
			let lastId: string | null = null;
			for (;;) {
				const pageQb = QueryBuilder.from(safeTable)
					.select('id', ...textFields)
					.whereNull('deleted_at')
					.orderBy('id', 'asc')
					.limit(BATCH);
				if (lastId) pageQb.where('id', '>', lastId);
				const items = await this.db.all<Record<string, unknown>>(pageQb.toSelect());
				if (items.length === 0) break;

				const rows: Record<string, unknown>[] = [];
				for (const item of items) {
					const title = this._extractTitle(item, textFields);
					const body = textFields
						.map((f) => String(item[f] ?? ''))
						.filter(Boolean)
						.join(' ');
					rows.push({ entity_type: c.slug, entity_id: String(item.id), title, body });
					total++;
				}
				for (let i = 0; i < rows.length; i += CHUNK) {
					await this.db.run(QueryBuilder.from('_search_content').toInsertMany(rows.slice(i, i + CHUNK)));
				}

				lastId = String(items[items.length - 1].id);
				if (items.length < BATCH) break;
			}
		}

		// Create the FTS5 virtual table on top of the content table
		await this.db.exec(
			"CREATE VIRTUAL TABLE IF NOT EXISTS _search_index USING fts5(entity_type, entity_id, title, body, content='_search_content', content_rowid='rowid')",
		);

		// Rebuild the index from the content table
		await this.db.run(QueryBuilder.raw("INSERT INTO _search_index(_search_index) VALUES ('rebuild')"));

		return total;
	}

	/**
	 * v2: Global multi-entity search.
	 *
	 * Strategy 1 (FTS5): Queries the unified `_search_index` FTS5 table.
	 * Strategy 2 (LIKE): Fallback — queries each collection with LIKE on text fields.
	 *
	 * Soft-deleted items are excluded in both strategies.
	 */
	async searchGlobal(options: GlobalSearchOptions): Promise<{ data: GlobalSearchResult[]; meta: GlobalSearchMeta }> {
		const { query, collections, limit = 25, cursor } = options;

		if (!query || query.trim().length === 0) {
			return { data: [], meta: { total: 0, collection_counts: {}, has_more: false, next_cursor: null } };
		}

		// NOTE: the FTS5 path is cursor-paginated — results are rank-ordered across
		// collections via a (rank, rowid) keyset cursor (meta.next_cursor). The LIKE
		// fallback remains single-page: it never emits a cursor.

		// Try FTS5 strategy first
		try {
			return await this._searchGlobalFts5(query, collections, limit, cursor);
		} catch {
			// FTS5 not available — fall back to LIKE
			return this._searchGlobalLike(query, collections, limit);
		}
	}

	/**
	 * v2 — FTS5 strategy: query the unified `_search_index` table.
	 */
	private async _searchGlobalFts5(
		query: string,
		filterCollections?: string[],
		limit = 20,
		cursor?: string,
	): Promise<{ data: GlobalSearchResult[]; meta: GlobalSearchMeta }> {
		const allCollections = await this.collections();
		const colMap = new Map(allCollections.map((c) => [c.slug, c.name]));

		const sanitized = query.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
		if (!sanitized) {
			return { data: [], meta: { total: 0, collection_counts: {}, has_more: false, next_cursor: null } };
		}
		const matchQuery = sanitized
			.split(/\s+/)
			.map((w) => w + '*')
			.join(' ');

		// Raw SQL is required here because FTS5's MATCH syntax and its column namespace
		// (_search_index vs the content table) cannot be expressed through QueryBuilder's
		// abstraction (which targets standard SQL WHERE clauses). The MATCH predicate
		// is FTS5-specific and must reference the virtual table name directly.
		//
		// D1 FTS5 does NOT accept bound parameters for MATCH (?1 fails on the real
		// runtime) — inline the match expression as an escaped literal, exactly like
		// the v1 per-collection path below. The match query is built from
		// [a-zA-Z0-9 ] tokens + '*' suffixes, so escaping single quotes fully
		// neutralizes literal injection. Remaining params (entity_type, keyset,
		// LIMIT) stay bound — and their ?N numbering is derived from the live
		// binding count so LIMIT can never alias a collection slug (a latent bug
		// when ?2 was fixed).
		//
		// Keyset pagination: the MATCH (+ optional entity_type filter) runs INSIDE
		// the subquery; the (rank, rowid) cursor predicate, ORDER BY and LIMIT apply
		// to the outer query. `rank` is a selectable FTS5 hidden column, so it
		// materializes as a plain column in the subquery result.
		const escapedMatch = matchQuery.replace(/'/g, "''");
		let sql = `SELECT * FROM (SELECT rowid, rank, entity_type, entity_id, title, body FROM _search_index WHERE _search_index MATCH '${escapedMatch}'`;
		const bindings: unknown[] = [];

		if (filterCollections && filterCollections.length > 0) {
			const placeholders = filterCollections.map(() => '?').join(',');
			sql += ` AND entity_type IN (${placeholders})`;
			bindings.push(...filterCollections);
		}
		sql += `)`;

		const decoded = this.decodeSearchCursor(cursor);
		if (decoded) {
			sql += ` WHERE rank > ? OR (rank = ? AND rowid > ?)`;
			bindings.push(decoded.rank, decoded.rank, decoded.rowid);
		}

		sql += ` ORDER BY rank, rowid`;

		// Fetch extra 1 to determine has_more
		const fetchLimit = limit + 1;
		sql += ` LIMIT ?${bindings.length + 1}`;
		bindings.push(fetchLimit);

		const rows = await this.db.all<{
			rowid: number;
			rank: number;
			entity_type: string;
			entity_id: string;
			title: string;
			body: string;
		}>(QueryBuilder.raw(sql, bindings));

		// has_more reflects the RAW FTS5 page (pre-RBAC) — the cursor stays valid
		// even when row-level filters hide some matches from the caller.
		const rawHasMore = rows.length > limit;
		if (rows.length > limit) rows.pop();

		// Cursor for the next page: the LAST RAW row (pre-RBAC) of this page.
		const lastRaw = rows[rows.length - 1];

		// Row-level RBAC: strip matches the caller's role cannot see (e.g. an
		// owner-scoped row filter must not leak other owners' documents through
		// the shared FTS index).
		let visible = rows;
		if (this.auth && !this.auth.is_admin) {
			const byCollection = new Map<string, { tableName: string; ids: string[] }>();
			for (const r of rows) {
				const entry = byCollection.get(r.entity_type);
				if (entry) entry.ids.push(r.entity_id);
				else {
					const col = allCollections.find((c) => c.slug === r.entity_type);
					if (!col) continue;
					byCollection.set(r.entity_type, { tableName: col.table_name, ids: [r.entity_id] });
				}
			}
			const allowedByCollection = new Map<string, Set<string>>();
			for (const [slug, { tableName, ids }] of byCollection) {
				allowedByCollection.set(slug, await this._filterIdsByRowAccess(slug, tableName, ids));
			}
			visible = rows.filter((r) => allowedByCollection.get(r.entity_type)?.has(r.entity_id));
		}

		const collectionCounts: Record<string, number> = {};
		const results: GlobalSearchResult[] = visible.map((r) => {
			collectionCounts[r.entity_type] = (collectionCounts[r.entity_type] || 0) + 1;

			const score = Math.max(0, 1 - r.rank / 100);
			const snippet = this._makeSnippet(r.body, query);

			return {
				collection: r.entity_type,
				collection_label: colMap.get(r.entity_type) || r.entity_type,
				id: r.entity_id,
				title: r.title,
				snippet,
				fields: {},
				score,
			};
		});

		const meta: GlobalSearchMeta = {
			total: results.length,
			collection_counts: collectionCounts,
			has_more: rawHasMore,
			next_cursor: rawHasMore && lastRaw ? this.encodeSearchCursor(lastRaw.rank, lastRaw.rowid) : null,
		};

		return { data: results, meta };
	}

	/**
	 * v2 — LIKE fallback strategy: query each collection independently with LIKE.
	 */
	private async _searchGlobalLike(
		query: string,
		filterCollections?: string[],
		limit = 20,
	): Promise<{ data: GlobalSearchResult[]; meta: GlobalSearchMeta }> {
		const allCollections = await this.collections();
		const colMap = new Map(allCollections.map((c) => [c.slug, c.name]));

		const target = filterCollections?.length ? allCollections.filter((c) => filterCollections.includes(c.slug)) : allCollections;

		// Escape LIKE wildcards in the query
		const escaped = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
		const likePattern = `%${escaped}%`;

		// Per-collection limit — higher so we don't miss relevant results
		const perColLimit = Math.max(limit, 50);

		// Scan every target collection in PARALLEL (one LIKE scan + one row-access
		// filter per collection) — serial scans of wide tables dominated the
		// request. Each task swallows its own errors exactly like the serial loop
		// (a failing collection must not reject Promise.all), and results are
		// flattened in `target` order below so the merge/sort stays unchanged.
		const scanned = await Promise.all(
			target.map(async (c): Promise<GlobalSearchResult[]> => {
				const textFields = this._getTextFields(c);
				if (textFields.length === 0) return [];

				const safeTable = sanitizeIdentifier(c.table_name, 'SearchService.table');
				const safeFields = textFields.map((f) => sanitizeIdentifier(f, 'SearchService.field'));

				// Projection is identity (rowid/id) + the searched text columns ONLY —
				// never `*`: the merge below reads nothing else, so a full-row LIKE
				// scan drags every wide row across the wire for no reason. ESCAPE '\\'
				// makes the backslash-escaped wildcards above match literally (without
				// it, SQLite treats %/_ as wildcards despite the escaping).
				const sql = `SELECT rowid, id, ${safeFields.join(', ')} FROM ${safeTable} WHERE deleted_at IS NULL AND (${safeFields
					.map((f) => `${f} LIKE ? ESCAPE '\\'`)
					.join(' OR ')}) ORDER BY rowid DESC LIMIT ?`;
				const allBindings = [...safeFields.map(() => likePattern), perColLimit];

				try {
					const items = await this.db.all<Record<string, unknown>>(QueryBuilder.raw(sql, allBindings));

					// Row-level RBAC: strip rows the caller's role cannot see (an
					// owner-scoped row filter must not leak other owners' documents).
					let visibleItems = items;
					if (this.auth && !this.auth.is_admin) {
						const allowed = await this._filterIdsByRowAccess(
							c.slug,
							safeTable,
							items.map((i) => String(i.id)),
						);
						visibleItems = items.filter((i) => allowed.has(String(i.id)));
					}

					const results: GlobalSearchResult[] = [];
					for (const item of visibleItems) {
						const title = this._extractTitle(item, textFields);
						const allText = safeFields
							.map((f) => String(item[f] ?? ''))
							.filter(Boolean)
							.join(' ');

						// Calculate score: count of matches in text, normalized
						const matchCount = allText.toLowerCase().split(query.toLowerCase()).length - 1;
						const score = Math.min(1, matchCount / 10);

						const snippet = this._makeSnippet(allText, query);

						const fields: Record<string, unknown> = {};
						for (const [k, v] of Object.entries(item)) {
							if (k !== '_meta' && k !== 'deleted_at' && k !== 'rowid' && k !== 'body') {
								fields[k] = v;
							}
						}

						results.push({
							collection: c.slug,
							collection_label: colMap.get(c.slug) || c.slug,
							id: String(item.id),
							title,
							snippet,
							fields,
							score,
						});
					}
					return results;
				} catch {
					return []; // Skip collections that error
				}
			}),
		);

		// Flatten in `target` order: the score sort below is stable, so equal
		// (score, id) pairs keep the serial loop's collection order.
		const allResults: GlobalSearchResult[] = [];
		for (const results of scanned) allResults.push(...results);

		// Sort by score descending, then by id for stability
		allResults.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

		// Apply global limit
		const paged = allResults.slice(0, limit);

		const collectionCounts: Record<string, number> = {};
		for (const r of paged) {
			collectionCounts[r.collection] = (collectionCounts[r.collection] || 0) + 1;
		}

		// LIKE fallback is single-page — there is no FTS5 rank/rowid to key on, so
		// has_more is always false and no cursor is emitted (cursors are FTS5-only).
		return {
			data: paged,
			meta: { total: allResults.length, collection_counts: collectionCounts, has_more: false, next_cursor: null },
		};
	}

	// ── Helpers ────────────────────────────────────────────

	/**
	 * Encode a keyset cursor: base64(JSON{rank, rowid}) — rank is the FTS5 match
	 * rank, rowid the content row. Matches the keyset-cursor convention in
	 * collection-query.service.ts (base64, padding stripped).
	 */
	private encodeSearchCursor(rank: number, rowid: number): string {
		return btoa(JSON.stringify({ rank, rowid })).replace(/=+$/, '');
	}

	/**
	 * Decode a search cursor; returns null for garbage (callers fall back to page 1).
	 */
	private decodeSearchCursor(cursor: string | null | undefined): { rank: number; rowid: number } | null {
		if (!cursor) return null;
		try {
			const p = JSON.parse(atob(cursor)) as { rank?: unknown; rowid?: unknown };
			if (typeof p.rank === 'number' && Number.isFinite(p.rank) && typeof p.rowid === 'number' && Number.isFinite(p.rowid)) {
				return { rank: p.rank, rowid: p.rowid };
			}
		} catch {
			/* fall through */
		}
		return null;
	}

	/**
	 * Extract text field names from a collection schema, excluding system fields.
	 */
	private _getTextFields(c: EntitySchema): string[] {
		let schemaFields: Array<{ name: string; type: string }> = [];
		try {
			const parsed = JSON.parse(c.schema_json);
			if (parsed.fields) schemaFields = parsed.fields;
		} catch {
			return [];
		}

		const systemFields = new Set(['id', 'doc_status', 'display_number', 'deleted_at', '_meta', 'created_at', 'updated_at', 'rowid']);

		return schemaFields
			.filter((f) => SEARCHABLE_FIELD_TYPES.has(f.type))
			.map((f) => f.name)
			.filter((n) => !systemFields.has(n));
	}

	/**
	 * Extract a "title" from an item. Prefers common title-like field names,
	 * falls back to the first text field.
	 */
	private _extractTitle(item: Record<string, unknown>, textFields: string[]): string {
		const titleCandidates = ['title', 'name', 'headline', 'subject', 'label', 'full_name', 'company'];
		for (const candidate of titleCandidates) {
			const val = item[candidate];
			if (val && typeof val === 'string' && val.trim().length > 0) {
				return val;
			}
		}
		// Fall back to first non-empty text field
		for (const f of textFields) {
			const val = item[f];
			if (val && typeof val === 'string' && val.trim().length > 0) {
				return val;
			}
		}
		return '(untitled)';
	}

	/**
	 * Generate an excerpt with `<mark>`-highlighted match.
	 * Extracts ~150 chars around the first match.
	 */
	private _makeSnippet(text: string, query: string): string {
		if (!text) return '';

		const lowerText = text.toLowerCase();
		const lowerQuery = query.toLowerCase();
		const idx = lowerText.indexOf(lowerQuery);

		if (idx === -1) {
			// No direct match — return first 150 chars
			return text.length > 150 ? text.slice(0, 150) + '…' : text;
		}

		// Extract context around the match (75 chars each side)
		const contextLen = 75;
		const start = Math.max(0, idx - contextLen);
		const end = Math.min(text.length, idx + query.length + contextLen);

		let snippet = text.slice(start, end);

		// Add ellipsis if we trimmed
		if (start > 0) snippet = '…' + snippet;
		if (end < text.length) snippet = snippet + '…';

		// Highlight the match (case-insensitive replacement)
		const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		snippet = snippet.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');

		return snippet;
	}
}
