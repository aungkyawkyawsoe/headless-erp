/**
 * Field Linkage Engine — Dynamic Field Behavior
 *
 * When a field value changes, automatically:
 *   - Set/clear/calculate other field values
 *   - Change field visibility (show/hide)
 *   - Change field editability (readonly/editable)
 *   - Change field requirement (required/optional)
 *
 * All rules are declared in field schema JSON — no code needed.
 * Bundle: ~1.5KB, zero dependencies
 */

import { evaluateExpression } from './expression';
import { coerceValue } from './field-utils';
import type { FieldType } from '@mmbix/types';

// ─── Types ───────────────────────────────────────────────

export interface LinkageCondition {
	field: string;
	op: 'eq' | 'neq' | 'in' | 'nin' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'starts_with' | 'is_empty' | 'is_not_empty';
	value?: unknown;
}

export interface FieldLinkage {
	/** Target field to update */
	target: string;
	/** Action to perform */
	action: 'set_value' | 'clear' | 'calculate' | 'set_options';
	/** For set_value: the value to set */
	value?: unknown;
	/** For calculate: expression (e.g. "qty * rate") */
	expression?: string;
	/** Only trigger when this condition is met */
	condition?: LinkageCondition;
}

export interface FieldVisibilityRule {
	field: string;
	/** Condition — when true, the behavior applies */
	condition: LinkageCondition;
}

export interface FieldHint {
	field: string;
	visible?: boolean;
	readonly?: boolean;
	required?: boolean;
}

// ─── Linkage Engine ──────────────────────────────────────

export class LinkageEngine {
	/**
	 * Evaluate all linkage rules for a collection.
	 * Called before insert/update to modify data and return UI hints.
	 *
	 * @param fields - Field definitions with linkages
	 * @param inputData - The data being saved
	 * @returns Modified data + frontend hints
	 */
	static evaluate(fields: LinkageFieldDef[], inputData: Record<string, unknown>): { data: Record<string, unknown>; hints: FieldHint[] } {
		const data = { ...inputData };
		const hints: FieldHint[] = [];

		for (const field of fields) {
			// ── Visibility rules ──
			if (field.visible_when) {
				hints.push({
					field: field.name,
					visible: this._checkCondition(field.visible_when, data, field.type),
				});
			}

			// ── Readonly rules ──
			if (field.readonly_when) {
				hints.push({
					field: field.name,
					readonly: this._checkCondition(field.readonly_when, data, field.type),
				});
			}

			// ── Required rules ──
			if (field.required_when) {
				hints.push({
					field: field.name,
					required: this._checkCondition(field.required_when, data, field.type),
				});
			}

			// ── Linkage rules (auto-update other fields) ──
			if (field.linkages) {
				for (const link of field.linkages) {
					// Skip if condition is not met
					if (link.condition && !this._checkCondition(link.condition, data, field.type)) continue;

					switch (link.action) {
						case 'set_value':
							data[link.target] = this._resolveValue(link.value, data);
							break;

						case 'clear':
							delete data[link.target];
							break;

						case 'calculate':
							if (link.expression) {
								try {
									data[link.target] = this._evaluateExpression(link.expression, data);
								} catch (err) {
									console.error(
										`[linkage] calculate failed for ${link.target}: ${link.expression}`,
										err instanceof Error ? err.message : String(err),
									);
								}
							}
							break;

						case 'set_options':
							// For select type: dynamically change the option list
							// This is a hint for the frontend, not a data change
							if (link.value && Array.isArray(link.value)) {
								hints.push({
									field: link.target,
									options: link.value,
								} as FieldHint & { options: unknown[] });
							}
							break;
					}
				}
			}
		}

		return { data, hints };
	}

	// ── Condition Evaluation ────────────────────────────

	static _checkCondition(cond: LinkageCondition, data: Record<string, unknown>, fieldType?: string): boolean {
		const val = data[cond.field];
		// Stored values are DB-coerced (booleans → 1/0, numeric strings parsed), so
		// a condition like `{ op: 'eq', value: true }` never matches a row loaded
		// from the DB (is_active === 1). Coerce BOTH sides through the same path
		// used for storage so both in-memory (`true`) and stored (`1`) compare equal.
		const coerce = (v: unknown): unknown => {
			if (!fieldType) return v;
			try {
				return coerceValue(v, fieldType as FieldType);
			} catch {
				return v; // malformed value for strict types (uuid/m2o) — compare raw
			}
		};

		switch (cond.op) {
			case 'eq':
				return coerce(val) === coerce(cond.value);

			case 'neq':
				return coerce(val) !== coerce(cond.value);

			case 'in':
				return Array.isArray(cond.value) && cond.value.some((v) => coerce(val) === coerce(v));

			case 'nin':
				return Array.isArray(cond.value) && !cond.value.some((v) => coerce(val) === coerce(v));

			case 'gt':
				return Number(val) > Number(cond.value);

			case 'gte':
				return Number(val) >= Number(cond.value);

			case 'lt':
				return Number(val) < Number(cond.value);

			case 'lte':
				return Number(val) <= Number(cond.value);

			case 'contains':
				return String(val ?? '').includes(String(cond.value ?? ''));

			case 'starts_with':
				return String(val ?? '').startsWith(String(cond.value ?? ''));

			case 'is_empty':
				return val === undefined || val === null || val === '';

			case 'is_not_empty':
				return val !== undefined && val !== null && val !== '';

			default:
				return false;
		}
	}

	// ── Value Resolution (for set_value) ────────────────

	/**
	 * Resolve a set_value payload:
	 *   - "$NOW"/"$TODAY"/"$UUID"/"$TIMESTAMP" → named variables
	 *   - "=expr" → safe expression evaluation
	 *   - anything else → literal value
	 */
	static _resolveValue(value: unknown, data: Record<string, unknown>): unknown {
		if (typeof value !== 'string') return value;

		switch (value) {
			case '$NOW':
				return new Date().toISOString();
			case '$TODAY':
				return new Date().toISOString().split('T')[0];
			case '$UUID':
				return crypto.randomUUID();
			case '$TIMESTAMP':
				return Date.now();
		}

		// Expression: =expr
		if (value.startsWith('=')) {
			try {
				return this._evaluateExpression(value.slice(1), data);
			} catch {
				return value; // keep literal on failure
			}
		}

		return value;
	}

	// ─── Expression Evaluation ────────────────────────────

	static _evaluateExpression(expr: string, data: Record<string, unknown>): unknown {
		// Build scope with all data fields + utility functions
		const scope: Record<string, unknown> = {
			...data,
			NOW: () => new Date().toISOString(),
			TODAY: () => new Date().toISOString().split('T')[0],
			UUID: () => crypto.randomUUID(),
			Math,
			parseInt,
			parseFloat,
		};

		try {
			// workerd-safe evaluator — new Function()/eval are disallowed in Workers
			return evaluateExpression(expr, scope);
		} catch (err) {
			throw new Error(`Linkage expression error: "${expr}" — ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}

// ─── Extended Field Definition (for linkage support) ────

export interface LinkageFieldDef {
	name: string;
	type?: string;
	linkages?: FieldLinkage[];
	visible_when?: LinkageCondition;
	readonly_when?: LinkageCondition;
	required_when?: LinkageCondition;
}
