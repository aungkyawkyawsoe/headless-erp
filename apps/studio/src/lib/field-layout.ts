/**
 * A schema field's place on the detail form, for the field "⋯" menu: whether it is
 * on the form at all, and the width it sits at there.
 *
 * Directus keeps those two facts in the field's own meta (`width` / `hidden`); this
 * Studio keeps them in the form LAYOUT — the one thing that decides what the detail
 * form renders — so the menu's entries are a pure projection over that layout rather
 * than a second copy of the state that could drift from what the form shows.
 *
 * Both directions go through the SAME materializer the layout canvas uses
 * (`tabsFromLayout`), so "is this field on the form?" means exactly what the canvas
 * means by it — including the seeded default of an uncurated collection.
 */
import { fieldSpanOf, halfSpanOf, isTextareaField } from '@mmbix/ui-views';
import { flattenGroups, serializeLayout, tabsFromLayout, type StoredFormLayout } from '../components/formlayout/serialize';
import { addFieldToGroup, applyFieldWidth, removeFieldFromLayout } from '../components/formlayout/tree-ops';
import type { FieldWidth, FormGroup } from '../components/formlayout/types';
import type { FieldDefinition } from './api';

export interface FieldLayoutState {
	/** The field is placed in at least one group of the form. */
	placed: boolean;
	/** The width the form renders it with — null when that is not one of the named widths. */
	width: FieldWidth | null;
}

/** The width a group renders a placed field with, named — or null for a custom span. */
function widthOf(group: FormGroup, field: FieldDefinition): FieldWidth | null {
	const cols = Math.max(1, group.columns || 2);
	const declared = fieldSpanOf(group, field.name, isTextareaField(field.type));
	if (declared === 'fill') return 'fill';
	if (declared >= cols) return 'full';
	return declared === halfSpanOf(cols) ? 'half' : null;
}

/** Resolve every field's place on the form in ONE pass over the layout. */
export function fieldLayoutStates(
	layout: StoredFormLayout | undefined,
	userNames: string[],
	fields: FieldDefinition[],
): Map<string, FieldLayoutState> {
	const { tabs } = tabsFromLayout(layout, userNames);
	// A field may be placed more than once; the FIRST placement states its width,
	// matching the "applies to every placement at once" rule of the writers below.
	const groupOf = new Map<string, FormGroup>();
	for (const group of tabs.flatMap((t) => flattenGroups(t.groups))) {
		for (const name of group.fieldNames) if (!groupOf.has(name)) groupOf.set(name, group);
	}
	return new Map(
		fields.map((field) => {
			const group = groupOf.get(field.name);
			return [field.name, group ? { placed: true, width: widthOf(group, field) } : { placed: false, width: null }];
		}),
	);
}

/** The group a re-shown field lands in: the first one of the tab the form opens on. */
function landingGroup(tabs: ReturnType<typeof tabsFromLayout>['tabs'], defaultTabId: string | null): FormGroup | null {
	const tab = tabs.find((t) => t.id === defaultTabId) ?? tabs[0];
	return tab?.groups[0] ?? null;
}

/** The layout with `field` set to one of the three named widths, wherever it is placed. */
export function withFieldWidth(
	layout: StoredFormLayout | undefined,
	userNames: string[],
	field: FieldDefinition,
	width: FieldWidth,
): ReturnType<typeof serializeLayout> {
	const { tabs, defaultTabId } = tabsFromLayout(layout, userNames);
	return serializeLayout(applyFieldWidth(tabs, field.name, width), defaultTabId);
}

/** The layout with `field` put on the detail form (into the tab the form opens on) or
 *  taken off it (removed from every group — the field itself is untouched). */
export function withFieldPlaced(
	layout: StoredFormLayout | undefined,
	userNames: string[],
	field: FieldDefinition,
	placed: boolean,
): ReturnType<typeof serializeLayout> {
	const { tabs, defaultTabId } = tabsFromLayout(layout, userNames);
	if (!placed) return serializeLayout(removeFieldFromLayout(tabs, field.name), defaultTabId);
	const group = landingGroup(tabs, defaultTabId);
	if (!group) return serializeLayout(tabs, defaultTabId);
	return serializeLayout(addFieldToGroup(tabs, field.name, group.id), defaultTabId);
}
