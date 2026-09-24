/**
 * KPI Registry — single source of truth for metrics (SVOT).
 *
 * A KPI is a declarative definition (data, not code): an aggregate over a
 * collection (SUM/AVG/COUNT/MIN/MAX of a field), an optional filter, an
 * optional group-by and an optional time period. The same definition drives
 * both on-demand computation and nightly materialization — every dashboard
 * reads the same numbers, computed the same way (no duplicated ad-hoc logic).
 *
 * Materialized values land in _kpi_values (kpi_id, period_key, group_key,
 * value, computed_at) — pre-computed for BI-ready reads (O(log n) per KPI).
 */

import { D1Client, QueryBuilder } from '@mmbix/core';
import { ValidationError } from '@mmbix/utils';
import { clampPageSize } from '@/lib/api/page-size';

export type KpiAgg = 'sum' | 'avg' | 'count' | 'min' | 'max';
export type KpiPeriod = 'none' | 'day' | 'month' | 'quarter' | 'year';
export type KpiSchedule = 'manual' | 'daily';

/** Simple scalar filter — same op surface as decision-table conditions. */
export interface KpiFilter {
	field: string;
	op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
	value?: unknown;
}

export interface KpiDefinition {
	name: string;
	collection: string;
	description?: string;
	agg: KpiAgg;
	/** Aggregate target (unused for count). */
	field?: string;
	/** Optional filters (AND). */
	filter?: KpiFilter[];
	/** Optional group-by field → one materialized value per group. */
	group_by?: string;
	/** Time rollup over created_at. */
	period?: KpiPeriod;
	schedule?: KpiSchedule;
	enabled?: boolean;
}

export interface KpiRow {
	id: string;
	name: string;
	collection: string;
	definition_json: string;
	enabled: number;
	version: number;
	created_at: string;
	updated_at: string;
	definition: KpiDefinition;
}

export interface KpiValueRow {
	id: string;
	kpi_id: string;
	period_key: string;
	group_key: string;
	value: number;
	computed_at: string;
}

const VALID_AGGS = new Set(['sum', 'avg', 'count', 'min', 'max']);
const VALID_PERIODS = new Set(['none', 'day', 'month', 'quarter', 'year']);
const VALID_SCHEDULES = new Set(['manual', 'daily']);
const VALID_FILTER_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in']);

/** strftime expression for each period rollup (bounds GROUP BY cardinality). */
const PERIOD_SQL: Record<Exclude<KpiPeriod, 'none'>, string> = {
	day: `strftime('%Y-%m-%d', created_at)`,
	month: `strftime('%Y-%m', created_at)`,
	quarter: `printf('%d-Q%d', strftime('%Y', created_at), ((strftime('%m', created_at) - 1) / 3) + 1)`,
	year: `strftime('%Y', created_at)`,
};

export class KpiService {
	constructor(private readonly db: D1Client) {}

	// ─── CRUD ────────────────────────────────────────────

	async list(collection?: string): Promise<KpiRow[]> {
		const rows = await this.db.all<KpiRow>({
			sql: 'SELECT * FROM _kpis' + (collection ? ' WHERE collection = ?' : '') + ' ORDER BY created_at DESC',
			bindings: collection ? [collection] : [],
		});
		return rows.map((r) => this.decorate(r));
	}

	async get(id: string): Promise<KpiRow | null> {
		const row = await this.db.first<KpiRow>({ sql: 'SELECT * FROM _kpis WHERE id = ?', bindings: [id] });
		return row ? this.decorate(row) : null;
	}

	async upsert(definition: KpiDefinition, id?: string): Promise<{ id: string; version: number }> {
		this.validate(definition);
		const now = new Date().toISOString();
		const rowId = id ?? crypto.randomUUID();
		const result = await this.db.first<{ id: string; version: number }>({
			sql: `INSERT INTO _kpis (id, name, collection, definition_json, enabled, version, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, 1, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					name = excluded.name,
					collection = excluded.collection,
					definition_json = excluded.definition_json,
					enabled = excluded.enabled,
					version = _kpis.version + 1,
					updated_at = excluded.updated_at
				RETURNING id, version`,
			bindings: [rowId, definition.name, definition.collection, JSON.stringify(definition), definition.enabled === false ? 0 : 1, now, now],
		});
		return { id: result?.id ?? rowId, version: result?.version ?? 1 };
	}

	async remove(id: string): Promise<void> {
		await this.db.run({ sql: 'DELETE FROM _kpis WHERE id = ?', bindings: [id] });
		await this.db.run({ sql: 'DELETE FROM _kpi_values WHERE kpi_id = ?', bindings: [id] });
	}

	// ─── Materialization ─────────────────────────────────

	/**
	 * Compute a KPI against the live collection and upsert its materialized
	 * values. Runs one aggregate query (group-by pushed to D1 — O(rows) scan
	 * once per KPI, not per dashboard render).
	 */
	private aggregateQuery(tableName: string, def: KpiDefinition, withDeletedFilter: boolean): QueryBuilder {
		const qb = QueryBuilder.from(tableName);
		if (withDeletedFilter) qb.whereNull('deleted_at');
		this.applyFilter(qb, def.filter ?? []);

		const groupCols: string[] = [];
		if (def.period && def.period !== 'none') {
			const expr = PERIOD_SQL[def.period as Exclude<KpiPeriod, 'none'>];
			qb.selectExpr(expr, 'period_key');
			groupCols.push(expr);
		}
		if (def.group_by) {
			qb.selectExpr(def.group_by, 'group_key');
			groupCols.push(def.group_by);
		}

		if (def.agg === 'count') {
			qb.selectExpr('COUNT(*)', 'value');
		} else {
			qb.selectExpr(`${def.agg.toUpperCase()}(${def.field})`, 'value');
		}
		if (groupCols.length > 0) qb.groupBy(...groupCols);
		return qb;
	}

	/**
	 * Compute a KPI against the live collection and upsert its materialized
	 * values. Runs one aggregate query (group-by pushed to D1 — O(rows) scan
	 * once per KPI, not per dashboard render).
	 */
	async compute(kpi: KpiRow): Promise<{ kpi_id: string; rows: number }> {
		const def = kpi.definition;
		const tableName = await this.tableNameOf(def.collection);
		if (!tableName) throw new ValidationError(`Collection "${def.collection}" not found`);

		let rows: Array<{ period_key: string | null; group_key: string | null; value: number }>;
		try {
			rows = await this.db.all(this.aggregateQuery(tableName, def, true).toSelect());
		} catch (err) {
			// Legacy tables without deleted_at — retry without the soft-delete filter.
			const msg = err instanceof Error ? err.message : String(err);
			if (/no such column/i.test(msg)) {
				rows = await this.db.all(this.aggregateQuery(tableName, def, false).toSelect());
			} else {
				throw err;
			}
		}

		const now = new Date().toISOString();
		const nowDate = now.split('T')[0];
		const nowMonth = now.slice(0, 7);
		const nowYear = now.slice(0, 4);
		const nowQuarter = `${nowYear}-Q${Math.floor((Number(now.slice(5, 7)) - 1) / 3) + 1}`;
		const periodKeyOf = (raw: string | null): string => {
			if (raw) return raw;
			switch (def.period) {
				case 'day':
					return nowDate;
				case 'month':
					return nowMonth;
				case 'quarter':
					return nowQuarter;
				case 'year':
					return nowYear;
				default:
					return 'all';
			}
		};

		const stmts = rows.map((r) => {
			const periodKey = periodKeyOf(r.period_key ?? null);
			const groupKey = r.group_key == null ? 'all' : String(r.group_key);
			const value = Number(r.value) || 0;
			return QueryBuilder.raw(
				`INSERT INTO _kpi_values (id, kpi_id, period_key, group_key, value, computed_at) VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(kpi_id, period_key, group_key) DO UPDATE SET value = excluded.value, computed_at = excluded.computed_at`,
				[crypto.randomUUID(), kpi.id, periodKey, groupKey, value, now],
			);
		});
		// Batch all upserts atomically (single round-trip).
		if (stmts.length > 0) await this.db.batch(stmts as never[]);
		return { kpi_id: kpi.id, rows: rows.length };
	}

	/** Materialized values for a KPI — the BI read path (pre-computed). */
	async getData(kpiId: string, opts: { period_from?: string; period_to?: string; limit?: number } = {}): Promise<KpiValueRow[]> {
		const sql = `SELECT * FROM _kpi_values WHERE kpi_id = ?
			${opts.period_from ? ' AND period_key >= ?' : ''}${opts.period_to ? ' AND period_key <= ?' : ''}
			ORDER BY period_key ASC, group_key ASC LIMIT ?`;
		const bindings: unknown[] = [kpiId];
		if (opts.period_from) bindings.push(opts.period_from);
		if (opts.period_to) bindings.push(opts.period_to);
		// Page-size policy (enterprise): default 25, max 100 (defensive clamp here
		// AND in the route — the backend is the single source of truth).
		bindings.push(clampPageSize(opts.limit));
		return this.db.all<KpiValueRow>({ sql, bindings });
	}

	// ─── Internals ───────────────────────────────────────

	private async tableNameOf(collectionSlug: string): Promise<string | null> {
		const row = await this.db.first<{ table_name: string }>({
			sql: `SELECT table_name FROM _entity_schemas WHERE slug = ?`,
			bindings: [collectionSlug],
		});
		return row?.table_name ?? null;
	}

	private applyFilter(qb: QueryBuilder, filters: KpiFilter[]): void {
		for (const f of filters) {
			const field = f.field.startsWith('doc.') ? f.field.slice(4) : f.field;
			switch (f.op) {
				case 'eq':
					qb.where(field, '=', f.value ?? null);
					break;
				case 'neq':
					qb.where(field, '!=', f.value ?? null);
					break;
				case 'gt':
					qb.where(field, '>', f.value);
					break;
				case 'gte':
					qb.where(field, '>=', f.value);
					break;
				case 'lt':
					qb.where(field, '<', f.value);
					break;
				case 'lte':
					qb.where(field, '<=', f.value);
					break;
				case 'in':
					qb.whereIn(field, Array.isArray(f.value) ? f.value : []);
					break;
			}
		}
	}

	validate(def: KpiDefinition): void {
		if (!def.name?.trim()) throw new ValidationError('name is required');
		if (!def.collection?.trim()) throw new ValidationError('collection is required');
		if (!VALID_AGGS.has(def.agg)) throw new ValidationError(`agg must be one of: ${[...VALID_AGGS].join(', ')}`);
		if (def.agg !== 'count' && !def.field?.trim()) throw new ValidationError(`field is required for agg "${def.agg}"`);
		if (def.period !== undefined && def.period !== 'none' && !VALID_PERIODS.has(def.period)) {
			throw new ValidationError(`period must be one of: ${[...VALID_PERIODS].join(', ')}`);
		}
		if (def.schedule !== undefined && !VALID_SCHEDULES.has(def.schedule)) {
			throw new ValidationError(`schedule must be one of: ${[...VALID_SCHEDULES].join(', ')}`);
		}
		if (def.group_by && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(def.group_by)) {
			throw new ValidationError(`group_by must be a plain column name, got "${def.group_by}"`);
		}
		for (const f of def.filter ?? []) {
			if (!f.field?.trim()) throw new ValidationError('filter conditions need a field');
			if (!VALID_FILTER_OPS.has(f.op)) throw new ValidationError(`filter op "${f.op}" is invalid (${[...VALID_FILTER_OPS].join(', ')})`);
		}
	}

	private decorate(row: KpiRow): KpiRow {
		let definition: KpiDefinition;
		try {
			definition = JSON.parse(row.definition_json) as KpiDefinition;
		} catch {
			definition = { name: row.name, collection: row.collection, agg: 'count' };
		}
		return { ...row, definition };
	}
}
