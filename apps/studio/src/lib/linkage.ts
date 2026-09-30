import type { FieldCondition, FieldDefinition } from './api';

/**
 * Client-side field linkage — evaluates the `visible_when` / `readonly_when` /
 * `required_when` conditions authored on a field (FieldInspector) at DATA-ENTRY
 * time, so an authored rule actually changes the form instead of doing nothing.
 *
 * PURE and deterministic: the same `(condition, data)` always yields the same
 * boolean; no DOM, no clock, no ordering. It never throws — an absent condition
 * is `true` ("no rule" = always show / never force), and any malformed input
 * degrades to a sensible default rather than blanking the form.
 *
 * This is the Studio-side counterpart of the engine's `LinkageEngine._checkCondition`
 * (packages/core) — the server enforces linkage on stored rows; this mirrors the
 * same operators for the live form state (which holds raw JS values, not the
 * DB-coerced ones, so scalars compare loosely as strings).
 */

/** A scalar's comparable string form — null/undefined collapse to '' (an untouched
 *  field equals an empty expected value), structured values serialize stably so
 *  two distinct objects never both compare as '[object Object]'. */
function scalar(v: unknown): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'object') {
		try {
			return JSON.stringify(v) ?? '';
		} catch {
			return String(v);
		}
	}
	return String(v);
}

/** Loose equality — form state holds raw values (a number field stores `30`, an
 *  authored rule may say `'30'`), so both sides compare through `scalar()`. */
function looseEq(a: unknown, b: unknown): boolean {
	return scalar(a) === scalar(b);
}

function num(v: unknown): number {
	return Number(v); // NaN for junk — every comparison against NaN is false (fail closed)
}

function str(v: unknown): string {
	return v === null || v === undefined ? '' : String(v);
}

function isEmpty(v: unknown): boolean {
	return v === undefined || v === null || v === '';
}

/**
 * Evaluate one linkage condition against the current form data.
 *
 * Returns `true` when `cond` is absent/malformed (no rule → don't hide, don't
 * disable, don't force). Otherwise `data[cond.field]` is compared to `cond.value`
 * per `op`:
 *  - `eq` / `neq`  — loose string equality (scalars; see `scalar`);
 *  - `gt`/`gte`/`lt`/`lte` — numeric via `Number()` (NaN fails the comparison);
 *  - `in` / `nin`  — membership in the array `value` (a non-array value means the
 *    empty set, so `nin` holds);
 *  - `contains` / `starts_with` — substring / prefix on the string form;
 *  - `is_empty` / `is_not_empty` — null | undefined | ''.
 */
export function evaluateCondition(cond: FieldCondition | undefined | null, data: Record<string, unknown>): boolean {
	if (!cond || typeof cond !== 'object' || !cond.field) return true;
	const val = data?.[cond.field];
	switch (cond.op) {
		case 'eq':
			return looseEq(val, cond.value);
		case 'neq':
			return !looseEq(val, cond.value);
		case 'in':
			return Array.isArray(cond.value) && cond.value.some((v) => looseEq(val, v));
		case 'nin':
			return Array.isArray(cond.value) ? !cond.value.some((v) => looseEq(val, v)) : true;
		case 'gt':
			return num(val) > num(cond.value);
		case 'gte':
			return num(val) >= num(cond.value);
		case 'lt':
			return num(val) < num(cond.value);
		case 'lte':
			return num(val) <= num(cond.value);
		case 'contains':
			return str(val).includes(str(cond.value));
		case 'starts_with':
			return str(val).startsWith(str(cond.value));
		case 'is_empty':
			return isEmpty(val);
		case 'is_not_empty':
			return !isEmpty(val);
		default:
			// Unknown operator — treat as "no rule" rather than hiding or forcing.
			return true;
	}
}

/** The effective runtime state of one field for the current data — what the form
 *  actually renders, independent of the field's static flags. */
export interface FieldRuntimeState {
	visible: boolean;
	readOnly: boolean;
	required: boolean;
}

/**
 * Compose a field's static flags with its linkage conditions:
 *  - `visible`  = `visible_when` holds (absent rule → visible, via the evaluator's
 *    no-rule default of `true`);
 *  - `readOnly` = statically `read_only` OR `readonly_when` is AUTHORED and holds;
 *  - `required` = statically `required` OR `required_when` is AUTHORED and holds.
 *
 * The readOnly/required rules are gated on the condition being present: an absent
 * condition means "no constraint" (the evaluator's `true` default means "always",
 * which is right for visibility but would wrongly force a field read-only/required).
 * A computed `required` with an unmet rule stays required — conditions can only
 * ADD the constraint, never remove a static one.
 */
export function fieldRuntimeState(
	field: Pick<FieldDefinition, 'read_only' | 'required' | 'visible_when' | 'readonly_when' | 'required_when'>,
	data: Record<string, unknown>,
): FieldRuntimeState {
	return {
		visible: evaluateCondition(field.visible_when, data),
		readOnly: Boolean(field.read_only) || (field.readonly_when != null && evaluateCondition(field.readonly_when, data)),
		required: Boolean(field.required) || (field.required_when != null && evaluateCondition(field.required_when, data)),
	};
}
