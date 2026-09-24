/**
 * Child Tables Service
 *
 * Enables composite documents — parent entities with embedded
 * child records (like Invoice → Invoice Items).
 *
 * How it works:
 *   1. Create a "table" field on the parent entity
 *   2. Child items are stored in their own collection with a parent_id
 *   3. When reading a parent, children are auto-resolved and embedded
 *   4. Creating/updating a parent with child data batch creates child items
 *
 * @example
 *   Entity: invoices  →  fields: [{ name: "items", type: "table", related_collection: "invoice_items" }]
 *   Entity: invoice_items  →  fields: [{ name: "product", type: "text" }, { name: "qty", type: "integer" }]
 *
 *   POST /api/entities/invoices {
 *     customer: "Acme Corp",
 *     items: [{ product: "Widget", qty: 5 }, { product: "Gadget", qty: 3 }]
 *   }
 *   → Creates invoice + 2 invoice_items with parent_id → invoice.id
 *
 *   GET /api/entities/invoices/:id
 *   → { customer: "Acme Corp", items: [{ product: "Widget", qty: 5 }, { product: "Gadget", qty: 3 }] }
 */

import { D1Client } from '@mmbix/core';
import { QueryBuilder, invalidateCollectionReads } from '@mmbix/core';
import { coerceValue } from '@mmbix/core';
import { collectionTable } from '@/lib/utils/table-name';
import { SYSTEM_FIELD_NAMES } from '@/lib/services/collection.shared';
import { findCollectionRow, findCollectionRows } from '@/lib/services/schema-lookup';
import type { FieldDefinition, SqlStatement } from '@mmbix/types';
import { InternalError, ValidationError } from '@mmbix/utils';

export type ParentChildMap = Record<string, string>; // child_table_name → child_slug

export class ChildTableService {
	constructor(private db: D1Client) {}

	/**
	 * Resolve the actual table name for a collection slug.
	 * Looks up `table_name` from `_entity_schemas`; falls back to `cms_${slug}`.
	 */
	private async _getTableName(slug: string): Promise<string> {
		const row = await findCollectionRow(this.db, slug);
		return row?.table_name ?? collectionTable(slug);
	}

	/**
	 * Get the mapping of parent → child table fields.
	 * Returns: { child_table_name → child_slug }
	 */
	async getChildMap(schemaFields: FieldDefinition[]): Promise<ParentChildMap> {
		const tableFields = schemaFields.filter((f) => f.type === 'table' && f.related_collection);
		if (tableFields.length === 0) return {};

		const map: ParentChildMap = {};
		// ONE batched, cached read for every child target — was one D1 round-trip
		// per `table` field.
		const rows = await findCollectionRows(
			this.db,
			tableFields.map((f) => f.related_collection!),
		);
		for (const f of tableFields) {
			if (rows.get(f.related_collection!)) map[f.name] = f.related_collection!;
		}
		return map;
	}

	/**
	 * Before creating a parent item — extract child data,
	 * remove from insert payload, return for post-insert processing.
	 */
	extractChildData(
		body: Record<string, unknown>,
		schemaFields: FieldDefinition[],
	): {
		cleanBody: Record<string, unknown>;
		childData: Record<string, unknown[]>;
	} {
		const tableFields = schemaFields.filter((f) => f.type === 'table');
		const childData: Record<string, unknown[]> = {};
		const cleanBody = { ...body };

		for (const f of tableFields) {
			if (Array.isArray(cleanBody[f.name])) {
				childData[f.name] = cleanBody[f.name] as unknown[];
				delete cleanBody[f.name];
			}
		}

		return { cleanBody, childData };
	}

	/**
	 * After creating parent — create child items with parent_id.
	 */
	async createChildren(parentId: string, childData: Record<string, unknown[]>, childMap: ParentChildMap): Promise<void> {
		for (const [fieldName, items] of Object.entries(childData)) {
			const childSlug = childMap[fieldName];
			if (!childSlug) continue;
			const childTable = await this._getTableName(childSlug);
			const childFields = await this._getChildFields(childSlug);

			let wrote = false;
			for (const item of items) {
				if (typeof item === 'object' && item !== null) {
					const now = new Date().toISOString();
					const insertData: Record<string, unknown> = {
						id: crypto.randomUUID(),
						parent_id: parentId,
						...this._coerceChildRow(childFields, item as Record<string, unknown>),
						doc_status: 'draft',
						created_at: now,
						updated_at: now,
					};
					try {
						await this.db.run(QueryBuilder.from(childTable).returning(true).toInsert(insertData));
						wrote = true;
					} catch (err) {
						const msg = err instanceof Error ? err.message : 'Unknown error';
						if (msg.includes('NOT NULL')) throw new ValidationError(`Child table field missing: ${msg.split(':').pop()}`);
						throw new InternalError(`Failed to create child record: ${msg}`);
					}
				}
			}
			// The rows landed in the CHILD collection's table, so drop ITS cached reads:
			// the parent's own invalidation cannot, because a reader of these rows (the
			// document page's line read) is keyed on the child slug. The observer also
			// records it in the write's change envelope, so clients drop it too.
			if (wrote) invalidateCollectionReads(childSlug);
		}
	}

	/**
	 * Before updating parent — replace all children (delete + re-create).
	 */
	async replaceChildren(parentId: string, childData: Record<string, unknown[]>, childMap: ParentChildMap): Promise<void> {
		for (const [fieldName, items] of Object.entries(childData)) {
			const childSlug = childMap[fieldName];
			if (!childSlug) continue;
			const childTable = await this._getTableName(childSlug);
			const childFields = await this._getChildFields(childSlug);

			try {
				const statements: SqlStatement[] = [];
				// Delete existing children
				statements.push(QueryBuilder.from(childTable).where('parent_id', parentId).toDelete());
				// Re-create
				for (const item of items) {
					if (typeof item === 'object' && item !== null) {
						const now = new Date().toISOString();
						const insertData: Record<string, unknown> = {
							id: crypto.randomUUID(),
							parent_id: parentId,
							...this._coerceChildRow(childFields, item as Record<string, unknown>),
							doc_status: 'draft',
							created_at: now,
							updated_at: now,
						};
						statements.push(QueryBuilder.from(childTable).toInsert(insertData));
					}
				}
				await this.db.batch(statements);
				// The child SET was replaced (a delete ran even for an empty payload),
				// so drop this child collection's cached reads — a reader keyed on the
				// child slug would otherwise serve the pre-save lines until the TTL,
				// long after the parent was saved. The observer folds it into
				// `meta.changed`, so clients invalidate it too.
				invalidateCollectionReads(childSlug);
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				if (msg.includes('UNIQUE')) throw new InternalError(`Duplicate child record in ${childTable}`);
				if (msg.includes('NOT NULL')) throw new ValidationError(`Child table field missing: ${msg.split(':').pop()}`);
				console.error(`[ChildTables] Failed to replace children for ${childTable}:`, err);
				throw err;
			}
		}
	}

	/** Load the child collection's schema fields (non-system) for value coercion. */
	private async _getChildFields(childSlug: string): Promise<FieldDefinition[]> {
		const row = await findCollectionRow(this.db, childSlug);
		try {
			const parsed = JSON.parse(row?.schema_json ?? '{}') as { fields?: FieldDefinition[] };
			return (parsed.fields ?? []).filter((f) => f.name && !SYSTEM_FIELD_NAMES.has(f.name));
		} catch {
			return [];
		}
	}

	/**
	 * Coerce a child-table row to its storage representation, mirroring the parent
	 * row's splitRowData behavior: known fields are coerced by type (json objects
	 * become JSON strings — D1 has no native JSON column), unknown fields are
	 * parked in _meta instead of failing the INSERT with a missing column.
	 */
	private _coerceChildRow(fields: FieldDefinition[], item: Record<string, unknown>): Record<string, unknown> {
		const schemaNames = new Set(fields.map((f) => f.name));
		const schemaTypeMap = new Map(fields.map((f) => [f.name, f.type]));
		const m2aColumns = new Set<string>();
		for (const f of fields) {
			if (f.type === 'm2a') {
				m2aColumns.add(`${f.name}_type`);
				m2aColumns.add(`${f.name}_id`);
			}
		}

		const columns: Record<string, unknown> = {};
		const meta: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(item)) {
			if (SYSTEM_FIELD_NAMES.has(key)) continue;
			if (schemaNames.has(key)) {
				const fieldType = schemaTypeMap.get(key)!;
				if (fieldType === 'o2m' || fieldType === 'm2m' || fieldType === 'table' || fieldType === 'formula') continue;
				columns[key] = coerceValue(value, fieldType);
			} else if (m2aColumns.has(key)) {
				columns[key] = value;
			} else {
				meta[key] = value;
			}
		}

		const out: Record<string, unknown> = { ...columns };
		if (Object.keys(meta).length > 0) out._meta = JSON.stringify(meta);
		return out;
	}

	/**
	 * When reading a parent — fetch and embed children.
	 *
	 * `limit` (optional) applies a per-parent cap via a ROW_NUMBER() window over
	 * parent_id (same semantics as the o2m resolver): every parent gets up to
	 * `limit` children ordered by id, never every child of every parent. The
	 * cap is DISPLAY-side only — callers that need the full child set for
	 * aggregate semantics (stored/virtual formula lookup scopes) omit it.
	 */
	async resolveChildren(
		parentIds: string[],
		schemaFields: FieldDefinition[],
		limit?: number,
	): Promise<{ parentId: string; fieldName: string; children: Record<string, unknown>[] }[]> {
		const tableFields = schemaFields.filter((f) => f.type === 'table' && f.related_collection);
		if (tableFields.length === 0 || parentIds.length === 0) return [];

		const results: { parentId: string; fieldName: string; children: Record<string, unknown>[] }[] = [];

		for (const f of tableFields) {
			const childTable = await this._getTableName(f.related_collection!);
			try {
				const capped = limit !== undefined && Number.isFinite(limit) && limit > 0;
				let childrenStmt: SqlStatement;
				if (capped) {
					// Per-parent cap via a window function: ROW_NUMBER() OVER (PARTITION BY
					// parent_id ORDER BY id) gives EVERY parent up to `limit` children — a
					// plain LIMIT would starve later parents entirely once the total passes
					// the cap. Mirrors resolveO2M; soft-deleted children are excluded before
					// windowing. The window expression must not repeat the `*` selector
					// (QueryBuilder defaults `_columns` to ['*'] — see the o2m note).
					const sub = QueryBuilder.from(childTable)
						.selectRaw('ROW_NUMBER() OVER (PARTITION BY "parent_id" ORDER BY id ASC) AS _ct_rn')
						.whereIn('parent_id', parentIds)
						.whereNull('deleted_at');
					const subStmt = sub.toSelect();
					// Order the surviving rows by their window rank so each parent's child
					// order matches the uncapped id ASC fetch.
					childrenStmt = {
						sql: `SELECT * FROM (${subStmt.sql}) WHERE _ct_rn <= ? ORDER BY _ct_rn ASC`,
						bindings: [...subStmt.bindings, limit],
					};
				} else {
					childrenStmt = QueryBuilder.from(childTable)
						.select('*')
						.whereIn('parent_id', parentIds)
						.whereNull('deleted_at')
						.orderBy('id', 'asc')
						.toSelect();
				}
				const children = await this.db.all<Record<string, unknown>>(childrenStmt);

				const grouped: Record<string, Record<string, unknown>[]> = {};
				for (const child of children) {
					const pid = String(child.parent_id ?? '');
					if (!grouped[pid]) grouped[pid] = [];
					const rest: Record<string, unknown> = {};
					for (const [k, v] of Object.entries(child)) {
						if (k !== 'parent_id' && k !== 'deleted_at' && k !== '_meta' && k !== '_ct_rn') rest[k] = v;
					}
					grouped[pid].push(rest);
				}

				for (const pid of parentIds) {
					results.push({ parentId: pid, fieldName: f.name, children: grouped[pid] || [] });
				}
			} catch {
				// Table might not exist yet
			}
		}

		return results;
	}
}
