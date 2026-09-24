/**
 * Many-to-Any (Polymorphic) Relation — Service + Plugin
 *
 * Enables "m2a" field type: references ANY entity collection.
 * Storage: {field}_type TEXT + {field}_id TEXT
 * Resolution: batch-fetch from correct table by type
 */

import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { mergeRowData } from '@mmbix/core';
import { collectionTable } from '@/lib/utils/table-name';
import { findCollectionRow } from '@/lib/services/schema-lookup';
import type { FieldDefinition } from '@mmbix/types';
import { ValidationError } from '@mmbix/utils';

export interface M2AInfo {
	fieldName: string;
	allowed: string[];
	typeCol: string;
	idCol: string;
}

export class M2AService {
	constructor(private db: D1Client) {}

	/**
	 * Resolve the actual table name for a collection slug.
	 * Looks up `table_name` from `_entity_schemas`; falls back to `cms_${slug}`.
	 */
	private async _getTableName(slug: string): Promise<string> {
		const row = await findCollectionRow(this.db, slug);
		return row?.table_name ?? collectionTable(slug);
	}

	getFields(fields: FieldDefinition[]): M2AInfo[] {
		return fields
			.filter((f) => f.type === 'm2a' && f.related_collections)
			.map((f) => ({
				fieldName: f.name,
				allowed: f.related_collections!,
				typeCol: `${f.name}_type`,
				idCol: `${f.name}_id`,
			}));
	}

	validate(m2aFields: M2AInfo[], data: Record<string, unknown>): void {
		for (const m of m2aFields) {
			const t = data[m.typeCol],
				id = data[m.idCol];
			if ((t || id) && !(t && id)) throw new ValidationError(`"${m.fieldName}": both _type and _id required`);
			if (t && !m.allowed.includes(String(t))) throw new ValidationError(`"${m.fieldName}": type "${t}" not allowed`);
		}
	}

	async resolve(items: Record<string, unknown>[], m2aFields: M2AInfo[]): Promise<Record<string, unknown>[]> {
		for (const m of m2aFields) {
			const byType = new Map<string, string[]>();
			for (const item of items) {
				const t = item[m.typeCol],
					id = item[m.idCol];
				if (typeof t === 'string' && typeof id === 'string') {
					if (!byType.has(t)) byType.set(t, []);
					byType.get(t)!.push(id);
				}
			}
			if (byType.size === 0) continue;

			// Memoize table resolution per resolve call — 1 lookup per distinct
			// collection instead of 1 per type per field.
			const tableCache = new Map<string, string>();
			const getTable = async (slug: string): Promise<string> => {
				let table = tableCache.get(slug);
				if (!table) {
					table = await this._getTableName(slug);
					tableCache.set(slug, table);
				}
				return table;
			};

			const lookup = new Map<string, Record<string, unknown>>();
			for (const [type, ids] of byType) {
				try {
					const tableName = await getTable(type);
					const rows = await this.db.all<Record<string, unknown>>(
						QueryBuilder.from(tableName)
							.select('*')
							.whereIn('id', [...new Set(ids)])
							.whereNull('deleted_at') // trashed polymorphic targets are invisible (root-list convention)
							.toSelect(),
					);
					for (const r of rows) {
						const merged = mergeRowData(r);
						merged._type = type;
						lookup.set(String(r.id), merged);
					}
				} catch {}
			}

			for (const item of items) {
				const id = item[m.idCol];
				if (typeof id === 'string') {
					if (lookup.has(id)) {
						item[m.fieldName] = lookup.get(id)!;
					} else {
						// Dangling/trashed target — never leak the raw {name}_type/{name}_id
						// columns as a value: the expanded relation resolves to null instead
						// (mirrors m2o dangling-FK handling in the relation resolver).
						item[m.fieldName] = null;
					}
					delete item[m.idCol];
					delete item[m.typeCol];
				}
			}
		}
		return items;
	}
}
