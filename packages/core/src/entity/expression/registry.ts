/**
 * Evaluator function registry — the single source of truth for callable
 * functions in the safe expression evaluator.
 *
 * Built-ins are registered here (NOW/TODAY/UUID/TIMESTAMP/parseInt/…);
 * @mmbix/compute and any other package register their own via registerFunction().
 * Untrusted rule data can only reference names that exist in this registry —
 * nothing else is callable, ever.
 */

/**
 * A callable evaluator function. Receives already-parsed arguments and must
 * be pure + deterministic (no I/O, no Math.random) to preserve the evaluator's
 * guarantees. Registered at compile time by bundled code only.
 */
export type EvalFunction = (args: unknown[]) => unknown;

const functionRegistry = new Map<string, EvalFunction>();
const NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Register a callable evaluator function. Idempotent — a later registration
 * with the same name replaces the earlier one. This is the extension point
 * used by @mmbix/compute (financial/statistical/date functions) and any other
 * package that wants its functions available to declarative rules.
 */
export function registerFunction(name: string, fn: EvalFunction): void {
	if (!NAME_RE.test(name)) throw new Error(`Invalid function name "${name}"`);
	functionRegistry.set(name, fn);
}

/** Lookup a registered function (parser uses this; returns undefined if absent). */
export function getFunction(name: string): EvalFunction | undefined {
	return functionRegistry.get(name);
}

/** Introspection — all callable function names (docs/UI). */
export function listRegisteredFunctions(): string[] {
	return [...functionRegistry.keys()].sort();
}

/**
 * Call a registered function with NO arguments — the entry point the $-named
 * variable pre-processors (`$NOW`/`$TODAY`/`$UUID`/`$TIMESTAMP`) use, so their
 * implementation is the SAME one the evaluator invokes for `NOW()`/`TODAY()`.
 * Throws for an unknown name (the $-built-ins always exist).
 */
export function callBuiltin(name: string): unknown {
	const fn = functionRegistry.get(name);
	if (!fn) throw new Error(`Unknown function "${name}"`);
	return fn([]);
}

// ─── Built-ins (single source of truth — same registry as extensions) ──

registerFunction('NOW', () => new Date().toISOString());
registerFunction('TODAY', () => new Date().toISOString().split('T')[0]);
registerFunction('UUID', () => crypto.randomUUID());
registerFunction('TIMESTAMP', () => Date.now());
registerFunction('parseInt', (args) => parseInt(String(args[0] ?? ''), 10));
registerFunction('parseFloat', (args) => parseFloat(String(args[0] ?? '')));
registerFunction('String', (args) => String(args[0] ?? ''));
registerFunction('Number', (args) => {
	// Preserve the evaluator's legacy toNumber coercion: non-numeric → 0.
	const v = args[0];
	if (typeof v === 'number') return v;
	if (typeof v === 'boolean') return v ? 1 : 0;
	const n = Number(v);
	return isNaN(n) ? 0 : n;
});
registerFunction('Boolean', (args) => Boolean(args[0]));

// ─── Aggregate built-ins (computed-field lookups) ──────────────
// SUM(child.amount) / COUNT(child) / MIN / MAX / AVG — operate on value
// arrays extracted from a lookup scope (see entity/computed.ts) or on plain
// arrays/values. SQL-like semantics: null/undefined/'' and non-numeric entries
// are ignored by numeric aggregates; empty input yields null (COUNT → 0).

function rowsOf(v: unknown): unknown[] | null {
	if (Array.isArray(v)) return v;
	if (v && typeof v === 'object' && Array.isArray((v as { __rows?: unknown[] }).__rows)) {
		return (v as { __rows: unknown[] }).__rows;
	}
	return null;
}

function numericValues(args: unknown[]): number[] {
	const out: number[] = [];
	const push = (v: unknown): void => {
		if (v === null || v === undefined || v === '') return;
		const n = Number(v);
		if (!Number.isNaN(n)) out.push(n);
	};
	for (const a of args) {
		const rows = rowsOf(a);
		if (rows) {
			for (const r of rows) push(r);
			continue;
		}
		push(a);
	}
	return out;
}

registerFunction('SUM', (args) => {
	const nums = numericValues(args);
	return nums.length === 0 ? 0 : nums.reduce((s, n) => s + n, 0);
});
registerFunction('COUNT', (args) => {
	let total = 0;
	for (const a of args) {
		const rows = rowsOf(a);
		total += rows ? rows.length : a === null || a === undefined ? 0 : 1;
	}
	return total;
});
registerFunction('MIN', (args) => {
	const nums = numericValues(args);
	return nums.length === 0 ? null : Math.min(...nums);
});
registerFunction('MAX', (args) => {
	const nums = numericValues(args);
	return nums.length === 0 ? null : Math.max(...nums);
});
registerFunction('AVG', (args) => {
	const nums = numericValues(args);
	return nums.length === 0 ? null : nums.reduce((s, n) => s + n, 0) / nums.length;
});
