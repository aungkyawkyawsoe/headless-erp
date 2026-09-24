/**
 * Currency conversion — pure and data-driven.
 *
 *   CONVERT(amount, from, to, rates?)
 *
 * `rates` may be:
 *   - a number  → direct from→to rate:            CONVERT(100, 'USD', 'MMK', 2100)
 *   - an object → nested or keyed map (from scope):
 *         { USD: { MMK: 2100 } }                  → CONVERT(100, 'USD', 'MMK', doc.rates)
 *         { "USD_MMK": 2100 }  /  { "USD:MMK": 2100 }
 *         Missing direct rate falls back to the inverse rate (1/x).
 *         Missing both → NaN (never a silent wrong conversion).
 *
 * Rate tables are plain data — store them in a collection and pass them in.
 */

import type { EvalFunction } from '@mmbix/core';

const num = (v: unknown): number => Number(v) || 0;

export function lookupRate(rates: unknown, from: string, to: string): number | null {
	if (!rates || typeof rates !== 'object') return null;
	const r = rates as Record<string, unknown>;
	const nested = r[from] as Record<string, unknown> | undefined;
	const direct = r[`${from}_${to}`] ?? r[`${from}:${to}`] ?? nested?.[to];
	if (typeof direct === 'number' && isFinite(direct)) return direct;
	const inv = r[`${to}_${from}`] ?? r[`${to}:${from}`] ?? (r[to] as Record<string, unknown> | undefined)?.[from];
	if (typeof inv === 'number' && isFinite(inv) && inv !== 0) return 1 / inv;
	return null;
}

export function convert(amount: unknown, from: unknown, to: unknown, rates?: unknown): number {
	const a = num(amount);
	const f = String(from ?? '').toUpperCase();
	const t = String(to ?? '').toUpperCase();
	if (f === '') return NaN;
	if (f === t) return a;
	if (typeof rates === 'number' && isFinite(rates)) return a * rates;
	const rate = lookupRate(rates, f, t);
	return rate === null ? NaN : a * rate;
}

export const currencyFunctions: Array<[string, EvalFunction]> = [['CONVERT', (args) => convert(args[0], args[1], args[2], args[3])]];
