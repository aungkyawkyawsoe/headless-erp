import type { FormGroup, SerializedFormGroup } from './types';

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
