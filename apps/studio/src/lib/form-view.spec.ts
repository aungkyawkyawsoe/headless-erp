/**
 * The record form's view of the form layout (`formSections`) — the ONE resolution
 * both record surfaces render, and the reason the field "⋯" menu's Hide and width
 * entries actually change what the form shows.
 *
 * The layout is a CURATION, not a whitelist, and that is what these tests pin:
 * a field the layout never carried still renders (appended, at the form's own
 * default width), `hidden` is the one thing that takes a field off the form, the
 * layout's own flow decides the placed fields' spans, and a rule-hidden field or
 * group leaves no hole behind.
 */
import { describe, expect, it } from 'vitest';
import { formSections } from './form-view';
import { DEFAULT_FORM_FIELDS, type StoredFormLayout } from '../components/formlayout/serialize';
import type { SerializedFormGroup } from '../components/formlayout/types';
import type { FieldDefinition } from './api';

const f = (name: string, type = 'text'): FieldDefinition => ({ name, type });

/** One tab, one or more groups — the shape the layout canvas writes. */
function layout(groups: Array<Partial<SerializedFormGroup> & { fieldNames: string[] }>): StoredFormLayout {
	return {
		tabs: [
			{
				key: 't1',
				label: 'General',
				groups: groups.map((g) => ({ ...g, title: g.title ?? '', columns: g.columns ?? 6 })),
			},
		],
	};
}

const names = (sections: ReturnType<typeof formSections>) => sections.flatMap((s) => s.fields.map((x) => x.name));

describe('formSections', () => {
	it("renders the layout's groups in order, each with its own grid and title", () => {
		const sections = formSections(
			layout([
				{ title: 'Main', columns: 6, fieldNames: ['a', 'b'], fieldSpans: { a: 3, b: 6 } },
				{ title: 'Meta', columns: 2, fieldNames: ['c'] },
			]),
			['a', 'b', 'c'],
			[f('a'), f('b'), f('c')],
		);
		expect(sections.map((s) => [s.title, s.columns, s.spans])).toEqual([
			['Main', 6, [3, 6]],
			['Meta', 2, [1]],
		]);
	});

	it('appends a never-placed field after the last section — half by default, full for a wide type', () => {
		const sections = formSections(
			layout([{ title: 'Main', columns: 6, fieldNames: ['a'] }]),
			['a', 'b', 'note'],
			[f('a'), f('b'), f('note', 'longtext')],
		);
		expect(sections).toHaveLength(1);
		expect(names(sections)).toEqual(['a', 'b', 'note']);
		// `a` is placed but unpositioned (canvas default: 1 column), `b` is appended
		// (form default: half of the 6-grid), `note` is a wide type (full row).
		expect(sections[0].spans).toEqual([1, 3, 6]);
	});

	it('drops a hidden field — from the layout AND from the appended rest', () => {
		const sections = formSections(
			layout([{ title: 'Main', fieldNames: ['a', 'b'] }]),
			['a', 'b', 'c'],
			[f('a'), { ...f('b'), hidden: true }, f('c')],
		);
		expect(names(sections)).toEqual(['a', 'c']);
	});

	it('drops a group left with no fields — and does not re-offer its placements elsewhere', () => {
		const sections = formSections(
			layout([
				{ title: 'A', fieldNames: ['a'] },
				{ title: 'B', fieldNames: ['b'] },
			]),
			['a', 'b'],
			[f('a'), { ...f('b'), hidden: true }],
		);
		expect(sections.map((s) => s.title)).toEqual(['A']);
	});

	it('renders every tab — a field curated into a later tab does not vanish', () => {
		const twoTabs: StoredFormLayout = {
			tabs: [
				{ key: 't1', label: 'One', groups: [{ title: 'A', columns: 6, fieldNames: ['a'] }] },
				{ key: 't2', label: 'Two', groups: [{ title: 'B', columns: 6, fieldNames: ['b'] }] },
			],
		};
		const sections = formSections(twoTabs, ['a', 'b'], [f('a'), f('b')]);
		expect(sections.map((s) => [s.title, s.fields.map((x) => x.name)])).toEqual([
			['A', ['a']],
			['B', ['b']],
		]);
	});

	it('renders a field once when the layout lists it twice — first placement wins', () => {
		const sections = formSections(
			layout([
				{ title: 'A', fieldNames: ['a'] },
				{ title: 'B', fieldNames: ['a'] },
			]),
			['a'],
			[f('a')],
		);
		// The second group is left with nothing to render — and drops, rather than
		// repeating the field it lost at the tail.
		expect(sections.map((s) => [s.title, s.fields.map((x) => x.name)])).toEqual([['A', ['a']]]);
	});

	it('a rule-hidden FIELD drops and its space flows away — spans are flow-resolved', () => {
		const fields: FieldDefinition[] = [f('a'), { ...f('b'), visible_when: { field: 'kind', op: 'eq', value: 'x' } }, f('c')];
		const stored = layout([{ fieldNames: ['a', 'b', 'c'], fieldSpans: { a: 3, b: 3, c: 3 } }]);

		const shown = formSections(stored, ['a', 'b', 'c'], fields, { kind: 'x' });
		expect(names(shown)).toEqual(['a', 'b', 'c']);
		expect(shown[0].spans).toEqual([3, 3, 3]);

		const hidden = formSections(stored, ['a', 'b', 'c'], fields, { kind: 'y' });
		expect(names(hidden)).toEqual(['a', 'c']);
		// `c` needs 3 and 3 are free after `a` — no hole where `b` was.
		expect(hidden[0].spans).toEqual([3, 3]);
	});

	it('a rule-hidden GROUP drops its section, and its fields are consumed — not appended elsewhere', () => {
		const sections = formSections(
			layout([
				{ title: 'Main', fieldNames: ['a'] },
				{ title: 'Secret', fieldNames: ['b'], visible_when: { field: 'kind', op: 'eq', value: 'x' } },
			]),
			['a', 'b'],
			[f('a'), f('b')],
			{ kind: 'y' },
		);
		expect(sections.map((s) => s.title)).toEqual(['Main']);
		// `b` was PLACED (the rule hides the group, not the field) — it must not
		// resurface at the tail as if the layout never knew it.
		expect(names(sections)).toEqual(['a']);
	});

	it('falls back to the ordinary two-column form when no section survives', () => {
		const empty: StoredFormLayout = { tabs: [{ key: 't1', label: 'General', groups: [] }] };
		const sections = formSections(empty, ['a', 'b'], [f('a'), f('b')]);
		expect(sections).toEqual([{ title: '', columns: 2, fields: [f('a'), f('b')], spans: [1, 1] }]);
	});

	it('states the seeded default of an uncurated collection — first 8 at half, the rest appended half', () => {
		const all = Array.from({ length: DEFAULT_FORM_FIELDS + 2 }, (_, i) => `f${i}`);
		const sections = formSections(
			undefined,
			all,
			all.map((n) => f(n)),
		);
		expect(sections).toHaveLength(1);
		expect(sections[0].columns).toBe(6);
		expect(names(sections)).toEqual(all);
		expect(sections[0].spans).toEqual([...Array(DEFAULT_FORM_FIELDS).fill(3), 3, 3]);
	});
});
