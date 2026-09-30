/**
 * Role/access matrix — the pure logic behind the Roles & Access tab.
 *
 * The tab renders TWO tables in one shape, switched by the button group in the
 * table's label area: the per-collection permission matrix (one row per
 * collection, one column per flag) and the role's app board (one row per app,
 * one Open column). Everything numeric or conditional in either view is derived
 * HERE so it can be tested without a DOM — the component only renders it.
 *
 * Design notes:
 *   • The six flags are the engine's `_role_permissions` columns; they live here so
 *     the header and the payload can never drift into two lists.
 *   • `field_restrictions` is a JSON whitelist ('*' / null = every field visible);
 *     `row_filters` is a JSON `{ conditions, combiner }`. Both are stored as opaque
 *     strings, so every read parses defensively — a malformed value is "no rule",
 *     never a thrown render.
 *   • The app board is the role's `app_access` — ONE field, so it diffs as a whole
 *     (`sameBoard`) rather than per row, unlike the per-collection rows.
 */
import type { RolePermission } from './api';

/** The record-access flags on a `_role_permissions` row, in matrix column order. */
export const FLAG_KEYS = ['can_read', 'can_write', 'can_create', 'can_delete', 'can_approve', 'can_submit'] as const;
export type FlagKey = (typeof FLAG_KEYS)[number];

/** Column headers — engine truth, titled for a dense header row. */
export const FLAG_LABEL: Record<FlagKey, string> = {
	can_read: 'Read',
	can_write: 'Write',
	can_create: 'Create',
	can_delete: 'Delete',
	can_approve: 'Approve',
	can_submit: 'Submit',
};

/** A brand-new (deny) permission draft for a role + collection pair. */
export function emptyPermission(roleId: string, slug: string): RolePermission {
	return {
		id: '',
		role_id: roleId,
		collection_slug: slug,
		can_read: false,
		can_write: false,
		can_create: false,
		can_delete: false,
		can_approve: false,
		can_submit: false,
		field_restrictions: null,
		row_filters: null,
	};
}

/** How many of the six flags are on. */
export function grantedFlagCount(p: RolePermission): number {
	let n = 0;
	for (const k of FLAG_KEYS) if (Boolean(p[k])) n++;
	return n;
}

/** Does the row grant anything at all? */
export function hasGrant(p: RolePermission): boolean {
	return Boolean(p.id) || grantedFlagCount(p) > 0;
}

/** The number of fields in the row's whitelist (0 when every field is visible). */
export function fieldLockCount(p: RolePermission): number {
	const raw = p.field_restrictions;
	if (!raw || raw === '*') return 0;
	try {
		const arr = JSON.parse(raw) as unknown;
		return Array.isArray(arr) ? arr.length : 0;
	} catch {
		return 0;
	}
}

/** The number of row-level conditions in the row's filter (0 when none). */
export function rowRuleCount(p: RolePermission): number {
	const raw = p.row_filters;
	if (!raw) return 0;
	try {
		const parsed = JSON.parse(raw) as { conditions?: unknown } | null;
		const conds = parsed && typeof parsed === 'object' && Array.isArray(parsed.conditions) ? parsed.conditions : [];
		return conds.length;
	} catch {
		return 0;
	}
}

/**
 * The per-flag state of a column across the rows on screen — the tri-state a
 * master checkbox shows. Computed over the VISIBLE rows so "toggle all" acts on
 * exactly what the operator filtered to.
 */
export type ColumnState = 'all' | 'some' | 'none';

/** The tri-state of a boolean column, in column order (the one rule for both tables). */
export function triState(values: readonly boolean[]): ColumnState {
	if (values.length === 0) return 'none';
	let on = 0;
	for (const v of values) if (v) on++;
	if (on === 0) return 'none';
	return on === values.length ? 'all' : 'some';
}

export function columnState(perms: readonly RolePermission[], flag: FlagKey): ColumnState {
	return triState(perms.map((p) => Boolean(p[flag])));
}

/** The value a master toggle should write: flip to on unless the column is already fully on. */
export function columnToggleValue(state: ColumnState): boolean {
	return state !== 'all';
}

/** A draft differs from its persisted baseline (any flag or either restriction). */
export function isPermDirty(draft: RolePermission | undefined, baseline: RolePermission | undefined): boolean {
	if (!draft || !baseline) return false;
	for (const k of FLAG_KEYS) if (Boolean(draft[k]) !== Boolean(baseline[k])) return true;
	return (
		normalize(draft.field_restrictions) !== normalize(baseline.field_restrictions) ||
		normalize(draft.row_filters) !== normalize(baseline.row_filters)
	);
}

function normalize(v: string | null | undefined): string {
	return v ?? '';
}

/** How many rows carry unsaved edits (draft ≠ the persisted baseline). O(rows). */
export function dirtyCount(perms: readonly RolePermission[], baseline: Record<string, RolePermission>): number {
	let n = 0;
	for (const p of perms) if (isPermDirty(p, baseline[p.collection_slug])) n++;
	return n;
}

/**
 * Is the app board the same as the persisted one? `null` is the unrestricted
 * board (every app) and a list is exactly those app ids; order is irrelevant.
 * `null` never equals a list, because the unrestricted board also covers apps
 * that do not exist yet.
 */
export function sameBoard(a: readonly string[] | null, b: readonly string[] | null): boolean {
	if (a === null || b === null) return a === b;
	if (a.length !== b.length) return false;
	const set = new Set(a);
	return b.every((id) => set.has(id));
}

/** The governance note shown per row — the "Attributes & RLS" column. */
export function governanceBadges(p: RolePermission): string[] {
	const badges: string[] = [];
	const fields = fieldLockCount(p);
	if (fields > 0) badges.push(`${fields} field${fields === 1 ? '' : 's'} restricted`);
	const rules = rowRuleCount(p);
	if (rules > 0) badges.push(`${rules} row rule${rules === 1 ? '' : 's'}`);
	return badges;
}
