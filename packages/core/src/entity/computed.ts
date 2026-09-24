/**
 * Computed fields — shared machinery for the `formula` field type.
 *
 * Pure helpers (no I/O), used by BOTH pipelines so virtual + stored formulas
 * behave identically:
 *   - read path   → RelationResolver (evaluates virtual formulas per page)
 *   - write path  → ItemMutationService (recomputes stored formulas per record)
 *
 * DB-backed lookup fetching lives in apps/api (`computed-field.service.ts`);
 * the aggregate functions (SUM/COUNT/MIN/MAX/AVG) are registered in the safe
 * expression evaluator's registry (see expression/registry.ts).
 */
import type { FieldDefinition } from '@mmbix/types';
import { isCallableFunction } from './expression';

/** Result types a formula may produce — drives column type + SDK type. */
export type FormulaResultType = 'number' | 'string' | 'boolean' | 'json';

/** Default result type when a formula field does not declare one. */
export const DEFAULT_FORMULA_RESULT_TYPE: FormulaResultType = 'number';

export const FORMULA_RESULT_TYPES: readonly FormulaResultType[] = ['number', 'string', 'boolean', 'json'];

/** Rounding modes for `precision` on numeric formulas (default 'half_up'). */
export type RoundingMode = 'half_up' | 'half_even' | 'up' | 'down';

export const FORMULA_ROUNDING_MODES: readonly RoundingMode[] = ['half_up', 'half_even', 'up', 'down'];

/** Relation field types a lookup may reference (array children or a single m2o row). */
const LOOKUP_RELATION_TYPES = new Set(['o2m', 'm2m', 'table', 'm2o']);

const IDENT_RE = /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g;

/** Resolve the declared result type of a formula field (defaults to 'number'). */
export function formulaResultType(f: FieldDefinition): FormulaResultType {
	const rt = f.result_type;
	return rt && (FORMULA_RESULT_TYPES as readonly string[]).includes(rt) ? rt : DEFAULT_FORMULA_RESULT_TYPE;
}

/** Resolve the declared rounding mode (defaults to 'half_up'). */
export function formulaRounding(f: FieldDefinition): RoundingMode {
	const r = f.rounding;
	return r && (FORMULA_ROUNDING_MODES as readonly string[]).includes(r) ? r : 'half_up';
}

/**
 * Round a number to `precision` decimals. Epsilon (1e-9) absorbs binary
 * float artifacts (2.345 * 100 = 234.49999999999997) so the common
 * half-up cases land where accountants expect them.
 */
export function roundTo(value: number, precision: number, mode: RoundingMode = 'half_up'): number {
	const factor = 10 ** precision;
	const scaled = value * factor;
	const EPS = 1e-9;
	switch (mode) {
		case 'half_even': {
			const floor = Math.floor(scaled);
			const diff = scaled - floor;
			if (diff > 0.5 + EPS) return (floor + 1) / factor;
			if (diff < 0.5 - EPS) return floor / factor;
			return (floor % 2 === 0 ? floor : floor + 1) / factor;
		}
		case 'up':
			return Math.ceil(scaled) / factor;
		case 'down':
			return Math.floor(scaled) / factor;
		case 'half_up':
		default: {
			// Half away from zero (matches SQLite ROUND / Excel) — Math.round alone
			// would round 2.5 → 3 but -2.5 → -2.
			const sign = scaled < 0 ? -1 : 1;
			return (Math.floor(Math.abs(scaled) + 0.5 + EPS) * sign) / factor;
		}
	}
}

/**
 * Apply a formula field's precision/rounding to a numeric result (virtual +
 * stored paths stay consistent). Non-numeric results pass through unchanged.
 */
export function applyFormulaPrecision(value: unknown, f: FieldDefinition): unknown {
	if (typeof value !== 'number' || f.precision === undefined || f.precision === null) return value;
	const p = Math.max(0, Math.min(10, Math.trunc(f.precision)));
	if (p === 0) return Math.trunc(value);
	return roundTo(value, p, formulaRounding(f));
}

/**
 * Extract the relation references a formula needs at evaluation time.
 * Returns a map of relation field name → field definition for every
 * o2m/m2m/table/m2o field whose name appears as an identifier in the
 * expression — e.g. `SUM(items.amount)`, `COUNT(items)`, `related.name`.
 *
 * Identifiers that are NOT relations are left to resolve from the plain row
 * scope (ordinary field references). The identifier scan is deliberately
 * approximate: a false positive only triggers an extra lookup fetch.
 */
export function extractLookupRefs(formula: string, fields: FieldDefinition[]): Map<string, FieldDefinition> {
	const refs = new Map<string, FieldDefinition>();
	if (!formula) return refs;
	const relByField = new Map(fields.filter((f) => LOOKUP_RELATION_TYPES.has(f.type)).map((f) => [f.name, f]));
	for (const match of formula.matchAll(IDENT_RE)) {
		const field = relByField.get(match[0]);
		if (field) refs.set(field.name, field);
	}
	return refs;
}

/**
 * Build the evaluator scope value for an array relation lookup.
 *
 *   scope.amount → number[] (values mapped from the child rows)
 *   scope.__rows → the raw child rows (COUNT(child) counts these)
 *
 * So `SUM(child.amount)` and `COUNT(child)` both evaluate with the existing
 * parser (member access + registered aggregate functions) — no parser changes.
 */
export function buildLookupScope(rows: Record<string, unknown>[]): Record<string, unknown> {
	const scope: Record<string, unknown> = { __rows: rows };
	const fieldNames = new Set<string>();
	for (const r of rows) for (const k of Object.keys(r)) fieldNames.add(k);
	for (const name of fieldNames) {
		scope[name] = rows.map((r) => (r[name] === undefined ? null : r[name]));
	}
	return scope;
}

/**
 * Order stored formula fields so dependencies compute before dependents
 * (field A referenced by field B's formula → A first). Fields referenced by no
 * other formula keep schema order. Cycles are broken by schema order (the
 * evaluator still runs deterministically — the last writer wins).
 */
export function topoSortStoredFormulas(fields: FieldDefinition[]): FieldDefinition[] {
	const stored = fields.filter((f) => f.type === 'formula' && f.store && f.formula);
	if (stored.length <= 1) return stored;
	const byName = new Map(stored.map((f) => [f.name, f]));
	const referencedNames = (formula: string): Set<string> => {
		const out = new Set<string>();
		for (const m of formula.matchAll(IDENT_RE)) {
			if (byName.has(m[0])) out.add(m[0]);
		}
		return out;
	};
	const remaining = new Set(stored.map((f) => f.name));
	const ordered: FieldDefinition[] = [];
	while (remaining.size > 0) {
		let progress = false;
		for (const name of [...remaining]) {
			const f = byName.get(name)!;
			const unmet = [...referencedNames(f.formula!)].filter((d) => remaining.has(d) && d !== name);
			if (unmet.length === 0) {
				ordered.push(f);
				remaining.delete(name);
				progress = true;
			}
		}
		if (!progress) {
			// Cycle — emit the remainder in schema order and stop.
			for (const name of [...remaining]) ordered.push(byName.get(name)!);
			break;
		}
	}
	return ordered;
}

/**
 * Coerce a computed result to the storage representation for `result_type`.
 * null/undefined pass through as null; number → numeric (NaN → 0);
 * boolean → 1/0 (string 'false'/'0' → 0, mirroring coerceValue);
 * json → JSON string; string → String. When `opts.precision` is set the
 * number is rounded with `opts.rounding` (default 'half_up').
 */
export function coerceComputedValue(
	value: unknown,
	resultType: FormulaResultType,
	opts?: { precision?: number; rounding?: RoundingMode },
): unknown {
	if (value === null || value === undefined) return null;
	switch (resultType) {
		case 'number': {
			const n = typeof value === 'number' ? value : Number(value);
			if (Number.isNaN(n)) return 0;
			if (opts?.precision !== undefined && opts.precision !== null) {
				const p = Math.max(0, Math.min(10, Math.trunc(opts.precision)));
				if (p === 0) return Math.trunc(n);
				return roundTo(n, p, opts.rounding ?? 'half_up');
			}
			return n;
		}
		case 'boolean': {
			if (typeof value === 'boolean') return value ? 1 : 0;
			if (typeof value === 'number') return value ? 1 : 0;
			const s = String(value).trim().toLowerCase();
			if (s === 'false' || s === '0' || s === '') return 0;
			return 1;
		}
		case 'json':
			return typeof value === 'string' ? value : JSON.stringify(value);
		default:
			return String(value);
	}
}

// ─── Save-time reference validation ────────────────────────────

/** Chain regex — `items.amount` matches as one chain, `SUM(...)` as a call. */
const CHAIN_RE = /[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*/g;

const LITERAL_IDENTIFIERS = new Set(['true', 'false', 'null']);

/**
 * Blank out every string literal (`'...'` / `"..."`, backslash-escapes and
 * all) with same-length spaces, leaving every other byte untouched. The
 * identifier scan below must never see inside a literal — `IF(x == 'paid', …)`
 * is a comparison against a VALUE, not a reference to a field named `paid`,
 * and the timestamp literal `'2000-01-01T00:00:00Z'` contains ident-like
 * runs (`T00`, `Z`) that are not fields. Offsets are preserved (spaces, not
 * deletion) so the function-call probe (`formula[idx + len] === '('`) stays
 * aligned with the original expression. Mirror the tokenizer's string rules:
 * a backslash escapes the next character inside the literal.
 */
function maskStringLiterals(expression: string): string {
	const out = expression.split('');
	let i = 0;
	const len = expression.length;
	while (i < len) {
		const ch = expression[i];
		if (ch === "'" || ch === '"') {
			const quote = ch;
			out[i] = ' ';
			i++;
			while (i < len && expression[i] !== quote) {
				if (expression[i] === '\\' && i + 1 < len) {
					out[i] = ' ';
					out[i + 1] = ' ';
					i += 2;
					continue;
				}
				out[i] = ' ';
				i++;
			}
			if (i < len) out[i] = ' '; // closing quote
			i++;
			continue;
		}
		i++;
	}
	return out.join('');
}

/**
 * Validate that every identifier in a formula is resolvable: a field of the
 * collection (or a relation field for lookups), a callable function
 * (registry + Math.*), or a literal. Returns an error message or null.
 *
 * `extraAllowed` covers system columns (id, created_at, …) which are not part
 * of `fields`. Member-access chains validate their BASE identifier only
 * (`items.amount` → `items`), so child columns are not required to exist here.
 * String literal CONTENT is not scanned (see maskStringLiterals).
 */
export function validateFormulaReferences(
	formula: string,
	fields: FieldDefinition[],
	extraAllowed: ReadonlySet<string> = new Set(),
): string | null {
	if (!formula) return null;
	const allowed = new Set([...fields.map((f) => f.name), ...extraAllowed]);
	// Identifiers inside quoted strings would read as field references — mask
	// literals first so string-returning formulas (`IF(…, 'on_time', 'late_in')`)
	// and string comparisons (`status != 'paid'`) validate cleanly.
	const masked = maskStringLiterals(formula);
	for (const m of masked.matchAll(CHAIN_RE)) {
		const chain = m[0];
		const base = chain.split('.')[0];
		if (LITERAL_IDENTIFIERS.has(base) || base === 'Math') continue;
		const isCall = masked[m.index! + chain.length] === '(';
		if (isCall) {
			if (isCallableFunction(chain) || isCallableFunction(base)) continue;
			return `unknown function "${base}" in expression`;
		}
		if (allowed.has(base)) continue;
		return `unknown field "${base}" in expression`;
	}
	return null;
}

/**
 * Physical (column) field names an expression references — same-row
 * dependencies a SELECT must include for a virtual formula to evaluate
 * correctly (`?fields=total` needs `qty` and `rate` in the projection).
 * Relation/virtual fields are excluded (their values come from lookups or
 * other computed fields).
 */
export function extractFieldRefs(formula: string, fields: FieldDefinition[]): string[] {
	const out = new Set<string>();
	if (!formula) return [];
	const byName = new Map(fields.map((f) => [f.name, f]));
	for (const m of formula.matchAll(IDENT_RE)) {
		const f = byName.get(m[0]);
		if (!f) continue;
		if (f.type === 'o2m' || f.type === 'm2m' || f.type === 'table' || f.type === 'm2a' || f.type === 'formula') continue;
		out.add(f.name);
	}
	return [...out];
}

/**
 * The VIRTUAL formula fields needed (transitively) to compute the given
 * selected set — in topological order (dependencies first), so chained
 * formulas like `grand_total = total * 1.1` evaluate after `total`.
 */
export function resolveFormulaDependencies(fields: FieldDefinition[], selected: Iterable<string>): FieldDefinition[] {
	const byName = new Map(fields.map((f) => [f.name, f]));
	const out: FieldDefinition[] = [];
	const visited = new Set<string>();
	const visit = (name: string): void => {
		const f = byName.get(name);
		if (!f || f.type !== 'formula' || !f.formula || visited.has(name)) return;
		visited.add(name);
		// Dependencies first (DFS post-order); the visited guard breaks cycles.
		for (const m of f.formula.matchAll(IDENT_RE)) {
			const dep = byName.get(m[0]);
			if (dep?.type === 'formula' && dep.formula) visit(dep.name);
		}
		out.push(f);
	};
	for (const n of selected) visit(n);
	return out;
}
