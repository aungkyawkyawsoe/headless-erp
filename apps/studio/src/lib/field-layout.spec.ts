/**
 * A field's place on the detail form, resolved through the SAME materializer the
 * layout canvas uses (`tabsFromLayout`) — so "is this field on the form?" and
 * "how wide does it sit?" mean exactly what the canvas means by them, including
 * the seeded default of an uncurated collection. Both writers must round-trip
 * through that reader: what the "⋯" menu writes is what the menu then states.
 *
 * The width rule has one subtlety worth pinning: an UNPLACED field still renders
 * (the form appends it after the layout's groups, lib/form-view), so its state
 * names the width it renders with — half, or full for a wide type — rather than
 * pretending the field has no width at all.
 */
import { describe, expect, it } from 'vitest';
import { fieldLayoutStates, withFieldPlaced, withFieldWidth } from './field-layout';
import { DEFAULT_FORM_FIELDS, type StoredFormLayout } from '../components/formlayout/serialize';
import type { FieldDefinition } from './api';

const field = (name: string, type = 'text'): FieldDefinition => ({ name, type });
const fieldsOf = (...names: string[]): FieldDefinition[] => names.map((name) => field(name));

/** One tab, one group — the shape the layout canvas writes. */
function oneGroup(
	fieldNames: string[],
	over: Partial<{ columns: number; fieldSpans: Record<string, number | 'fill'> }> = {},
): StoredFormLayout {
	return {
		tabs: [
			{
				key: 't1',
				label: 'General',
				groups: [{ title: 'General', columns: over.columns ?? 6, fieldNames, ...(over.fieldSpans ? { fieldSpans: over.fieldSpans } : {}) }],
			},
		],
	};
}

describe('fieldLayoutStates', () => {
	it('states the seeded default of an uncurated collection — first 8 on the form at half width', () => {
		const names = Array.from({ length: DEFAULT_FORM_FIELDS + 2 }, (_, i) => `f${i}`);
		const states = fieldLayoutStates(undefined, names, fieldsOf(...names));
		expect(states.get('f0')).toEqual({ placed: true, hidden: false, width: 'half' });
		expect(states.get(`f${DEFAULT_FORM_FIELDS - 1}`)).toEqual({ placed: true, hidden: false, width: 'half' });
		// Unplaced — but the form still renders it (appended), at its own default.
		expect(states.get(`f${DEFAULT_FORM_FIELDS}`)).toEqual({ placed: false, hidden: false, width: 'half' });
	});

	it('reads the three named widths off the layout, and a custom span as no named width', () => {
		const layout = oneGroup(['a', 'b', 'c', 'd'], { columns: 6, fieldSpans: { a: 3, b: 6, c: 'fill', d: 2 } });
		const states = fieldLayoutStates(layout, ['a', 'b', 'c', 'd'], fieldsOf('a', 'b', 'c', 'd'));
		expect(states.get('a')).toEqual({ placed: true, hidden: false, width: 'half' });
		expect(states.get('b')).toEqual({ placed: true, hidden: false, width: 'full' });
		expect(states.get('c')).toEqual({ placed: true, hidden: false, width: 'fill' });
		expect(states.get('d')).toEqual({ placed: true, hidden: false, width: null });
	});

	it("reads the legacy 'full' width as full", () => {
		const layout: StoredFormLayout = {
			tabs: [{ key: 't1', label: 'General', groups: [{ title: 'G', columns: 6, fieldNames: ['a'], fieldWidths: { a: 'full' } }] }],
		};
		expect(fieldLayoutStates(layout, ['a'], fieldsOf('a')).get('a')).toEqual({ placed: true, hidden: false, width: 'full' });
	});

	it('reports the HIDDEN flag from the field, not the layout — hidden keeps its placement', () => {
		const layout = oneGroup(['a', 'b'], { columns: 6, fieldSpans: { a: 3, b: 3 } });
		const states = fieldLayoutStates(
			layout,
			['a', 'b'],
			[
				{ name: 'a', type: 'text' },
				{ name: 'b', type: 'text', hidden: true },
			],
		);
		expect(states.get('a')).toEqual({ placed: true, hidden: false, width: 'half' });
		// Hiding is a field fact; the layout is the position, restored on show.
		expect(states.get('b')).toEqual({ placed: true, hidden: true, width: 'half' });
	});

	it('reads an unplaced wide type as full — the width the appended field renders with', () => {
		const states = fieldLayoutStates(oneGroup(['a']), ['a', 'notes'], [field('a'), field('notes', 'longtext')]);
		expect(states.get('notes')).toEqual({ placed: false, hidden: false, width: 'full' });
	});
});

describe('withFieldWidth', () => {
	it('sets each named width as a span resolved against the group, clearing any legacy width', () => {
		const half = withFieldWidth(oneGroup(['a'], { columns: 6 }), ['a'], field('a'), 'half');
		expect(half.tabs?.[0].groups?.[0].fieldSpans).toEqual({ a: 3 });

		const full = withFieldWidth(oneGroup(['a'], { columns: 6 }), ['a'], field('a'), 'full');
		expect(full.tabs?.[0].groups?.[0].fieldSpans).toEqual({ a: 6 });

		const fill = withFieldWidth(oneGroup(['a'], { columns: 6 }), ['a'], field('a'), 'fill');
		expect(fill.tabs?.[0].groups?.[0].fieldSpans).toEqual({ a: 'fill' });
	});

	it('round-trips through the reader — what the menu writes is what it then states', () => {
		for (const width of ['half', 'full', 'fill'] as const) {
			const next = withFieldWidth(oneGroup(['a'], { columns: 6 }), ['a'], field('a'), width);
			expect(fieldLayoutStates(next, ['a'], fieldsOf('a')).get('a')).toEqual({ placed: true, hidden: false, width });
		}
	});

	it("resolves half/full against EACH group's own columns — one field, two group sizes", () => {
		const layout: StoredFormLayout = {
			tabs: [
				{
					key: 't1',
					label: 'General',
					groups: [
						{ title: 'Wide', columns: 6, fieldNames: ['a'] },
						{ title: 'Narrow', columns: 2, fieldNames: ['a'] },
					],
				},
			],
		};
		const next = withFieldWidth(layout, ['a'], field('a'), 'half');
		expect(next.tabs?.[0].groups?.[0].fieldSpans).toEqual({ a: 3 });
		expect(next.tabs?.[0].groups?.[1].fieldSpans).toEqual({ a: 1 });
	});

	it('PLACES an unplaced field first — a width for a field the form appends must land in the layout', () => {
		const next = withFieldWidth(oneGroup(['a']), ['a', 'b'], field('b'), 'full');
		expect(next.tabs?.[0].groups?.[0].fieldNames).toEqual(['a', 'b']);
		expect(next.tabs?.[0].groups?.[0].fieldSpans).toEqual({ b: 6 });
		expect(fieldLayoutStates(next, ['a', 'b'], fieldsOf('a', 'b')).get('b')).toEqual({ placed: true, hidden: false, width: 'full' });
	});
});

describe('withFieldPlaced', () => {
	it('is a no-op for a field the layout already carries — showing never re-materializes the seed', () => {
		const layout = oneGroup(['a'], { columns: 6, fieldSpans: { a: 6 } });
		expect(withFieldPlaced(layout, ['a'], field('a'))).toEqual(layout);
	});

	it('puts a field the layout never carried into the group the form opens on — the default tab, not tab one', () => {
		const layout: StoredFormLayout = {
			tabs: [
				{ key: 't1', label: 'General', groups: [{ title: 'G', columns: 6, fieldNames: ['a'] }] },
				{ key: 't2', label: 'Details', groups: [{ title: 'D', columns: 6, fieldNames: ['b'] }] },
			],
			default_tab: 't2',
		};
		const shown = withFieldPlaced(layout, ['a', 'b'], field('c'));
		expect(shown.tabs?.[1].groups?.[0].fieldNames).toEqual(['b', 'c']);
		expect(shown.tabs?.[0].groups?.[0].fieldNames).toEqual(['a']);
	});

	it("keeps a placement's declared span — placing moves a field, it never rewrites its width", () => {
		const layout = oneGroup(['a'], { columns: 6, fieldSpans: { a: 6 } });
		const placed = withFieldPlaced(layout, ['a', 'b'], field('b'));
		expect(fieldLayoutStates(placed, ['a', 'b'], fieldsOf('a', 'b')).get('a')).toEqual({ placed: true, hidden: false, width: 'full' });
	});

	it('is a no-op when there is no group to land in — never invents a form shape', () => {
		const layout: StoredFormLayout = { tabs: [{ key: 't1', label: 'General', groups: [] }] };
		expect(withFieldPlaced(layout, ['a'], field('a'))).toEqual(layout);
	});
});
