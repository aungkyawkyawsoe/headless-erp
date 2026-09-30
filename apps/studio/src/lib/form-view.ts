/**
 * The record form's view of the form layout — which fields render, in which order,
 * and how wide. ONE resolution for both record surfaces (the detail view and the
 * create dialog), so the two forms can never render the same layout differently.
 *
 * The layout is a CURATION, not a whitelist:
 *
 * 1. Fields render as the layout groups them, in layout order (every tab, so a
 *    field curated into a later tab does not silently vanish from a form with no
 *    tab chrome).
 * 2. A field the layout never placed is APPENDED to the last rendered section, in
 *    schema order — a field added after the layout was curated keeps rendering
 *    until someone hides it (that is what `field.hidden` is for).
 * 3. `field.hidden === true` drops the field, and a group left with no fields
 *    drops its section.
 * 4. Linkage rules (`visible_when` on the field OR the group) are evaluated
 *    against the live values, exactly like the inputs evaluate them — a rule-hidden
 *    field neither renders nor occupies grid space, because spans are flow-resolved.
 * 5. Spans come from the SAME flow arithmetic the layout canvas uses (`flowSpans`),
 *    against each group's OWN column count; an appended field reads as an ordinary
 *    half-width form field (full for a wide type), not the canvas's one-of-N
 *    default — the layout never positioned it.
 */
import { flowSpans, halfSpanOf, isWideField, type FieldSpan } from '@mmbix/ui-views';
import { flattenGroups, tabsFromLayout, type StoredFormLayout } from '../components/formlayout/serialize';
import type { FieldDefinition } from './api';
import type { FormGroup } from '../components/formlayout/types';
import { evaluateCondition } from './linkage';

export interface FormSection {
	/** Group title — '' when the group has none. */
	title: string;
	/** The group's grid: every field spans 1..columns of it. */
	columns: number;
	/** The fields this section renders, in render order. */
	fields: FieldDefinition[];
	/** Positional grid span per field (flow-resolved — `fill` is already a count). */
	spans: number[];
	/** Group icon (a name from the builder's icon picker) when the layout declares one. */
	icon?: string;
}

/** The group's column count, clamped the same way every renderer clamps it. */
function colsOf(group: FormGroup): number {
	return Math.max(1, Math.round(group.columns || 2));
}

/**
 * Spans for one section's fields: the layout's own flow for the fields it placed,
 * with never-placed (appended) fields defaulted to the group's half width — or the
 * full width for a wide type — so a field the layout does not position reads like
 * an ordinary form field instead of a one-column sliver of a 6-grid.
 */
function spansOf(group: FormGroup, placed: Set<string>, all: FieldDefinition[]): number[] {
	const cols = colsOf(group);
	const overrides: Record<string, FieldSpan> = {};
	for (const f of all) {
		if (!placed.has(f.name) && !isWideField(f.type)) overrides[f.name] = halfSpanOf(cols);
	}
	const masked = Object.keys(overrides).length ? { ...group, fieldSpans: { ...(group.fieldSpans ?? {}), ...overrides } } : group;
	return flowSpans(masked, all);
}

export function formSections(
	layout: StoredFormLayout | undefined,
	layoutNames: string[],
	candidates: FieldDefinition[],
	values: Record<string, unknown> = {},
): FormSection[] {
	// A field the caller cannot render (non-editable type, system column) or the
	// schema hides is invisible to the walk; the layout keeps its placement, so
	// showing it again restores the position.
	const byName = new Map(candidates.filter((f) => f.hidden !== true).map((f) => [f.name, f]));
	const { tabs } = tabsFromLayout(layout, layoutNames);
	const consumed = new Set<string>();
	// `placed` remembers which names came FROM the layout — the appended rest must
	// not read as placed or `spansOf` would hand it the canvas default instead of
	// the form's half width.
	const rows: Array<{ group: FormGroup; placed: Set<string>; fields: FieldDefinition[] }> = [];

	for (const group of tabs.flatMap((t) => flattenGroups(t.groups))) {
		// First placement wins — one field renders once even if a hand-edited layout
		// lists it in two groups (the menu's width resolution uses the same rule).
		// A field placed ONLY in a rule-hidden group is consumed like any other: the
		// group's condition hides it, it is not "unplaced" and appended elsewhere.
		const placed = group.fieldNames
			.filter((name) => !consumed.has(name) && byName.has(name))
			.map((name) => {
				consumed.add(name);
				return byName.get(name)!;
			});
		if (!evaluateCondition(group.visible_when, values)) continue;
		const fields = placed.filter((f) => evaluateCondition(f.visible_when, values));
		if (fields.length === 0) continue;
		rows.push({ group, placed: new Set(fields.map((f) => f.name)), fields });
	}

	const rest = candidates.filter((f) => f.hidden !== true && !consumed.has(f.name) && evaluateCondition(f.visible_when, values));
	if (rest.length > 0) {
		const last = rows[rows.length - 1];
		if (last) last.fields = [...last.fields, ...rest];
		// No section at all — the layout was emptied out or every rule now hides its
		// group. Render the ordinary two-column form the record views had before
		// layouts existed, so the remaining fields are still reachable.
		else rows.push({ group: { id: '', title: '', columns: 2, fieldNames: [] }, placed: new Set(), fields: rest });
	}

	return rows.map(({ group, placed, fields }) => ({
		title: group.title ?? '',
		columns: colsOf(group),
		fields,
		spans: spansOf(group, placed, fields),
		...(group.icon ? { icon: group.icon } : {}),
	}));
}
