// @vitest-environment jsdom
/**
 * Relation display preferences — the per-collection "which field of the related
 * row does this relation column show?" pick and "which related fields get a
 * column of their own?" toggles. Storage + the pickable-field rule only; WHICH
 * field a pick resolves to (and the stale-pick fallback) is pinned in
 * collection-table-filters.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	loadRelationColumns,
	loadRelationLeaves,
	saveRelationColumns,
	saveRelationLeaves,
	selectableDisplayFields,
	withRelationColumn,
	withRelationLeaf,
} from './relation-display';
import type { FieldDefinition } from './api';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('withRelationLeaf', () => {
	it('sets a pick without mutating the input', () => {
		const before = { department: 'name_mm' };
		expect(withRelationLeaf(before, 'owner', 'full_name')).toEqual({ department: 'name_mm', owner: 'full_name' });
		expect(before).toEqual({ department: 'name_mm' });
	});

	it('clears a pick with null and leaves the rest alone', () => {
		expect(withRelationLeaf({ a: 'x', b: 'y' }, 'a', null)).toEqual({ b: 'y' });
	});
});

describe('relation display storage', () => {
	it('round-trips picks per collection', () => {
		saveRelationLeaves('orders', { customer: 'name_en' });
		expect(loadRelationLeaves('orders')).toEqual({ customer: 'name_en' });
		// The pick belongs to the column, not the app: another collection starts clean.
		expect(loadRelationLeaves('invoices')).toEqual({});
	});

	it('removes the entry when the last pick is cleared', () => {
		saveRelationLeaves('orders', { customer: 'name_en' });
		saveRelationLeaves('orders', {});
		expect(loadRelationLeaves('orders')).toEqual({});
		expect(localStorage.getItem('studio-relation-display:orders')).toBeNull();
	});

	it('degrades to {} on corrupt JSON or an unusable entry', () => {
		localStorage.setItem('studio-relation-display:orders', '{not json');
		expect(loadRelationLeaves('orders')).toEqual({});
		localStorage.setItem('studio-relation-display:orders', JSON.stringify({ a: 7, b: '', c: 'name_mm' }));
		expect(loadRelationLeaves('orders')).toEqual({ c: 'name_mm' });
		expect(loadRelationLeaves(null)).toEqual({});
	});

	it('never throws when storage is blocked (private mode)', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(loadRelationLeaves('orders')).toEqual({});
		vi.restoreAllMocks();
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(() => saveRelationLeaves('orders', { a: 'b' })).not.toThrow();
	});
});

describe('withRelationColumn', () => {
	it('adds a related field as a column of its own without mutating the input', () => {
		const before = { department: ['code'] };
		expect(withRelationColumn(before, 'department', 'name_en', true)).toEqual({ department: ['code', 'name_en'] });
		expect(withRelationColumn({}, 'department', 'code', true)).toEqual({ department: ['code'] });
		expect(before).toEqual({ department: ['code'] });
	});

	it('is a no-op when the column is already on, and removes it with `on: false`', () => {
		expect(withRelationColumn({ department: ['code'] }, 'department', 'code', true)).toEqual({ department: ['code'] });
		expect(withRelationColumn({ department: ['code', 'name_en'] }, 'department', 'code', false)).toEqual({ department: ['name_en'] });
	});

	it('drops the relation entry when its last column is removed', () => {
		expect(withRelationColumn({ department: ['code'], owner: ['full_name'] }, 'department', 'code', false)).toEqual({
			owner: ['full_name'],
		});
	});
});

describe('relation column storage', () => {
	it('round-trips the toggled columns per collection', () => {
		saveRelationColumns('employees', { department: ['code', 'name_en'] });
		expect(loadRelationColumns('employees')).toEqual({ department: ['code', 'name_en'] });
		// The columns belong to the focused collection: another one starts clean.
		expect(loadRelationColumns('orders')).toEqual({});
	});

	it('removes the entry when the last column is removed', () => {
		saveRelationColumns('employees', { department: ['code'] });
		saveRelationColumns('employees', {});
		expect(loadRelationColumns('employees')).toEqual({});
		expect(localStorage.getItem('studio-relation-columns:employees')).toBeNull();
	});

	it('drops unreadable entries and never throws on blocked storage', () => {
		localStorage.setItem('studio-relation-columns:employees', '{not json');
		expect(loadRelationColumns('employees')).toEqual({});
		localStorage.setItem('studio-relation-columns:employees', JSON.stringify({ a: 'code', b: [7, '', 'code'], c: [] }));
		expect(loadRelationColumns('employees')).toEqual({ b: ['code'] });
		expect(loadRelationColumns(null)).toEqual({});
		vi.restoreAllMocks();
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(() => saveRelationColumns('employees', { a: ['b'] })).not.toThrow();
	});
});

describe('selectableDisplayFields', () => {
	it('keeps readable scalar fields and drops what a cell cannot state', () => {
		const fields: FieldDefinition[] = [
			{ name: 'id', type: 'uuid' },
			{ name: '_owner', type: 'uuid' },
			{ name: 'name_mm', type: 'text' },
			{ name: 'active', type: 'boolean' },
			{ name: 'dept', type: 'm2o', related_collection: 'departments' },
			{ name: 'lines', type: 'table' },
			{ name: 'secret', type: 'password' },
			{ name: 'salary', type: 'currency', encrypted: true },
			{ name: 'status', type: 'select' },
		];
		expect(selectableDisplayFields(fields).map((f) => f.name)).toEqual(['name_mm', 'active', 'status']);
	});
});
