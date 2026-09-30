/**
 * The width rule shared by the Studio layout canvas and the runtime form
 * (`packages/ui-views/src/field-span.ts`) — pinned from here the way
 * `cell-render.spec.ts` pins the other consumed ui-views rules.
 *
 * The contract that must not drift: `fieldSpanOf` answers what the layout
 * DECLARES, `flowSpans` answers how many columns each field actually gets,
 * and `'fill'` is the one mode where those two differ — it consumes the REST
 * of the row the field lands in, which is why a half followed by a fill share
 * one row instead of the fill dropping to the next (the Studio's schema "⋯"
 * menu and the canvas' keyboard spans both write through this rule).
 */
import { describe, expect, it } from 'vitest';
import { fieldSpanOf, flowSpans, halfSpanOf, isWideField } from '@mmbix/ui-views';

const plain = (name: string, type = 'text') => ({ name, type });

describe('halfSpanOf', () => {
	it('halves the column count, rounded', () => {
		expect(halfSpanOf(6)).toBe(3);
		expect(halfSpanOf(4)).toBe(2);
		expect(halfSpanOf(2)).toBe(1);
		expect(halfSpanOf(3)).toBe(2);
	});
	it('never returns less than one column', () => {
		expect(halfSpanOf(1)).toBe(1);
		expect(halfSpanOf(0)).toBe(1);
	});
});

describe('fieldSpanOf', () => {
	it('an explicit span wins — presence matters, not just > 1', () => {
		const group = { columns: 6, fieldSpans: { note: 1 } };
		expect(fieldSpanOf(group, 'note', true)).toBe(1);
	});
	it('clamps a declared span into 1..columns', () => {
		expect(fieldSpanOf({ columns: 6, fieldSpans: { a: 9 } }, 'a')).toBe(6);
		expect(fieldSpanOf({ columns: 6, fieldSpans: { a: 0 } }, 'a')).toBe(1);
	});
	it("passes 'fill' through as a mode, never a number", () => {
		expect(fieldSpanOf({ columns: 6, fieldSpans: { a: 'fill' } }, 'a')).toBe('fill');
	});
	it("legacy fieldWidths 'full' spans every column", () => {
		expect(fieldSpanOf({ columns: 6, fieldWidths: { a: 'full' } }, 'a')).toBe(6);
	});
	it('textarea-ish types default to full, others to one column', () => {
		expect(fieldSpanOf({ columns: 6 }, 'a', true)).toBe(6);
		expect(fieldSpanOf({ columns: 6 }, 'a', false)).toBe(1);
		expect(isWideField('longtext')).toBe(true);
		expect(isWideField('markdown')).toBe(true);
		expect(isWideField('text_editor')).toBe(true);
		// `json` renders as a code editor — as wide as the other multi-line types.
		expect(isWideField('json')).toBe(true);
		expect(isWideField('text')).toBe(false);
	});
});

describe('flowSpans', () => {
	it("'fill' at the start of a row takes the whole row", () => {
		const group = { columns: 4, fieldSpans: { a: 'fill' as const } };
		expect(flowSpans(group, [plain('a')])).toEqual([4]);
	});

	it('a half followed by a fill SHARE one row — fill takes the rest, not a new row', () => {
		const group = { columns: 6, fieldSpans: { a: 3, b: 'fill' as const } };
		expect(flowSpans(group, [plain('a'), plain('b')])).toEqual([3, 3]);
	});

	it('a fill after a wrapped field takes the rest of ITS row', () => {
		// cols 4: a=2 (used 2), b=2 → 2+2 fits exactly (used 0), c=1 (used 1), d='fill' → 4-1=3.
		const group = { columns: 4, fieldSpans: { a: 2, b: 2, c: 1, d: 'fill' as const } };
		expect(flowSpans(group, [plain('a'), plain('b'), plain('c'), plain('d')])).toEqual([2, 2, 1, 3]);
	});

	it('a declared span that does not fit wraps instead of back-filling the gap', () => {
		// cols 3: a=2 (used 2), b=2 → 2+2 > 3 → wraps to a new row (used 0), then c='fill' → 3-2=1.
		const group = { columns: 3, fieldSpans: { a: 2, b: 2, c: 'fill' as const } };
		expect(flowSpans(group, [plain('a'), plain('b'), plain('c')])).toEqual([2, 2, 1]);
	});

	it('defaults: textarea-ish spans the row, plain fields one column — positioned as declared', () => {
		const group = { columns: 6 };
		expect(flowSpans(group, [plain('a'), plain('note', 'longtext'), plain('b')])).toEqual([1, 6, 1]);
	});

	it('a legacy full width spans the whole row', () => {
		const group = { columns: 4, fieldWidths: { a: 'full' as const } };
		expect(flowSpans(group, [plain('a'), plain('b')])).toEqual([4, 1]);
	});

	it('an empty group falls back to 2 columns, exactly like fieldSpanOf', () => {
		const group = { fieldSpans: { a: 'fill' as const } };
		expect(flowSpans(group, [plain('a')])).toEqual([2]);
	});
});
