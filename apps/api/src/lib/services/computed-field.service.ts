/**
 * ComputedFieldService — DB-backed lookup resolution for formula fields.
 *
 * Shared by the read pipeline (RelationResolver — batched once per referenced
 * relation for a whole page, never N+1) and the write pipeline
 * (ItemMutationService — per record, for stored formula recompute).
 *
 * The pure helpers (extractLookupRefs / buildLookupScope / coerceComputedValue)
 * live in @mmbix/core (entity/computed.ts); this service only fetches the
 * related rows a formula's lookups reference:
 *
 *   SUM(items.amount) / COUNT(items)   → o2m / m2m / child-table children
 *   related.name                       → the single m2o target row
 */
import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import {
	mergeRowData,
	getM2ORelations,
	getO2MRelations,
	getM2MRelations,
	extractLookupRefs,
	buildLookupScope,
	physicalColumnNames,
	buildSystemColumnsList,
} from '@mmbix/core';
import type { EntitySchema, FieldDefinition, SystemFieldOptions } from '@mmbix/types';
import { DEFAULT_SYSTEM_FIELDS } from '@mmbix/types';
import { ChildTableService } from '@/plugins/child-tables/service';
import { SYSTEM_FIELD_NAMES } from '@/lib/services/collection.shared';

export class ComputedFieldService {
	constructor(
		private db: D1Client,
		private collections: EntitySchema[],
	) {}

	/**
	 * Single-hop member access (rel.col) is the only member syntax the expression
	 * evaluator supports (its parser resolves exactly one `.` hop), so a textual
	 * scan for `<relation> . <member>` over the formula(s) enumerates every child
	 * column a lookup can read. False positives (member text inside a string
	 * literal) only over-select — never under-select.
	 */
	private static lookupMemberColumns(formulas: Iterable<string>, relationName: string): Set<string> {
		const out = new Set<string>();
		const re = new RegExp(`(^|[^A-Za-z0-9_$])${relationName}\\s*\\.\\s*([A-Za-z_$][A-Za-z0-9_$]*)`, 'g');
		for (const formula of formulas) {
			let m: RegExpExecArray | null;
			while ((m = re.exec(formula))) out.add(m[2]);
		}
		return out;
	}

	/** True when a formula uses the relation as a bare value (not only rel.member). */
	private static usesRelationBare(formulas: Iterable<string>, relationName: string): boolean {
		const re = new RegExp(`(^|[^A-Za-z0-9_$])${relationName}(?!\\s*\\.)`);
		for (const formula of formulas) {
			if (re.test(formula)) return true;
		}
		return false;
	}

	/**
	 * Narrowest SELECT list a formula lookup can use while staying value-identical
	 * for the evaluator:
	 *  - m2o scope values are first-class ROW objects — when any formula uses the
	 *    relation bare (IS_EMPTY(rel), a json result embedding the whole row, …)
	 *    the full row must stay available → null keeps select('*'). Member-only
	 *    usage narrows to the referenced members + id.
	 *  - o2m/m2m array scopes expose per-column arrays + __rows (COUNT); the
	 *    documented SUM/COUNT/MIN/MAX/AVG patterns read only referenced members,
	 *    so id + referenced members is always sufficient.
	 * Every referenced member is validated against the target table's REAL
	 * columns (schema fields + configured system columns): a member that is not
	 * a column is a missing property under select('*') too, so it is simply not
	 * selected. Returns null → keep select('*').
	 */
	private lookupProjection(relationName: string, formulas: string[], targetTable: string, kind: 'm2o' | 'array'): string[] | null {
		if (formulas.length === 0) return null;
		const members = ComputedFieldService.lookupMemberColumns(formulas, relationName);
		if (kind === 'm2o' && ComputedFieldService.usesRelationBare(formulas, relationName)) return null;
		const coll = this.collections.find((c) => c.table_name === targetTable);
		if (!coll) return null;
		let fields: FieldDefinition[] = [];
		try {
			const p = JSON.parse(coll.schema_json) as { fields?: FieldDefinition[] };
			fields = (p.fields ?? []).filter((f) => f.name && !SYSTEM_FIELD_NAMES.has(f.name));
		} catch {
			return null;
		}
		let sysOpts: SystemFieldOptions = DEFAULT_SYSTEM_FIELDS;
		if (coll.system_field_options) {
			try {
				sysOpts = { ...DEFAULT_SYSTEM_FIELDS, ...(JSON.parse(coll.system_field_options) as SystemFieldOptions) };
			} catch {
				/* malformed options — keep the defaults */
			}
		}
		const allowed = new Set<string>([...physicalColumnNames(fields), ...buildSystemColumnsList(sysOpts)]);
		const cols = new Set<string>(['id']);
		for (const member of members) {
			if (allowed.has(member)) cols.add(member);
		}
		return [...cols];
	}

	private tableName(slug: string | undefined): string | undefined {
		if (!slug) return undefined;
		return this.collections.find((c) => c.slug === slug)?.table_name;
	}

	/**
	 * Fetch lookup scopes for a PAGE of rows, batched once per referenced
	 * relation. Returns Map<parentId, Record<relationName, scopeValue>> where
	 * array-relation values are lookup scopes (buildLookupScope) and m2o values
	 * are the related row object (or null).
	 */
	async fetchLookupScopes(
		items: Record<string, unknown>[],
		sf: FieldDefinition[],
		formulaFields: FieldDefinition[],
		sourceTable: string,
	): Promise<Map<string, Record<string, unknown>>> {
		const out = new Map<string, Record<string, unknown>>();
		if (items.length === 0 || formulaFields.length === 0) return out;
		const ids = items.map((i) => String(i.id ?? '')).filter(Boolean);
		if (ids.length === 0) return out;

		// Collect the referenced relations across all selected formulas (once).
		const refs = new Map<string, FieldDefinition>();
		for (const f of formulaFields) {
			for (const [name, def] of extractLookupRefs(f.formula as string, sf)) refs.set(name, def);
		}
		if (refs.size === 0) return out;

		const scopesFor = (id: string): Record<string, unknown> => {
			let per = out.get(id);
			if (!per) {
				per = {};
				out.set(id, per);
			}
			return per;
		};

		// The formula texts being computed — the lookup fetches below narrow their
		// SELECT to exactly the child/target columns these formulas reference.
		const formulas = formulaFields.map((f) => (f.formula as string) ?? '');

		// m2o — the FK lives in the item itself, one query per referenced field.
		for (const m2o of getM2ORelations(sf, this.collections)) {
			if (!refs.has(m2o.fieldName)) continue;
			const rows = await this.fetchM2O(
				items,
				m2o.fieldName,
				m2o.targetTable,
				this.lookupProjection(m2o.fieldName, formulas, m2o.targetTable, 'm2o'),
			);
			for (const item of items) {
				scopesFor(String(item.id ?? ''))[m2o.fieldName] = rows.get(String(item.id ?? '')) ?? null;
			}
		}

		// o2m / m2m / child-table — children keyed by the parent id.
		for (const o2m of getO2MRelations(sf, this.collections)) {
			if (!refs.has(o2m.fieldName)) continue;
			const rows = await this.fetchArrayChildren(
				ids,
				o2m.targetTable,
				o2m.foreignKey,
				this.lookupProjection(o2m.fieldName, formulas, o2m.targetTable, 'array'),
			);
			for (const id of ids) {
				scopesFor(id)[o2m.fieldName] = buildLookupScope(rows.get(id) ?? []);
			}
		}
		for (const m2m of getM2MRelations(sf, this.collections, sourceTable)) {
			if (!refs.has(m2m.fieldName)) continue;
			const rows = await this.fetchM2MChildren(
				ids,
				m2m.junctionTable,
				m2m.targetTable,
				this.lookupProjection(m2m.fieldName, formulas, m2m.targetTable, 'array'),
			);
			for (const id of ids) {
				scopesFor(id)[m2m.fieldName] = buildLookupScope(rows.get(id) ?? []);
			}
		}
		const tableFields = sf.filter((f) => f.type === 'table' && refs.has(f.name));
		if (tableFields.length > 0) {
			const children = await new ChildTableService(this.db).resolveChildren(ids, sf);
			const grouped = new Map<string, Record<string, unknown>[]>();
			for (const entry of children) {
				if (!refs.has(entry.fieldName)) continue;
				const arr = grouped.get(`${entry.fieldName}:${entry.parentId}`) ?? [];
				arr.push(...entry.children);
				grouped.set(`${entry.fieldName}:${entry.parentId}`, arr);
			}
			for (const id of ids) {
				for (const f of tableFields) {
					scopesFor(id)[f.name] = buildLookupScope(grouped.get(`${f.name}:${id}`) ?? []);
				}
			}
		}

		return out;
	}

	/**
	 * Attach lookup scope values for ONE record into an existing evaluator
	 * scope (write path — stored formula recompute). Reads existing children
	 * from the DB (o2m/m2m/table) and the m2o target row by FK from `scope`.
	 *
	 * `id` is the parent row's id — null on the pre-insert pass of a create.
	 * m2o lookups only need the FK, which the payload already carries, so they
	 * attach even before the row exists (a stored formula referencing
	 * `shift.time_in` must compute on the FIRST insert, not silently null).
	 * Array children (o2m/m2m/child-table) need the parent id to query, so
	 * they stay skipped until a later pass (or update) has one.
	 */
	async attachLookupScope(
		scope: Record<string, unknown>,
		formula: string,
		sf: FieldDefinition[],
		sourceTable: string,
		id: string | null,
	): Promise<void> {
		const refs = extractLookupRefs(formula, sf);
		if (refs.size === 0) return;

		for (const m2o of getM2ORelations(sf, this.collections)) {
			if (!refs.has(m2o.fieldName)) continue;
			const fk = scope[m2o.fieldName];
			// Already attached by an earlier formula in the same pass — the slot now
			// holds the target row object (or null), not the raw FK. Keep it instead
			// of re-reading (and clobbering) the FK.
			if (fk !== null && typeof fk === 'object') continue;
			if (typeof fk !== 'string' || fk.length === 0) {
				scope[m2o.fieldName] = null;
				continue;
			}
			// m2o fetch stays FULL-row on purpose: computeStoredFormulas calls
			// attachLookupScope once per stored formula over a SHARED scope, and an
			// already-attached row object skips re-fetching (the typeof-object guard
			// above) — so a row narrowed to one formula's members would starve a
			// later formula that reads different members of the same target.
			const row = await this.db.first<Record<string, unknown>>(QueryBuilder.from(m2o.targetTable).select('*').where('id', fk).toSelect());
			scope[m2o.fieldName] = row ? mergeRowData(row) : null;
		}

		if (!id) return; // array children below need the parent id

		for (const o2m of getO2MRelations(sf, this.collections)) {
			if (!refs.has(o2m.fieldName)) continue;
			const rows = await this.fetchArrayChildren(
				[id],
				o2m.targetTable,
				o2m.foreignKey,
				this.lookupProjection(o2m.fieldName, [formula], o2m.targetTable, 'array'),
			);
			scope[o2m.fieldName] = buildLookupScope(rows.get(id) ?? []);
		}
		for (const m2m of getM2MRelations(sf, this.collections, sourceTable)) {
			if (!refs.has(m2m.fieldName)) continue;
			const rows = await this.fetchM2MChildren(
				[id],
				m2m.junctionTable,
				m2m.targetTable,
				this.lookupProjection(m2m.fieldName, [formula], m2m.targetTable, 'array'),
			);
			scope[m2m.fieldName] = buildLookupScope(rows.get(id) ?? []);
		}
		const tableFields = sf.filter((f) => f.type === 'table' && refs.has(f.name));
		if (tableFields.length > 0) {
			const children = await new ChildTableService(this.db).resolveChildren([id], sf);
			for (const f of tableFields) {
				const rows = children.filter((e) => e.fieldName === f.name).flatMap((e) => e.children);
				scope[f.name] = buildLookupScope(rows);
			}
		}
	}

	// ── Fetchers ────────────────────────────────────────────

	private async fetchM2O(
		items: Record<string, unknown>[],
		fieldName: string,
		targetTable: string,
		/** Narrow the target SELECT to these columns (omit for full rows). */
		columns?: string[] | null,
	): Promise<Map<string, Record<string, unknown>>> {
		const fks = items.map((i) => i[fieldName]).filter((v): v is string => typeof v === 'string' && v.length > 0);
		if (fks.length === 0) return new Map();
		const qb = QueryBuilder.from(targetTable).whereIn('id', fks).whereNull('deleted_at');
		if (columns && columns.length > 0) qb.select(...columns);
		const targets = await this.db.all<Record<string, unknown>>(qb.toSelect());
		const byId = new Map(targets.map((t) => [String(t.id), mergeRowData(t)]));
		const out = new Map<string, Record<string, unknown>>();
		for (const item of items) {
			const fk = item[fieldName];
			if (typeof fk === 'string' && fk.length > 0) {
				const row = byId.get(fk);
				if (row) out.set(String(item.id ?? ''), row);
			}
		}
		return out;
	}

	private async fetchArrayChildren(
		parentIds: string[],
		targetTable: string,
		foreignKey: string,
		/** Narrow the child SELECT to these columns (omit for full rows). */
		columns?: string[] | null,
	): Promise<Map<string, Record<string, unknown>[]>> {
		if (parentIds.length === 0) return new Map();
		// Soft-deleted children never count toward a computed value (matches
		// child-table resolution and SQL aggregate semantics).
		const qb = QueryBuilder.from(targetTable).whereIn(foreignKey, parentIds).whereNull('deleted_at');
		if (columns && columns.length > 0) qb.select(...columns);
		const related = await this.db.all<Record<string, unknown>>(qb.toSelect());
		const grouped = new Map<string, Record<string, unknown>[]>();
		for (const rel of related) {
			const fk = String(rel[foreignKey] ?? '');
			if (!fk) continue;
			const arr = grouped.get(fk) ?? [];
			arr.push(mergeRowData(rel));
			grouped.set(fk, arr);
		}
		return grouped;
	}

	private async fetchM2MChildren(
		parentIds: string[],
		junctionTable: string,
		targetTable: string,
		/** Narrow the target SELECT to these columns (omit for full rows). */
		columns?: string[] | null,
	): Promise<Map<string, Record<string, unknown>[]>> {
		if (parentIds.length === 0) return new Map();
		const junctions = await this.db.all<{ source_id: string; target_id: string }>(
			QueryBuilder.from(junctionTable)
				.select('source_id', 'target_id')
				.whereIn('source_id', parentIds)
				.orderBy('created_at', 'asc')
				.orderBy('target_id', 'asc')
				.toSelect(),
		);
		const targetIds = new Set<string>();
		const bySource = new Map<string, string[]>();
		for (const j of junctions) {
			if (!j.source_id || !j.target_id) continue;
			if (!bySource.has(j.source_id)) bySource.set(j.source_id, []);
			bySource.get(j.source_id)!.push(j.target_id);
			targetIds.add(j.target_id);
		}
		const targets = new Map<string, Record<string, unknown>>();
		if (targetIds.size > 0) {
			const qb = QueryBuilder.from(targetTable)
				.whereIn('id', [...targetIds])
				.whereNull('deleted_at');
			if (columns && columns.length > 0) qb.select(...columns);
			const rows = await this.db.all<Record<string, unknown>>(qb.toSelect());
			for (const t of rows) targets.set(String(t.id), mergeRowData(t));
		}
		const out = new Map<string, Record<string, unknown>[]>();
		for (const [sourceId, ids] of bySource) {
			out.set(
				sourceId,
				ids.map((targetId) => targets.get(targetId)).filter((x): x is Record<string, unknown> => x !== undefined),
			);
		}
		return out;
	}
}
