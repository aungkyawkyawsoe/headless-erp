/**
 * CascadeService — M2M junction bookkeeping + graph-wide cascade delete.
 *
 * Extracted from CollectionService (enterprise decomposition): owns every
 * write-path statement that touches M2M junction tables, plus the cascade
 * delete traversal over the relation graph.
 *
 * Performance notes:
 *  - Level-batched BFS: children are located with ONE `WHERE field IN (...)` per
 *    (child collection, field) per level instead of one SELECT per parent row,
 *    and soft/hard deletes are batched the same way (QueryBuilder.whereIn
 *    transparently switches to json_each for large lists — D1's 100-binding cap).
 *  - The inbound-cascade index (parent → children) is memoized in a WeakMap
 *    keyed on the array identity returned by getCollections(), so it is parsed
 *    once per schema-cache lifetime instead of on every delete. Collections
 *    without any cascade_delete field pay ~zero work here.
 */
import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { SchemaBuilder } from '@mmbix/core';
import type { EntitySchema, FieldDefinition, SqlStatement } from '@mmbix/types';
import { collectionTable } from '@/lib/utils/table-name';
import type { CollectionInfo } from '@/lib/services/collection.shared';

export class CascadeService {
	private db: D1Client;
	private getCollection: (slug: string) => Promise<CollectionInfo>;
	private getCollections: () => Promise<EntitySchema[]>;

	/** Per-schema-array memo — auto-invalidates with the schema cache (array identity). */
	private cascadeMapCache = new WeakMap<EntitySchema[], Map<string, { childSlug: string; fieldName: string }[]>>();

	constructor(db: D1Client, getCollection: (slug: string) => Promise<CollectionInfo>, getCollections: () => Promise<EntitySchema[]>) {
		this.db = db;
		this.getCollection = getCollection;
		this.getCollections = getCollections;
	}

	/**
	 * Build the junction-table statements for M2M fields.
	 *
	 * 'create' → insert rows for the provided target ids.
	 * 'update' → delete existing rows, then insert the new set (atomic with the
	 * parent UPDATE — the caller batches them together). Fields not present in
	 * the payload are left untouched.
	 *
	 * Junction tables have id/source_id/target_id/created_at only.
	 *
	 * The junction name follows the RELATION READ path (packages/core
	 * relation-resolver + deleteM2MJunctions below): `_jt_{sourceTable}_
	 * {targetTable}` with the TARGET's stored `_entity_schemas.table_name` —
	 * NOT `collectionTable(slug)` — so collections whose physical table was
	 * renamed (per-collection table_name ≠ prefix + slug) keep reads, writes
	 * and deletes on the SAME junction table.
	 */
	async buildM2MStatements(
		tableName: string,
		data: Record<string, unknown>,
		sf: FieldDefinition[],
		sourceId: string,
		mode: 'create' | 'update',
	): Promise<SqlStatement[]> {
		const statements: SqlStatement[] = [];
		const m2mFields = sf.filter((f) => f.type === 'm2m' && f.related_collection);
		if (m2mFields.length === 0) return statements;
		const allC = await this.getCollections();
		const tableBySlug = new Map(allC.map((c) => [c.slug, c.table_name]));
		for (const f of m2mFields) {
			const val = data[f.name];
			if (mode === 'update' && val === undefined) continue; // field absent → leave junctions as-is
			const targetTable = tableBySlug.get(f.related_collection!) ?? collectionTable(f.related_collection!);
			const { table: jtName } = new SchemaBuilder().createJunctionTable(tableName, targetTable);
			if (mode === 'update') {
				statements.push(QueryBuilder.from(jtName).where('source_id', sourceId).toDelete());
			}
			if (val && Array.isArray(val)) {
				const now = new Date().toISOString();
				for (const targetId of val) {
					statements.push(
						QueryBuilder.from(jtName).toInsert({
							id: crypto.randomUUID(),
							source_id: sourceId,
							target_id: String(targetId),
							created_at: now,
						}),
					);
				}
			}
		}
		return statements;
	}

	/**
	 * Delete M2M junction rows where any of the given ids is the source.
	 * Prevents orphaned links when items are hard-deleted (batched per field —
	 * one DELETE per m2m field, not one per row).
	 */
	async deleteM2MJunctions(collectionSlug: string, ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		const info = await this.getCollection(collectionSlug);
		const { table_name: tableName, schemaFields } = info;
		const allC = await this.getCollections();
		const collectionMap = new Map(allC.map((c) => [c.slug, c]));
		for (const f of schemaFields) {
			if (f.type !== 'm2m' || !f.related_collection) continue;
			const target = collectionMap.get(f.related_collection);
			if (!target) continue;
			const { table: jtName } = new SchemaBuilder().createJunctionTable(tableName, target.table_name);
			try {
				await this.db.run(QueryBuilder.from(jtName).whereIn('source_id', ids).toDelete());
			} catch (err) {
				console.error(`[M2M] Failed to clean junctions for ${jtName}:`, err);
			}
		}
	}

	/**
	 * Cascade delete child records referenced through m2o fields with
	 * cascade_delete: true.
	 *
	 * The `cascade_delete` flag lives on the CHILD collection's m2o field
	 * (e.g. expense.parent → departments). Deleting a parent row must find
	 * every collection whose m2o field targets it and delete/soft-delete the
	 * matching child rows. BFS over the relation graph with a visited set
	 * (defense in depth against cycles — self-referencing cascades are
	 * already rejected at schema creation).
	 *
	 * @param mode 'soft' → set deleted_at on children; 'hard' → delete rows
	 */
	async cascadeDelete(collectionSlug: string, id: string, mode: 'soft' | 'hard'): Promise<string[]> {
		const allC = await this.getCollections();
		const cascadeMap = this.buildCascadeMap(allC);

		const visited = new Set<string>([`${collectionSlug}:${id}`]);
		const deleted: string[] = [];

		// Level queue of (slug, ids) batches — children are located with one
		// batched query per (child collection, field) per level.
		let level: { slug: string; ids: string[] }[] = [{ slug: collectionSlug, ids: [id] }];

		while (level.length > 0) {
			// Bucket the next level by child collection while this one drains, so a
			// level of N children runs ONE `WHERE field IN (...)` per (slug, field)
			// instead of one queue entry + one SELECT per child id.
			const nextBySlug = new Map<string, string[]>();
			for (const { slug, ids } of level) {
				const inbound = cascadeMap.get(slug) ?? [];
				for (const { childSlug, fieldName } of inbound) {
					const childInfo = await this.getCollection(childSlug);
					const children = await this.db.all<{ id: string }>(
						QueryBuilder.from(childInfo.table_name).select('id').whereIn(fieldName, ids).whereNull('deleted_at').toSelect(),
					);
					const fresh: string[] = [];
					for (const child of children) {
						const key = `${childSlug}:${child.id}`;
						if (visited.has(key)) continue;
						visited.add(key);
						fresh.push(child.id);
					}
					if (fresh.length === 0) continue;
					if (mode === 'soft') {
						const now = new Date().toISOString();
						await this.db.run(QueryBuilder.from(childInfo.table_name).whereIn('id', fresh).toUpdate({ deleted_at: now, updated_at: now }));
					} else {
						await this.db.run(QueryBuilder.from(childInfo.table_name).whereIn('id', fresh).toDelete());
						await this.deleteM2MJunctions(childSlug, fresh);
					}
					for (const cid of fresh) {
						deleted.push(`${childSlug}:${cid}`);
						const bucket = nextBySlug.get(childSlug);
						if (bucket) bucket.push(cid);
						else nextBySlug.set(childSlug, [cid]);
					}
				}
			}
			level = [...nextBySlug].map(([slug, ids]) => ({ slug, ids }));
		}
		return deleted;
	}

	/** Inbound cascade index: parentSlug → [{ childSlug, fieldName }] (memoized). */
	private buildCascadeMap(allC: EntitySchema[]): Map<string, { childSlug: string; fieldName: string }[]> {
		const hit = this.cascadeMapCache.get(allC);
		if (hit) return hit;
		const cascadeMap = new Map<string, { childSlug: string; fieldName: string }[]>();
		for (const c of allC) {
			let fields: FieldDefinition[] = [];
			try {
				fields = (JSON.parse(c.schema_json || '{}') as { fields?: FieldDefinition[] }).fields ?? [];
			} catch {
				continue;
			}
			for (const f of fields) {
				if (f.type !== 'm2o' || !f.cascade_delete || !f.related_collection) continue;
				if (f.related_collection === c.slug) continue; // self-reference guard
				const list = cascadeMap.get(f.related_collection) ?? [];
				list.push({ childSlug: c.slug, fieldName: f.name });
				cascadeMap.set(f.related_collection, list);
			}
		}
		this.cascadeMapCache.set(allC, cascadeMap);
		return cascadeMap;
	}
}
