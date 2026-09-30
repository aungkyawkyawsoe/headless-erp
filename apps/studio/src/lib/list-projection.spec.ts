import { describe, expect, it } from 'vitest';
import { MAX_FIELD_SELECTIONS } from '@mmbix/types';
import { buildListFields } from './list-projection';
import { M2O_DISPLAY_FIELDS } from './record-label';
import type { FieldDefinition } from './api';

function partsOf(projection: string): string[] {
	return projection.split(',');
}

describe('buildListFields', () => {
	it('falls back to `*` when the schema has no fields (defensive — callers gate on it)', () => {
		expect(buildListFields([])).toBe('*');
	});

	it('asks for own columns only when there are no relations', () => {
		const fields: FieldDefinition[] = [
			{ name: 'name_en', type: 'text' },
			{ name: 'active', type: 'boolean' },
		];
		expect(buildListFields(fields)).toBe('*');
	});

	it('expands an m2o target to id + the conventional display columns', () => {
		const projection = buildListFields([{ name: 'department', type: 'm2o', related_collection: 'hrm_departments' }]);
		const parts = partsOf(projection);
		expect(parts).toContain('*');
		expect(parts).toContain('department.id');
		expect(parts).toContain('department.name');
		// Does NOT expand the target wholesale.
		expect(parts).not.toContain('department.*');
	});

	it('adds the display_template keys an m2o label can read', () => {
		const projection = buildListFields([
			{ name: 'owner', type: 'm2o', related_collection: 'users', display_template: '{{full_name}} ({{emp_code}})' },
		]);
		const parts = partsOf(projection);
		expect(parts).toContain('owner.full_name');
		expect(parts).toContain('owner.emp_code');
	});

	it('projects relation arrays (o2m/m2m/table) as id-only', () => {
		const projection = buildListFields([
			{ name: 'shifts', type: 'm2m', related_collection: 'hrm_shifts' },
			{ name: 'subordinates', type: 'o2m', related_collection: 'hrm_employee_links' },
			{ name: 'lines', type: 'table', related_collection: 'doc_lines' },
		]);
		const parts = partsOf(projection);
		expect(parts).toContain('shifts.id');
		expect(parts).toContain('subordinates.id');
		expect(parts).toContain('lines.id');
		expect(parts).not.toContain('shifts.*');
	});

	it('keeps m2a polymorphism fully expanded (no fixed label shape)', () => {
		const projection = buildListFields([{ name: 'target', type: 'm2a' }]);
		expect(partsOf(projection)).toContain('target');
	});

	it('is a compact superset that the server narrows (no duplicates)', () => {
		const projection = buildListFields([
			{ name: 'a', type: 'm2o', related_collection: 'x', display_template: '{{name}}' },
			{ name: 'a2', type: 'm2o', related_collection: 'y', display_template: '{{name}}' },
		]);
		const parts = partsOf(projection);
		expect(new Set(parts).size).toBe(parts.length);
	});

	it('spends no budget on a narrow schema — the whole conventional column list survives', () => {
		const parts = partsOf(buildListFields([{ name: 'department', type: 'm2o', related_collection: 'x' }]));
		for (const key of M2O_DISPLAY_FIELDS) expect(parts).toContain(`department.${key}`);
	});

	// The regression this guards: each m2o costs ~18 entries, so `mro_serial_events`
	// (6 m2o fields) projected 103 entries and the engine rejected the ENTIRE list
	// read with `Too many field selections (max 100)` — a blank table.
	it('never exceeds the engine cap on a relation-heavy collection, keeping every anchor', () => {
		const fields: FieldDefinition[] = Array.from({ length: 6 }, (_, i) => ({
			name: `rel_${i}`,
			type: 'm2o' as const,
			related_collection: 'x',
			display_template: i === 0 ? '{{name_en}}' : undefined,
		}));
		const parts = partsOf(buildListFields(fields));
		expect(parts.length).toBeLessThanOrEqual(MAX_FIELD_SELECTIONS);
		expect(parts[0]).toBe('*');
		for (let i = 0; i < fields.length; i++) {
			expect(parts).toContain(`rel_${i}.id`);
			expect(parts).toContain(`rel_${i}.plate_no`); // budget shared evenly
		}
		expect(parts).toContain('rel_0.name_en'); // declared template key is an anchor
	});

	it('holds the cap even when the schema has more relations than the budget', () => {
		const fields: FieldDefinition[] = Array.from({ length: 120 }, (_, i) => ({
			name: `rel_${i}`,
			type: 'm2o' as const,
			related_collection: 'x',
		}));
		const parts = partsOf(buildListFields(fields));
		expect(parts.length).toBeLessThanOrEqual(MAX_FIELD_SELECTIONS);
		expect(parts).toContain('rel_0.id');
	});
});
