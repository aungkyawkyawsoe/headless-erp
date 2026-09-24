/**
 * @mmbix/compute — extended function tests (gap-fill: currency/tax/string/
 * math/logic + advanced financial/statistical/datetime). All hand-verified.
 */
import { describe, it, expect } from 'vitest';
import {
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
	db,
	stdevpOf,
	varianceOf,
	geomeanOf,
	harmeanOf,
	modeOf,
	quartileOf,
	largeOf,
	smallOf,
	rankOf,
	datedif,
	netWorkdays,
	workday,
	yearOf,
	monthOf,
	dayOf,
	isoWeekNum,
	quarterOf,
	convert,
	tax,
	taxTotal,
	taxGross,
	taxBrackets,
	roundOf,
	roundUpOf,
	roundDownOf,
	modOf,
	intOf,
	signOf,
	evenOf,
	oddOf,
	ifThen,
	coalesceOf,
	upperOf,
	lowerOf,
	titleCaseOf,
	trimOf,
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
	computeFunctionNames,
	computeFunctionGroupsMap,
} from '../src/index';

describe('financial — advanced', () => {
	it('RATE / NPER invert PMT', () => {
		expect(rate(12, -11001.6, 120000)).toBeGreaterThan(0.014);
		expect(rate(12, -11001.6, 120000)).toBeLessThan(0.016);
		expect(nper(0.015, -11001.6, 120000)).toBeCloseTo(12, 1);
	});

	it('IPMT / PPMT split the payment', () => {
		expect(ipmt(0.015, 1, 12, 120000)).toBeCloseTo(-1800, 4);
		expect(ipmt(0.015, 2, 12, 120000)).toBeCloseTo(-1661.98, 2);
		expect(ppmt(0.015, 1, 12, 120000)).toBeCloseTo(-9201.6, 1);
		// pmt = ipmt + ppmt for the same period
		expect(ipmt(0.015, 3, 12, 120000) + ppmt(0.015, 3, 12, 120000)).toBeCloseTo(pmtOf(0.015, 12, 120000), 4);
	});

	it('CUMIPMT / CUMPRINC sum to total interest + principal', () => {
		const totalInterest = cumipmt(0.015, 12, 120000, 1, 12);
		const totalPrincipal = cumprinc(0.015, 12, 120000, 1, 12);
		expect(totalInterest).toBeCloseTo(-12019.19, 1);
		expect(totalPrincipal).toBeCloseTo(-120000, 1);
	});

	it('EFFECT / NOMINAL invert each other', () => {
		expect(effect(0.12, 12)).toBeCloseTo(0.126825, 5);
		expect(nominal(0.126825, 12)).toBeCloseTo(0.12, 5);
	});

	it('XNPV discounts by exact day fractions; XIRR inverts it', () => {
		const v = xnpv(0.1, [-1000, 500, 600], ['2026-01-01', '2026-07-01', '2027-01-01']);
		expect(v).toBeCloseTo(22.37, 1);
		const r = xirr([-1000, 600, 600], ['2026-01-01', '2026-07-01', '2027-01-01']);
		expect(r).toBeGreaterThan(0.27);
		expect(r).toBeLessThan(0.29);
		expect(xnpv(r, [-1000, 600, 600], ['2026-01-01', '2026-07-01', '2027-01-01'])).toBeCloseTo(0, 4);
	});

	it('MIRR blends finance + reinvest rates', () => {
		expect(mirr([-1000, 500, 500, 500], 0.1, 0.12)).toBeCloseTo(0.1904, 3);
	});

	it('DB fixed-declining with partial first year', () => {
		expect(db(10000, 1000, 5, 1)).toBeCloseTo(3690.4, 1);
		expect(db(10000, 1000, 5, 1, 6)).toBeCloseTo(1845.2, 1); // half first year
	});
});

// Helper: pmt for the CUMIPMT cross-check
import { pmt as pmtOf } from '../src/index';

describe('statistical — advanced', () => {
	it('variance / population stdev', () => {
		expect(varianceOf([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(4.5714, 3);
		expect(stdevpOf([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 3);
	});

	it('geometric / harmonic means', () => {
		expect(geomeanOf([2, 8])).toBeCloseTo(4, 6);
		expect(harmeanOf([2, 8])).toBeCloseTo(3.2, 6);
	});

	it('mode / quartile / large / small / rank', () => {
		expect(modeOf([1, 2, 2, 3, 3, 3])).toBe(3);
		expect(quartileOf([1, 2, 3, 4, 5], 2)).toBe(3);
		expect(largeOf([1, 2, 3, 4, 5], 2)).toBe(4);
		expect(smallOf([1, 2, 3, 4, 5], 2)).toBe(2);
		expect(rankOf(3, [1, 2, 3, 4, 5])).toBe(3); // descending: 5→1, 3→3
		expect(rankOf(2, [1, 2, 3, 4, 5], 1)).toBe(2); // ascending: 1→1, 2→2
	});
});

describe('datetime — advanced', () => {
	it('YEAR / MONTH / DAY / QUARTER / ISOWEEKNUM', () => {
		expect(yearOf('2026-03-15')).toBe(2026);
		expect(monthOf('2026-03-15')).toBe(3);
		expect(dayOf('2026-03-15')).toBe(15);
		expect(quarterOf('2026-04-01')).toBe(2);
		expect(isoWeekNum('2026-01-05')).toBe(2); // Mon Jan 5 2026 → ISO week 2
	});

	it('DATEDIF units', () => {
		expect(datedif('2020-01-15', '2026-03-15', 'Y')).toBe(6);
		expect(datedif('2020-01-15', '2026-03-15', 'M')).toBe(74);
		expect(datedif('2020-01-15', '2026-03-15', 'D')).toBe(2251); // 6y incl. 2024 leap
		expect(datedif('2020-01-15', '2026-03-15', 'YM')).toBe(2);
		expect(datedif('2020-01-15', '2026-03-15', 'MD')).toBe(0);
		expect(datedif('2020-01-15', '2026-03-15', 'YD')).toBe(59);
	});

	it('NET_WORKDAYS / WORKDAY skip weekends + holidays', () => {
		// Jan 2026 has 22 weekdays (31 days, 9 weekend days).
		expect(netWorkdays('2026-01-01', '2026-01-31')).toBe(22);
		expect(netWorkdays('2026-01-01', '2026-01-31', ['2026-01-01'])).toBe(21);
		expect(workday('2026-01-02', 1)).toBe('2026-01-05'); // skips the weekend
		expect(workday('2026-01-02', 1, ['2026-01-05'])).toBe('2026-01-06'); // + holiday
	});
});

describe('currency', () => {
	it('direct rate, map lookup, inverse fallback', () => {
		expect(convert(100, 'USD', 'MMK', 2100)).toBe(210000);
		expect(convert(100, 'USD', 'MMK', { USD: { MMK: 2100 } })).toBe(210000);
		expect(convert(100, 'MMK', 'USD', { USD: { MMK: 2100 } })).toBeCloseTo(0.04762, 4);
		expect(convert(100, 'USD', 'EUR', { USD_EUR: 0.92 })).toBe(92);
		expect(convert(100, 'USD', 'EUR', { 'USD:EUR': 0.92 })).toBe(92);
		expect(convert(100, 'USD', 'MMK', {})).toBeNaN(); // never silent-wrong
		expect(convert(100, 'USD', 'USD', 0)).toBe(100); // same currency
	});
});

describe('tax', () => {
	it('flat rate helpers', () => {
		expect(tax(1000, 0.05)).toBe(50);
		expect(taxTotal(1000, 0.05)).toBe(1050);
		expect(taxGross(1050, 0.05)).toBe(50);
	});

	it('progressive brackets (data-driven)', () => {
		const brackets = [
			[0, 0],
			[10000, 0.05],
			[50000, 0.1],
		];
		expect(taxBrackets(75000, brackets)).toBe(4500); // 0 + 2000 + 2500
		expect(taxBrackets(8000, brackets)).toBe(0);
		expect(taxBrackets(0, brackets)).toBe(0);
		expect(taxBrackets(500, 'bad')).toBeNaN();
	});
});

describe('math helpers', () => {
	it('rounding family', () => {
		expect(roundOf(2.567, 2)).toBe(2.57);
		expect(roundUpOf(2.111, 2)).toBe(2.12);
		expect(roundDownOf(2.999, 2)).toBe(2.99);
		expect(roundUpOf(-2.1, 0)).toBe(-3); // away from zero
		expect(roundDownOf(-2.9, 0)).toBe(-2); // toward zero
	});

	it('MOD / INT / SIGN / EVEN / ODD', () => {
		expect(modOf(7, 3)).toBe(1);
		expect(modOf(-7, 3)).toBe(2); // Excel MOD: sign of divisor
		expect(intOf(-2.7)).toBe(-3); // Excel INT rounds DOWN
		expect(signOf(-5)).toBe(-1);
		expect(evenOf(3)).toBe(4);
		expect(oddOf(4)).toBe(5);
		expect(oddOf(3)).toBe(3);
	});
});

describe('logic', () => {
	it('IF / COALESCE', () => {
		expect(ifThen(2 > 1, 'yes', 'no')).toBe('yes');
		expect(ifThen(0, 'yes', 'no')).toBe('no');
		expect(coalesceOf([null, undefined, '', 5])).toBe(''); // '' is kept
		expect(coalesceOf([null, undefined, 0])).toBe(0);
		expect(coalesceOf([null, null])).toBe(null);
	});
});

describe('string', () => {
	it('case + trimming', () => {
		expect(upperOf('abc')).toBe('ABC');
		expect(lowerOf('ABC')).toBe('abc');
		expect(titleCaseOf('hello WORLD')).toBe('Hello World');
		expect(trimOf('  a  ')).toBe('a');
	});

	it('extraction + joining', () => {
		expect(lenOf('hello')).toBe(5);
		expect(leftOf('hello', 2)).toBe('he');
		expect(rightOf('hello', 2)).toBe('lo');
		expect(midOf('hello', 2, 3)).toBe('ell'); // 1-based start
		expect(concatOf(['a', 'b', 'c'])).toBe('abc');
		expect(replaceOf('a-b-c', '-', '+')).toBe('a+b+c');
		expect(joinOf(['a', 'b'], '-')).toBe('a-b');
	});

	it('predicates + padding', () => {
		expect(startsWithOf('hello', 'he')).toBe(true);
		expect(endsWithOf('hello', 'lo')).toBe(true);
		expect(containsOf('hello', 'ell')).toBe(true);
		expect(padLeftOf('5', 3, '0')).toBe('005');
		expect(padRightOf('5', 3, '0')).toBe('500');
		expect(repeatOf('ab', 3)).toBe('ababab');
	});
});

describe('registry surface — extended', () => {
	it('all new groups registered', () => {
		const names = computeFunctionNames();
		for (const expected of [
			'CONVERT',
			'TAX',
			'TAX_BRACKETS',
			'UPPER',
			'CONTAINS',
			'ROUND',
			'IF',
			'COALESCE',
			'XNPV',
			'XIRR',
			'MIRR',
			'RATE',
			'NPER',
			'IPMT',
			'CUMIPMT',
			'EFFECT',
			'DB',
			'NET_WORKDAYS',
			'DATEDIF',
			'QUARTILE',
			'RANK',
		]) {
			expect(names).toContain(expected);
		}
		const byGroup = computeFunctionGroupsMap();
		expect(byGroup.currency).toContain('CONVERT');
		expect(byGroup.tax).toContain('TAX_BRACKETS');
		expect(byGroup.string).toContain('TITLE_CASE');
		expect(byGroup.logic).toContain('IF');
	});
});
