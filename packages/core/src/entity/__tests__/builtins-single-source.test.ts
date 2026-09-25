/**
 * The evaluator's built-ins live in exactly ONE place — the registry
 * (`expression/registry.ts`). The `$NOW`/`$TODAY`/`$UUID`/`$TIMESTAMP` named
 * variables (defaults.ts + linkage-engine.ts) and the `NOW()`/`TODAY()` call
 * path must all resolve through it; a second inlined implementation would mean
 * the two can drift.
 *
 * Proven by replacing a registry entry with a sentinel: if any consumer still
 * had its own copy, it would return the real value instead of the sentinel.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getFunction, listRegisteredFunctions, registerFunction, type EvalFunction } from '../expression';
import { DefaultResolver } from '../defaults';
import { LinkageEngine } from '../linkage-engine';

const NAMED = ['NOW', 'TODAY', 'UUID', 'TIMESTAMP'] as const;
const originals = new Map<string, EvalFunction>();

function sentinel(name: string): void {
	if (!originals.has(name)) originals.set(name, getFunction(name)!);
	registerFunction(name, () => `sentinel:${name}`);
}

afterEach(() => {
	for (const [name, fn] of originals) registerFunction(name, fn);
	originals.clear();
});

describe('evaluator built-ins — ONE source (the registry)', () => {
	it('registers every built-in the named-variable pre-processors resolve', () => {
		const names = listRegisteredFunctions();
		for (const n of [...NAMED, 'parseInt', 'parseFloat', 'String', 'Number', 'Boolean', 'SUM', 'COUNT', 'MIN', 'MAX', 'AVG']) {
			expect(names, n).toContain(n);
		}
	});

	it('$NAMED defaults + linkage $vars resolve THROUGH the registry', () => {
		for (const name of NAMED) {
			sentinel(name);
			expect(DefaultResolver.resolve(`$${name}`), name).toBe(`sentinel:${name}`);
			expect(LinkageEngine._resolveValue(`$${name}`, {}), name).toBe(`sentinel:${name}`);
		}
	});

	it('expressions resolve built-ins from the registry, not a shadowing scope', () => {
		sentinel('NOW');
		expect(DefaultResolver.resolve('=NOW()')).toBe('sentinel:NOW');
		const { data } = LinkageEngine.evaluate([{ name: 'status', linkages: [{ target: 'at', action: 'calculate', expression: 'NOW()' }] }], {
			status: 'x',
		});
		expect(data.at).toBe('sentinel:NOW');
		// parseInt now comes from the registry too (the scope copy was removed).
		expect(DefaultResolver.resolve('=parseInt("42")')).toBe(42);
	});
});
