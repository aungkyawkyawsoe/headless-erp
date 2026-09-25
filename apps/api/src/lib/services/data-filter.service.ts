/**
 * 🧴 Data Filter Service — Row-Level & Field-Level Permission Enforcement
 *
 * Applies permission-based data filtering at the query/response layer.
 * Called by CollectionService before/after DB operations.
 *
 * Row Filters:  Injects WHERE conditions into QueryBuilder
 * Field Filters: Strips hidden fields from response data
 */
import type { AuthContext } from '@/lib/services/auth.service';
import type { QueryBuilder } from '@mmbix/core';
import { PermissionEvaluator } from '@/lib/services/permission-evaluator';
import type { D1Client } from '@mmbix/core';

// ─── Types ───────────────────────────────────────────────

export interface DataFilterContext {
	db: D1Client;
	auth: AuthContext;
	collectionSlug: string;
}

// ─── Data Filter Service ─────────────────────────────────

export class DataFilterService {
	/**
	 * One operator table, shared by the single- and multi-condition paths so the two
	 * can never disagree. Before this was hoisted the single-condition branch passed
	 * the raw value only — collapsing `neq/gt/gte/lt/lte/like/nin` into `=` (a
	 * silently wrong (over-exposed or empty) result set, not merely noise).
	 */
	private static readonly OPERATOR_MAP: Record<string, string> = {
		eq: '=',
		neq: '!=',
		gt: '>',
		gte: '>=',
		lt: '<',
		lte: '<=',
		in: 'IN',
		nin: 'NOT IN',
		null: 'IS NULL',
		nnull: 'IS NOT NULL',
		like: 'LIKE',
	};

	/**
	 * Apply row-level filter WHERE conditions to a QueryBuilder.
	 * Reads row_filters from _role_permissions and injects them.
	 *
	 * Supports:
	 *   - `{ "owner": "$CURRENT_USER" }` → WHERE owner = current_user_id
	 *   - `{ "status": "published" }`   → WHERE status = 'published'
	 *   - `{ "department": "$CURRENT_USER.department" }` → dynamic field resolution
	 */
	static async applyRowFilter(qb: QueryBuilder, ctx: DataFilterContext): Promise<QueryBuilder> {
		if (!ctx.auth || ctx.auth.is_admin) return qb;

		const filter = await PermissionEvaluator.getRowFilter(ctx.db, ctx.auth.role_id, ctx.collectionSlug);
		if (!filter) return qb;

		const conditions = filter.conditions as Array<{ field: string; op: string; value: unknown }> | undefined;
		if (!conditions || !Array.isArray(conditions) || conditions.length === 0) return qb;

		const operatorMap = DataFilterService.OPERATOR_MAP;

		const combiner = (filter.combiner === 'or' || filter.combiner === 'any' ? 'or' : 'and') as 'and' | 'or';

		if (conditions.length === 1) {
			// Single condition — use simple where
			const cond = conditions[0];
			const resolved = DataFilterService._resolveVariable(cond.value, ctx.auth);
			this._applySingleCondition(qb, cond.field, cond.op, resolved);
		} else {
			// Multiple conditions — use whereGroup with combiner
			const clause = conditions.map((c) => ({
				column: c.field,
				op: operatorMap[c.op] || c.op,
				value: DataFilterService._resolveVariable(c.value, ctx.auth),
				type: combiner,
			}));
			qb.whereGroup(clause, combiner);
		}

		return qb;
	}

	private static _applySingleCondition(qb: QueryBuilder, field: string, op: string, value: unknown): void {
		const mapped = DataFilterService.OPERATOR_MAP[op] ?? op;
		if (mapped === 'IS NULL') {
			qb.whereNull(field);
		} else if (mapped === 'IS NOT NULL') {
			qb.whereNotNull(field);
		} else if (mapped === 'IN' && Array.isArray(value)) {
			qb.whereIn(field, value as string[]);
		} else if (mapped === 'NOT IN' && Array.isArray(value)) {
			qb.whereNotIn(field, value as string[]);
		} else {
			// Every comparison operator (incl. `=` and `LIKE`) goes through the SAME
			// whitelisted render path the multi-condition branch uses. Coercing every
			// op to `=` here was the bug: a `neq`/`gt`/`lt` filter silently matched
			// equality instead of the intended comparison.
			qb.whereGroup([{ column: field, op: mapped, value }], 'and');
		}
	}

	/**
	 * Strip hidden fields from response items based on field_restrictions.
	 */
	static async applyFieldFilter(
		items: Record<string, unknown>[],
		ctx: DataFilterContext,
		_schemaFieldNames: string[],
	): Promise<Record<string, unknown>[]> {
		if (!ctx.auth || ctx.auth.is_admin) return items;

		const restrictions = await PermissionEvaluator.getFieldRestrictions(ctx.db, ctx.auth.role_id, ctx.collectionSlug);
		if (restrictions === null) return items; // null = no restrictions, all fields visible

		// restrictions is an array of ALLOWED fields (whitelist)
		const allowedFields = new Set(restrictions);
		// Always include id and system fields
		allowedFields.add('id');
		allowedFields.add('created_at');
		allowedFields.add('updated_at');

		return items.map((item) => {
			const filtered: Record<string, unknown> = {};
			for (const key of Object.keys(item as Record<string, unknown>)) {
				if (allowedFields.has(key)) {
					filtered[key] = (item as Record<string, unknown>)[key];
				}
			}
			return filtered;
		});
	}

	/**
	 * Strip hidden fields from a single item.
	 */
	static async applyFieldFilterToItem(
		item: Record<string, unknown>,
		ctx: DataFilterContext,
		_schemaFieldNames: string[],
	): Promise<Record<string, unknown>> {
		const filtered = await DataFilterService.applyFieldFilter([item], ctx, _schemaFieldNames);
		return filtered[0] || item;
	}

	// ── Private ──────────────────────────────────────────

	/**
	 * Resolve dynamic variables in filter values.
	 *   "$CURRENT_USER" → auth.user_id
	 *   "$CURRENT_USER.email" → auth.email
	 *   "$CURRENT_USER.role_name" → auth.role_name
	 */
	private static _resolveVariable(value: unknown, auth: AuthContext): unknown {
		if (typeof value !== 'string') return value;

		if (value === '$CURRENT_USER') return auth.user_id;

		if (value.startsWith('$CURRENT_USER.')) {
			const path = value.slice('$CURRENT_USER.'.length);
			const authRecord = auth as unknown as Record<string, unknown>;
			return authRecord[path] ?? value;
		}

		return value;
	}
}
