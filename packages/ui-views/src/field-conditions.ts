/**
 * Linkage-rule conditions (visible_when / readonly_when / required_when) — shared
 * between the Studio builder, the Studio preview and the runtime form so a
 * condition authored in the Studio evaluates identically everywhere (preview == runtime).
 * Pure JSON evaluation — no eval/new Function (workerd constraint).
 */

export type FieldConditionOp =
	'eq' | 'neq' | 'in' | 'nin' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'starts_with' | 'is_empty' | 'is_not_empty';

export interface FieldCondition {
	field: string;
	op: FieldConditionOp;
	value?: unknown;
}

/**
 * Evaluate a linkage-rule condition against the current record values.
 * Returns false for a missing/malformed condition — callers decide the default
 * (typically `cond && !eval(...)` so no condition means always visible).
 */
export function evalFieldCondition(cond: FieldCondition | undefined, values: Record<string, unknown>): boolean {
	if (!cond || !cond.field) return false;
	const raw = values[cond.field];
	const v = typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : String(raw);
	switch (cond.op) {
		case 'eq':
			return v === String(cond.value ?? '');
		case 'neq':
			return v !== String(cond.value ?? '');
		case 'in':
			return Array.isArray(cond.value) && cond.value.map(String).includes(v);
		case 'nin':
			return !(Array.isArray(cond.value) && cond.value.map(String).includes(v));
		case 'gt':
			return Number(v) > Number(cond.value);
		case 'gte':
			return Number(v) >= Number(cond.value);
		case 'lt':
			return Number(v) < Number(cond.value);
		case 'lte':
			return Number(v) <= Number(cond.value);
		case 'contains':
			return v.toLowerCase().includes(String(cond.value ?? '').toLowerCase());
		case 'starts_with':
			return v.toLowerCase().startsWith(String(cond.value ?? '').toLowerCase());
		case 'is_empty':
			return !v;
		case 'is_not_empty':
			return !!v;
		default:
			return true;
	}
}
