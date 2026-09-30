import type { FormGroup, FormTab } from './types';
import { mapGroups, flattenGroups } from './serialize';

/**
 * Pure tree operations for the form-layout engine — every function maps a
 * `FormTab[]` to a new `FormTab[]` (immutable, no side effects). The provider
 * wraps these with `setTabs` + `markDirty`; being pure makes them unit-testable.
 */

/** Reorder a group up/down within its parent (top-level groups in the tab, nested in their parent). */
export function moveGroup(tabs: FormTab[], gid: string, dir: -1 | 1): FormTab[] {
	return tabs.map((t) => {
		const idx = t.groups.findIndex((g) => g.id === gid);
		if (idx >= 0) {
			const target = idx + dir;
			if (target < 0 || target >= t.groups.length) return t;
			const next = [...t.groups];
			[next[idx], next[target]] = [next[target], next[idx]];
			return { ...t, groups: next };
		}
		return {
			...t,
			groups: mapGroups(t.groups, (g) => {
				const subs = g.groups ?? [];
				const i2 = subs.findIndex((sg) => sg.id === gid);
				if (i2 < 0) return g;
				const target2 = i2 + dir;
				if (target2 < 0 || target2 >= subs.length) return g;
				const next2 = [...subs];
				[next2[i2], next2[target2]] = [next2[target2], next2[i2]];
				return { ...g, groups: next2 };
			}),
		};
	});
}

/** Delete a group (and its sub-groups) wherever it lives. */
export function removeGroup(tabs: FormTab[], gid: string): FormTab[] {
	return tabs.map((t) => {
		const idx = t.groups.findIndex((g) => g.id === gid);
		if (idx >= 0) return { ...t, groups: t.groups.filter((g) => g.id !== gid) };
		return {
			...t,
			groups: mapGroups(t.groups, (g) => {
				const subs = g.groups ?? [];
				if (!subs.some((sg) => sg.id === gid)) return g;
				const rest = subs.filter((sg) => sg.id !== gid);
				return { ...g, groups: rest.length ? rest : undefined };
			}),
		};
	});
}

/** Move a sub-group out of its parent — re-insert it right after its top-level ancestor. */
export function promoteGroup(tabs: FormTab[], gid: string): FormTab[] {
	return tabs.map((t) => {
		const all = flattenGroups(t.groups);
		const node = all.find((g) => g.id === gid);
		if (!node) return t;
		// Already top-level? Nothing to promote.
		if (t.groups.some((g) => g.id === gid)) return t;
		// Find the top-level root this subtree hangs under.
		let ancestor: FormGroup | null = null;
		const walk = (gs: FormGroup[], root: FormGroup) => {
			for (const g of gs) {
				if (g.id === gid) {
					ancestor = root;
					return;
				}
				if (g.groups?.length) walk(g.groups, g);
			}
		};
		for (const root of t.groups) walk([root], root);
		// Remove the node everywhere, then re-insert right after its ancestor.
		const cleanedTop = t.groups.filter((g) => g.id !== gid);
		const cleaned = mapGroups(cleanedTop, (g) => {
			const subs = (g.groups ?? []).filter((sg) => sg.id !== gid);
			return subs.length === (g.groups ?? []).length ? g : { ...g, groups: subs.length ? subs : undefined };
		});
		const anchorIdx = cleaned.findIndex((g) => g.id === (ancestor?.id ?? ''));
		if (anchorIdx < 0) return t;
		const next = [...cleaned];
		next.splice(anchorIdx + 1, 0, node);
		return { ...t, groups: next };
	});
}

/** Move a group to become a child of another group (nesting) — same tab, no cycles. */
export function moveGroupUnder(tabs: FormTab[], gid: string, targetGid: string): FormTab[] {
	if (gid === targetGid) return tabs;
	const all = tabs.flatMap((t) => flattenGroups(t.groups));
	const node = all.find((g) => g.id === gid);
	if (!node) return tabs;
	// A group can't be nested under itself or one of its own descendants.
	const subtree = new Set<string>();
	const collect = (gs: FormGroup[]) => {
		for (const g of gs) {
			subtree.add(g.id);
			if (g.groups?.length) collect(g.groups);
		}
	};
	collect(node.groups ?? []);
	if (subtree.has(targetGid)) return tabs;
	return tabs.map((t) => {
		if (!flattenGroups(t.groups).some((g) => g.id === targetGid)) return t;
		const cleanedTop = t.groups.filter((g) => g.id !== gid);
		const cleaned = mapGroups(cleanedTop, (g) => {
			const subs = (g.groups ?? []).filter((sg) => sg.id !== gid);
			return subs.length === (g.groups ?? []).length ? g : { ...g, groups: subs.length ? subs : undefined };
		});
		return {
			...t,
			groups: mapGroups(cleaned, (g) => (g.id === targetGid ? { ...g, groups: [...(g.groups ?? []), node] } : g)),
		};
	});
}

/** Move a field into a group — remove it from wherever it currently lives (palette click, drag). */
export function addFieldToGroup(tabs: FormTab[], name: string, groupId: string): FormTab[] {
	return tabs.map((t) => ({
		...t,
		groups: mapGroups(t.groups, (g) => {
			if (g.id === groupId) {
				if (g.fieldNames.includes(name)) return g; // already here — keep its position
				return { ...g, fieldNames: [...g.fieldNames, name] };
			}
			const without = g.fieldNames.filter((n) => n !== name);
			return without.length === g.fieldNames.length ? g : { ...g, fieldNames: without };
		}),
	}));
}

/** Set a field's grid width inside its group — 'full' spans all columns; 'half' is the default (omit). */
export function setFieldWidth(tabs: FormTab[], name: string, width: 'half' | 'full'): FormTab[] {
	return tabs.map((t) => ({
		...t,
		groups: mapGroups(t.groups, (g) => {
			if (!g.fieldNames.includes(name)) return g;
			const fw = { ...(g.fieldWidths ?? {}) };
			if (width === 'full') fw[name] = 'full';
			else delete fw[name];
			return { ...g, fieldWidths: fw };
		}),
	}));
}

/** Set a field's grid span (1..group.columns) — stored explicitly, clears any legacy 'full' width. */
export function setFieldSpan(tabs: FormTab[], name: string, span: number): FormTab[] {
	return tabs.map((t) => ({
		...t,
		groups: mapGroups(t.groups, (g) => {
			if (!g.fieldNames.includes(name)) return g;
			const sp = { ...(g.fieldSpans ?? {}) };
			sp[name] = Math.max(1, Math.round(span));
			const fw = { ...(g.fieldWidths ?? {}) };
			delete fw[name];
			return { ...g, fieldSpans: sp, fieldWidths: Object.keys(fw).length ? fw : undefined };
		}),
	}));
}

/** Swap two fields' positions inside the group that contains `name`. */
export function swapFields(tabs: FormTab[], name: string, other: string): FormTab[] {
	return tabs.map((t) => ({
		...t,
		groups: mapGroups(t.groups, (g) => {
			if (!g.fieldNames.includes(name)) return g;
			const i = g.fieldNames.indexOf(name);
			const j = g.fieldNames.indexOf(other);
			if (i < 0 || j < 0) return g;
			const next = [...g.fieldNames];
			[next[i], next[j]] = [next[j], next[i]];
			return { ...g, fieldNames: next };
		}),
	}));
}

/** Move a field up/down within its group. */
export function moveField(tabs: FormTab[], name: string, dir: -1 | 1): FormTab[] {
	return tabs.map((t) => ({
		...t,
		groups: mapGroups(t.groups, (g) => {
			const idx = g.fieldNames.indexOf(name);
			if (idx < 0) return g;
			const target = idx + dir;
			if (target < 0 || target >= g.fieldNames.length) return g;
			const next = [...g.fieldNames];
			[next[idx], next[target]] = [next[target], next[idx]];
			return { ...g, fieldNames: next };
		}),
	}));
}

/** Remove a field from every group's layout (the field itself is untouched). */
export function removeFieldFromLayout(tabs: FormTab[], name: string): FormTab[] {
	return tabs.map((t) => ({
		...t,
		groups: mapGroups(t.groups, (g) => ({ ...g, fieldNames: g.fieldNames.filter((n) => n !== name) })),
	}));
}
