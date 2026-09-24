/**
 * DecisionTableService — persistence + evaluation for data-driven business rules.
 *
 *   evaluateFor(collection, doc) → runs every enabled table for the collection,
 *   applies matching rules to the doc (set / compute / abort) and records which
 *   rules fired into _decision_rule_audit (append-only lineage).
 *
 * Safety: compute expressions run through the safe evaluator (no eval); save
 * time validation catches bad ops/fields/expressions so a broken rule can never
 * surface mid-request.
 */

import { D1Client, evaluateExpression, validateExpressionComplexity } from '@mmbix/core';
import { ValidationError } from '@mmbix/utils';
import type { AuthContext } from '@/lib/services/auth.service';
import type { DecisionActions, DecisionCondition, DecisionEvaluation, DecisionRuleRow, DecisionTableDefinition } from './types';

export interface DecisionTableRow {
	id: string;
	name: string;
	collection: string;
	definition_json: string;
	enabled: number;
	version: number;
	created_at: string;
	updated_at: string;
	definition: DecisionTableDefinition;
}

const VALID_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'contains', 'matches', 'empty', 'not_empty']);

/** Normalize "doc.status" → "status" so both spellings work. */
const fieldOf = (field: string): string => (field.startsWith('doc.') ? field.slice(4) : field);

export class DecisionTableService {
	constructor(private readonly db: D1Client) {}

	// ─── CRUD ────────────────────────────────────────────

	async list(collection?: string): Promise<DecisionTableRow[]> {
		const rows = await this.db.all<DecisionTableRow>({
			sql: 'SELECT * FROM _decision_tables' + (collection ? ' WHERE collection = ?' : '') + ' ORDER BY created_at DESC',
			bindings: collection ? [collection] : [],
		});
		return rows.map((r) => this.decorate(r));
	}

	async get(id: string): Promise<DecisionTableRow | null> {
		const row = await this.db.first<DecisionTableRow>({
			sql: 'SELECT * FROM _decision_tables WHERE id = ?',
			bindings: [id],
		});
		return row ? this.decorate(row) : null;
	}

	async upsert(definition: DecisionTableDefinition, id?: string): Promise<{ id: string; version: number }> {
		this.validate(definition);
		const now = new Date().toISOString();
		const rowId = id ?? crypto.randomUUID();
		const result = await this.db.first<{ id: string; version: number }>({
			sql: `INSERT INTO _decision_tables (id, name, collection, definition_json, enabled, version, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, 1, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					name = excluded.name,
					collection = excluded.collection,
					definition_json = excluded.definition_json,
					enabled = excluded.enabled,
					version = _decision_tables.version + 1,
					updated_at = excluded.updated_at
				RETURNING id, version`,
			bindings: [rowId, definition.name, definition.collection, JSON.stringify(definition), definition.enabled === false ? 0 : 1, now, now],
		});
		return { id: result?.id ?? rowId, version: result?.version ?? 1 };
	}

	async remove(id: string): Promise<void> {
		await this.db.run({ sql: 'DELETE FROM _decision_tables WHERE id = ?', bindings: [id] });
	}

	// ─── Evaluation ──────────────────────────────────────

	/**
	 * Evaluate every enabled table for a collection against a document.
	 * Applies matching rules (set / compute / abort) in place and returns what
	 * fired. Throws ValidationError when a matching rule carries `abort`.
	 */
	async evaluateFor(
		collection: string,
		doc: Record<string, unknown>,
		auth?: AuthContext | null,
		documentId?: string,
	): Promise<DecisionEvaluation> {
		const tables = await this.db.all<DecisionTableRow>({
			sql: `SELECT * FROM _decision_tables WHERE collection = ? AND enabled = 1 ORDER BY created_at ASC`,
			bindings: [collection],
		});
		const applied: DecisionEvaluation['applied'] = [];
		let current = { ...doc };

		for (const row of tables.map((r) => this.decorate(r))) {
			const tableResult = this.evaluateTable(row.definition, current);
			for (const rule of tableResult.fired) {
				applied.push({ table: row.definition.name, rule: rule.name, actions: rule.actions });
				current = this.applyActions(rule.actions, current);
				this.audit(collection, documentId ?? null, row.id, rule, auth).catch((err) =>
					console.error('[decision-table] audit failed:', err instanceof Error ? err.message : err),
				);
				if (row.definition.mode === 'first_match') break;
			}
		}

		return { applied, doc: current };
	}

	/** Pure evaluation of a single table — exported for tests and the :id/evaluate route. */
	evaluateTable(def: DecisionTableDefinition, doc: Record<string, unknown>): { fired: DecisionRuleRow[] } {
		const rules = [...(def.rules ?? [])].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
		const fired: DecisionRuleRow[] = [];
		for (const rule of rules) {
			const matches = rule.conditions.every((cond) => this.matchCondition(cond, doc));
			if (matches) {
				fired.push(rule);
				if ((def.mode ?? 'first_match') === 'first_match') break;
			}
		}
		return { fired };
	}

	// ─── Rule semantics ──────────────────────────────────

	private matchCondition(cond: DecisionCondition, doc: Record<string, unknown>): boolean {
		const actual = doc[fieldOf(cond.field)];
		switch (cond.op) {
			case 'eq':
				return this.eq(actual, cond.value);
			case 'neq':
				return !this.eq(actual, cond.value);
			case 'gt':
				return Number(actual) > Number(cond.value);
			case 'gte':
				return Number(actual) >= Number(cond.value);
			case 'lt':
				return Number(actual) < Number(cond.value);
			case 'lte':
				return Number(actual) <= Number(cond.value);
			case 'in': {
				const list = Array.isArray(cond.value) ? cond.value : [];
				return list.some((v) => this.eq(actual, v));
			}
			case 'not_in': {
				const list = Array.isArray(cond.value) ? cond.value : [];
				return !list.some((v) => this.eq(actual, v));
			}
			case 'contains':
				return actual != null && String(actual).includes(String(cond.value ?? ''));
			case 'matches': {
				try {
					return actual != null && new RegExp(String(cond.value)).test(String(actual));
				} catch {
					return false; // invalid regex at save time is rejected; runtime-safe
				}
			}
			case 'empty':
				return actual === undefined || actual === null || actual === '';
			case 'not_empty':
				return actual !== undefined && actual !== null && actual !== '';
			default:
				return false;
		}
	}

	private eq(a: unknown, b: unknown): boolean {
		if (a === b) return true;
		if (a === null || a === undefined) return b === null || b === undefined;
		if (b === null || b === undefined) return false;
		const an = Number(a);
		const bn = Number(b);
		if (!isNaN(an) && !isNaN(bn) && an === bn) return true;
		return String(a) === String(b);
	}

	/** Apply a rule's actions to a doc (public so routes/tests can dry-run). */
	applyActions(actions: DecisionActions, doc: Record<string, unknown>): Record<string, unknown> {
		const next = { ...doc };
		if (actions.abort) throw new ValidationError(actions.abort);
		if (actions.set) {
			for (const [field, value] of Object.entries(actions.set)) next[fieldOf(field)] = value;
		}
		for (const c of actions.compute ?? []) {
			try {
				next[fieldOf(c.field)] = evaluateExpression(c.expression, { doc: next });
			} catch (err) {
				throw new ValidationError(`compute "${c.field}" failed: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
		return next;
	}

	// ─── Save-time validation (fail fast, never mid-request) ──

	validate(def: DecisionTableDefinition): void {
		if (!def.name?.trim()) throw new ValidationError('name is required');
		if (!def.collection?.trim()) throw new ValidationError('collection is required');
		if (!Array.isArray(def.rules) || def.rules.length === 0) throw new ValidationError('rules must be a non-empty array');
		if (def.mode !== undefined && !['first_match', 'all'].includes(def.mode)) throw new ValidationError('mode must be first_match | all');
		const seen = new Set<string>();
		for (const rule of def.rules) {
			if (!rule.id) throw new ValidationError('every rule needs an id');
			if (seen.has(rule.id)) throw new ValidationError(`duplicate rule id "${rule.id}"`);
			seen.add(rule.id);
			if (!rule.name?.trim()) throw new ValidationError(`rule "${rule.id}" needs a name`);
			if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) {
				throw new ValidationError(`rule "${rule.id}" needs at least one condition`);
			}
			for (const cond of rule.conditions) {
				if (!cond.field?.trim()) throw new ValidationError(`rule "${rule.id}" has a condition without a field`);
				if (!VALID_OPS.has(cond.op))
					throw new ValidationError(`rule "${rule.id}" op "${cond.op}" is invalid (${[...VALID_OPS].join(', ')})`);
				if (cond.op === 'matches') {
					try {
						new RegExp(String(cond.value));
					} catch {
						throw new ValidationError(`rule "${rule.id}" has an invalid regex: ${String(cond.value)}`);
					}
				}
			}
			for (const c of rule.actions.compute ?? []) {
				if (!c.field?.trim()) throw new ValidationError(`rule "${rule.id}" compute action needs a field`);
				const complexity = validateExpressionComplexity(c.expression);
				if (complexity) throw new ValidationError(`rule "${rule.id}" compute expression ${complexity}`);
				try {
					evaluateExpression(c.expression, { doc: {} });
				} catch (err) {
					throw new ValidationError(`rule "${rule.id}" compute expression invalid: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		}
	}

	// ─── Internals ───────────────────────────────────────

	private async audit(
		collection: string,
		documentId: string | null,
		tableId: string,
		rule: DecisionRuleRow,
		auth?: AuthContext | null,
	): Promise<void> {
		await this.db.run({
			sql: `INSERT INTO _decision_rule_audit (id, collection_slug, document_id, table_id, rule_id, rule_name, actions_json, by_user, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			bindings: [
				crypto.randomUUID(),
				collection,
				documentId,
				tableId,
				rule.id,
				rule.name,
				JSON.stringify(rule.actions),
				auth?.user_id ?? null,
				new Date().toISOString(),
			],
		});
	}

	private decorate(row: DecisionTableRow): DecisionTableRow {
		let definition: DecisionTableDefinition;
		try {
			definition = JSON.parse(row.definition_json) as DecisionTableDefinition;
		} catch {
			definition = { name: row.name, collection: row.collection, rules: [] };
		}
		return { ...row, definition };
	}
}
