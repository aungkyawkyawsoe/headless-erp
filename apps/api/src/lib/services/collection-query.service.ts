/**
 * ItemQueryService — entity reads (list + detail) and every read-side engine.
 *
 * Extracted from CollectionService (enterprise decomposition): owns listItems /
 * getItem, keyset cursor pagination, aggregates (group-by), nested relation
 * filters/sorts, the self-tuning index advisor observation, RBAC row/field
 * filters on read, the policy-driven response cache, and decrypt-on-read.
 *
 * Performance notes:
 *  - Decryption is skipped when a ?fields= projection excludes every encrypted
 *    field (and after RBAC field-filtering has stripped them) — encrypted
 *    columns are never decrypted (and held) in memory unless requested.
 *  - Nested-query hop lookups are O(1) via a per-request name→field map.
 */
import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { getIndexAdvisor, resolvePolicy } from '@mmbix/core';
import { readCacheKey, readCached, storeCached } from '@mmbix/core';
import { buildSystemColumnsList, physicalColumnNames, mergeRowData, decodeJsonFields } from '@mmbix/core';
import { MAX_AGGREGATE_GROUPS, assertGroupCeiling } from '@/lib/api/aggregate-size';
import { authzVersion } from '@/lib/services/authz-version';
import {
	QueryParser,
	OPERATOR_MAP,
	parseGroupByClause,
	groupBySelectExpr,
	parseFieldSelection,
	emptyFieldSelection,
	type GroupByClause,
	type FieldSelection,
	type ParsedQuery,
	type FilterOperator,
	type SortClause,
} from '@/lib/api/query-parser';
import { validators, assertValid } from '@mmbix/utils';
import { sanitizeIdentifier, SEARCHABLE_FIELD_TYPES } from '@mmbix/utils';
import { ValidationError, NotFoundError } from '@mmbix/utils';
import { DataFilterService } from '@/lib/services/data-filter.service';
import { backgroundTask } from '@/lib/request-tasks';
import type { AuthContext } from '@/lib/services/auth.service';
import type { EntitySchema, FieldDefinition } from '@mmbix/types';
import { SchemaService } from '@/lib/services/collection-schema.service';
import { RelationResolver } from '@/lib/services/collection-relations.service';
import {
	authFingerprint,
	checkRowFilterAccess,
	defaultLeanHiddenColumns,
	FULL_ROW_READ_KEY,
	getFilterContext,
	type CollectionInfo,
	type ItemListResult,
} from '@/lib/services/collection.shared';

/**
 * Shape a row for a lean wire payload (default read OR the bare `*` wildcard):
 * drop the relation keys and system user-reference columns in place (the SQL
 * row above keeps them — this only affects the wire representation).
 */
function applyLeanRowDefault(row: Record<string, unknown>, hidden: Set<string>): Record<string, unknown> {
	for (const k of hidden) delete row[k];
	return row;
}

/** Field types whose value on the wire is an embedded RELATED row (no column). */
const EMBEDDED_RELATION_TYPES = new Set(['m2o', 'o2m', 'm2m', 'm2a', 'table']);

/** How many relation hops `readDependencies` will follow before giving up (and the
 *  read is left uncached). Captures every shape the `?fields=` parser can express
 *  in practice, while keeping the walk bounded. */
const MAX_DEPENDENCY_DEPTH = 3;

export class ItemQueryService {
	private db: D1Client;
	private schema: SchemaService;
	private relations: RelationResolver;
	private getAuth: () => AuthContext | null;

	constructor(db: D1Client, schema: SchemaService, relations: RelationResolver, getAuth: () => AuthContext | null) {
		this.db = db;
		this.schema = schema;
		this.relations = relations;
		this.getAuth = getAuth;
	}

	async listItems(collectionSlug: string, url: URL, includeTrashed = false): Promise<ItemListResult> {
		const info = await this.schema.getCollection(collectionSlug);
		const { table_name: tableName, schemaFields, systemFieldOptions } = info;
		const fieldNames = schemaFields.map((f) => f.name);
		// Filterable columns = schema fields + physical system columns (id, created_at,
		// _meta, doc_status…). Unknown columns now raise a 400 instead of being
		// silently skipped (a dropped filter returns wrong rows with 200 OK).
		const schemaFieldSet = new Set([...fieldNames, ...buildSystemColumnsList(systemFieldOptions)]);
		const parsed = QueryParser.parse(url);

		// Self-tuning index advisor (headless): OBSERVE this query's filter shape
		// so the engine can later auto-create composite indexes for hot multi-column
		// reads — without hardcoding any business collection. Non-blocking.
		this.observeForAutoIndex(tableName, parsed, info);

		// ── Field selection (Directus-style) ─────────────────────────────
		// Resolve the selection tree FIRST (it gates cacheability below): explicit
		// ?fields= wins; otherwise the schema-level list_fields projection applies;
		// otherwise the lean default (own columns, NO relation expansion).
		let selection: FieldSelection | null = null;
		if (parsed.fields.length > 0) {
			selection = parsed.fieldSelection;
		} else if (info.listFields && info.listFields.length > 0) {
			selection = parseFieldSelection(info.listFields);
		}

		// ── Headless response cache (policy-driven) ──
		// When this collection opts in via policies.cache (REST, no code), cache
		// the read result keyed by (collection, auth, canonical-url) so repeated
		// identical reads (dashboards, badges, option-maps) skip D1. Cacheable only
		// for safe, recomputable read shapes — never cursor pages / exports /
		// aggregates, and never a payload that embeds OTHER collections' rows
		// (expanded relations or virtual formulas over lookups): a write to the
		// related collection cannot invalidate this collection's cached entry, so
		// those shapes must stay live to avoid serving stale children.
		const policy = resolvePolicy(info.policies);
		const cachePol = policy.cache;
		// A read is cacheable only when the collections it EMBEDS form a finite set
		// (readDependencies returns null otherwise). The returned slugs become the
		// entry's invalidation tags, so a write to any embedded collection drops it
		// even though the writer only knows its own slug — that is what makes caching
		// a relation-expanded read safe instead of a stale-children trap.
		const dependencies =
			cachePol.enabled &&
			!parsed.cursor &&
			!parsed.export_csv &&
			parsed.aggregate.length === 0 &&
			url.searchParams.get('explain') !== 'true'
				? await this.readDependencies(info, selection)
				: null;
		// Fold the authz-version stamp into the cache KEY so a permission/role change
		// in another isolate retires this user's cached body (see authFingerprint).
		const readVersion = dependencies !== null ? await authzVersion(this.db) : undefined;
		const cacheKey = dependencies !== null ? readCacheKey(collectionSlug, authFingerprint(this.getAuth(), readVersion), url.search) : null;
		if (cacheKey) {
			const hit = readCached<ItemListResult>(cacheKey);
			if (hit) return hit;
		}

		const qb = QueryBuilder.from(tableName);
		// Text-ish field types the `?search=` term matches (OR across all of them) —
		// the ONE shared list (`@mmbix/utils`), so every search surface agrees and a
		// new text-ish type is added in exactly one place. id/system timestamps and
		// relations are never searched.
		const textSearchFields = schemaFields.filter((f) => SEARCHABLE_FIELD_TYPES.has(f.type)).map((f) => f.name);
		// A collection may opt into the INDEX-BACKED `prefix` search over declared
		// fields (SearchPolicy) — the type-ahead shape whose `LIKE 'term%'` an index
		// serves. Prefix needs at least one declared (ideally indexed) field to be worth
		// it; otherwise the text-field default keeps today's substring behavior. This is
		// the only switch — every other read of the collection is untouched.
		const prefixFields = policy.search.fields.filter((f) => schemaFieldSet.has(f));
		const usePrefix = policy.search.mode === 'prefix' && prefixFields.length > 0;
		const searchPlan = {
			fields: usePrefix ? prefixFields : textSearchFields,
			mode: (usePrefix ? 'prefix' : 'contains') as 'contains' | 'prefix',
		};
		QueryParser.applyToQueryBuilder(qb, parsed, schemaFieldSet, searchPlan.fields, searchPlan.mode);

		// Exclude soft-deleted items by default, or show only trashed
		if (includeTrashed) {
			qb.whereNotNull('deleted_at');
		} else {
			qb.whereNull('deleted_at');
		}

		// Apply group filters
		for (const group of parsed.filterGroups) {
			// Each clause carries its OWN join type (or → (a OR b), and → (a AND b));
			// the parenthesized group ALWAYS AND-joins the rest of the query. Passing
			// group.type as the OUTER type would make `_or` groups OR-join everything
			// (WHERE deleted_at IS NULL OR …) — silently returning every row.
			const validClauses = group.conditions.map((c) => {
				if (!schemaFieldSet.has(c.field)) {
					throw new ValidationError(`Unknown filter field "${c.field}" for this collection`);
				}
				// Same operator semantics as the flat-filter path (applyToQueryBuilder):
				// LIKE-family operators get their % wildcards wrapped around the value.
				switch (c.operator) {
					case '_contains':
					case '_icontains':
						return { column: c.field, op: 'LIKE', value: `%${c.value}%`, type: group.type };
					case '_ncontains':
						return { column: c.field, op: 'NOT LIKE', value: `%${c.value}%`, type: group.type };
					case '_startswith':
						return { column: c.field, op: 'LIKE', value: `${c.value}%`, type: group.type };
					case '_endswith':
						return { column: c.field, op: 'LIKE', value: `%${c.value}`, type: group.type };
					default:
						return {
							column: c.field,
							op: OPERATOR_MAP[c.operator as keyof typeof OPERATOR_MAP] || c.operator,
							value: c.value,
							type: group.type,
						};
				}
			});
			if (validClauses.length > 0) qb.whereGroup(validClauses, 'and');
		}

		// ── Apply function-based filters (filter[year(created_at)][_eq]=2024 etc.) ──
		QueryParser.applyFunctionFilters(qb, parsed, schemaFieldSet);

		// ── Apply nested relation filters/sorts (filter[parent.field][_eq]=x, sort=parent.field) ──
		await this.applyNestedQueries(qb, parsed, schemaFields, tableName);

		// Shared column projection (list + detail) — Directus-style: '*' = all
		// columns minus exclusions; named columns + m2o FK columns for relation
		// paths; lean default = all columns without any relation expansion.
		qb.select(...this.relations.projectColumns(schemaFields, systemFieldOptions, selection));
		// Default order: created_at DESC (newest first) with an id tiebreaker.
		// UUID v4 ids are NOT time-ordered, so the old bare `ORDER BY id DESC`
		// default produced a random-looking (non-deterministic) list order.
		if (parsed.sorts.length === 0 && parsed.nestedSorts.length === 0) qb.orderBy('created_at', 'desc');

		// Aggregate mode
		if (parsed.aggregate.length > 0) {
			const aggRows = await this.runAggregate(tableName, parsed, schemaFields, includeTrashed, searchPlan);
			return { data: aggRows, meta: {} };
		}

		const dir = url.searchParams.get('dir') || 'after';
		const fetchLimit = parsed.limit + 1;
		qb.limit(fetchLimit);

		// ── Keyset pagination ────────────────────────────────────────────
		// Every list is ordered by a composite keyset over (sort fields..., id),
		// so pages stay correct under inserts/deletes and non-id orderings.
		// The default sort (created_at DESC, id DESC) uses the same machinery —
		// deterministic, newest-first, and cursor-based (no OFFSET).
		const customSorts: SortClause[] = parsed.sorts.length > 0 ? parsed.sorts : [{ field: 'created_at', direction: 'desc' }];

		// Append the id tiebreaker so the keyset order is total (stable pages)
		qb.orderBy('id', customSorts[0].direction);

		let keysetCursor: { values: unknown[]; id: string } | null = null;
		if (parsed.cursor) {
			keysetCursor = this.decodeKeysetCursor(parsed.cursor);
			if (keysetCursor) {
				const cols = [...customSorts.map((s) => s.field), 'id'];
				const dirs = [...customSorts.map((s) => s.direction), customSorts[0].direction];
				const vals = [...keysetCursor.values, keysetCursor.id];
				if (dir === 'before') {
					// Fetch the preceding page: flip the ordering, reverse the page at the end
					qb.clearOrderBy();
					for (const s of customSorts) qb.orderBy(s.field, s.direction === 'asc' ? 'desc' : 'asc');
					qb.orderBy('id', customSorts[0].direction === 'asc' ? 'desc' : 'asc');
					this.applyKeysetPredicate(qb, cols, dirs, vals, true);
				} else {
					this.applyKeysetPredicate(qb, cols, dirs, vals, false);
				}
			}
			// Undecodable cursor (legacy bare-id / garbage) → ignore the cursor (safe fallback to page 1)
		}

		// Nested relation sorts resolve via correlated subqueries — the keyset
		// predicate cannot be expressed against them, so cursors would page wrong.
		if (parsed.cursor && parsed.nestedSorts.length > 0) {
			throw new ValidationError('Cursor pagination is not supported with nested relation sorts');
		}

		// Apply row-level filters (RBAC)
		const filterCtx = getFilterContext(this.db, this.getAuth(), collectionSlug);
		if (filterCtx) {
			await DataFilterService.applyRowFilter(qb, filterCtx);
		}

		// ?count=true → include the TOTAL row count in meta (KPI blocks / dashboards)
		// A COUNT(*) clone runs against the same WHERE clauses, so the number
		// always matches the visible (filtered) list.
		let totalCount: number | null = null;
		if (url.searchParams.get('count') === 'true' || url.searchParams.get('count_only') === 'true') {
			const countRow = await this.db.first<{ count: number }>(qb.clone().toCount());
			totalCount = Number(countRow?.count ?? 0);
		}

		// ?count_only=true → return just the total, skipping the SELECT + per-row
		// enrichment (relation resolution, decryption, mergeRowData). The caller
		// (e.g. miniapp fetchCount sends limit=1 and discards rows) wants only the
		// number, so a full page query is pure waste — this halves that cost.
		// Unlike ?count=true it does NOT also return a page: strictly the count.
		if (url.searchParams.get('count_only') === 'true') {
			// Opportunistic self-tuning pass (rate-limited, non-blocking).
			backgroundTask(this.autoTune(info));
			return { data: [], meta: { limit: 0, has_more: false, total: totalCount ?? 0 } };
		}

		let items = await this.db.all<Record<string, unknown>>(qb.toSelect());
		// O2M children are capped per field (default 50, override with ?o2m_limit=)
		// so list pages never materialize every child of every row.
		// NOTE: Number(searchParams.get(x)) is 0 when absent — guard with has() so
		// the default really is 50 (0 would clamp to 1 and truncate everything).
		const parsedO2mLimit = Number(url.searchParams.get('o2m_limit'));
		const o2mLimit = Number.isFinite(parsedO2mLimit) && parsedO2mLimit > 0 ? Math.min(Math.trunc(parsedO2mLimit), 500) : 50;
		// When the caller projected columns (?fields=), resolve ONLY the relations
		// those columns reference — never the whole schema's relation graph. This
		// makes ?fields= skip unused O2M/M2O fetches (e.g. a list asks for
		// `permits,insurances` and stops paying for `maintenance/trips/fuel_logs`).
		// With no selection at all the lean default applies (no relations).
		items = await this.relations.resolveRelations(
			items,
			schemaFields,
			tableName,
			o2mLimit,
			selection,
			url.searchParams.get('formula_trace') === 'true',
		);

		// Apply field-level restrictions (RBAC) BEFORE decryption so hidden
		// encrypted fields are never decrypted (and held) in memory.
		if (filterCtx) {
			items = await DataFilterService.applyFieldFilter(items, filterCtx, fieldNames);
		}

		// v0.7: Decrypt encrypted fields before returning — skipped entirely when
		// the projection excludes every encrypted field (AES is CPU-heavy).
		if (this.needsDecrypt(schemaFields, selection)) {
			const decrypted = await this.decryptItems(items, schemaFields);
			items = decrypted ?? items;
		}

		const hasMore = items.length > parsed.limit;
		if (hasMore) items.pop();
		if (dir === 'before') items.reverse();

		const lastId = items.length > 0 ? String(items[items.length - 1].id) : null;
		const firstId = items.length > 0 ? String(items[0].id) : null;
		const meta: Record<string, unknown> = { limit: parsed.limit, has_more: hasMore };
		if (totalCount !== null) meta.total = totalCount;
		if (parsed.nestedSorts.length === 0) {
			// Cursor emission is direction-aware. `hasMore` means "more rows in the
			// direction we walked" (older for `before`), so a backward page must not
			// gate `next_cursor` on it: the boundary item we came FROM always lies
			// after this page, so a next page exists whenever the page is non-empty
			// (this is what re-enables Next after walking back to page 1). Symmetrically
			// `prev_cursor` on a backward page exists only if older rows remain.
			if (dir === 'before') {
				if (lastId) meta.next_cursor = this.encodeKeysetCursor(items[items.length - 1], customSorts);
				if (hasMore && firstId) meta.prev_cursor = this.encodeKeysetCursor(items[0], customSorts);
			} else {
				if (hasMore && lastId) meta.next_cursor = this.encodeKeysetCursor(items[items.length - 1], customSorts);
				if (parsed.cursor && firstId) meta.prev_cursor = this.encodeKeysetCursor(items[0], customSorts);
			}
		}

		items = decodeJsonFields(items.map(mergeRowData), schemaFields);

		if (parsed.export_csv && items.length > 0) {
			return { data: items, meta: { ...meta, export_csv: true } };
		}

		// Lean wire payload: the DEFAULT read (no ?fields= and no schema list_fields)
		// AND the bare `*` wildcard both carry the record's own data only. Relation
		// keys (m2o/m2a FK columns) and the system user-reference columns (_owner,
		// created_by, updated_by, deleted_by) are OPT-IN — naming a relation
		// (department / department.name / department.*) or a wildcard depth (*.*)
		// brings it back, and CSV exports keep the full row. The SQL SELECT above
		// keeps every column so filters, sorts, cursors and RBAC still see them;
		// only the JSON is shaped here.
		const leanWire = selection === null || (selection !== null && selection.all);
		const payload = leanWire
			? items.map((row) => applyLeanRowDefault(row, defaultLeanHiddenColumns(schemaFields, systemFieldOptions, selection)))
			: items;

		// Store the recomputed read in the response cache (policy-driven TTL),
		// tagged with every embedded collection so any write to one drops it.
		if (cacheKey && dependencies !== null) storeCached(cacheKey, { data: payload, meta }, cachePol.ttlS * 1000, dependencies);

		// Opportunistic self-tuning pass (rate-limited, non-blocking) after a
		// representative list load — lets the advisor learn/index hot reads.
		backgroundTask(this.autoTune(info));
		return { data: payload, meta };
	}

	async getItem(collectionSlug: string, id: string, selection?: FieldSelection | null, fieldsKey = ''): Promise<Record<string, unknown>> {
		const info = await this.schema.getCollection(collectionSlug);
		const { table_name: tableName, schemaFields, systemFieldOptions } = info;
		assertValid(validators.uuid(id, 'id'));

		// Headless response cache (policy-driven) — single-record reads keyed by
		// (collection, auth, id, fields). The projection is part of the response
		// shape, so ?fields= must be in the key or a plain read would poison a
		// pruned read (and vice versa). Invalidation is tag-based (write ⇒ clear).
		const cachePol = resolvePolicy(info.policies).cache;
		const dependencies = cachePol.enabled && fieldsKey !== FULL_ROW_READ_KEY ? await this.readDependencies(info, selection ?? null) : null;
		const cacheKey =
			dependencies !== null
				? readCacheKey(
						collectionSlug,
						authFingerprint(this.getAuth(), await authzVersion(this.db)),
						`get/${id}${fieldsKey ? `?fields=${fieldsKey}` : ''}`,
					)
				: null;
		if (cacheKey) {
			const hit = readCached<Record<string, unknown>>(cacheKey);
			if (hit) return hit;
		}

		const fNames = schemaFields.map((f) => f.name);
		const raw = await this.db.first<Record<string, unknown>>(
			QueryBuilder.from(tableName)
				.select(...this.relations.projectColumns(schemaFields, systemFieldOptions, selection ?? null))
				.where('id', id)
				.toSelect(),
		);
		if (!raw) throw new NotFoundError('Item', id);
		// Row-level RBAC — the record must pass the role's row filter (owners only, …).
		await checkRowFilterAccess(this.db, this.getAuth(), collectionSlug, tableName, id);
		let items = decodeJsonFields([mergeRowData(raw)], schemaFields);
		// Detail reads follow the SAME selection rules as list reads: no ?fields= ⇒
		// lean columns (relations stay scalar FKs / omitted); explicit ?fields= paths
		// (e.g. category.name, *.*) expand relations exactly as on the list endpoint.
		items = await this.relations.resolveRelations(items, schemaFields, tableName, 50, selection ?? null);
		// Field-level restrictions (RBAC) — applied after relation resolution (so
		// hidden m2o/o2m sub-objects are masked too) and BEFORE decryption (so
		// hidden encrypted fields are never decrypted in memory).
		const fCtx = getFilterContext(this.db, this.getAuth(), collectionSlug);
		if (fCtx) {
			items = await DataFilterService.applyFieldFilter(items, fCtx, fNames);
		}
		// v0.7: Decrypt encrypted fields before returning (selection-aware skip).
		if (this.needsDecrypt(schemaFields, selection ?? null)) {
			const decrypted = await this.decryptItems(items, schemaFields);
			items = decrypted ?? items;
		}
		const result = items[0];
		if (result && fieldsKey !== FULL_ROW_READ_KEY && (selection == null || selection.all)) {
			// Lean detail payload — same opt-in rule as list reads: the default read
			// and the bare `*` wildcard expose the record's own data only; relation
			// keys and the system user-reference columns appear when the caller
			// projects them explicitly (?fields=department, ?fields=created_by, …).
			// Internal full-row reads (FULL_ROW_READ_KEY) skip this shaping.
			applyLeanRowDefault(result, defaultLeanHiddenColumns(schemaFields, systemFieldOptions, selection));
		}
		if (cacheKey && dependencies !== null) storeCached(cacheKey, result, cachePol.ttlS * 1000, dependencies);
		return result;
	}

	// ── Self-tuning index advisor (headless) ─────────────
	// The engine observes real query shapes and auto-creates composite indexes
	// for hot multi-column reads — never for one collection specifically. The
	// collection's own `composite_indexes` (declarative) always override auto-tune.

	/**
	 * The collections a read's payload DEPENDS ON — its own rows plus every
	 * collection it embeds through relation expansion — or null when that set
	 * cannot be bounded.
	 *
	 * A cached relation-expanded read is only safe if a write to ANY embedded
	 * collection drops the entry. `storeCached` tags the entry with exactly this
	 * set and `invalidateCollectionReads` clears those tags, so a stale child can
	 * never be served. A payload we cannot bound — a polymorphic m2a with no
	 * declared target, or a VIRTUAL formula whose lookup scope is open-ended —
	 * returns null and the read is never cached (deny-by-default).
	 */
	private async readDependencies(info: CollectionInfo, selection: FieldSelection | null): Promise<string[] | null> {
		const deps = new Set<string>();
		const bounded = await this.collectDependencies(info.schemaFields, selection, deps, 0);
		return bounded ? [...deps] : null;
	}

	/** Recursive worker for readDependencies. Returns false when a branch is unbounded. */
	private async collectDependencies(
		fields: FieldDefinition[],
		selection: FieldSelection | null,
		deps: Set<string>,
		depth: number,
	): Promise<boolean> {
		if (selection === null) return true; // lean default — own columns only
		if (depth > MAX_DEPENDENCY_DEPTH) return false; // deeper than we can follow ⇒ unbounded
		const byName = new Map(fields.map((f) => [f.name, f]));
		// '*' selects every column: a VIRTUAL formula reads lookups we cannot bound.
		if (selection.all && fields.some((f) => f.type === 'formula' && f.store !== true)) return false;

		const visit = async (name: string, child: FieldSelection | null): Promise<boolean> => {
			const f = byName.get(name);
			if (!f) return true; // unknown name — the resolver ignores it
			if (f.type === 'formula') return f.store === true; // stored ⇒ own rows; virtual ⇒ unbounded
			if (!EMBEDDED_RELATION_TYPES.has(f.type)) return true; // scalar column
			if (f.type === 'm2a') {
				// Polymorphic: tag every declared target; with none we cannot bound it.
				const targets = f.related_collections ?? (f.related_collection ? [f.related_collection] : []);
				if (targets.length === 0) return false;
				for (const t of targets) deps.add(t);
				return true; // M2A never recurses deeper (rows span collections)
			}
			const target = f.related_collection;
			if (!target) return false;
			deps.add(target);
			// A bare relation name expands that collection's own columns and stops.
			if (!child || (child.relations.size === 0 && child.expandDepth === 0 && !child.all)) return true;
			try {
				const related = await this.schema.getCollection(target);
				return await this.collectDependencies(related.schemaFields, child, deps, depth + 1);
			} catch {
				return false; // unknown related collection ⇒ cannot bound
			}
		};

		// Explicit relation paths (a.b → relations: {a: …}).
		for (const [name, child] of selection.relations) {
			if (!(await visit(name, child))) return false;
		}
		// Bare relation names (fields=category → whole relation) + formula names.
		for (const name of selection.columns) {
			if (!(await visit(name, null))) return false;
		}
		// Wildcard depth ('*.*') expands EVERY relation at this level, one level per '.'.
		if (selection.expandDepth > 0) {
			for (const f of fields) {
				if (!EMBEDDED_RELATION_TYPES.has(f.type) && f.type !== 'formula') continue;
				const child = selection.expandDepth > 1 ? { ...emptyFieldSelection(), all: true, expandDepth: selection.expandDepth - 1 } : null;
				if (!(await visit(f.name, child))) return false;
			}
		}
		return true;
	}

	private observeForAutoIndex(tableName: string, parsed: ParsedQuery, info: CollectionInfo): void {
		const policy = resolvePolicy(info.policies);
		if (!policy.autoIndex.enabled) return; // per-collection runtime toggle (headless)
		// Nested relation filters (parent.field) and function filters are subqueries,
		// not direct columns — ignore for index tuning. Global ?search= ORs across
		// many text fields, so it doesn't yield a useful composite either.
		if (parsed.nestedFilters.length > 0 || parsed.search) return;
		const declared = info.compositeIndexes ?? [];
		// Flat filter columns the advisor may index (nested/function filters excluded
		// already). The advisor's EXPLAIN verification + column sanitization guard
		// against any non-physical/system column, so no extra whitelist is needed.
		const flat = parsed.filters.map((f) => f.field);
		// The ORDER BY column: a TRAILING sort column is what lets the planner serve
		// the order from the index instead of building a temp B-tree on every page —
		// the `?sort=name` list case. A default created_at/updated_at sort
		// is already covered by the (deleted_at, created_at, id) backfill index.
		const sort = parsed.sorts[0] && !['created_at', 'updated_at'].includes(parsed.sorts[0].field) ? parsed.sorts[0].field : '';
		// Nothing worth indexing: a lone filter (a field-level index already covers
		// it) with no sort, or no shape at all.
		if (flat.length < 2 && !sort) return;
		// Every list read ANDs `deleted_at IS NULL` (soft-delete). When no other
		// filter narrows the rows, that predicate must LEAD the index or the sort
		// still cannot be served from it.
		const filters = flat.length === 0 ? ['deleted_at'] : flat;
		getIndexAdvisor().record(tableName, { filters, sort }, declared);
	}

	private async autoTune(info: CollectionInfo): Promise<void> {
		const policy = resolvePolicy(info.policies);
		if (!policy.autoIndex.enabled) return; // runtime disable
		// Per-call mode (not a shared singleton flag) — honors THIS collection's
		// auto_index policy without leaking it to other collections' tuning.
		await getIndexAdvisor().tune(this.db, policy.autoIndex.mode === 'propose');
	}

	// ── Field encryption (read path) ─────────────────────

	/** Fields marked encrypted=true in the schema */
	private encryptedFields(schemaFields: FieldDefinition[]): FieldDefinition[] {
		return schemaFields.filter((f) => (f as FieldDefinition & { encrypted?: boolean }).encrypted === true);
	}

	/**
	 * Should this read decrypt? Decryption is skipped when the caller's
	 * projection excludes every encrypted field (AES is CPU-heavy and the
	 * ciphertext columns are not selected anyway).
	 */
	private needsDecrypt(schemaFields: FieldDefinition[], selection: FieldSelection | null): boolean {
		const encFields = this.encryptedFields(schemaFields);
		if (encFields.length === 0) return false;
		if (selection === null || selection.all) return true;
		return encFields.some((f) => selection.columns.has(f.name));
	}

	/** Bulk decrypt for list responses */
	private async decryptItems(items: Record<string, unknown>[], schemaFields: FieldDefinition[]): Promise<Record<string, unknown>[] | null> {
		const encFields = this.encryptedFields(schemaFields);
		if (encFields.length === 0) return null;
		try {
			const { FieldEncryption } = await import('@/lib/services/field-encryption.service');
			const out = await FieldEncryption.decryptBulk(items, encFields);
			for (const item of out) this.flagUndecryptable(item, encFields, FieldEncryption);
			return out;
		} catch {
			console.error('[encryption] WARNING: decrypt failed — sensitive fields could not be read (missing/rotated ENCRYPTION_KEY?)');
			return null;
		}
	}

	/**
	 * Replace any still-encrypted value (decrypt failed) with an explicit marker
	 * instead of leaking raw ciphertext as if it were the field value.
	 */
	private flagUndecryptable(
		item: Record<string, unknown>,
		encFields: FieldDefinition[],
		FieldEncryption: { isEncrypted: (v: string) => boolean },
	): void {
		for (const f of encFields) {
			const v = item[f.name];
			if (typeof v === 'string' && FieldEncryption.isEncrypted(v)) {
				console.error(
					`[encryption] WARNING: field "${f.name}" is unreadable (missing/rotated ENCRYPTION_KEY?) — returning '[encrypted:unreadable]' marker`,
				);
				item[f.name] = '[encrypted:unreadable]';
			}
		}
	}

	/**
	 * Apply nested M2O relation filters and sorts via subqueries.
	 *
	 * Single hop:  filter[category.name][_eq]=Gadgets  →  WHERE category IN (SELECT id FROM cms_categories WHERE name = ?)
	 * Multi hop:   filter[category.sub.name][_eq]=x    →  WHERE category IN (SELECT id FROM cms_categories WHERE sub IN (SELECT id FROM cms_subs WHERE name = ?))
	 * sort=category.name  →  ORDER BY (SELECT name FROM cms_categories WHERE id = cms_products.category)
	 *
	 * Subqueries avoid JOIN alias/column-collision issues and keep the cursor
	 * pagination on the source table intact. Invalid paths are skipped.
	 */
	private async applyNestedQueries(qb: QueryBuilder, parsed: ParsedQuery, sf: FieldDefinition[], tableName: string): Promise<void> {
		if (parsed.nestedFilters.length === 0 && parsed.nestedSorts.length === 0) return;

		const allC = await this.schema.getCollections();
		const collectionMap = new Map(allC.map((c) => [c.slug, c]));

		// Per-call field cache — hop paths are resolved many times per request
		// (once per nested filter/sort), and each parse of a collection's JSON
		// schema used to be repeated work. Caches a name→field map per collection
		// so each hop lookup is O(1) instead of an O(fields) scan.
		const fieldCache = new Map<string, { fields: FieldDefinition[]; byName: Map<string, FieldDefinition> }>();
		const parseFields = (c: EntitySchema): { fields: FieldDefinition[]; byName: Map<string, FieldDefinition> } => {
			const hit = fieldCache.get(c.slug);
			if (hit) return hit;
			let fields: FieldDefinition[] = [];
			try {
				fields = (JSON.parse(c.schema_json || '{}') as { fields?: FieldDefinition[] }).fields ?? [];
			} catch {
				/* malformed schema — empty field list */
			}
			const entry = { fields, byName: new Map(fields.map((f) => [f.name, f])) };
			fieldCache.set(c.slug, entry);
			return entry;
		};

		/**
		 * Resolve a dotted path against the source schema.
		 * Returns the hop tables/fields (m2o hops) and the leaf table+column,
		 * or null when any hop is not an m2o relation or the leaf is virtual.
		 */
		const resolvePath = (path: string[]): { hops: { table: string; field: string }[]; leaf: { table: string; column: string } } | null => {
			if (path.length < 2) return null;
			let current = { fields: sf, byName: new Map(sf.map((f) => [f.name, f])) }; // source schema fields
			let currentTable = tableName; // source table
			const hops: { table: string; field: string }[] = [];
			for (let i = 0; i < path.length - 1; i++) {
				const hopField = path[i];
				const hop = current.byName.get(hopField);
				if (!hop || hop.type !== 'm2o' || !hop.related_collection) return null;
				const next = collectionMap.get(hop.related_collection!);
				if (!next) return null;
				hops.push({ table: currentTable, field: hopField });
				currentTable = next.table_name;
				current = parseFields(next);
			}
			const leaf = path[path.length - 1];
			const physical = new Set(physicalColumnNames(current.fields));
			if (!physical.has(leaf)) return null;
			return { hops, leaf: { table: currentTable, column: leaf } };
		};

		// Nested filters: build the IN-subquery chain from the deepest hop outward.
		// The top-level WHERE references the FIRST hop field on the source table,
		// so the first hop's table must NOT be wrapped again.
		for (const nf of parsed.nestedFilters) {
			const resolved = resolvePath(nf.path);
			if (!resolved) throw new ValidationError(`Unknown nested filter path "${nf.path.join('.')}"`);
			let sub = QueryBuilder.from(resolved.leaf.table).select('id');
			this.applyOperator(sub, resolved.leaf.column, nf.operator, nf.value);
			for (let i = resolved.hops.length - 1; i >= 1; i--) {
				const hop = resolved.hops[i];
				const wrap = QueryBuilder.from(hop.table).select('id');
				wrap.whereInSubquery(hop.field, sub);
				sub = wrap;
			}
			qb.whereInSubquery(resolved.hops[0].field, sub);
		}

		// Nested sorts: correlated subquery chain.
		// For path [a, b, leaf] with source.a → t1, t1.b → t2 (leaf on t2):
		//   ORDER BY (SELECT (SELECT leaf FROM t2 WHERE id = t1.b) FROM t1 WHERE id = src.a)
		// At iteration i the FROM table is the NEXT table in the chain (the leaf
		// table for the innermost level), and the WHERE reference is the m2o
		// column on the PREVIOUS table (the source table for the outermost level).
		for (const ns of parsed.nestedSorts) {
			const path = ns.field.split('.');
			const resolved = resolvePath(path);
			if (!resolved) continue;
			let expr = sanitizeIdentifier(resolved.leaf.column, 'nestedSort.leaf');
			for (let i = resolved.hops.length - 1; i >= 0; i--) {
				const from = i === resolved.hops.length - 1 ? resolved.leaf.table : resolved.hops[i + 1].table;
				const ref =
					i === 0
						? `${sanitizeIdentifier(tableName, 'nestedSort.sourceTable')}.${sanitizeIdentifier(resolved.hops[0].field, 'nestedSort.hop')}`
						: `${sanitizeIdentifier(resolved.hops[i].table, 'nestedSort.table')}.${sanitizeIdentifier(resolved.hops[i].field, 'nestedSort.hop')}`;
				expr = `(SELECT ${expr} FROM ${sanitizeIdentifier(from, 'nestedSort.table')} WHERE id = ${ref})`;
			}
			qb.orderByRaw(expr, ns.direction);
		}
	}

	// ── Keyset cursor helpers (custom-sort pagination) ──

	/** Encode a composite keyset cursor: base64(JSON{values, id}) */
	private encodeKeysetCursor(item: Record<string, unknown>, sorts: SortClause[]): string {
		const payload = {
			v: sorts.map((s) => item[s.field] ?? null),
			id: String(item.id ?? ''),
		};
		return btoa(JSON.stringify(payload)).replace(/=+$/, '');
	}

	/** Decode a composite keyset cursor; returns null for legacy id cursors / garbage */
	private decodeKeysetCursor(cursor: string): { values: unknown[]; id: string } | null {
		try {
			const parsed = JSON.parse(atob(cursor)) as { v?: unknown[]; id?: unknown };
			if (!Array.isArray(parsed.v) || typeof parsed.id !== 'string') return null;
			return { values: parsed.v, id: parsed.id };
		} catch {
			return null;
		}
	}

	/**
	 * Row-value keyset predicate for the page boundary.
	 * All-asc/all-desc sorts use SQLite row-value comparison;
	 * mixed directions fall back to an OR chain over prefix-equal rows.
	 */
	private applyKeysetPredicate(qb: QueryBuilder, cols: string[], dirs: SortClause['direction'][], vals: unknown[], before: boolean): void {
		const safeCols = cols.map((c) => sanitizeIdentifier(c, 'keyset.column'));
		const allAsc = dirs.every((d) => d === 'asc');
		const allDesc = dirs.every((d) => d === 'desc');
		if (allAsc || allDesc) {
			const afterOp = allAsc ? '>' : '<';
			const op = before ? (afterOp === '>' ? '<' : '>') : afterOp;
			qb.whereRaw(`(${safeCols.join(', ')}) ${op} (${vals.map(() => '?').join(', ')})`, vals);
			return;
		}
		const clauses: string[] = [];
		const bindings: unknown[] = [];
		for (let i = 0; i < safeCols.length; i++) {
			const conds: string[] = [];
			for (let j = 0; j < i; j++) {
				conds.push(`${safeCols[j]} = ?`);
				bindings.push(vals[j]);
			}
			const asc = dirs[i] === 'asc';
			const op = before ? (asc ? '<' : '>') : asc ? '>' : '<';
			conds.push(`${safeCols[i]} ${op} ?`);
			bindings.push(vals[i]);
			clauses.push('(' + conds.join(' AND ') + ')');
		}
		qb.whereRaw('(' + clauses.join(' OR ') + ')', bindings);
	}

	/** Apply a filter operator to a subquery builder (same semantics as the main filter path). */
	private applyOperator(qb: QueryBuilder, field: string, operator: FilterOperator, value: unknown): void {
		switch (operator) {
			case '_null':
				qb.where(field, 'IS NULL', '');
				break;
			case '_nnull':
				qb.where(field, 'IS NOT NULL', '');
				break;
			case '_contains':
			case '_icontains':
				qb.where(field, 'LIKE', `%${value}%`);
				break;
			case '_ncontains':
				qb.where(field, 'NOT LIKE', `%${value}%`);
				break;
			case '_startswith':
				qb.where(field, 'LIKE', `${value}%`);
				break;
			case '_endswith':
				qb.where(field, 'LIKE', `%${value}`);
				break;
			case '_in':
				qb.whereIn(field, value as unknown[]);
				break;
			case '_nin':
				qb.whereNotIn(field, value as unknown[]);
				break;
			case '_between': {
				const a = value as [unknown, unknown];
				qb.where(field, '>=', a[0]);
				qb.where(field, '<=', a[1]);
				break;
			}
			case '_empty':
				qb.where(field, '=', '');
				break;
			case '_nempty':
				qb.where(field, '!=', '');
				break;
			default: {
				const sqlOp = OPERATOR_MAP[operator];
				if (sqlOp) qb.where(field, sqlOp, value);
			}
		}
	}

	private async runAggregate(
		tableName: string,
		parsed: ParsedQuery,
		sf: FieldDefinition[],
		includeTrashed: boolean,
		search: { fields: string[]; mode: 'contains' | 'prefix' },
	): Promise<Record<string, unknown>[]> {
		const sfSet = new Set(sf.map((f) => f.name));
		// System columns aggregates may legitimately target (id/created_at/updated_at).
		const ALLOWED_AGG_FIELDS = new Set(['id', 'created_at', 'updated_at']);
		const aggSelects = parsed.aggregate.map((a) => {
			// Reject unknown fields BEFORE they reach SQL — an unknown name would
			// surface as a raw SQL error (500); a system column may leak internals.
			if (a.field !== '*' && !sfSet.has(a.field) && !ALLOWED_AGG_FIELDS.has(a.field)) {
				throw new ValidationError(`Unknown aggregate field "${a.field}" for this collection`);
			}
			const field = a.field === '*' ? '*' : sanitizeIdentifier(a.field, 'aggregate.field');
			const opMap: Record<string, string> = {
				count: 'COUNT',
				count_distinct: 'COUNT(DISTINCT',
				sum: 'SUM',
				avg: 'AVG',
				min: 'MIN',
				max: 'MAX',
			};
			let sql = opMap[a.op] || 'COUNT';
			sql += '(' + field + (a.op === 'count_distinct' ? '))' : ')');
			const safeAlias = sanitizeIdentifier(a.alias, 'aggregate.alias');
			return sql + ' as ' + safeAlias;
		});
		// Build the FULL filter scope — identical to listItems (incl. nested
		// relation filters) so an aggregate count always matches the list count
		// for the same query (?filter[parent.field][_eq]=x&count=true vs aggregate).
		const fQb = QueryBuilder.from(tableName);
		if (includeTrashed) {
			fQb.whereNotNull('deleted_at');
		} else {
			fQb.whereNull('deleted_at');
		}
		QueryParser.applyToQueryBuilder(fQb, parsed, sfSet, search.fields, search.mode);
		QueryParser.applyFunctionFilters(fQb, parsed, sfSet);
		await this.applyNestedQueries(fQb, parsed, sf, tableName);

		// Group-by support (chart widgets): ?groupBy[]=status or ?groupBy[]=month(created_at).
		// Invalid entries are ignored — but a FUNCTION entry on an unknown field
		// (e.g. month(nonexistent)) would still reach SQL as a raw error, so the
		// field is validated for fn entries too ('*' for count(*)-style; system
		// timestamp columns are legitimate group targets).
		const GROUP_SYSTEM_FIELDS = new Set(['id', 'created_at', 'updated_at']);
		const groupClauses = parsed.groupBy
			.map(parseGroupByClause)
			.filter((g): g is GroupByClause => !!g && (g.field === '*' || sfSet.has(g.field) || GROUP_SYSTEM_FIELDS.has(g.field)));
		const groupSelects = groupClauses.map(groupBySelectExpr);

		// Replace the SELECT clause with the aggregate/group columns (clears any
		// ?fields= projection applied by applyToQueryBuilder) and drop ORDER BY —
		// an aggregate must not be ordered by a non-grouped column. No string
		// surgery on the rendered SQL (the old indexOf('FROM') splice was fragile).
		fQb.select().clearOrderBy();
		fQb.selectRaw([...groupSelects, ...aggSelects].join(', '));
		const fStmt = fQb.toSelect();
		if (groupClauses.length === 0) {
			const r = await this.db.first<Record<string, unknown>>(QueryBuilder.raw(fStmt.sql, fStmt.bindings));
			return [r ?? {}];
		}
		// GROUP BY output-column position — matches the SELECT list order. The probe
		// LIMIT (ceiling + 1) bounds the work AND lets us fail loudly past the
		// ceiling instead of returning a truncated chart (see MAX_AGGREGATE_GROUPS).
		const sql = `${fStmt.sql} GROUP BY ${groupClauses.map((_, i) => i + 1).join(', ')} LIMIT ${MAX_AGGREGATE_GROUPS + 1}`;
		const grouped = await this.db.all<Record<string, unknown>>(QueryBuilder.raw(sql, fStmt.bindings));
		assertGroupCeiling(grouped.length);
		return grouped;
	}
}
