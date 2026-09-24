/**
 * Financial functions — pure, deterministic, workerd/browser-safe.
 *
 * Conventions (documented so every consumer shares ONE interpretation):
 *   - cashflows[0] is the initial investment at t=0 (finance standard for
 *     NPV/IRR/MIRR). NPV(rate, cfs) = Σ cfs[i] / (1+rate)^i
 *   - IRR/XIRR are the rate where NPV/XNPV = 0 (bounded bisection).
 *   - PMT/FV/PV/RATE/NPER/IPMT/PPMT/CUMIPMT follow the standard annuity
 *     formulas; `type` 0 = end of period, 1 = beginning (Excel-compatible).
 *   - XNPV/XIRR discount by exact day-fractions (365-day year, Excel-style).
 *   - Depreciation: SLN straight-line, DDB double-declining, SYD
 *     sum-of-years-digits, DB fixed-declining (with partial first year).
 *
 * Everything is implemented from primitives — no third-party dependency.
 */

// ─── Helpers ─────────────────────────────────────────────

/** Flatten nested arrays one level + coerce to numbers (skips NaN). */
export function flatNumbers(args: unknown[]): number[] {
	const out: number[] = [];
	for (const a of args) {
		if (Array.isArray(a)) {
			for (const x of a) {
				const n = Number(x);
				if (!isNaN(n)) out.push(n);
			}
		} else {
			const n = Number(a);
			if (!isNaN(n)) out.push(n);
		}
	}
	return out;
}

const num = (v: unknown): number => Number(v) || 0;

/** Array of ISO date strings → epoch ms (skips invalid). */
function dateMs(values: unknown): number[] {
	if (!Array.isArray(values)) return [];
	const out: number[] = [];
	for (const d of values) {
		const t = new Date(String(d)).getTime();
		if (!isNaN(t)) out.push(t);
	}
	return out;
}

/** Coerce an evaluator arg (array field or scalar) into an array. */
function toArgArray(v: unknown): unknown[] {
	return Array.isArray(v) ? v : [v];
}

/** Bisection root finder — deterministic, bounded (~200 iterations). */
function bisect(f: (r: number) => number, low = -0.999_999, high = 1): number {
	let lo = low;
	let hi = high;
	let fLo = f(lo);
	if (fLo === 0) return lo;
	let fHi = f(hi);
	for (let i = 0; i < 200 && Math.sign(fLo) === Math.sign(fHi); i++) {
		hi *= 2;
		fHi = f(hi);
		if (!isFinite(fHi)) {
			hi = 1e9;
			fHi = f(hi);
			break;
		}
	}
	if (Math.sign(fLo) === Math.sign(fHi)) return NaN;
	for (let i = 0; i < 200; i++) {
		const mid = (lo + hi) / 2;
		const fMid = f(mid);
		if (Math.abs(fMid) < 1e-9) return mid;
		if (Math.sign(fLo) === Math.sign(fMid)) {
			lo = mid;
			fLo = fMid;
		} else {
			hi = mid;
		}
	}
	return (lo + hi) / 2;
}

// ─── Time value of money ─────────────────────────────────

/**
 * Net present value. cashflows[0] is at t=0 (not discounted).
 * Supports both NPV(rate, [c0, c1, …]) and NPV(rate, c0, c1, …).
 */
export function npv(rate: unknown, ...cashflowArgs: unknown[]): number {
	const r = num(rate);
	const cfs = flatNumbers(cashflowArgs);
	let sum = 0;
	for (let i = 0; i < cfs.length; i++) {
		sum += cfs[i] / Math.pow(1 + r, i);
	}
	return sum;
}

/** Payment for a loan: PMT(rate, nper, pv, fv?, type?) */
export function pmt(rate: unknown, nper: unknown, pv: unknown, fv: unknown = 0, type: unknown = 0): number {
	const r = num(rate);
	const n = num(nper);
	const p = num(pv);
	const f = num(fv);
	const t = num(type);
	if (n === 0) return NaN;
	if (r === 0) return -(p + f) / n;
	const pvif = Math.pow(1 + r, n);
	return -(r * (p * pvif + f)) / ((1 + r * t) * (pvif - 1));
}

/** Future value: FV(rate, nper, pmt, pv?, type?) */
export function fv(rate: unknown, nper: unknown, payment: unknown, pv: unknown = 0, type: unknown = 0): number {
	const r = num(rate);
	const n = num(nper);
	const pm = num(payment);
	const p = num(pv);
	const t = num(type);
	const pvif = Math.pow(1 + r, n);
	const fvifa = r === 0 ? n : ((pvif - 1) / r) * (1 + r * t);
	return -(p * pvif + pm * fvifa);
}

/** Present value: PV(rate, nper, pmt, fv?, type?) */
export function pv(rate: unknown, nper: unknown, payment: unknown, fv: unknown = 0, type: unknown = 0): number {
	const r = num(rate);
	const n = num(nper);
	const pm = num(payment);
	const f = num(fv);
	const t = num(type);
	if (r === 0) return -(f + pm * n);
	const pvif = Math.pow(1 + r, n);
	const pvifa = ((1 - 1 / pvif) / r) * (1 + r * t);
	return -f / pvif - pm * pvifa;
}

/** IRR: the rate where NPV = 0 (cfs[0] at t=0). NaN when no sign change. */
export function irr(...cashflowArgs: unknown[]): number {
	const cfs = flatNumbers(cashflowArgs);
	if (cfs.length === 0) return NaN;
	return bisect((r) => {
		let sum = 0;
		for (let i = 0; i < cfs.length; i++) sum += cfs[i] / Math.pow(1 + r, i);
		return sum;
	});
}

/** Period rate that satisfies the PV equation: RATE(nper, pmt, pv, fv?, type?) */
export function rate(nper: unknown, payment: unknown, present: unknown, fv: unknown = 0, type: unknown = 0): number {
	const n = num(nper);
	const pm = num(payment);
	const p = num(present);
	const f = num(fv);
	const t = num(type);
	if (n <= 0) return NaN;
	return bisect((r) => {
		if (r === 0) return p + pm * n + f;
		const pvif = Math.pow(1 + r, n);
		return p + pm * ((1 - 1 / pvif) / r) * (1 + r * t) + f / pvif;
	});
}

/** Number of periods: NPER(rate, pmt, pv, fv?, type?) */
export function nper(rateV: unknown, payment: unknown, present: unknown, fv: unknown = 0, type: unknown = 0): number {
	const r = num(rateV);
	const pm = num(payment);
	const p = num(present);
	const f = num(fv);
	const t = num(type);
	if (r === 0) return pm === 0 ? NaN : -(p + f) / pm;
	const a = pm * (1 + r * t) - f * r;
	const b = p * r + pm * (1 + r * t);
	if (b === 0 || a === 0) return NaN;
	return Math.log(a / b) / Math.log(1 + r);
}

/** Outstanding balance after k payments (Excel semantics). */
function balanceAfter(p: number, pm: number, r: number, k: number, t: number, f: number): number {
	if (r === 0) return p + pm * k + f;
	const pvif = Math.pow(1 + r, k);
	const factor = ((pvif - 1) / r) * (1 + r * t);
	return p * pvif + pm * factor + f;
}

/** Interest portion of payment at period per (1-based): IPMT(rate, per, nper, pv, fv?, type?) */
export function ipmt(rateV: unknown, per: unknown, nperV: unknown, present: unknown, fv: unknown = 0, type: unknown = 0): number {
	const r = num(rateV);
	const p = num(per);
	const n = num(nperV);
	const pv0 = num(present);
	const f = num(fv);
	const t = num(type);
	if (r === 0) return 0;
	const pm = pmt(r, n, pv0, f, t);
	const bal = balanceAfter(pv0, pm, r, p - 1, t, f);
	return -(bal * r);
}

/** Principal portion of payment at period per: PPMT(rate, per, nper, pv, fv?, type?) */
export function ppmt(rateV: unknown, per: unknown, nperV: unknown, present: unknown, fv: unknown = 0, type: unknown = 0): number {
	const r = num(rateV);
	const p = num(per);
	const n = num(nperV);
	const pv0 = num(present);
	const f = num(fv);
	const t = num(type);
	const pm = pmt(r, n, pv0, f, t);
	return pm - ipmt(r, p, n, pv0, f, t);
}

/** Cumulative interest between periods start..end: CUMIPMT(rate, nper, pv, start, end, type?) */
export function cumipmt(rateV: unknown, nperV: unknown, present: unknown, start: unknown, end: unknown, type: unknown = 0): number {
	const r = num(rateV);
	const n = num(nperV);
	const pv0 = num(present);
	const s = Math.max(1, Math.round(num(start)));
	const e = Math.min(Math.round(num(n)), Math.round(num(end)));
	let sum = 0;
	for (let per = s; per <= e; per++) sum += ipmt(r, per, n, pv0, 0, type);
	return sum;
}

/** Cumulative principal between periods start..end: CUMPRINC(rate, nper, pv, start, end, type?) */
export function cumprinc(rateV: unknown, nperV: unknown, present: unknown, start: unknown, end: unknown, type: unknown = 0): number {
	const r = num(rateV);
	const n = num(nperV);
	const pv0 = num(present);
	const s = Math.max(1, Math.round(num(start)));
	const e = Math.min(Math.round(num(n)), Math.round(num(end)));
	let sum = 0;
	for (let per = s; per <= e; per++) sum += ppmt(r, per, n, pv0, 0, type);
	return sum;
}

/** Effective annual rate: EFFECT(nominal_rate, npery) */
export function effect(nominal: unknown, npery: unknown): number {
	const nr = num(nominal);
	const m = num(npery);
	if (m <= 0) return NaN;
	return Math.pow(1 + nr / m, m) - 1;
}

/** Nominal annual rate: NOMINAL(effect_rate, npery) */
export function nominal(effective: unknown, npery: unknown): number {
	const er = num(effective);
	const m = num(npery);
	if (m <= 0) return NaN;
	return m * (Math.pow(1 + er, 1 / m) - 1);
}

/** Net present value with exact dates: XNPV(rate, cashflows, dates) */
export function xnpv(rateV: unknown, values: unknown, dates: unknown): number {
	const r = num(rateV);
	const cfs = flatNumbers(toArgArray(values));
	const ds = dateMs(dates);
	if (cfs.length === 0 || ds.length !== cfs.length) return NaN;
	const t0 = ds[0];
	let sum = 0;
	for (let i = 0; i < cfs.length; i++) {
		const years = (ds[i] - t0) / (365 * 86_400_000);
		sum += cfs[i] / Math.pow(1 + r, years);
	}
	return sum;
}

/** IRR with exact dates: XIRR(cashflows, dates) */
export function xirr(values: unknown, dates: unknown): number {
	const cfs = flatNumbers(toArgArray(values));
	const ds = dateMs(dates);
	if (cfs.length === 0 || ds.length !== cfs.length) return NaN;
	return bisect((r) => {
		const t0 = ds[0];
		let sum = 0;
		for (let i = 0; i < cfs.length; i++) {
			const years = (ds[i] - t0) / (365 * 86_400_000);
			sum += cfs[i] / Math.pow(1 + r, years);
		}
		return sum;
	});
}

/** Modified IRR: MIRR(values, finance_rate, reinvest_rate) */
export function mirr(values: unknown, financeRate: unknown, reinvestRate: unknown): number {
	const cfs = flatNumbers(toArgArray(values));
	const fr = num(financeRate);
	const rr = num(reinvestRate);
	const n = cfs.length;
	if (n < 2) return NaN;
	let pvNeg = 0;
	let fvPos = 0;
	for (let i = 0; i < n; i++) {
		const cf = cfs[i];
		if (cf < 0) pvNeg += cf / Math.pow(1 + fr, i);
		else fvPos += cf * Math.pow(1 + rr, n - 1 - i);
	}
	if (pvNeg >= 0) return NaN;
	return Math.pow(fvPos / -pvNeg, 1 / (n - 1)) - 1;
}

// ─── Depreciation ────────────────────────────────────────

/** Straight-line: (cost - salvage) / life */
export function sln(cost: unknown, salvage: unknown, life: unknown): number {
	return (num(cost) - num(salvage)) / (num(life) || NaN);
}

/** Double-declining balance for a given period (1-based). */
export function ddb(cost: unknown, salvage: unknown, life: unknown, period: unknown): number {
	const c = num(cost);
	const s = num(salvage);
	const l = num(life);
	const p = num(period);
	if (l === 0) return NaN;
	const rate = 2 / l;
	let book = c;
	let dep = 0;
	for (let i = 1; i <= p; i++) {
		dep = Math.min(book * rate, book - s);
		book -= dep;
	}
	return dep;
}

/** Sum-of-years-digits for a given period (1-based). */
export function syd(cost: unknown, salvage: unknown, life: unknown, period: unknown): number {
	const c = num(cost);
	const s = num(salvage);
	const l = num(life);
	const p = num(period);
	if (l <= 0) return NaN;
	return ((c - s) * (l - p + 1) * 2) / (l * (l + 1));
}

/** Fixed-declining balance: DB(cost, salvage, life, period, month?=12) — partial first year. */
export function db(cost: unknown, salvage: unknown, life: unknown, period: unknown, month: unknown = 12): number {
	const c = num(cost);
	const s = num(salvage);
	const l = num(life);
	const p = num(period);
	const m = num(month);
	if (l <= 0 || c <= s) return NaN;
	const rate = 1 - Math.pow(s / c, 1 / l);
	let book = c;
	let dep = 0;
	for (let i = 1; i <= p; i++) {
		const factor = i === 1 ? Math.max(1, Math.min(12, m)) / 12 : 1;
		dep = book * rate * factor;
		book -= dep;
	}
	return dep;
}

// ─── Business ratios & quick metrics ─────────────────────

/** Return on investment: (gain - cost) / cost */
export function roi(gain: unknown, cost: unknown): number {
	const c = num(cost);
	return c === 0 ? NaN : (num(gain) - c) / c;
}

/** Profit margin: (price - cost) / price */
export function margin(price: unknown, cost: unknown): number {
	const p = num(price);
	return p === 0 ? NaN : (p - num(cost)) / p;
}

/** Markup: (price - cost) / cost */
export function markup(price: unknown, cost: unknown): number {
	const c = num(cost);
	return c === 0 ? NaN : (num(price) - c) / c;
}

/** Compound annual growth rate: (end/start)^(1/years) - 1 */
export function cagr(start: unknown, end: unknown, years: unknown): number {
	const s = num(start);
	const y = num(years);
	if (s <= 0 || y <= 0) return NaN;
	return Math.pow(num(end) / s, 1 / y) - 1;
}

/** Simple interest: principal × rate × time */
export function simpleInterest(principal: unknown, rateV: unknown, time: unknown): number {
	return num(principal) * num(rateV) * num(time);
}

/** Compound interest earned: principal × ((1+rate)^periods − 1) */
export function compoundInterest(principal: unknown, rateV: unknown, periods: unknown): number {
	const p = num(principal);
	return p * (Math.pow(1 + num(rateV), num(periods)) - 1);
}

/** Units to break even: fixed / (price − variable cost) */
export function breakeven(fixed: unknown, price: unknown, varCost: unknown): number {
	const d = num(price) - num(varCost);
	return d === 0 ? NaN : num(fixed) / d;
}

/** Weighted average cost of capital: E/V·Re + D/V·Rd·(1−T) */
export function wacc(equity: unknown, debt: unknown, costEquity: unknown, costDebt: unknown, taxRate: unknown): number {
	const e = num(equity);
	const d = num(debt);
	const v = e + d;
	if (v === 0) return NaN;
	return (e / v) * num(costEquity) + (d / v) * num(costDebt) * (1 - num(taxRate));
}

/** Simple payback period in years: PAYBACK(investment, cashflows) — even flow within a year. */
export function payback(investment: unknown, cashflowArgs: unknown): number {
	const inv = num(investment);
	const cfs = flatNumbers(toArgArray(cashflowArgs));
	let cumulative = 0;
	for (let i = 0; i < cfs.length; i++) {
		cumulative += cfs[i];
		if (cumulative >= inv) {
			const prev = cumulative - cfs[i];
			const frac = cfs[i] === 0 ? 0 : (inv - prev) / cfs[i];
			return i + frac;
		}
	}
	return NaN; // never recovered
}

/** Outstanding balance after k payments: BALANCE(rate, nper, pv, period, fv?, type?) */
export function loanBalance(rateV: unknown, nperV: unknown, present: unknown, period: unknown, fv: unknown = 0, type: unknown = 0): number {
	const r = num(rateV);
	const n = num(nperV);
	const pv0 = num(present);
	const k = num(period);
	const f = num(fv);
	const t = num(type);
	if (r === 0) return pv0 + pmt(r, n, pv0, f, t) * k + f;
	const pvif = Math.pow(1 + r, k);
	const factor = ((pvif - 1) / r) * (1 + r * t);
	return pv0 * pvif + pmt(r, n, pv0, f, t) * factor + f;
}

// ─── Registry entries (single source of truth for the evaluator) ──

import type { EvalFunction } from '@mmbix/core';

export const financialFunctions: Array<[string, EvalFunction]> = [
	['NPV', (args) => npv(args[0], ...args.slice(1))],
	['IRR', (args) => irr(...args)],
	['PMT', (args) => pmt(args[0], args[1], args[2], args[3], args[4])],
	['FV', (args) => fv(args[0], args[1], args[2], args[3], args[4])],
	['PV', (args) => pv(args[0], args[1], args[2], args[3], args[4])],
	['RATE', (args) => rate(args[0], args[1], args[2], args[3], args[4])],
	['NPER', (args) => nper(args[0], args[1], args[2], args[3], args[4])],
	['IPMT', (args) => ipmt(args[0], args[1], args[2], args[3], args[4], args[5])],
	['PPMT', (args) => ppmt(args[0], args[1], args[2], args[3], args[4], args[5])],
	['CUMIPMT', (args) => cumipmt(args[0], args[1], args[2], args[3], args[4], args[5])],
	['CUMPRINC', (args) => cumprinc(args[0], args[1], args[2], args[3], args[4], args[5])],
	['EFFECT', (args) => effect(args[0], args[1])],
	['NOMINAL', (args) => nominal(args[0], args[1])],
	['XNPV', (args) => xnpv(args[0], args[1], args[2])],
	['XIRR', (args) => xirr(args[1], args[2])],
	['MIRR', (args) => mirr(args[0], args[1], args[2])],
	['SLN', (args) => sln(args[0], args[1], args[2])],
	['DDB', (args) => ddb(args[0], args[1], args[2], args[3])],
	['SYD', (args) => syd(args[0], args[1], args[2], args[3])],
	['DB', (args) => db(args[0], args[1], args[2], args[3], args[4])],
	['ROI', (args) => roi(args[0], args[1])],
	['MARGIN', (args) => margin(args[0], args[1])],
	['MARKUP', (args) => markup(args[0], args[1])],
	['CAGR', (args) => cagr(args[0], args[1], args[2])],
	['SIMPLE_INTEREST', (args) => simpleInterest(args[0], args[1], args[2])],
	['COMPOUND_INTEREST', (args) => compoundInterest(args[0], args[1], args[2])],
	['BREAKEVEN', (args) => breakeven(args[0], args[1], args[2])],
	['WACC', (args) => wacc(args[0], args[1], args[2], args[3], args[4])],
	['PAYBACK', (args) => payback(args[0], args[1])],
	['BALANCE', (args) => loanBalance(args[0], args[1], args[2], args[3], args[4], args[5])],
];
