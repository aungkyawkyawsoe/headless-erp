/**
 * Reports / Dashboard Service
 *
 * Provides analytics endpoints for collection data.
 * Aggregations, trends, summaries — like a lightweight BI tool.
 */

import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { sanitizeIdentifier } from '@mmbix/utils';
import { collectionTable } from '@/lib/utils/table-name';
import { findCollectionRow } from '@/lib/services/schema-lookup';
import type { EntitySchema } from '@mmbix/types';

export interface ReportQuery {
	collection: string;
	group_by?: string;
	aggregate?: string; // "count", "sum", "avg", "min", "max"
	aggregate_field?: string;
	filter?: Record<string, unknown>;
	timeframe?: { from?: string; to?: string };
}

export interface ReportResult {
	labels: string[];
	values: number[];
	total: number;
	collection: string;
}

export class ReportService {
	constructor(private db: D1Client) {}

	/** Look up the actual table_name for a collection slug (cached schema row). */
	private async _getTableName(slug: string): Promise<string> {
		const row = await findCollectionRow(this.db, slug);
		return row?.table_name || collectionTable(slug);
	}

	/**
	 * Generate a report for a collection.
	 */
	async generateReport(query: ReportQuery): Promise<ReportResult> {
		const tableName = await this._getTableName(query.collection);
		const table = sanitizeIdentifier(tableName, 'ReportService.table');

		// Whitelist aggregate SQL functions — never interpolate raw request
		// strings. Accepts both lowercase names and SQL-style uppercase forms
		// (incl. the legacy 'COUNT(DISTINCT' form).
		const AGG_SQL: Record<string, string> = {
			COUNT: 'COUNT',
			SUM: 'SUM',
			AVG: 'AVG',
			MIN: 'MIN',
			MAX: 'MAX',
			'COUNT(DISTINCT': 'COUNT(DISTINCT',
			GROUP_CONCAT: 'GROUP_CONCAT',
		};
		const rawAgg = (query.aggregate || 'count').toUpperCase();
		const aggSql = AGG_SQL[rawAgg];
		if (!aggSql) {
			throw new Error(`Invalid aggregate function: ${query.aggregate}`);
		}
		const aggField = query.aggregate_field ? sanitizeIdentifier(query.aggregate_field, 'report.field') : '*';
		// The legacy 'COUNT(DISTINCT' form needs the DISTINCT expression spelled out
		// (COUNT(DISTINCT field) — NOT COUNT(DISTINCT(field), which is a syntax error).
		const aggExpr = aggSql === 'COUNT(DISTINCT' ? `COUNT(DISTINCT ${aggField})` : `${aggSql}(${aggField})`;

		// Base filters: exclude soft-deleted
		const whereClauses = [`${table}.deleted_at IS NULL`];
		const bindings: unknown[] = [];

		if (query.filter) {
			for (const [key, val] of Object.entries(query.filter)) {
				const safeKey = sanitizeIdentifier(key, 'report.filter');
				whereClauses.push(`${table}.${safeKey} = ?`);
				bindings.push(val);
			}
		}
		if (query.timeframe?.from) {
			whereClauses.push(`${table}.created_at >= ?`);
			bindings.push(query.timeframe.from);
		}
		if (query.timeframe?.to) {
			whereClauses.push(`${table}.created_at <= ?`);
			bindings.push(query.timeframe.to);
		}

		const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

		if (query.group_by) {
			const groupBy = sanitizeIdentifier(query.group_by, 'report.group_by');
			const sql = `SELECT ${groupBy} as label, ${aggExpr} as value FROM ${table} ${where} GROUP BY ${groupBy} ORDER BY value DESC LIMIT 20`;
			const rows = await this.db.all<{ label: string; value: number }>(QueryBuilder.raw(sql, bindings));
			return {
				labels: rows.map((r) => r.label),
				values: rows.map((r) => Number(r.value)),
				total: rows.reduce((s, r) => s + Number(r.value), 0),
				collection: query.collection,
			};
		}

		const sql = `SELECT ${aggExpr} as total FROM ${table} ${where}`;
		const result = await this.db.first<{ total: number }>(QueryBuilder.raw(sql, bindings));

		return {
			labels: [query.collection],
			values: [result?.total || 0],
			total: result?.total || 0,
			collection: query.collection,
		};
	}

	/**
	 * Dashboard summary — counts for all collections.
	 */
	async dashboard(): Promise<Record<string, number>> {
		const collections = await this.db.all<EntitySchema>(QueryBuilder.from('_entity_schemas').select('slug', 'table_name').toSelect());

		const summary: Record<string, number> = { total_collections: collections.length };

		// Parallel COUNT per collection — O(1) round-trips instead of O(n) sequential
		await Promise.all(
			collections.map(async (c) => {
				try {
					const table = sanitizeIdentifier(c.table_name || collectionTable(c.slug), 'report.dashboard.table');
					const r = await this.db.first<{ total: number }>(
						QueryBuilder.raw(`SELECT COUNT(*) as total FROM ${table} WHERE deleted_at IS NULL`),
					);
					summary[c.slug] = r?.total || 0;
				} catch {
					summary[c.slug] = -1;
				}
			}),
		);

		return summary;
	}
}
