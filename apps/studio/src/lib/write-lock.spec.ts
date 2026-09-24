import { describe, expect, it } from 'vitest';

import type { EntitySchema } from './api';
import { frozenRowsReason, isRowFrozen, partitionFrozenRows, writeLockOf } from './write-lock';

/** A collection schema carrying only the write policy under test. */
function schemaWith(writes: unknown): EntitySchema {
	return {
		id: '1',
		name: 'X',
		slug: 'x',
		table_name: 'cms_x',
		schema_json: { fields: [], policies: { writes } },
	} as unknown as EntitySchema;
}

describe('writeLockOf', () => {
	it('is generically writable with no write policy', () => {
		const lock = writeLockOf(schemaWith(undefined));
		expect(lock.canCreate).toBe(true);
		expect(lock.canMutate).toBe(true);
		expect(lock.reason).toBeNull();
	});

	it('locks a service-owned collection completely — create included', () => {
		const lock = writeLockOf(schemaWith({ mode: 'service' }));
		expect(lock.serviceOnly).toBe(true);
		expect(lock.canCreate).toBe(false);
		expect(lock.canMutate).toBe(false);
		expect(lock.reason).toMatch(/domain service/i);
	});

	it('allows create but blocks update/delete on an append-only collection', () => {
		const lock = writeLockOf(schemaWith({ append_only: true }));
		expect(lock.canCreate).toBe(true);
		expect(lock.canMutate).toBe(false);
		expect(lock.reason).toMatch(/append-only/i);
	});

	it('captures frozen fields and the row-level freeze rule', () => {
		const lock = writeLockOf(schemaWith({ frozen_fields: ['status'], freeze_when: { field: 'status', values: ['posted'] } }));
		expect(lock.frozenFields).toEqual(['status']);
		expect(lock.freezeWhen).toEqual({ field: 'status', values: ['posted'] });
		// Still generically writable — only the watched FIELD / ROW is restricted.
		expect(lock.canMutate).toBe(true);
		expect(isRowFrozen(lock, { status: 'posted' })).toBe(true);
		expect(isRowFrozen(lock, { status: 'draft' })).toBe(false);
	});

	it('has no row-freeze rule when the collection is locked anyway', () => {
		expect(writeLockOf(schemaWith({ mode: 'service', freeze_when: { field: 'status', values: ['posted'] } })).freezeWhen).toBeNull();
	});
});

describe('partitionFrozenRows / frozenRowsReason', () => {
	const lock = writeLockOf(schemaWith({ freeze_when: { field: 'doc_status', values: ['confirmed'] } }));
	const rows = [
		{ id: 'a', doc_status: 'draft' },
		{ id: 'b', doc_status: 'confirmed' },
		{ id: 'c', doc_status: 'draft' },
	];

	it('separates the rows a generic bulk write may touch from the frozen ones', () => {
		const { writable, frozen } = partitionFrozenRows(lock, rows);
		expect(writable.map((r) => r.id)).toEqual(['a', 'c']);
		expect(frozen.map((r) => r.id)).toEqual(['b']);
	});

	it('passes everything through when there is no freeze rule', () => {
		const { writable, frozen } = partitionFrozenRows(writeLockOf(schemaWith(undefined)), rows);
		expect(writable).toHaveLength(3);
		expect(frozen).toHaveLength(0);
	});

	it('names the rule in the skip note', () => {
		expect(frozenRowsReason(lock, 2)).toContain('2 rows skipped');
		expect(frozenRowsReason(lock, 2)).toContain('doc_status is confirmed');
		expect(frozenRowsReason(lock, 1)).toContain('1 row skipped');
	});
});
