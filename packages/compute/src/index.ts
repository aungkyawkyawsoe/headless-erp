/**
 * @mmbix/compute — single source of truth for computation.
 *
 * Use in ANY consumer (API worker, plugin workers, miniapp BFF, Studio, CLI):
 *
 *   // 1) One call registers every function into the safe expression evaluator
 *   //    (packages/core) → workflow guards, server-function rules, linkage
 *   //    calculate and formula fields can call them by name, e.g.:
 *   //      "guard": "NPV(0.08, doc.cashflows) > 0 && CONVERT(doc.total, 'USD', 'MMK', doc.rates) < doc.budget"
 *   import { registerComputeFunctions } from '@mmbix/compute';
 *   registerComputeFunctions();
 *
 *   // 2) Or import individual pure functions directly for TypeScript reuse:
 *   import { npv, pmt, taxBrackets } from '@mmbix/compute';
 *
 * "Import only when needed": consumers that never import this package add 0
 * bytes to their bundle; tree-shaking keeps only the groups actually used.
 */

import { registerFunction } from '@mmbix/core/expression';
import { financialFunctions } from './functions/financial';
import { statisticalFunctions } from './functions/statistical';
import { datetimeFunctions } from './functions/datetime';
import { stringFunctions } from './functions/string';
import { currencyFunctions } from './functions/currency';
import { taxFunctions } from './functions/tax';
import { mathFunctions } from './functions/math';
import { logicFunctions } from './functions/logic';
import { arrayFunctions } from './functions/array';
import { patternFunctions } from './functions/pattern';
import { conversionFunctions } from './functions/conversion';
import { timeseriesFunctions } from './functions/timeseries';
import { probabilityFunctions } from './functions/probability';

/** All function groups in registration order. */
export const computeFunctionGroups = [
	['financial', financialFunctions],
	['statistical', statisticalFunctions],
	['datetime', datetimeFunctions],
	['string', stringFunctions],
	['currency', currencyFunctions],
	['tax', taxFunctions],
	['math', mathFunctions],
	['logic', logicFunctions],
	['array', arrayFunctions],
	['pattern', patternFunctions],
	['conversion', conversionFunctions],
	['timeseries', timeseriesFunctions],
	['probability', probabilityFunctions],
] as const;

/** Every function name this package provides (for docs/introspection). */
export function computeFunctionNames(): string[] {
	return computeFunctionGroups.flatMap(([, fns]) => fns.map(([name]) => name));
}

/** Function names grouped by category (docs/UI). */
export function computeFunctionGroupsMap(): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	for (const [group, fns] of computeFunctionGroups) out[group] = fns.map(([name]) => name);
	return out;
}

/**
 * Register every compute function into the evaluator's function registry.
 * Idempotent — safe to call more than once per isolate.
 * Returns the number of functions registered.
 */
export function registerComputeFunctions(): number {
	let count = 0;
	for (const [, fns] of computeFunctionGroups) {
		for (const [name, fn] of fns) {
			registerFunction(name, fn);
			count++;
		}
	}
	return count;
}

// Direct TypeScript reuse (pure functions — no evaluator involved).
export {
	npv,
	irr,
	pmt,
	fv,
	pv,
	rate,
	nper,
	ipmt,
	ppmt,
	cumipmt,
	cumprinc,
	effect,
	nominal,
	xnpv,
	xirr,
	mirr,
	sln,
	ddb,
	syd,
	db,
	roi,
	margin,
	markup,
	cagr,
	simpleInterest,
	compoundInterest,
	breakeven,
	wacc,
	payback,
	loanBalance,
	flatNumbers,
} from './functions/financial';
export {
	sumOf,
	countOf,
	meanOf,
	minOf,
	maxOf,
	medianOf,
	stdevOf,
	stdevpOf,
	varianceOf,
	geomeanOf,
	harmeanOf,
	modeOf,
	percentileOf,
	quartileOf,
	largeOf,
	smallOf,
	rankOf,
	weightedAvgOf,
	correlOf,
	slopeOf,
	interceptOf,
	forecastOf,
	percentRankOf,
	clampOf,
} from './functions/statistical';
export {
	daysBetween,
	addMonths,
	endOfMonth,
	yearOf,
	monthOf,
	dayOf,
	isoWeekNum,
	quarterOf,
	datedif,
	netWorkdays,
	workday,
	weekdayOf,
	startOfMonth,
	endOfQuarter,
	endOfYear,
	hoursBetween,
	minutesBetween,
	isWeekend,
	ageYears,
} from './functions/datetime';
export {
	upperOf,
	lowerOf,
	titleCaseOf,
	trimOf,
	ltrimOf,
	rtrimOf,
	lenOf,
	leftOf,
	rightOf,
	midOf,
	concatOf,
	replaceOf,
	startsWithOf,
	endsWithOf,
	containsOf,
	padLeftOf,
	padRightOf,
	repeatOf,
	joinOf,
	splitOf,
	indexOf,
	lastIndexOf,
	reverseOf,
	normalizeOf,
	maskOf,
	slugifyOf,
	truncateOf,
} from './functions/string';
export { convert, lookupRate } from './functions/currency';
export { tax, taxTotal, taxGross, taxBrackets } from './functions/tax';
export { roundOf, roundUpOf, roundDownOf, modOf, intOf, signOf, evenOf, oddOf } from './functions/math';
export {
	ifThen,
	coalesceOf,
	inList,
	betweenOf,
	switchOf,
	isEmptyOf,
	isNullOf,
	isNumberOf,
	isIntegerOf,
	isTextOf,
	isBooleanOf,
} from './functions/logic';
export { arrayLength, arrayGet, arrayFirst, arrayLast, arrayUnique, arraySort } from './functions/array';
export { matchesOf } from './functions/pattern';
export { percentOf, toNumberOf, toTextOf, toBooleanOf } from './functions/conversion';
export { movingAverage, movingSum, percentChange, yoyGrowth, growthRate, meanAbsoluteDeviation } from './functions/timeseries';
export {
	factorialOf,
	combinOf,
	permutOf,
	binomDist,
	poissonOf,
	normDist,
	normInvOf,
	zscoreOf,
	confidenceOf,
} from './functions/probability';
