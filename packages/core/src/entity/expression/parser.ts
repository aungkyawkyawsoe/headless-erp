/**
 * Parser + evaluator — recursive descent, no eval/new Function.
 *
 * Supports arithmetic/comparison/logical operators, member access, function
 * calls, array literals (via the registry — see registry.ts) and literals.
 * Identifiers resolve from a provided scope object only; functions resolve
 * from the explicit registry (single source of truth).
 */

import { getFunction } from './registry';
import { tokenize, type Token } from './tokenizer';

export class Parser {
	private pos = 0;
	/** Current nesting depth — guards unbounded unary/paren recursion. */
	private depth = 0;
	private static readonly MAX_DEPTH = 100;

	constructor(
		private tokens: Token[],
		private scope: Record<string, unknown>,
	) {}

	private enterNested(): void {
		this.depth++;
		if (this.depth > Parser.MAX_DEPTH) {
			throw new Error(`Expression too deeply nested (max ${Parser.MAX_DEPTH} levels)`);
		}
	}

	private leaveNested(): void {
		this.depth--;
	}

	private peek(): Token {
		return this.tokens[this.pos];
	}
	private next(): Token {
		return this.tokens[this.pos++];
	}

	private expectOp(op: string): void {
		const t = this.next();
		if (t.value !== op) throw new Error(`Expected "${op}" at position ${t.pos}, got "${t.value}"`);
	}

	parse(): unknown {
		const value = this.parseLogicalOr();
		const t = this.peek();
		if (t.type !== 'eof') throw new Error(`Unexpected token "${t.value}" at position ${t.pos}`);
		return value;
	}

	// ── Precedence ladder ─────────────────────────────────

	// ||
	private parseLogicalOr(): unknown {
		let left = this.parseLogicalAnd();
		while (this.peek().value === '||') {
			this.next();
			const right = this.parseLogicalAnd();
			left = Boolean(left) || Boolean(right);
		}
		return left;
	}

	// &&
	private parseLogicalAnd(): unknown {
		let left = this.parseComparison();
		while (this.peek().value === '&&') {
			this.next();
			const right = this.parseComparison();
			left = Boolean(left) && Boolean(right);
		}
		return left;
	}

	// == != < <= > >=
	private parseComparison(): unknown {
		const left = this.parseAdditive();
		const op = this.peek().value;
		if (op === '==' || op === '!=' || op === '<' || op === '<=' || op === '>' || op === '>=') {
			this.next();
			const right = this.parseAdditive();
			switch (op) {
				case '==':
					return this.eq(left, right);
				case '!=':
					return !this.eq(left, right);
				case '<':
					return this.compare(left, right) < 0;
				case '<=':
					return this.compare(left, right) <= 0;
				case '>':
					return this.compare(left, right) > 0;
				case '>=':
					return this.compare(left, right) >= 0;
			}
		}
		return left;
	}

	/**
	 * Compare two values for ordering. Handles date strings (YYYY-MM-DD)
	 * lexicographically, which works correctly for ISO format dates.
	 * Falls back to numeric comparison for other types.
	 */
	private compare(left: unknown, right: unknown): number {
		const ls = String(left ?? '');
		const rs = String(right ?? '');
		// ISO date strings (YYYY-MM-DD...) compare lexicographically
		if (/^\d{4}-\d{2}-\d{2}/.test(ls) && /^\d{4}-\d{2}-\d{2}/.test(rs)) {
			return ls < rs ? -1 : ls > rs ? 1 : 0;
		}
		const ln = Number(left);
		const rn = Number(right);
		// If both are numeric (or convertible), compare as numbers
		if (!isNaN(ln) && !isNaN(rn)) return ln < rn ? -1 : ln > rn ? 1 : 0;
		// Fallback: string comparison
		return ls < rs ? -1 : ls > rs ? 1 : 0;
	}

	private eq(a: unknown, b: unknown): boolean {
		if (a === b) return true;
		// JS loose equality: null == undefined (and only those two)
		if (a === null || a === undefined) return b === null || b === undefined;
		if (b === null || b === undefined) return false;
		// Loose equality for numbers-as-strings
		const an = Number(a);
		const bn = Number(b);
		if (!isNaN(an) && !isNaN(bn) && an === bn) return true;
		return String(a) === String(b);
	}

	// + -
	private parseAdditive(): unknown {
		let left = this.parseMultiplicative();
		while (this.peek().value === '+' || this.peek().value === '-') {
			const op = this.next().value;
			const right = this.parseMultiplicative();
			if (op === '+') left = this.toNumber(left) + this.toNumber(right);
			else left = this.toNumber(left) - this.toNumber(right);
		}
		return left;
	}

	// * / %
	private parseMultiplicative(): unknown {
		let left = this.parseUnary();
		while (this.peek().value === '*' || this.peek().value === '/' || this.peek().value === '%') {
			const op = this.next().value;
			const right = this.parseUnary();
			if (op === '*') left = this.toNumber(left) * this.toNumber(right);
			else if (op === '/') left = this.toNumber(left) / this.toNumber(right);
			else left = this.toNumber(left) % this.toNumber(right);
		}
		return left;
	}

	// unary - !
	private parseUnary(): unknown {
		this.enterNested();
		try {
			const t = this.peek();
			if (t.value === '-') {
				this.next();
				return -this.toNumber(this.parseUnary());
			}
			if (t.value === '!') {
				this.next();
				return !Boolean(this.parseUnary());
			}
			return this.parsePrimary();
		} finally {
			this.leaveNested();
		}
	}

	private parsePrimary(): unknown {
		const t = this.next();

		switch (t.type) {
			case 'num':
				return parseFloat(t.value);

			case 'str':
				return t.value;

			case 'paren': {
				this.enterNested();
				try {
					if (t.value === '[') return this.parseArray();
					if (t.value !== '(') throw new Error(`Unexpected "${t.value}"`);
					const value = this.parseLogicalOr();
					this.expectOp(')');
					return value;
				} finally {
					this.leaveNested();
				}
			}

			case 'ident': {
				// Member access: data.field or Math.max
				if (this.peek().value === '.' && this.peek().type === 'op') {
					this.next(); // consume .
					const member = this.next();
					if (member.type !== 'ident') throw new Error('Expected member name');
					if (this.peek().value === '(') {
						this.next(); // consume (
						return this.callFunction(`${t.value}.${member.value}`, this.parseArgs());
					}
					return this.resolveMember(t.value, member.value);
				}

				// Function call?
				if (this.peek().value === '(') {
					this.next(); // consume (
					return this.callFunction(t.value, this.parseArgs());
				}

				// Literals
				if (t.value === 'true') return true;
				if (t.value === 'false') return false;
				if (t.value === 'null') return null;

				// Field reference from scope
				return this.resolveIdentifier(t.value);
			}

			default:
				throw new Error(`Unexpected token "${t.value}" at position ${t.pos}`);
		}
	}

	// ── Array literals: [a, b, …] (incl. nested + trailing comma) ──

	private parseArray(): unknown[] {
		const arr: unknown[] = [];
		if (this.peek().value === ']') {
			this.next();
			return arr;
		}
		while (true) {
			arr.push(this.parseLogicalOr());
			const sep = this.next().value;
			if (sep === ']') break;
			if (sep !== ',') throw new Error(`Expected "," or "]" in array at position ${this.peek().pos}`);
			if (this.peek().value === ']') {
				this.next(); // trailing comma
				break;
			}
		}
		return arr;
	}

	// ── Function arguments (shared by plain + member calls) ──

	private parseArgs(): unknown[] {
		this.enterNested();
		try {
			const args: unknown[] = [];
			if (this.peek().value !== ')') {
				args.push(this.parseLogicalOr());
				while (this.peek().value === ',') {
					this.next();
					args.push(this.parseLogicalOr());
				}
			}
			this.expectOp(')');
			return args;
		} finally {
			this.leaveNested();
		}
	}

	// ── Resolution ──────────────────────────────────────

	private resolveIdentifier(name: string): unknown {
		// Own-property lookup only — `in` walks the prototype chain and would
		// resolve Object.prototype members (constructor/toString/hasOwnProperty).
		if (Object.prototype.hasOwnProperty.call(this.scope, name)) return this.scope[name];
		return undefined;
	}

	private resolveMember(base: string, member: string): unknown {
		const baseVal = this.resolveIdentifier(base);
		if (baseVal && typeof baseVal === 'object') {
			return (baseVal as Record<string, unknown>)[member];
		}
		return undefined;
	}

	/** Deterministic Math.* functions the evaluator may call. Anything else
	 * (Math.random, Math.constructor, …) is rejected — non-determinism would
	 * poison default-value caching and a live Function return is a code-exec
	 * primitive. */
	static readonly MATH_FUNCTIONS = new Set([
		'abs',
		'ceil',
		'floor',
		'round',
		'max',
		'min',
		'pow',
		'sqrt',
		'sign',
		'trunc',
		'exp',
		'log',
		'log10',
		'log2',
		'sin',
		'cos',
		'tan',
		'asin',
		'acos',
		'atan',
		'atan2',
		'hypot',
		'cbrt',
		'expm1',
		'log1p',
		'sinh',
		'cosh',
		'tanh',
		'asinh',
		'acosh',
		'atanh',
	]);

	private callFunction(name: string, args: unknown[]): unknown {
		// Registry first — the extensible single source of truth (built-ins + @mmbix/compute).
		const fn = getFunction(name);
		if (fn) return fn(args);

		// Deterministic Math.* whitelist (never non-deterministic members).
		if (name.startsWith('Math.')) {
			const mathName = name.slice(5);
			if (Parser.MATH_FUNCTIONS.has(mathName)) {
				const mathFn = (Math as unknown as Record<string, (...a: number[]) => number>)[mathName];
				return mathFn(...args.map((a) => this.toNumber(a)));
			}
		}
		throw new Error(`Unknown function "${name}"`);
	}

	private toNumber(v: unknown): number {
		if (typeof v === 'number') return v;
		if (typeof v === 'boolean') return v ? 1 : 0;
		const n = Number(v);
		return isNaN(n) ? 0 : n;
	}
}

/** Tokenize + evaluate against a scope (exported for reuse). */
export function evaluateWith(expression: string, scope: Record<string, unknown>): unknown {
	assertComplexity(expression);
	const tokens = tokenize(expression);
	const parser = new Parser(tokens, scope);
	return parser.parse();
}

// ─── Complexity guard (Big-O bound for untrusted rule data) ──

/** Hard cap on expression length — a pathological guard must not burn CPU. */
export const MAX_EXPRESSION_LENGTH = 2_048;
/** Hard cap on token count — bounds tokenizer + parser work (O(len) each). */
export const MAX_EXPRESSION_TOKENS = 256;

/**
 * Validate an expression against the complexity caps. Returns an error string
 * when the expression is too large (or a syntax error string on tokenize
 * failure), otherwise null. Used by rule-save surfaces (workflow guards,
 * decision tables, linkage calculate) to fail fast at save time.
 */
export function validateExpressionComplexity(expression: string): string | null {
	if (typeof expression !== 'string' || expression.length === 0) return 'expression must be a non-empty string';
	if (expression.length > MAX_EXPRESSION_LENGTH) {
		return `expression too long (${expression.length} chars, max ${MAX_EXPRESSION_LENGTH})`;
	}
	const tokens = tokenize(expression);
	if (tokens.length > MAX_EXPRESSION_TOKENS) {
		return `expression has too many tokens (${tokens.length}, max ${MAX_EXPRESSION_TOKENS})`;
	}
	return null;
}

/** Throw when the expression exceeds the caps (called from evaluateWith). */
export function assertComplexity(expression: string): void {
	if (typeof expression !== 'string') throw new Error('expression must be a string');
	if (expression.length > MAX_EXPRESSION_LENGTH) {
		throw new Error(`Expression too long (${expression.length} chars, max ${MAX_EXPRESSION_LENGTH})`);
	}
	const tokens = tokenize(expression);
	if (tokens.length > MAX_EXPRESSION_TOKENS) {
		throw new Error(`Expression has too many tokens (${tokens.length}, max ${MAX_EXPRESSION_TOKENS})`);
	}
}
