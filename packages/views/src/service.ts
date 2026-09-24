/**
 * ViewService — declarative materialized views (CQRS read models, D1).
 *
 *   views.create({ name: 'order_totals', source: 'orders', columns: ['store_id', 'total'], groupBy: 'store_id' })
 *   views.refresh('order_totals')   → replaces `_view_order_totals` (DROP + CREATE AS SELECT)
 *   views.schedule?                 → register a `view.refresh` handler (see the plugin)
 *
 * Targets are always `_view_<name>` — identifiers are allow-listed, so payloads
 * can never inject SQL. Refresh is atomic-ish: DROP + CREATE run in one batch.
 */

import { D1Client } from '@mmbix/core';

export interface ViewWhere {
	field: string;
	op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
	value: string | number;
}

export interface ViewDefinition {
	name: string;
	/** Source table (or collection slug — resolved via `_entity_schemas`). */
	source: string;
	/** Columns to project. */
	columns: string[];
	where?: ViewWhere[];
	groupBy?: string;
}

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;
const WHERE_OPS: Record<ViewWhere['op'], string> = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' };

const VIEWS_TABLE = `CREATE TABLE IF NOT EXISTS _views (name TEXT PRIMARY KEY, source TEXT NOT NULL, columns_json TEXT NOT NULL, where_json TEXT, group_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;

export class ViewService {
	constructor(private readonly db: D1Client) {}

	async create(def: ViewDefinition): Promise<{ name: string }> {
		const name = assertIdentifier(def.name, 'view name');
		if (!def.columns?.length) throw new Error('views: columns are required');
		def.columns.forEach((c) => assertIdentifier(c, 'view column'));
		await this.ensure();
		const now = new Date().toISOString();
		await this.db.run({
			sql: `INSERT INTO _views (name, source, columns_json, where_json, group_by, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(name) DO UPDATE SET
					source = excluded.source, columns_json = excluded.columns_json,
					where_json = excluded.where_json, group_by = excluded.group_by, updated_at = excluded.updated_at`,
			bindings: [
				name,
				def.source.trim(),
				JSON.stringify(def.columns),
				def.where?.length ? JSON.stringify(def.where) : null,
				def.groupBy?.trim() ?? null,
				now,
				now,
			],
		});
		return { name };
	}

	async get(name: string): Promise<ViewDefinition | null> {
		await this.ensure();
		const row = await this.db.first<{ source: string; columns_json: string; where_json: string | null; group_by: string | null }>({
			sql: `SELECT source, columns_json, where_json, group_by FROM _views WHERE name = ?`,
			bindings: [name.trim()],
		});
		if (!row) return null;
		return {
			name: name.trim(),
			source: row.source,
			columns: JSON.parse(row.columns_json) as string[],
			where: row.where_json ? (JSON.parse(row.where_json) as ViewWhere[]) : undefined,
			groupBy: row.group_by ?? undefined,
		};
	}

	async list(): Promise<Array<Record<string, unknown>>> {
		await this.ensure();
		return this.db.all<Record<string, unknown>>({
			sql: `SELECT name, source, group_by, created_at, updated_at FROM _views ORDER BY name`,
			bindings: [],
		});
	}

	async remove(name: string): Promise<boolean> {
		const view = await this.get(name);
		if (!view) return false;
		await this.db.batch([
			{ sql: `DROP TABLE IF EXISTS _view_${assertIdentifier(name, 'view name')}`, bindings: [] },
			{ sql: `DELETE FROM _views WHERE name = ?`, bindings: [name.trim()] },
		]);
		return true;
	}

	/** Rebuild the view table (DROP + CREATE AS SELECT). Returns row count. */
	async refresh(name: string): Promise<{ rows: number; table: string }> {
		const view = await this.get(name);
		if (!view) throw new Error(`views: unknown view "${name}"`);
		const table = `_view_${assertIdentifier(view.name, 'view name')}`;

		let source = view.source.trim();
		if (!IDENTIFIER.test(source)) {
			// Not a table — try a collection slug.
			const schema = await this.db.first<{ table_name: string }>({
				sql: 'SELECT table_name FROM _entity_schemas WHERE slug = ?',
				bindings: [source],
			});
			if (!schema || !IDENTIFIER.test(schema.table_name)) throw new Error(`views: unknown source "${source}"`);
			source = schema.table_name;
		}

		const cols = view.columns.map((c) => assertIdentifier(c, 'view column')).join(', ');
		const clauses: string[] = [];
		const bindings: unknown[] = [];
		for (const w of view.where ?? []) {
			const field = assertIdentifier(w.field, 'view where.field');
			clauses.push(`${field} ${WHERE_OPS[w.op]} ?`);
			bindings.push(w.value);
		}
		const whereSql = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
		const groupSql = view.groupBy ? ` GROUP BY ${assertIdentifier(view.groupBy, 'view groupBy')}` : '';

		await this.db.batch([
			{ sql: `DROP TABLE IF EXISTS ${table}`, bindings: [] },
			{ sql: `CREATE TABLE ${table} AS SELECT ${cols} FROM ${source}${whereSql}${groupSql}`, bindings },
		]);

		const count = await this.db.first<{ n: number }>({ sql: `SELECT COUNT(*) AS n FROM ${table}`, bindings: [] });
		return { rows: Number(count?.n ?? 0), table };
	}

	private async ensure(): Promise<void> {
		const g = globalThis as unknown as Record<string, boolean>;
		if (g.__VIEWS_TABLE__) return;
		await this.db.exec(VIEWS_TABLE);
		g.__VIEWS_TABLE__ = true;
	}
}

function assertIdentifier(value: string, label: string): string {
	const v = String(value ?? '').trim();
	if (!IDENTIFIER.test(v)) throw new Error(`views: ${label} "${v}" is not a safe identifier`);
	return v;
}
