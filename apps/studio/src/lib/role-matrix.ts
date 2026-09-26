/**
 * Role/access matrix — the pure logic behind the Roles & Access tab.
 *
 * The tab renders a per-collection permission matrix (one row per collection, one
 * column per flag) plus a governance summary. Everything numeric or conditional in
 * that view is derived HERE so it can be tested without a DOM — the component only
 * renders it.
 *
 * Design notes:
 *   • The six flags are the engine's `_role_permissions` columns; they live here so
 *     the header, the summary and the payload can never drift into three lists.
 *   • `field_restrictions` is a JSON whitelist ('*' / null = every field visible);
 *     `row_filters` is a JSON `{ conditions, combiner }`. Both are stored as opaque
 *     strings, so every read parses defensively — a malformed value is "no rule",
 *     never a thrown render.
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

/** Governance summary for the matrix — the tiles above the table. */
export interface MatrixStats {
	/** Collections in the library. */
	total: number;
	/** Collections with at least one flag on. */
	granted: number;
	/** Total flag ticks across every row. */
	flags: number;
	/** Collections carrying at least one row-level condition. */
	rowRules: number;
	/** Collections carrying a field whitelist. */
	fieldLocks: number;
	/** Collections with at least one unsaved edit (drafts differing from baseline). */
	dirty: number;
}

/**
 * The per-flag state of a column across the rows on screen — the tri-state a
 * master checkbox shows. Computed over the VISIBLE rows so "toggle all" acts on
 * exactly what the operator filtered to.
 */
export type ColumnState = 'all' | 'some' | 'none';

export function columnState(perms: readonly RolePermission[], flag: FlagKey): ColumnState {
	if (perms.length === 0) return 'none';
	let on = 0;
	for (const p of perms) if (Boolean(p[flag])) on++;
	if (on === 0) return 'none';
	return on === perms.length ? 'all' : 'some';
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

/**
 * Derive the whole summary in ONE pass over the library (O(collections)), given the
 * drafts and the baseline they are compared against.
 */
export function matrixStats(perms: readonly RolePermission[], baseline: Record<string, RolePermission>): MatrixStats {
	const stats: MatrixStats = { total: perms.length, granted: 0, flags: 0, rowRules: 0, fieldLocks: 0, dirty: 0 };
	for (const p of perms) {
		const flagCount = grantedFlagCount(p);
		if (flagCount > 0) stats.granted++;
		stats.flags += flagCount;
		if (rowRuleCount(p) > 0) stats.rowRules++;
		if (fieldLockCount(p) > 0) stats.fieldLocks++;
		if (isPermDirty(p, baseline[p.collection_slug])) stats.dirty++;
	}
	return stats;
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
