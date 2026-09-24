/**
 * RelationResolver — selection-driven relation resolution for entity reads.
 *
 * Extracted from CollectionService (enterprise decomposition): owns everything
 * that turns a flat page of rows into the Directus-style `?fields=` selection
 * tree (m2o / o2m / m2m / m2a / child-table resolution, wildcard depth,
 * exclusions, SQL column projection, and RBAC row-filtering of resolved
 * relations). Design == runtime: list and detail reads share this path.
 *
 * Performance notes:
 *  - Batched: relations are fetched ONCE per level for ALL rows — never once
 *    per row (kills the classic N+1 pattern).
 *  - Recursion is batched too: related rows across the whole page are resolved
 *    in a single level pass, then pruned per row.
 *  - Memoized: derived maps (table → fields) are cached in a WeakMap keyed on
 *    the array identity returned by getCollections(), so they auto-invalidate
 *    the moment the schema cache is invalidated (new array identity).
 */
import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import {
	resolveM2O,
	getM2ORelations,
	resolveO2M,
	getO2MRelations,
	resolveM2M,
	getM2MRelations,
	evaluateExpression,
	applyFormulaPrecision,
	extractFieldRefs,
	resolveFormulaDependencies,
	buildSystemColumnsList,
	physicalColumnNames,
	decodeJsonFields,
} from '@mmbix/core';
import type { EntitySchema, FieldDefinition, SystemFieldOptions } from '@mmbix/types';
import { DEFAULT_SYSTEM_FIELDS } from '@mmbix/types';
import type { FieldSelection } from '@/lib/api/query-parser';
import { M2AService } from '@/plugins/m2a/service';
import { ChildTableService } from '@/plugins/child-tables/service';
import { DataFilterService } from '@/lib/services/data-filter.service';
import { ComputedFieldService } from '@/lib/services/computed-field.service';
import type { AuthContext } from '@/lib/services/auth.service';
import { SYSTEM_FIELD_NAMES } from '@/lib/services/collection.shared';

/** Field types whose wire value comes from ANOTHER collection (or a virtual
 *  formula) — exactly what `resolveRelations` exists to produce. */
const RELATION_FIELD_TYPES = new Set(['m2o', 'o2m', 'm2m', 'm2a', 'table', 'formula']);

/**
 * Does this projection ask for anything the resolver would produce? Decided from
 * the collection's OWN field list, so a purely scalar projection can skip the
 * resolver — AND the all-collections schema read it opens with. Mirrors the
 * `childOf()` / formula predicates inside `resolveLevel` so the skip is exact:
 *   - a relation field named in `columns`, listed under `relations`, or pulled in
 *     by wildcard depth (`*.*`);
 *   - a VIRTUAL formula selected by `*` or by name (a `store: true` formula is a
 *     real column and needs no resolution).
 */
function selectionNeedsRelations(sf: FieldDefinition[], node: FieldSelection): boolean {
	for (const f of sf) {
		if (f.type === 'formula') {
			if (f.store !== true && f.formula && (node.all || node.columns.has(f.name))) return true;
			continue;
		}
		if (!RELATION_FIELD_TYPES.has(f.type)) continue;
		if (node.relations.has(f.name) || node.expandDepth >= 1 || node.columns.has(f.name)) return true;
	}
	return false;
}

export class RelationResolver {
	private db: D1Client;
	private getCollections: () => Promise<EntitySchema[]>;
	private getAuth: () => AuthContext | null;

	/** Per-schema-array memo — auto-invalidates with the schema cache (array identity). */
	private tableFieldsCache = new WeakMap<EntitySchema[], Map<string, FieldDefinition[]>>();
	/** Per-schema-array memo of each table's SystemFieldOptions (same identity rule). */
	private systemOptionsCache = new WeakMap<EntitySchema[], Map<string, SystemFieldOptions>>();

	constructor(db: D1Client, getCollections: () => Promise<EntitySchema[]>, getAuth: () => AuthContext | null) {
		this.db = db;
		this.getCollections = getCollections;
		this.getAuth = getAuth;
	}

	/**
	 * Resolve relations for a page of rows (list + detail share this path).
	 * `selection === null` → lean default: columns only, no relation expansion.
	 * `traceFormulas` (debug: `?formula_trace=true`) attaches `_formula_trace` to
	 * each row — per computed field: ok / value / error. (`?explain=true` is the
	 * SQL plan debugger and returns before resolution.)
	 */
	async resolveRelations(
		items: Record<string, unknown>[],
		sf: FieldDefinition[],
		tableName: string,
		o2mLimit = 50,
		selection: FieldSelection | null = null,
		traceFormulas = false,
	): Promise<Record<string, unknown>[]> {
		// No explicit selection → lean default: no relations, no formulas.
		if (selection === null) return items;
		// Nothing relational was selected → nothing to resolve. Deciding this from
		// THIS collection's own field list (no schema read) matters: the resolver
		// used to call `getCollections()` FIRST, so every scalar-only `?fields=`
		// read — the shaped reads the miniature app issues everywhere — paid one
		// large read of EVERY collection's schema_json on a cold isolate for nothing.
		if (!selectionNeedsRelations(sf, selection)) return items;

		const allC = await this.getCollections();

		// Selection-driven resolution: dot paths, wildcards (*, *.*), exclusions (-x).
		const tableFields = this.buildTableFieldsMap(allC);
		const slugToTable = new Map(allC.map((c) => [c.slug, c.table_name]));
		await this.resolveLevel(items, sf, tableName, selection, o2mLimit, allC, tableFields, slugToTable, traceFormulas);

		// Row-level RBAC on resolved relations (same semantics as any resolution).
		await this.filterResolvedRelations(
			items,
			getM2ORelations(sf, allC),
			getO2MRelations(sf, allC),
			getM2MRelations(sf, allC, tableName),
			allC,
		);
		return items;
	}

	/**
	 * Directus-style SQL column projection shared by LIST and DETAIL reads — one
	 * source of truth for what a `?fields=` selection means at the SQL level.
	 *
	 *   selection.all            → every column minus exclusions ('*', '*, -x')
	 *   selection named columns  → those columns + the physical FK columns of any
	 *                              relation the selection expands (m2o → the FK
	 *                              column itself; m2a → {name}_type/{name}_id)
	 *   selection === null       → lean default: all columns, no relation expansion
	 */
	projectColumns(sf: FieldDefinition[], systemFieldOptions: SystemFieldOptions, selection: FieldSelection | null): string[] {
		const sysCols = buildSystemColumnsList(systemFieldOptions);
		// Virtual fields (o2m/m2m/table/formula) have no physical column; m2a expands to
		// {name}_type/{name}_id. Selecting by field name would raise "no such column" errors.
		const selectableFields = physicalColumnNames(sf);
		const allFields = [
			'id',
			...selectableFields,
			...new Set([...sysCols.filter((c) => c !== 'id' && c !== '_meta'), '_meta', 'deleted_at']),
		];
		const selectableSet = new Set(selectableFields);
		if (selection && selection.all) {
			return allFields.filter((f) => !selection.excludes.has(f));
		}
		if (selection) {
			const kept = [...selection.columns].filter((f) => selectableSet.has(f) && !selection.excludes.has(f));
			// Explicitly-named SYSTEM columns (created_by, updated_by, _owner,
			// deleted_by, doc_status, …) are legitimate projections too — the named
			// path used to drop them silently. They are real columns the default
			// lean payload hides, so naming them is the way back in. The always-
			// included columns are skipped here (they are appended below).
			const sysColSet = new Set(sysCols);
			for (const name of selection.columns) {
				if (selection.excludes.has(name)) continue;
				if (sysColSet.has(name) && !['id', '_meta', 'created_at', 'updated_at'].includes(name) && !kept.includes(name)) {
					kept.push(name);
				}
			}
			// Physical FK columns needed to resolve the requested relations:
			//  - explicit paths (selection.relations)
			//  - wildcard depth (*.* / *.*.*) — every relation on the schema
			//  - bare relation names in columns (fields=category → expand all columns)
			const REL_TYPES = new Set(['m2o', 'o2m', 'm2m', 'm2a', 'table', 'formula']);
			const relByName = new Map(sf.filter((f) => REL_TYPES.has(f.type)).map((f) => [f.name, f]));
			const wantedRels = new Set<string>();
			for (const name of selection.relations.keys()) wantedRels.add(name);
			if (selection.expandDepth > 0) {
				for (const f of sf) if (REL_TYPES.has(f.type)) wantedRels.add(f.name);
			}
			for (const c of selection.columns) {
				if (relByName.has(c)) wantedRels.add(c);
			}
			for (const name of wantedRels) {
				if (selection.excludes.has(name)) continue;
				const f = relByName.get(name);
				if (!f) continue;
				if (f.type === 'm2o' && !kept.includes(name)) kept.push(name);
				else if (f.type === 'm2a') {
					if (!kept.includes(`${name}_type`)) kept.push(`${name}_type`, `${name}_id`);
				}
			}
			// Virtual formula dependencies — a selected formula needs its source
			// columns (and transitively its virtual-formula deps' sources) in the
			// SELECT, or it evaluates against missing fields (the under-fetching
			// trap: `fields=total` must also fetch `qty` + `rate`). Virtual
			// formulas are NOT physical columns, so expand from the REQUESTED
			// names (they were already filtered out of `kept`).
			const virtualFormulaNames = new Set(sf.filter((f) => f.type === 'formula' && f.store !== true).map((f) => f.name));
			const requestedFormulas = [...selection.columns].filter((n) => virtualFormulaNames.has(n));
			if (requestedFormulas.length > 0) {
				for (const fd of resolveFormulaDependencies(sf, requestedFormulas)) {
					for (const ref of extractFieldRefs(fd.formula as string, sf)) {
						if (selection.excludes.has(ref)) continue;
						if (selectableSet.has(ref) && !kept.includes(ref)) kept.push(ref);
					}
				}
			}
			return [...new Set(['id', ...kept, '_meta', 'created_at', 'updated_at'])];
		}
		return allFields;
	}

	/** Parse every collection's schema_json once into a table_name → fields map (recursion). */
	private buildTableFieldsMap(allC: EntitySchema[]): Map<string, FieldDefinition[]> {
		const hit = this.tableFieldsCache.get(allC);
		if (hit) return hit;
		const map = new Map<string, FieldDefinition[]>();
		for (const c of allC) {
			try {
				const p = JSON.parse(c.schema_json);
				if (p.fields && Array.isArray(p.fields)) {
					map.set(
						c.table_name,
						(p.fields as FieldDefinition[]).filter((f) => f.name && !SYSTEM_FIELD_NAMES.has(f.name)),
					);
				}
			} catch {
				/* skip malformed schemas */
			}
		}
		this.tableFieldsCache.set(allC, map);
		return map;
	}

	/** Each table's configured system columns (parse of system_field_options, defaults on failure). */
	private systemOptionsByTable(allC: EntitySchema[]): Map<string, SystemFieldOptions> {
		const hit = this.systemOptionsCache.get(allC);
		if (hit) return hit;
		const map = new Map<string, SystemFieldOptions>();
		for (const c of allC) {
			let opts: SystemFieldOptions = DEFAULT_SYSTEM_FIELDS;
			if (c.system_field_options) {
				try {
					opts = { ...DEFAULT_SYSTEM_FIELDS, ...(JSON.parse(c.system_field_options) as SystemFieldOptions) };
				} catch {
					/* malformed options — keep the defaults */
				}
			}
			map.set(c.table_name, opts);
		}
		this.systemOptionsCache.set(allC, map);
		return map;
	}

	/**
	 * SQL projection for the batched m2o/m2m target fetches — one column list
	 * per target table, derived from the caller's child selection node through
	 * the SAME projectColumns logic the root read uses (named columns, relation
	 * FKs the recursion needs, virtual-formula source columns, named system
	 * columns). Returning null (or leaving a table out of the map) keeps
	 * select('*') — full rows — which is what any `all` child node wants
	 * (`fields=department`, `fields=department.*`, wildcard depth) or when the
	 * target schema is unknown. The JS-side output is byte-identical (pruneRow
	 * still shapes every row afterwards); only the SQL transfer narrows.
	 */
	private childTargetProjection(
		targets: { table: string; node: FieldSelection }[],
		tableFields: Map<string, FieldDefinition[]>,
		allC: EntitySchema[],
	): Map<string, string[]> | null {
		if (targets.length === 0) return null;
		const sysByTable = this.systemOptionsByTable(allC);
		// null = full row ('*'): one field wanting everything forces the shared
		// per-table query to stay '*' (fields on one table share one fetch).
		const perTable = new Map<string, Set<string> | null>();
		for (const { table, node } of targets) {
			if (perTable.get(table) === null) continue;
			if (node.all) {
				perTable.set(table, null);
				continue;
			}
			const sf = tableFields.get(table);
			if (!sf) {
				perTable.set(table, null);
				continue;
			}
			const cols = this.projectColumns(sf, sysByTable.get(table) ?? DEFAULT_SYSTEM_FIELDS, node);
			let set = perTable.get(table);
			if (!set) {
				set = new Set<string>();
				perTable.set(table, set);
			}
			for (const col of cols) set.add(col);
		}
		const out = new Map<string, string[]>();
		for (const [table, set] of perTable) {
			if (set) out.set(table, [...set]);
		}
		return out.size > 0 ? out : null;
	}

	/**
	 * Selection-driven relation resolution for one level of rows.
	 * Recurses into related rows when the selection node asks for deeper paths
	 * (explicit relations or wildcard depth), then prunes columns per node.
	 */
	private async resolveLevel(
		items: Record<string, unknown>[],
		sf: FieldDefinition[],
		tableName: string,
		node: FieldSelection,
		o2mLimit: number,
		allC: EntitySchema[],
		tableFields: Map<string, FieldDefinition[]>,
		slugToTable: Map<string, string>,
		traceFormulas = false,
	): Promise<void> {
		if (items.length === 0) return;

		const m2o = getM2ORelations(sf, allC);
		const o2m = getO2MRelations(sf, allC);
		const m2m = getM2MRelations(sf, allC, tableName);
		const m2aFields = new M2AService(this.db).getFields(sf);
		const childTableFields = sf.filter((f) => f.type === 'table' && f.related_collection);
		// VIRTUAL formulas only — stored formulas are real columns already in the
		// SELECT (their values were recomputed at write time).
		const formulaFields = sf.filter((f) => f.type === 'formula' && f.formula && f.store !== true);

		// Child selection for a relation field — explicit path wins, else wildcard depth,
		// else a BARE relation name listed in columns (e.g. `fields=category`) which
		// expands with all its columns (legacy-friendly).
		const childOf = (name: string): FieldSelection | null => {
			const explicit = node.relations.get(name);
			if (explicit) return explicit;
			if (node.expandDepth >= 1) {
				return { all: true, columns: new Set(), excludes: new Set(), relations: new Map(), expandDepth: node.expandDepth - 1 };
			}
			if (node.columns.has(name)) {
				return { all: true, columns: new Set(), excludes: new Set(), relations: new Map(), expandDepth: 0 };
			}
			return null;
		};

		// Formulas — computed when '*' or explicitly named at this level (plus any
		// VIRTUAL formulas they depend on, in topological order — so a chained
		// `grand_total = total * 1.1` computes after `total`).
		const requestedFormulas = formulaFields.filter((f) => node.all || node.columns.has(f.name)).map((f) => f.name);
		const formulaSel = resolveFormulaDependencies(formulaFields, requestedFormulas);
		if (formulaSel.length > 0) {
			// Lookups: batch-fetch every referenced relation ONCE for the whole page
			// (o2m/m2m/table children + m2o targets) — never one query per row.
			const lookupScopes = await new ComputedFieldService(this.db, allC).fetchLookupScopes(items, sf, formulaSel, tableName);
			for (const item of items) {
				const scope: Record<string, unknown> = { ...item };
				const perRow = lookupScopes.get(String(item.id ?? ''));
				if (perRow) Object.assign(scope, perRow);
				const trace = traceFormulas ? ([] as { field: string; ok: boolean; value?: unknown; error?: string }[]) : null;
				for (const ff of formulaSel) {
					try {
						// Later formulas can reference earlier computed ones (same order
						// semantics as the original evaluator loop). Precision/rounding
						// apply to virtual results exactly like stored ones.
						const v = applyFormulaPrecision(evaluateExpression(ff.formula as string, scope), ff);
						scope[ff.name] = v;
						item[ff.name] = v;
						trace?.push({ field: ff.name, ok: true, value: v });
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						scope[ff.name] = null;
						item[ff.name] = null;
						trace?.push({ field: ff.name, ok: false, error: message });
					}
				}
				if (trace) (item as Record<string, unknown>)._formula_trace = trace;
			}
		}

		// M2O — batched fetch, then recurse + prune per field.
		const m2oSel = m2o.filter((f) => childOf(f.fieldName) !== null);
		if (m2oSel.length > 0) {
			// Projection pushdown: fetch only the columns the child selections need.
			await resolveM2O(
				items,
				m2oSel,
				this.db,
				this.childTargetProjection(
					m2oSel.map((f) => ({ table: f.targetTable, node: childOf(f.fieldName)! })),
					tableFields,
					allC,
				),
			);
			// The per-FIELD recursions are independent (each writes only its own
			// `fieldName` of each row) — run them concurrently instead of one round
			// trip after another. A `?fields=*.*` detail with 5 relations used to pay
			// 5 SERIAL round trips here; it now pays ~1.
			await Promise.all(
				m2oSel.map((f) =>
					this.recurseAndPruneSingle(items, f.fieldName, f.targetTable, childOf(f.fieldName)!, o2mLimit, allC, tableFields, slugToTable),
				),
			);
		}

		// O2M + M2M — arrays. The two families write DISJOINT field names, so their
		// whole resolver+recursion pipelines run concurrently.
		const o2mSel = o2m.filter((f) => childOf(f.fieldName) !== null);
		const m2mSel = m2m.filter((f) => childOf(f.fieldName) !== null);
		await Promise.all([
			(async () => {
				if (o2mSel.length === 0) return;
				await resolveO2M(items, o2mSel, this.db, o2mLimit);
				await Promise.all(
					o2mSel.map((f) =>
						this.recurseAndPruneArray(items, f.fieldName, f.targetTable, childOf(f.fieldName)!, o2mLimit, allC, tableFields, slugToTable),
					),
				);
			})(),
			(async () => {
				if (m2mSel.length === 0) return;
				// Projection pushdown + per-parent cap (same limit as the o2m path —
				// a page of rows never materializes every m2m child of every parent).
				await resolveM2M(
					items,
					m2mSel,
					this.db,
					this.childTargetProjection(
						m2mSel.map((f) => ({ table: f.targetTable, node: childOf(f.fieldName)! })),
						tableFields,
						allC,
					),
					o2mLimit,
				);
				await Promise.all(
					m2mSel.map((f) =>
						this.recurseAndPruneArray(items, f.fieldName, f.targetTable, childOf(f.fieldName)!, o2mLimit, allC, tableFields, slugToTable),
					),
				);
			})(),
		]);

		// M2A — polymorphic rows: prune columns only (no deeper recursion; rows may
		// span different collections). RBAC applies PER referenced collection — the
		// resolved row's `_type` selects its own row filter + field restrictions
		// (a level-1 relation must not bypass the target collection's rules).
		const m2aSel = m2aFields.filter((f) => childOf(f.fieldName) !== null);
		if (m2aSel.length > 0) {
			await new M2AService(this.db).resolve(items, m2aSel);
			for (const f of m2aSel) {
				const child = childOf(f.fieldName)!;
				// Group resolved rows by target collection (slug) — each collection has
				// its own row filter and field restrictions.
				const byType = new Map<string, Record<string, unknown>[]>();
				for (const item of items) {
					const val = item[f.fieldName];
					if (val && typeof val === 'object') {
						const type = String((val as { _type?: unknown })._type ?? '');
						if (!type) continue;
						if (!byType.has(type)) byType.set(type, []);
						byType.get(type)!.push(val as Record<string, unknown>);
					}
				}
				const allowedByType = new Map<string, Set<string>>();
				for (const [type, rows] of byType) {
					const coll = allC.find((c) => c.slug === type);
					const table = coll?.table_name ?? slugToTable.get(type);
					if (!coll || !table) continue;
					// Decode json-typed fields in the resolved polymorphic rows (they were
					// fetched raw from the target table — see decodeJsonFields).
					const relatedFields = tableFields.get(table);
					if (relatedFields) decodeJsonFields(rows, relatedFields);
					const allowed = await this.filterLevelRbac(rows, table, allC, tableFields);
					if (allowed) allowedByType.set(type, allowed);
				}
				for (const item of items) {
					const val = item[f.fieldName];
					if (val && typeof val === 'object') {
						const type = String((val as { _type?: unknown })._type ?? '');
						const allowed = allowedByType.get(type);
						if (allowed && !allowed.has(String((val as { id?: unknown }).id ?? ''))) {
							item[f.fieldName] = null;
							continue;
						}
						this.pruneRow(val as Record<string, unknown>, child);
					}
				}
			}
		}

		// Child tables — arrays of child rows (per-parent cap mirrors the o2m path).
		const childSel = childTableFields.filter((f) => childOf(f.name) !== null);
		if (childSel.length > 0) {
			const childService = new ChildTableService(this.db);
			const children = await childService.resolveChildren(
				items.map((i) => String(i.id)),
				sf,
				o2mLimit,
			);
			const childIndex = new Map<string, Record<string, unknown>[]>();
			for (const entry of children as { parentId: string; fieldName: string; children: Record<string, unknown>[] }[]) {
				childIndex.set(`${entry.parentId}:${entry.fieldName}`, entry.children);
			}
			for (const f of childSel) {
				const child = childOf(f.name)!;
				const childTable = f.related_collection ? slugToTable.get(f.related_collection) : undefined;
				const hasRows = items.some((item) => (childIndex.get(`${String(item.id)}:${f.name}`) ?? []).length > 0);
				for (const item of items) {
					item[f.name] = childIndex.get(`${String(item.id)}:${f.name}`) ?? [];
				}
				if (hasRows && childTable) {
					await this.recurseAndPruneArray(items, f.name, childTable, child, o2mLimit, allC, tableFields, slugToTable);
				}
			}
		}
	}

	/** Recurse + prune a single-valued relation field (m2o). */
	private async recurseAndPruneSingle(
		items: Record<string, unknown>[],
		fieldName: string,
		targetTable: string,
		child: FieldSelection,
		o2mLimit: number,
		allC: EntitySchema[],
		tableFields: Map<string, FieldDefinition[]>,
		slugToTable: Map<string, string>,
	): Promise<void> {
		const relatedFields = tableFields.get(targetTable);
		// Batch: collect every resolved row across the whole page, recurse ONCE.
		// (The old per-item recursion re-resolved the same relations in tiny
		// 1-row batches — one extra query round-trip per row.)
		const rows: Record<string, unknown>[] = [];
		for (const item of items) {
			const val = item[fieldName];
			if (val && typeof val === 'object') rows.push(val as Record<string, unknown>);
		}
		if (rows.length > 0) {
			// Decode json-typed fields in the related rows (fetched raw from the
			// target table — without this, nested json fields leak as strings).
			if (relatedFields) decodeJsonFields(rows, relatedFields);
			// RBAC at THIS level: the related collection's row filter + field
			// restrictions apply to these rows before they're expanded/pruned
			// (top-level filtering only covers the root rows' own fields).
			const allowed = await this.filterLevelRbac(rows, targetTable, allC, tableFields);
			if (allowed) {
				for (const item of items) {
					const val = item[fieldName];
					if (val && typeof val === 'object' && !allowed.has(String((val as { id?: unknown }).id ?? ''))) {
						item[fieldName] = null;
					}
				}
			}
			if ((child.relations.size > 0 || child.expandDepth > 0) && relatedFields && rows.length > 0) {
				await this.resolveLevel(rows, relatedFields, targetTable, child, o2mLimit, allC, tableFields, slugToTable);
			}
		}
		for (const item of items) {
			const val = item[fieldName];
			if (!val || typeof val !== 'object') continue;
			this.pruneRow(val as Record<string, unknown>, child);
		}
	}

	/** Recurse + prune an array-valued relation field (o2m/m2m/child-table). */
	private async recurseAndPruneArray(
		items: Record<string, unknown>[],
		fieldName: string,
		targetTable: string,
		child: FieldSelection,
		o2mLimit: number,
		allC: EntitySchema[],
		tableFields: Map<string, FieldDefinition[]>,
		slugToTable: Map<string, string>,
	): Promise<void> {
		const relatedFields = tableFields.get(targetTable);
		// Batch: collect every related row across all items, recurse ONCE.
		const allRows: Record<string, unknown>[] = [];
		for (const item of items) {
			const rows = item[fieldName];
			if (Array.isArray(rows) && rows.length > 0) allRows.push(...(rows as Record<string, unknown>[]));
		}
		if (allRows.length > 0) {
			// Decode json-typed fields in the related rows (fetched raw from the
			// target table — without this, nested json fields leak as strings).
			if (relatedFields) decodeJsonFields(allRows, relatedFields);
			// RBAC at THIS level — see recurseAndPruneSingle.
			const allowed = await this.filterLevelRbac(allRows, targetTable, allC, tableFields);
			if (allowed) {
				for (const item of items) {
					const rows = item[fieldName];
					if (!Array.isArray(rows) || rows.length === 0) continue;
					item[fieldName] = (rows as Record<string, unknown>[]).filter((r) => allowed.has(String(r.id ?? '')));
				}
			}
			if ((child.relations.size > 0 || child.expandDepth > 0) && relatedFields && allRows.length > 0) {
				await this.resolveLevel(allRows, relatedFields, targetTable, child, o2mLimit, allC, tableFields, slugToTable);
			}
		}
		for (const item of items) {
			const rows = item[fieldName];
			if (!Array.isArray(rows) || rows.length === 0) continue;
			for (const row of rows as Record<string, unknown>[]) this.pruneRow(row, child);
		}
	}

	/**
	 * Prune a related row to the columns a selection node requests. `id` is always
	 * kept (stable keys for consumers); deeper resolved sub-relations (from
	 * recursion) are kept via node.relations; excludes are applied last.
	 */
	private pruneRow(row: Record<string, unknown>, node: FieldSelection): void {
		const out: Record<string, unknown> = { id: row.id };
		if (node.all) {
			for (const k of Object.keys(row)) out[k] = row[k];
		} else {
			for (const c of node.columns) {
				if (c in row) out[c] = row[c];
			}
			for (const name of node.relations.keys()) {
				if (name in row) out[name] = row[name];
			}
		}
		for (const ex of node.excludes) delete out[ex];
		// Replace in place — resolvers (and callers) hold references to these rows.
		for (const k of Object.keys(row)) delete row[k];
		Object.assign(row, out);
	}

	/**
	 * RBAC for ONE resolved recursion level (beyond the root rows). The top-level
	 * filter only covers the root collection; every deeper m2o/o2m/m2m/child-table
	 * level fetched by the recursion was previously returned unfiltered. This
	 * applies the TARGET collection's row filter (batched id check — same logic as
	 * filterResolvedRelations) and field restrictions to the fetched rows in place
	 * (preserving object identity: the parent tree holds references to them).
	 *
	 * Returns the set of allowed ids (null when no filtering applies) so callers
	 * can drop disallowed rows from the parent tree (m2o → null, arrays → filtered).
	 */
	private async filterLevelRbac(
		rows: Record<string, unknown>[],
		targetTable: string,
		allC: EntitySchema[],
		tableFields: Map<string, FieldDefinition[]>,
	): Promise<Set<string> | null> {
		const auth = this.getAuth();
		if (!auth || auth.is_admin || rows.length === 0) return null;
		const coll = allC.find((c) => c.table_name === targetTable);
		if (!coll) return null;
		const slug = coll.slug;

		// Row filter: one batched id query against the target collection.
		const ids = rows.map((r) => r.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
		let allowed: Set<string> | null = null;
		if (ids.length > 0) {
			const qb = QueryBuilder.from(targetTable).select('id').whereIn('id', ids);
			await DataFilterService.applyRowFilter(qb, { db: this.db, auth, collectionSlug: slug });
			const allowedRows = await this.db.all<{ id: string }>(qb.toSelect());
			allowed = new Set(allowedRows.map((r) => String(r.id)));
			for (let i = rows.length - 1; i >= 0; i--) {
				if (!allowed.has(String((rows[i] as { id?: unknown }).id ?? ''))) rows.splice(i, 1);
			}
		}

		// Field restrictions: whitelist keys IN PLACE so the parent tree's
		// references to these rows are redacted too (pruneRow mutates the row).
		if (rows.length > 0) {
			const fieldNames = (tableFields.get(targetTable) ?? []).map((f) => f.name);
			const filtered = await DataFilterService.applyFieldFilter(rows, { db: this.db, auth, collectionSlug: slug }, fieldNames);
			// applyFieldFilter returns the SAME array when there are no field
			// restrictions — rewriting rows against themselves would delete every
			// column (src and dst are the same reference, so the copy is a no-op
			// after the delete). Only rewrite when it actually filtered.
			if (filtered !== rows) {
				for (let i = 0; i < rows.length; i++) {
					const src = filtered[i] ?? {};
					const dst = rows[i];
					for (const k of Object.keys(dst)) delete dst[k];
					Object.assign(dst, src);
				}
			}
		}
		return allowed;
	}

	/**
	 * Apply the RELATED collection's row filter to resolved m2o/o2m/m2m records.
	 * Disallowed related records are dropped (m2o → null, o2m/m2m → removed
	 * from the array) so a filtered user can't see others' records through an
	 * allowed parent. One batched id query per related collection.
	 */
	private async filterResolvedRelations(
		items: Record<string, unknown>[],
		m2o: { fieldName: string; targetTable: string }[],
		o2m: { fieldName: string; targetTable: string; foreignKey: string }[],
		m2m: { fieldName: string; targetTable: string; junctionTable: string }[],
		allC: EntitySchema[],
	): Promise<void> {
		const auth = this.getAuth();
		if (!auth || auth.is_admin) return;
		if (m2o.length === 0 && o2m.length === 0 && m2m.length === 0) return;

		const slugByTable = new Map(allC.map((c) => [c.table_name, c.slug]));
		const idsByTable = new Map<string, Set<string>>();
		const collect = (table: string, vals: unknown[]): void => {
			if (!table) return;
			let set = idsByTable.get(table);
			if (!set) {
				set = new Set<string>();
				idsByTable.set(table, set);
			}
			for (const v of vals) {
				if (v && typeof v === 'object') {
					const id = (v as { id?: unknown }).id;
					if (typeof id === 'string' && id.length > 0) set.add(id);
				}
			}
		};

		for (const item of items) {
			for (const f of m2o) collect(f.targetTable, [item[f.fieldName]]);
			for (const f of o2m) if (Array.isArray(item[f.fieldName])) collect(f.targetTable, item[f.fieldName] as unknown[]);
			for (const f of m2m) if (Array.isArray(item[f.fieldName])) collect(f.targetTable, item[f.fieldName] as unknown[]);
		}

		const allowedByTable = new Map<string, Set<string>>();
		for (const [table, ids] of idsByTable) {
			const slug = slugByTable.get(table);
			if (!slug) continue;
			const uniqueIds = [...ids];
			const qb = QueryBuilder.from(table).select('id').whereIn('id', uniqueIds);
			await DataFilterService.applyRowFilter(qb, { db: this.db, auth, collectionSlug: slug });
			const rows = await this.db.all<{ id: string }>(qb.toSelect());
			allowedByTable.set(table, new Set(rows.map((r) => String(r.id))));
		}

		for (const item of items) {
			for (const f of m2o) {
				const v = item[f.fieldName];
				if (v && typeof v === 'object') {
					const allowed = allowedByTable.get(f.targetTable);
					if (!allowed?.has(String((v as { id?: unknown }).id ?? ''))) item[f.fieldName] = null;
				}
			}
			for (const f of o2m) {
				if (Array.isArray(item[f.fieldName])) {
					const allowed = allowedByTable.get(f.targetTable);
					item[f.fieldName] = (item[f.fieldName] as Record<string, unknown>[]).filter((r) => allowed?.has(String(r.id ?? '')));
				}
			}
			for (const f of m2m) {
				if (Array.isArray(item[f.fieldName])) {
					const allowed = allowedByTable.get(f.targetTable);
					item[f.fieldName] = (item[f.fieldName] as Record<string, unknown>[]).filter((r) => allowed?.has(String(r.id ?? '')));
				}
			}
		}
	}
}
