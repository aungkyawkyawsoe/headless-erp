// @vitest-environment jsdom
/**
 * Relation display picks — the per-collection "which field of the related row
 * does this relation column show?" preference. Storage + the pickable-field rule
 * only; WHICH field a pick resolves to (and the stale-pick fallback) is pinned in
 * collection-table-filters.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRelationLeaves, saveRelationLeaves, selectableDisplayFields, withRelationLeaf } from './relation-display';
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
