/**
 * A schema field's place on the detail form, for the field "⋯" menu: whether it
 * renders there, and the width it sits at.
 *
 * Directus keeps both facts in the field's own meta (`hidden` / `width`). This
 * Studio keeps the WIDTH in the form layout — the one thing that decides what the
 * detail form renders — and the HIDDEN flag on the field definition itself: "the
 * layout never placed it" and "someone hid it" are different states (a field added
 * after the layout was curated must render until it is hidden), and only a
 * field-level flag can tell them apart.
 *
 * Both the state and the writers go through the SAME materializer the layout canvas
 * uses (`tabsFromLayout`), so the menu, the canvas and the rendered form can never
 * disagree — including the seeded default of an uncurated collection.
 */
import { fieldSpanOf, halfSpanOf, isWideField } from '@mmbix/ui-views';
import { flattenGroups, serializeLayout, tabsFromLayout, type StoredFormLayout } from '../components/formlayout/serialize';
import { addFieldToGroup, applyFieldWidth } from '../components/formlayout/tree-ops';
import type { FieldWidth, FormGroup, FormTab } from '../components/formlayout/types';
import type { FieldDefinition } from './api';

export interface FieldLayoutState {
	/** The field sits in at least one group of the layout. */
	placed: boolean;
	/** The field is explicitly hidden from the form (the menu's Hide entry). */
	hidden: boolean;
	/** The width the form renders it with — null only for a custom span. */
	width: FieldWidth | null;
}

/** The width a group renders a placed field with, named — or null for a custom span. */
function widthOf(group: FormGroup, field: FieldDefinition): FieldWidth | null {
	const cols = Math.max(1, group.columns || 2);
	const declared = fieldSpanOf(group, field.name, isWideField(field.type));
	if (declared === 'fill') return 'fill';
	if (declared >= cols) return 'full';
	return declared === halfSpanOf(cols) ? 'half' : null;
}

/** The field is placed somewhere in the layout. */
function isPlaced(tabs: FormTab[], name: string): boolean {
	return tabs.some((t) => flattenGroups(t.groups).some((g) => g.fieldNames.includes(name)));
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
			return [
				field.name,
				{
					placed: !!group,
					hidden: field.hidden === true,
					// An unplaced field still RENDERS — the form appends it after the
					// layout's own groups (lib/form-view) — at the form's own default:
					// half, or full for a wide type. That IS the width it renders with,
					// so it is what the menu's width entries compare against.
					width: group ? widthOf(group, field) : isWideField(field.type) ? 'full' : 'half',
				},
			];
		}),
	);
}

/** The group a field the layout does not carry lands in: the first one of the tab the form opens on. */
function landingGroup(tabs: FormTab[], defaultTabId: string | null): FormGroup | null {
	const tab = tabs.find((t) => t.id === defaultTabId) ?? tabs[0];
	return tab?.groups[0] ?? null;
}

/**
 * The layout with `field` placed on the form — the SHOW half of the menu's
 * Hide/Show entry, used when the layout does not carry the field: showing a field
 * the layout never placed must actually place it, or the entry would flip a flag
 * nothing renders. Already placed ⇒ the layout comes back unchanged.
 */
export function withFieldPlaced(
	layout: StoredFormLayout | undefined,
	userNames: string[],
	field: FieldDefinition,
): ReturnType<typeof serializeLayout> {
	const { tabs, defaultTabId } = tabsFromLayout(layout, userNames);
	if (isPlaced(tabs, field.name)) return serializeLayout(tabs, defaultTabId);
	const group = landingGroup(tabs, defaultTabId);
	if (!group) return serializeLayout(tabs, defaultTabId);
	return serializeLayout(addFieldToGroup(tabs, field.name, group.id), defaultTabId);
}

/**
 * The layout with `field` set to one of the three named widths. A width for a
 * field that renders nowhere has nothing to set (Poka-Yoke), so the pick PLACES
 * an unplaced field first, then applies the width to every group that holds it.
 */
export function withFieldWidth(
	layout: StoredFormLayout | undefined,
	userNames: string[],
	field: FieldDefinition,
	width: FieldWidth,
): ReturnType<typeof serializeLayout> {
	const { tabs, defaultTabId } = tabsFromLayout(layout, userNames);
	let next = tabs;
	if (!isPlaced(next, field.name)) {
		const group = landingGroup(next, defaultTabId);
		if (!group) return serializeLayout(next, defaultTabId);
		next = addFieldToGroup(next, field.name, group.id);
	}
	return serializeLayout(applyFieldWidth(next, field.name, width), defaultTabId);
}
