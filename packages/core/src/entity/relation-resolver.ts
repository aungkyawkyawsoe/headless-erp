/**
 * Relation Resolver — v2 Optimized
 *
 * Resolves M2O (Many-to-One), O2M (One-to-Many), M2A (Many-to-Any)
 * relations for CMS collection items.
 *
 * Optimizations (FIX #4, #5, #6):
 *   4 - Batch M2O: same target table → single SELECT ... WHERE id IN (...)
 *       Instead of N queries for N fields, deduplicates by target table.
 *   5 - Field projection: Use '*' only when needed; limited columns for preview
 *   6 - Parallel: resolveM2O, resolveO2M, resolveM2A run concurrently
 *
 * Uses application-level joining (batch fetch) instead of SQL JOIN
 * for better compatibility with D1 and simpler code.
 */

import type { FieldDefinition, EntitySchema } from '@mmbix/types';
import { D1Client } from '../db/d1-client';
import { QueryBuilder } from '../db/query-builder';
import { mergeRowData } from '../entity/field-utils';

/**
 * Resolve M2O fields: replace foreign key UUIDs with related objects.
 *
 * OPTIMIZED (FIX #4): Groups M2O fields by target table.
 * If article.customer_id and article.sales_rep_id both point to _users,
 * we do ONE SELECT ... FROM _users WHERE id IN (...) instead of two.
 *
 * Projection pushdown: `columnsByTable` maps each target table to the exact
 * column list the caller's selection needs (id + requested child columns).
 * When present the target SELECT narrows to those columns instead of '*' —
 * the JS-side rows keep the same shape (callers still prune per field); only
 * the SQL transfer narrows. A table missing from the map keeps select('*')
 * (full-row requests like `fields=department` / `fields=department.*`).
 */
export async function resolveM2O(
	items: Record<string, unknown>[],
	m2oFields: { fieldName: string; targetTable: string }[],
	db: D1Client,
	columnsByTable?: Map<string, string[]> | null,
): Promise<Record<string, unknown>[]> {
	if (items.length === 0 || m2oFields.length === 0) return items;

	// Step 1: Group M2O fields by target table
	const tableGroups = new Map<string, string[]>();
	for (const m2o of m2oFields) {
		const existing = tableGroups.get(m2o.targetTable);
		if (existing) {
			existing.push(m2o.fieldName);
		} else {
			tableGroups.set(m2o.targetTable, [m2o.fieldName]);
		}
	}

	// Step 2: Collect ALL FK IDs across all items, grouped by target table
	const tableIdSets = new Map<string, Set<string>>();
	for (const m2o of m2oFields) {
		let idSet = tableIdSets.get(m2o.targetTable);
		if (!idSet) {
			idSet = new Set<string>();
			tableIdSets.set(m2o.targetTable, idSet);
		}
		for (const item of items) {
			const fk = item[m2o.fieldName];
			if (typeof fk === 'string' && fk.length > 0) idSet.add(fk);
		}
	}

	// Step 3: ONE query per unique target table (not per field!)
	const fetches = [...tableIdSets.entries()].map(async ([targetTable, idSet]) => {
		const uniqueIds = [...idSet];
		if (uniqueIds.length === 0) return { targetTable, lookup: new Map<string, Record<string, unknown>>() };

		// Soft-deleted targets are excluded — an expanded relation must mirror the
		// root-list contract (trashed rows hidden). A trashed target therefore
		// behaves like a dangling FK: the lookup misses and the field resolves to
		// null below (same convention as ChildTableService / ComputedFieldService).
		// Projection pushdown: when the caller's selection named child columns the
		// target SELECT narrows to id + those columns; full-row requests (or a
		// table missing from the map) keep '*' — the JS prune that follows still
		// shapes every resolved row, only the SQL transfer narrows.
		const qb = QueryBuilder.from(targetTable).whereIn('id', uniqueIds).whereNull('deleted_at');
		const columns = columnsByTable?.get(targetTable);
		if (columns && columns.length > 0) qb.select(...columns);
		else qb.select('*');
		const related = await db.all<Record<string, unknown>>(qb.toSelect());

		const lookup = new Map<string, Record<string, unknown>>();
		for (const rel of related) lookup.set(String(rel.id), mergeRowData(rel));
		return { targetTable, lookup };
	});

	const results = await Promise.all(fetches);

	// Step 4: Build lookup by target table
	const tableLookups = new Map<string, Map<string, Record<string, unknown>>>();
	for (const { targetTable, lookup } of results) {
		tableLookups.set(targetTable, lookup);
	}

	// Step 5: Assign resolved objects to items
	for (const m2o of m2oFields) {
		const lookup = tableLookups.get(m2o.targetTable);
		if (!lookup) continue;
		for (const item of items) {
			const fk = item[m2o.fieldName];
			if (typeof fk === 'string') {
				const resolved = lookup.get(fk);
				if (resolved) item[m2o.fieldName] = resolved;
				// Dangling FK (the requested target row does not exist) → null, never the
				// raw scalar id: an expanded relation must not leak its db key as a value.
				else item[m2o.fieldName] = null;
			}
		}
	}

	return items;
}

/**
 * Resolve O2M fields: fetch related items that reference this item.
 *
 * For items with an O2M field like "articles" (where articles.article_id = this.id):
 *   Input:  [{ id: "uuid-1", name: "Author1" }]
 *   Output: [{ id: "uuid-1", name: "Author1", articles: [{ id: "...", title: "..." }] }]
 */
export async function resolveO2M(
	items: Record<string, unknown>[],
	o2mFields: { fieldName: string; targetTable: string; foreignKey: string }[],
	db: D1Client,
	/** Max children to resolve per O2M field — prevents a list page from
	 *  materializing every child of every row (O(Σ children) memory blowup). */
	limit = 50,
): Promise<Record<string, unknown>[]> {
	if (items.length === 0 || o2mFields.length === 0) return items;

	const ids = items.map((item) => item.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
	if (ids.length === 0) return items;

	// Parallel: fetch related items for all O2M fields concurrently
	const fetches = o2mFields.map(async (o2m) => {
		// Per-parent cap via a window function: ROW_NUMBER() OVER (PARTITION BY the
		// foreign key) gives EVERY parent up to `limit` children — a plain LIMIT
		// would starve later parents entirely once the field-wide total passes the
		// cap (a page of 20 rows × 100 children each would otherwise hide most of
		// the rows' children behind the first parents).
		// NOTE: the window expression must NOT repeat the `*` selector — QueryBuilder
		// defaults `_columns` to ['*'], so a selectRaw('*, ROW_NUMBER() …') would emit
		// `SELECT *, *, …` and D1 renames the duplicate column set with `:1` suffixes
		// (every child row then carries its columns twice). Soft-deleted children are
		// excluded before windowing (mirrors the root-list deleted_at IS NULL default).
		const fkCol = String(o2m.foreignKey).replace(/"/g, '""');
		const sub = QueryBuilder.from(o2m.targetTable)
			.selectRaw(`ROW_NUMBER() OVER (PARTITION BY "${fkCol}" ORDER BY id DESC) AS _o2m_rn`)
			.whereIn(o2m.foreignKey, ids)
			.whereNull('deleted_at');
		const subStmt = sub.toSelect();
		const related = await db.all<Record<string, unknown>>({
			sql: `SELECT * FROM (${subStmt.sql}) WHERE _o2m_rn <= ?`,
			bindings: [...subStmt.bindings, limit],
		});

		const grouped: Record<string, Record<string, unknown>[]> = {};
		for (const rel of related) {
			const fk = String(rel[o2m.foreignKey] ?? '');
			// Strip the internal row-number column — it is not part of the payload.
			delete (rel as Record<string, unknown>)._o2m_rn;
			if (!grouped[fk]) grouped[fk] = [];
			grouped[fk].push(mergeRowData(rel));
		}
		return { fieldName: o2m.fieldName, grouped };
	});

	const results = await Promise.all(fetches);

	// Assign to items
	for (const { fieldName, grouped } of results) {
		for (const item of items) {
			const id = String(item.id ?? '');
			item[fieldName] = grouped[id] || [];
		}
	}

	return items;
}

/**
 * Get M2O relation info from schema fields.
 */
export function getM2ORelations(
	schemaFields: FieldDefinition[],
	collections: EntitySchema[],
): { fieldName: string; targetTable: string }[] {
	const collectionMap = new Map(collections.map((c) => [c.slug, c]));
	return schemaFields
		.filter((f) => f.type === 'm2o' && f.related_collection)
		.map((f) => {
			const target = collectionMap.get(f.related_collection!);
			return target ? { fieldName: f.name, targetTable: target.table_name } : null;
		})
		.filter((x): x is { fieldName: string; targetTable: string } => x !== null);
}

/**
 * Get O2M relation info from schema fields.
 */
export function getO2MRelations(
	schemaFields: FieldDefinition[],
	collections: EntitySchema[],
): { fieldName: string; targetTable: string; foreignKey: string }[] {
	const collectionMap = new Map(collections.map((c) => [c.slug, c]));
	return schemaFields
		.filter((f) => f.type === 'o2m' && f.related_collection && f.foreign_key)
		.map((f) => {
			const target = collectionMap.get(f.related_collection!);
			return target ? { fieldName: f.name, targetTable: target.table_name, foreignKey: f.foreign_key! } : null;
		})
		.filter((x): x is { fieldName: string; targetTable: string; foreignKey: string } => x !== null);
}

/**
 * Get M2M relation info from schema fields.
 *
 * Junction table name must match SchemaBuilder.createJunctionTable:
 *   `_jt_{sourceTable}_{targetTable}`
 */
export function getM2MRelations(
	schemaFields: FieldDefinition[],
	collections: EntitySchema[],
	sourceTable: string,
): { fieldName: string; targetTable: string; junctionTable: string }[] {
	const collectionMap = new Map(collections.map((c) => [c.slug, c]));
	return schemaFields
		.filter((f) => f.type === 'm2m' && f.related_collection)
		.map((f) => {
			const target = collectionMap.get(f.related_collection!);
			if (!target) return null;
			return { fieldName: f.name, targetTable: target.table_name, junctionTable: `_jt_${sourceTable}_${target.table_name}` };
		})
		.filter((x): x is { fieldName: string; targetTable: string; junctionTable: string } => x !== null);
}

/**
 * Resolve M2M fields: replace junction-table rows with the related target objects.
 *
 * Batched: ONE junction query + ONE target query per M2M field, regardless of
 * how many items are being resolved (no N+1). Targets are fetched with a
 * single WHERE id IN (...) and joined in memory.
 *
 * Per-parent cap: `limit` bounds how many targets each parent row can
 * materialize (default 50, mirrors resolveO2M). The cap is applied to the
 * junction stream IN ORDER (created_at asc, target_id asc — the same
 * deterministic order the array is joined in), so a page of rows can never
 * materialize every m2m child of every parent. Targets are only fetched for
 * the kept junctions, which keeps the second query bounded too.
 *
 * Projection pushdown: `columnsByTable` narrows the target SELECT to the
 * caller's requested columns (see resolveM2O). A table missing from the map
 * keeps select('*').
 */
export async function resolveM2M(
	items: Record<string, unknown>[],
	m2mFields: { fieldName: string; targetTable: string; junctionTable: string }[],
	db: D1Client,
	columnsByTable?: Map<string, string[]> | null,
	limit = 50,
): Promise<Record<string, unknown>[]> {
	if (items.length === 0 || m2mFields.length === 0) return items;

	const ids = items.map((item) => item.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
	if (ids.length === 0) return items;

	const fetches = m2mFields.map(async (m2m) => {
		// Per-parent cap via a window function (mirrors resolveO2M): every parent
		// keeps up to `limit` junctions in the SAME deterministic order the array
		// is joined in (created_at asc, target_id asc) — a plain LIMIT would
		// starve later parents once the field-wide total passes the cap, and a
		// page of rows would otherwise materialize every m2m child of every
		// parent. The window expression must NOT repeat the `*` selector
		// (QueryBuilder defaults `_columns` to ['*'] — see the o2m note).
		const sub = QueryBuilder.from(m2m.junctionTable)
			.selectRaw('ROW_NUMBER() OVER (PARTITION BY "source_id" ORDER BY "created_at" ASC, "target_id" ASC) AS _m2m_rn')
			.whereIn('source_id', ids);
		const subStmt = sub.toSelect();
		const junctions = await db.all<Record<string, unknown>>({
			sql: `SELECT source_id, target_id FROM (${subStmt.sql}) WHERE _m2m_rn <= ? ORDER BY "created_at" ASC, "target_id" ASC`,
			bindings: [...subStmt.bindings, limit],
		});

		const bySource = new Map<string, string[]>();
		const targetIds = new Set<string>();
		for (const j of junctions) {
			const sourceId = String(j.source_id ?? '');
			const targetId = String(j.target_id ?? '');
			if (!sourceId || !targetId) continue;
			if (!bySource.has(sourceId)) bySource.set(sourceId, []);
			bySource.get(sourceId)!.push(targetId);
			targetIds.add(targetId);
		}

		const targetLookup = new Map<string, Record<string, unknown>>();
		if (targetIds.size > 0) {
			// Soft-deleted targets are excluded from the expanded array (same
			// root-list deleted_at IS NULL convention as m2o/o2m resolution).
			// Projection pushdown: the target SELECT narrows to the caller's
			// requested columns when known (see resolveM2O), else stays '*'
			// (full-row requests like `fields=tags` / `fields=tags.*`).
			const qb = QueryBuilder.from(m2m.targetTable)
				.whereIn('id', [...targetIds])
				.whereNull('deleted_at');
			const columns = columnsByTable?.get(m2m.targetTable);
			if (columns && columns.length > 0) qb.select(...columns);
			else qb.select('*');
			const targets = await db.all<Record<string, unknown>>(qb.toSelect());
			for (const t of targets) targetLookup.set(String(t.id), mergeRowData(t));
		}

		return { fieldName: m2m.fieldName, bySource, targetLookup };
	});

	const results = await Promise.all(fetches);

	for (const { fieldName, bySource, targetLookup } of results) {
		for (const item of items) {
			const id = String(item.id ?? '');
			const related = (bySource.get(id) ?? [])
				.map((targetId) => targetLookup.get(targetId))
				.filter((x): x is Record<string, unknown> => x !== undefined);
			item[fieldName] = related;
		}
	}

	return items;
}
