/**
 * The Roles & Access matrix — pure derivations.
 *
 * These pin what the tab shows ON its one table (the tri-state column master
 * toggles + the per-row governance note) and what its two views share: the
 * collections matrix and the app board derive from the SAME tri-state and dirty
 * rules, so the two cannot drift into separate interaction languages.
 */
import { describe, expect, it } from 'vitest';
import type { RolePermission } from './api';
import {
	columnState,
	columnToggleValue,
	dirtyCount,
	emptyPermission,
	fieldLockCount,
	governanceBadges,
	grantedFlagCount,
	hasGrant,
	isPermDirty,
	rowRuleCount,
	sameBoard,
	triState,
} from './role-matrix';

/** A permission row with only the fields under test set. */
function perm(slug: string, over: Partial<RolePermission> = {}): RolePermission {
	return { ...emptyPermission('r1', slug), ...over };
}

const FLAGS = ['can_read', 'can_write', 'can_create', 'can_delete', 'can_approve', 'can_submit'] as const;

describe('emptyPermission', () => {
	it('is a full deny with no restrictions', () => {
		const p = emptyPermission('r1', 'orders');
		expect(p.role_id).toBe('r1');
		expect(p.collection_slug).toBe('orders');
		for (const k of FLAGS) expect(Boolean(p[k])).toBe(false);
		expect(p.field_restrictions).toBeNull();
		expect(p.row_filters).toBeNull();
	});
});

describe('grantedFlagCount / hasGrant', () => {
	it('counts only the flags that are on', () => {
		expect(grantedFlagCount(perm('a'))).toBe(0);
		expect(grantedFlagCount(perm('a', { can_read: true, can_write: true }))).toBe(2);
	});

	it('treats a persisted row as granted even with every flag off (it exists)', () => {
		expect(hasGrant(perm('a', { id: 'p1' }))).toBe(true);
		expect(hasGrant(perm('a'))).toBe(false);
		expect(hasGrant(perm('a', { can_read: true }))).toBe(true);
	});
});

describe('fieldLockCount / rowRuleCount', () => {
	it('reads a whitelist length, and 0 for wide-open or malformed values', () => {
		expect(fieldLockCount(perm('a', { field_restrictions: null }))).toBe(0);
		expect(fieldLockCount(perm('a', { field_restrictions: '*' }))).toBe(0);
		expect(fieldLockCount(perm('a', { field_restrictions: JSON.stringify(['a', 'b', 'c']) }))).toBe(3);
		expect(fieldLockCount(perm('a', { field_restrictions: '{not json' }))).toBe(0);
		// A JSON object (not an array) is not a whitelist.
		expect(fieldLockCount(perm('a', { field_restrictions: JSON.stringify({ a: 1 }) }))).toBe(0);
	});

	it('reads a row-filter condition count, and 0 for absent or malformed values', () => {
		expect(rowRuleCount(perm('a', { row_filters: null }))).toBe(0);
		expect(rowRuleCount(perm('a', { row_filters: JSON.stringify({ conditions: [{}, {}], combiner: 'and' }) }))).toBe(2);
		expect(rowRuleCount(perm('a', { row_filters: JSON.stringify({ combiner: 'and' }) }))).toBe(0);
		expect(rowRuleCount(perm('a', { row_filters: 'nope' }))).toBe(0);
	});
});

describe('triState / columnState', () => {
	it('is none for an empty set, all when every value is on, some in between', () => {
		expect(triState([])).toBe('none');
		expect(triState([false, false])).toBe('none');
		expect(triState([true, true])).toBe('all');
		expect(triState([true, false])).toBe('some');
	});

	it('reads a flag column through that same rule', () => {
		expect(columnState([], 'can_read')).toBe('none');
		expect(columnState([perm('a'), perm('b')], 'can_read')).toBe('none');
		expect(columnState([perm('a', { can_read: true }), perm('b', { can_read: true })], 'can_read')).toBe('all');
		expect(columnState([perm('a', { can_read: true }), perm('b')], 'can_read')).toBe('some');
	});

	it('flips a column to on unless it is already fully on', () => {
		expect(columnToggleValue('none')).toBe(true);
		expect(columnToggleValue('some')).toBe(true);
		expect(columnToggleValue('all')).toBe(false);
	});
});

describe('isPermDirty', () => {
	const baseline = perm('a', { can_read: true, field_restrictions: JSON.stringify(['x']) });

	it('is false when nothing changed', () => {
		expect(isPermDirty({ ...baseline }, baseline)).toBe(false);
	});

	it('is true when a flag flips', () => {
		expect(isPermDirty({ ...baseline, can_write: true }, baseline)).toBe(true);
		expect(isPermDirty({ ...baseline, can_read: false }, baseline)).toBe(true);
	});

	it('is true when a restriction changes, and false for undefined on either side', () => {
		expect(isPermDirty({ ...baseline, field_restrictions: '*' }, baseline)).toBe(true);
		expect(isPermDirty(undefined, baseline)).toBe(false);
		expect(isPermDirty(baseline, undefined)).toBe(false);
	});
});

describe('dirtyCount', () => {
	const rows = [perm('a', { can_read: true }), perm('b'), perm('c', { can_write: true })];
	const baseline = Object.fromEntries(rows.map((r) => [r.collection_slug, { ...r }]));

	it('is 0 when every draft matches its persisted baseline', () => {
		expect(dirtyCount(rows, baseline)).toBe(0);
	});

	it('counts each edited row once, not each edited flag', () => {
		const edited = rows.map((r) => (r.collection_slug === 'c' ? { ...r, can_read: true, can_delete: true } : r));
		expect(dirtyCount(edited, baseline)).toBe(1);
		// Every row diverges from its own baseline → three dirty rows.
		expect(
			dirtyCount(
				rows.map((r) => ({ ...r, can_read: !Boolean(r.can_read) })),
				baseline,
			),
		).toBe(3);
	});

	it('treats a row with no baseline at all as clean (nothing to differ from)', () => {
		const partial = { a: { ...rows[0] } };
		const edited = [{ ...rows[0], can_read: false }, { ...rows[1] }];
		expect(dirtyCount(edited, partial)).toBe(1);
	});
});

describe('sameBoard', () => {
	it('treats `null` as the unrestricted board, which no list ever equals', () => {
		expect(sameBoard(null, null)).toBe(true);
		expect(sameBoard(['a'], null)).toBe(false);
		expect(sameBoard(null, ['a'])).toBe(false);
		// An empty list is NOT unrestricted — it opens nothing.
		expect(sameBoard([], null)).toBe(false);
		expect(sameBoard([], [])).toBe(true);
	});

	it('compares a list as a set, so ordering never reads as an edit', () => {
		expect(sameBoard(['a', 'b'], ['b', 'a'])).toBe(true);
		expect(sameBoard(['a', 'b'], ['a'])).toBe(false);
		expect(sameBoard(['a'], ['a', 'b'])).toBe(false);
	});
});

describe('governanceBadges', () => {
	it('is empty for an unrestricted row and names each restriction otherwise', () => {
		expect(governanceBadges(perm('a'))).toEqual([]);
		expect(governanceBadges(perm('a', { field_restrictions: JSON.stringify(['x']) }))).toEqual(['1 field restricted']);
		expect(governanceBadges(perm('a', { row_filters: JSON.stringify({ conditions: [{}, {}] }) }))).toEqual(['2 row rules']);
		expect(
			governanceBadges(perm('a', { field_restrictions: JSON.stringify(['x', 'y']), row_filters: JSON.stringify({ conditions: [{}] }) })),
		).toEqual(['2 fields restricted', '1 row rule']);
	});
});
