/**
 * Integrity Service — the generic, declarative data-quality (anomaly) engine.
 *
 * A collection declares `policies.integrity.rules` and the engine runs bounded
 * checks for it — no domain code. Four generic rule types cover the shapes an
 * ERP-style ledger actually drifts in:
 *
 *   orphan             a declared m2o whose value points at a missing parent row
 *   aggregate_mismatch a stored field ≠ an aggregate (SUM/COUNT) over a child
 *   duplicate          rows sharing the same value(s) on a key set
 *   stale              rows whose timestamp field is older than N days
 *
 * Big-O discipline: every rule is a LIMIT-bounded read (the executor probes one
 * row past the limit to report `truncated`), so a check can never stream an
 * unbounded result. `aggregate_mismatch` is the heaviest (a parent ⋈ child
 * GROUP BY) — it is still one query, and D1 indexes on the FK serve the join.
 *
 * Safety: every identifier (collection slug, field) is validated against the
 * live schema BEFORE it reaches SQL, so a rule can neither reference an unknown
 * table/column nor inject SQL.
 */
import type { D1Client, IntegrityRule } from '@mmbix/core';
import type { FieldDefinition } from '@mmbix/types';
import { collectionTable } from '@/lib/utils/table-name';

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
/** System columns an integrity rule may reference. */
const SYSTEM_FIELDS = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);

export interface IntegrityViolation {
	rule: IntegrityRule;
	/** Rows returned (bounded by the policy limit). */
	count: number;
	/** True when more violations exist than the limit returned. */
	truncated: boolean;
	rows: Record<string, unknown>[];
}

export interface IntegrityReport {
	checked: number;
	violations: number;
	results: IntegrityViolation[];
	/** Rules that were malformed / referenced unknown identifiers (skipped). */
	errors: Array<{ rule: unknown; error: string }>;
}

/** A collection's fields, keyed by slug — provided by the caller (schema cache). */
export type FieldLookup = (slug: string) => FieldDefinition[] | null;

export class IntegrityService {
	constructor(private readonly db: D1Client) {}

	private assertIdent(kind: string, value: unknown): string {
		if (typeof value !== 'string' || !IDENT.test(value)) throw new Error(`invalid ${kind}: ${String(value)}`);
		return value;
	}

	/** A field name valid for `slug` — declared field or system column. */
	private assertField(field: unknown, fields: FieldDefinition[]): string {
		const name = this.assertIdent('field', field);
		if (SYSTEM_FIELDS.has(name)) return name;
		if (!fields.some((f) => f.name === name)) throw new Error(`unknown field "${name}"`);
		return name;
	}

	/** Resolve a validated collection slug to its fields + physical table. */
	private resolveCollection(slug: unknown, fieldsOf: FieldLookup): { slug: string; table: string; fields: FieldDefinition[] } {
		const s = this.assertIdent('collection', slug);
		const fields = fieldsOf(s);
		if (!fields) throw new Error(`unknown collection "${s}"`);
		return { slug: s, table: collectionTable(s), fields };
	}

	/** Run every rule against `slug`; each rule's failure is isolated. */
	async run(
		slug: string,
		fields: FieldDefinition[],
		fieldsOf: FieldLookup,
		rules: IntegrityRule[],
		limit: number,
	): Promise<IntegrityReport> {
		const table = collectionTable(slug);
		const probe = limit + 1; // one past the limit → `truncated`
		const results: IntegrityViolation[] = [];
		const errors: IntegrityReport['errors'] = [];

		for (const rule of rules) {
			try {
				const rows = await this.runRule(rule, { table, fields }, fieldsOf, probe);
				const truncated = rows.length > limit;
				results.push({ rule, count: Math.min(rows.length, limit), truncated, rows: truncated ? rows.slice(0, limit) : rows });
			} catch (err) {
				errors.push({ rule, error: err instanceof Error ? err.message : String(err) });
			}
		}
		return { checked: results.length, violations: results.reduce((n, r) => n + r.count, 0), results, errors };
	}

	private async runRule(
		rule: IntegrityRule,
		self: { table: string; fields: FieldDefinition[] },
		fieldsOf: FieldLookup,
		probe: number,
	): Promise<Record<string, unknown>[]> {
		switch (rule?.type) {
			case 'orphan': {
				const field = this.assertField(rule.field, self.fields);
				const def = self.fields.find((f) => f.name === field);
				if (def?.type !== 'm2o' || !def.related_collection) throw new Error(`"${field}" is not an m2o field`);
				const ref = this.resolveCollection(def.related_collection, fieldsOf);
				return this.db.all<Record<string, unknown>>({
					sql: `SELECT a.id AS id, a.${field} AS ref_id FROM ${self.table} a LEFT JOIN ${ref.table} r ON a.${field} = r.id WHERE a.${field} IS NOT NULL AND a.deleted_at IS NULL AND r.id IS NULL LIMIT ?`,
					bindings: [probe],
				});
			}
			case 'aggregate_mismatch': {
				const field = this.assertField(rule.field, self.fields);
				const child = rule.child ?? ({} as { collection?: unknown; fk?: unknown; field?: unknown; fn?: unknown });
				const childCol = this.resolveCollection(child.collection, fieldsOf);
				const fk = this.assertField(child.fk, childCol.fields);
				const fn = rule.fn === 'count' ? 'count' : 'sum';
				const agg = fn === 'count' ? 'COUNT(c.id)' : `COALESCE(SUM(c.${this.assertField(child.field, childCol.fields)}),0)`;
				return this.db.all<Record<string, unknown>>({
					sql: `SELECT p.id AS id, p.${field} AS stored, ${agg} AS derived FROM ${self.table} p LEFT JOIN ${childCol.table} c ON c.${fk} = p.id AND c.deleted_at IS NULL WHERE p.deleted_at IS NULL GROUP BY p.id HAVING ${agg} <> COALESCE(p.${field},0) LIMIT ?`,
					bindings: [probe],
				});
			}
			case 'duplicate': {
				const cols = (Array.isArray(rule.fields) ? rule.fields : []).map((f) => this.assertField(f, self.fields));
				if (cols.length === 0) throw new Error('duplicate needs at least one field');
				return this.db.all<Record<string, unknown>>({
					sql: `SELECT ${cols.join(', ')}, COUNT(*) AS n FROM ${self.table} WHERE deleted_at IS NULL GROUP BY ${cols.join(', ')} HAVING n > 1 LIMIT ?`,
					bindings: [probe],
				});
			}
			case 'stale': {
				const field = this.assertField(rule.field ?? 'updated_at', self.fields);
				const days = Number.isFinite(rule.max_age_days) ? Math.max(1, Math.floor(rule.max_age_days)) : 30;
				return this.db.all<Record<string, unknown>>({
					sql: `SELECT id AS id, ${field} AS at FROM ${self.table} WHERE deleted_at IS NULL AND ${field} IS NOT NULL AND ${field} < datetime('now', ?) LIMIT ?`,
					bindings: [`-${days} days`, probe],
				});
			}
			default:
				throw new Error(`unknown rule type: ${String((rule as { type?: unknown })?.type)}`);
		}
	}
}
