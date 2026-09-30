import type { FormGroup, FormTab, SerializedFormGroup, SerializedFormLayout } from './types';

/* ── Group-tree helpers (nested groups: a group may contain sub-groups) ── */

/** Width-shortcut → target grid span: plain N → N, Shift+N → 2N (doubled),
 *  Alt+Shift+N → N (single). Mirrors the block canvas. Returns null when the
 *  key isn't a width shortcut (modifier combos excluded). Matches the number
 *  ROW and the NUMPAD via e.code (Shift+1 reports e.key '!'). */
export function spanShortcut(e: {
	key: string;
	code: string;
	shiftKey: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
}): number | null {
	if (e.ctrlKey || e.metaKey) return null;
	if (!e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) return Number(e.key);
	const m = /^(Digit|Numpad)([1-9])$/.exec(e.code);
	if (!m) return null;
	const n = Number(m[2]);
	if (e.shiftKey && !e.altKey) return n * 2;
	if (e.shiftKey && e.altKey) return n;
	return null;
}

/** Deep-map every group in a tree (recursive). */
export function mapGroups(groups: FormGroup[], fn: (g: FormGroup) => FormGroup): FormGroup[] {
	return groups.map((g) => {
		const mapped = fn(g);
		return { ...mapped, groups: mapped.groups?.length ? mapGroups(mapped.groups, fn) : mapped.groups };
	});
}

/** Flatten all groups in a tree into one list (recursive). */
export function flattenGroups(groups: FormGroup[]): FormGroup[] {
	return groups.flatMap((g) => [g, ...flattenGroups(g.groups ?? [])]);
}

/** Serialize a group tree for storage (ids are runtime-only). */
export function serGroups(gs: FormGroup[]): SerializedFormGroup[] {
	return gs.map((g) => ({
		title: g.title,
		columns: g.columns,
		fieldNames: g.fieldNames,
		...(Object.keys(g.fieldWidths ?? {}).length ? { fieldWidths: g.fieldWidths } : {}),
		...(g.fieldSpans && Object.keys(g.fieldSpans).length ? { fieldSpans: g.fieldSpans } : {}),
		...(g.icon ? { icon: g.icon } : {}),
		...(g.visible_when ? { visible_when: g.visible_when } : {}),
		...(g.groups?.length ? { groups: serGroups(g.groups) } : {}),
	}));
}

/** Parse a persisted group tree into runtime groups (unique ids). */
export function parseGroups(gs: SerializedFormGroup[], prefix: string): FormGroup[] {
	return gs.map((g, gi) => ({
		id: `${prefix}-${gi}`,
		title: g.title ?? '',
		columns: g.columns ?? 2,
		fieldNames: g.fieldNames ?? [],
		fieldWidths: g.fieldWidths ?? {},
		...(g.fieldSpans && Object.keys(g.fieldSpans).length ? { fieldSpans: g.fieldSpans } : {}),
		...(g.icon ? { icon: g.icon } : {}),
		...(g.visible_when ? { visible_when: g.visible_when } : {}),
		...(g.groups?.length ? { groups: parseGroups(g.groups, `${prefix}-${gi}`) } : {}),
	}));
}

/* ── Layout (de)serialization — tabs ↔ the persisted form_layout ── */

/** The persisted `form_layout` as it appears inside `schema_json`: the current
 *  `tabs` shape, or the legacy flat `groups`, plus the form-level default tab. */
export interface StoredFormLayout {
	tabs?: Array<{ key?: string; label?: string; groups?: SerializedFormGroup[] }>;
	groups?: SerializedFormGroup[];
	default_tab?: string;
}

/** Uncurated forms (no saved form_layout) seed this many user fields into the
 *  General group — mirroring the table (DEFAULT_LIST_COLUMNS) and card
 *  (DEFAULT_CARD_FIELDS) defaults so a fresh form doesn't dump every collection
 *  field. The rest stay one click away in the palette. */
export const DEFAULT_FORM_FIELDS = 8;

/** Serialize the whole layout (tabs → serialized groups) for storage. */
export function serializeLayout(tabs: FormTab[], defaultTabId: string | null): SerializedFormLayout {
	return {
		tabs: tabs.map((t) => ({ key: t.id, label: t.label, groups: serGroups(t.groups) })),
		...(defaultTabId ? { default_tab: defaultTabId } : {}),
	};
}

/** Turn persisted tabs into runtime tabs — ids are runtime-only, generated from
 *  `idPrefix` unless the stored tab carries its own key. */
export function tabsFromSerialized(
	serialized: Array<{ key?: string; label?: string; groups?: SerializedFormGroup[] }>,
	idPrefix: (ti: number) => string,
): FormTab[] {
	return serialized.map((t, ti) => {
		const prefix = idPrefix(ti);
		return { id: t.key || prefix, label: t.label || `Tab ${ti + 1}`, groups: parseGroups(t.groups ?? [], prefix) };
	});
}

/** Materialize the tabs (+ default tab) from a persisted form_layout, falling back
 *  to the legacy flat `groups` or a seeded single General tab so old collections
 *  keep working. Pure — the caller owns the I/O and state writes. */
export function tabsFromLayout(
	layout: StoredFormLayout | undefined,
	userNames: string[],
): { tabs: FormTab[]; defaultTabId: string | null } {
	const fromTabs = layout?.tabs;
	const legacyGroups = layout?.groups ?? [];
	let next: FormTab[] = [];
	if (fromTabs && fromTabs.length > 0) {
		next = tabsFromSerialized(fromTabs, (ti) => `t${ti}`);
	} else if (legacyGroups.length > 0) {
		next = [{ id: 't1', label: 'General', groups: parseGroups(legacyGroups, 'g') }];
	} else {
		const seeded = userNames.slice(0, DEFAULT_FORM_FIELDS);
		next = [
			{
				id: 't1',
				label: 'General',
				groups: [
					{
						id: 'g1',
						title: 'General',
						columns: 6,
						fieldNames: seeded,
						// Half-width default on the 6-grid (2 per row) — the width shortcuts
						// (Shift+1 → 2/6, Shift+2 → 4/6, Shift+3 → full) fine-tune it.
						fieldSpans: Object.fromEntries(seeded.map((n) => [n, 3])),
						fieldWidths: {},
					},
				],
			},
		];
	}
	// Form-level default tab: honor form_layout.default_tab when it still exists.
	const storedDefault = layout?.default_tab ?? null;
	const validDefault = storedDefault && next.some((t) => t.id === storedDefault) ? storedDefault : null;
	return { tabs: next, defaultTabId: validDefault };
}

/** Drop field names the collection no longer has (and groups left empty) — used
 *  when a layout arrives from the clipboard or an imported model file. Recursive. */
export function trimGroupsToFields(groups: SerializedFormGroup[], known: Set<string>): SerializedFormGroup[] {
	return groups
		.map((g) => ({
			...g,
			fieldNames: (g.fieldNames ?? []).filter((n) => known.has(n)),
			groups: g.groups?.length ? trimGroupsToFields(g.groups, known) : undefined,
		}))
		.filter((g) => g.fieldNames.length > 0 || (g.groups?.length ?? 0) > 0);
}
