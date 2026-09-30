import { describe, expect, it } from 'vitest';
import type { FormTab } from './types';
import {
	moveGroup,
	removeGroup,
	promoteGroup,
	moveGroupUnder,
	addFieldToGroup,
	setFieldWidth,
	setFieldSpan,
	applyFieldWidth,
	swapFields,
	moveField,
	removeFieldFromLayout,
} from './tree-ops';

/** A tab with two top-level groups; g2 has a nested sub-group g2a. */
function sample(): FormTab[] {
	return [
		{
			id: 't1',
			label: 'General',
			groups: [
				{ id: 'g1', title: 'A', columns: 2, fieldNames: ['a', 'b'] },
				{
					id: 'g2',
					title: 'B',
					columns: 2,
					fieldNames: ['c'],
					groups: [{ id: 'g2a', title: 'B1', columns: 2, fieldNames: ['d'] }],
				},
			],
		},
	];
}

describe('moveGroup', () => {
	it('reorders top-level groups', () => {
		const next = moveGroup(sample(), 'g2', -1);
		expect(next[0].groups.map((g) => g.id)).toEqual(['g2', 'g1']);
	});
	it('reorders nested sub-groups within their parent', () => {
		const tabs: FormTab[] = [
			{
				id: 't1',
				label: 'General',
				groups: [
					{
						id: 'g1',
						title: 'A',
						columns: 2,
						fieldNames: [],
						groups: [
							{ id: 's1', title: 'S1', columns: 2, fieldNames: [] },
							{ id: 's2', title: 'S2', columns: 2, fieldNames: [] },
						],
					},
				],
			},
		];
		const next = moveGroup(tabs, 's2', -1);
		expect(next[0].groups[0].groups!.map((g) => g.id)).toEqual(['s2', 's1']);
	});
	it('does not move past the edges', () => {
		expect(moveGroup(sample(), 'g1', -1)[0].groups.map((g) => g.id)).toEqual(['g1', 'g2']);
		expect(moveGroup(sample(), 'g2', 1)[0].groups.map((g) => g.id)).toEqual(['g1', 'g2']);
	});
});

describe('removeGroup', () => {
	it('removes a top-level group', () => {
		const next = removeGroup(sample(), 'g1');
		expect(next[0].groups.map((g) => g.id)).toEqual(['g2']);
	});
	it('removes a nested sub-group and drops the empty groups key', () => {
		const next = removeGroup(sample(), 'g2a');
		const g2 = next[0].groups.find((g) => g.id === 'g2')!;
		expect(g2.groups).toBeUndefined();
	});
});

describe('promoteGroup', () => {
	it('moves a sub-group up to the top level, right after its ancestor', () => {
		const next = promoteGroup(sample(), 'g2a');
		expect(next[0].groups.map((g) => g.id)).toEqual(['g1', 'g2', 'g2a']);
		expect(next[0].groups[2].fieldNames).toEqual(['d']);
	});
	it('leaves an already-top-level group alone', () => {
		const next = promoteGroup(sample(), 'g1');
		expect(next[0].groups.map((g) => g.id)).toEqual(['g1', 'g2']);
	});
});

describe('moveGroupUnder', () => {
	it('nests a group under a target', () => {
		const next = moveGroupUnder(sample(), 'g1', 'g2');
		const g2 = next[0].groups.find((g) => g.id === 'g2')!;
		expect(g2.groups!.map((g) => g.id)).toContain('g1');
		expect(next[0].groups.map((g) => g.id)).not.toContain('g1');
	});
	it('refuses to nest a group under itself', () => {
		const next = moveGroupUnder(sample(), 'g1', 'g1');
		expect(next).toEqual(sample());
	});
	it('refuses to nest a group under its own descendant', () => {
		const next = moveGroupUnder(sample(), 'g2', 'g2a');
		expect(next).toEqual(sample());
	});
});

describe('addFieldToGroup', () => {
	it('moves a field into the target group and removes it from its old group', () => {
		const next = addFieldToGroup(sample(), 'a', 'g2');
		expect(next[0].groups.find((g) => g.id === 'g1')!.fieldNames).toEqual(['b']);
		expect(next[0].groups.find((g) => g.id === 'g2')!.fieldNames).toEqual(['c', 'a']);
	});
	it('keeps position when the field is already in the target group', () => {
		const next = addFieldToGroup(sample(), 'a', 'g1');
		expect(next[0].groups.find((g) => g.id === 'g1')!.fieldNames).toEqual(['a', 'b']);
	});
});

describe('setFieldWidth / setFieldSpan', () => {
	it('sets and clears a full width', () => {
		const full = setFieldWidth(sample(), 'a', 'full');
		expect(full[0].groups.find((g) => g.id === 'g1')!.fieldWidths).toEqual({ a: 'full' });
		const half = setFieldWidth(full, 'a', 'half');
		expect(half[0].groups.find((g) => g.id === 'g1')!.fieldWidths).toEqual({});
	});
	it('sets a span and clears any width for that field', () => {
		const full = setFieldWidth(sample(), 'a', 'full');
		const spanned = setFieldSpan(full, 'a', 4);
		const g1 = spanned[0].groups.find((g) => g.id === 'g1')!;
		expect(g1.fieldSpans).toEqual({ a: 4 });
		expect(g1.fieldWidths).toBeUndefined();
	});
	it('clamps spans to >= 1', () => {
		const next = setFieldSpan(sample(), 'a', 0);
		expect(next[0].groups.find((g) => g.id === 'g1')!.fieldSpans).toEqual({ a: 1 });
	});
});

describe('applyFieldWidth', () => {
	/** 'a' sits in a 6-column group AND in a nested 2-column group; 'c' is elsewhere. */
	function grids(): FormTab[] {
		return [
			{
				id: 't1',
				label: 'General',
				groups: [
					{ id: 'g1', title: 'A', columns: 6, fieldNames: ['a', 'b'], fieldWidths: { a: 'full' } },
					{ id: 'g2', title: 'B', columns: 2, fieldNames: ['c'], groups: [{ id: 'g2a', title: 'B1', columns: 2, fieldNames: ['a'] }] },
				],
			},
		];
	}

	it("resolves each named width against EACH group's own columns, legacy width cleared", () => {
		const half = applyFieldWidth(grids(), 'a', 'half');
		const g1 = half[0].groups.find((g) => g.id === 'g1')!;
		const g2a = half[0].groups.find((g) => g.id === 'g2')!.groups![0];
		expect(g1.fieldSpans).toEqual({ a: 3 });
		expect(g1.fieldWidths).toBeUndefined();
		expect(g2a.fieldSpans).toEqual({ a: 1 });

		const full = applyFieldWidth(grids(), 'a', 'full');
		expect(full[0].groups.find((g) => g.id === 'g1')!.fieldSpans).toEqual({ a: 6 });
		expect(full[0].groups.find((g) => g.id === 'g2')!.groups![0].fieldSpans).toEqual({ a: 2 });
	});

	it("stores 'fill' verbatim — the rest of the row is resolved at render time", () => {
		const next = applyFieldWidth(grids(), 'a', 'fill');
		expect(next[0].groups.find((g) => g.id === 'g1')!.fieldSpans).toEqual({ a: 'fill' });
	});

	it('leaves groups the field is not placed in untouched, and the input immutable', () => {
		const input = grids();
		const next = applyFieldWidth(input, 'a', 'full');
		expect(next[0].groups.find((g) => g.id === 'g2')!.fieldSpans).toBeUndefined();
		expect(input[0].groups.find((g) => g.id === 'g1')!.fieldWidths).toEqual({ a: 'full' });
		expect(input[0].groups.find((g) => g.id === 'g1')!.fieldSpans).toBeUndefined();
	});
});

describe('swapFields / moveField', () => {
	it('swaps two fields in the same group', () => {
		const next = swapFields(sample(), 'a', 'b');
		expect(next[0].groups.find((g) => g.id === 'g1')!.fieldNames).toEqual(['b', 'a']);
	});
	it('moves a field up/down within its group', () => {
		expect(moveField(sample(), 'b', -1)[0].groups.find((g) => g.id === 'g1')!.fieldNames).toEqual(['b', 'a']);
		expect(moveField(sample(), 'a', 1)[0].groups.find((g) => g.id === 'g1')!.fieldNames).toEqual(['b', 'a']);
	});
});

describe('removeFieldFromLayout', () => {
	it('removes a field from every group', () => {
		const next = removeFieldFromLayout(sample(), 'a');
		expect(next[0].groups.find((g) => g.id === 'g1')!.fieldNames).toEqual(['b']);
	});
	it('leaves unrelated groups untouched', () => {
		const next = removeFieldFromLayout(sample(), 'a');
		expect(next[0].groups.find((g) => g.id === 'g2')!.fieldNames).toEqual(['c']);
	});
});
