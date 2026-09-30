/**
 * The relation half of the table derivation — ONE resolution (`displayLeafField`)
 * feeds the cell label, the header menu's display picker and the nested filter
 * leaf, so a column can never show one related field and filter on another.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef, ColumnMenuOption } from '@mmbix/design-system/datatable';
import { buildFilterFieldMap, buildTableColumns, displayLeafField, serializeTableFilters } from './collection-table-filters';
import type { EntitySchema, FieldDefinition } from './api';

function schemaOf(slug: string, fields: FieldDefinition[]): EntitySchema {
	return { id: '1', name: slug, slug, table_name: `cms_${slug}`, schema_json: { fields } } as unknown as EntitySchema;
}

const departments = schemaOf('departments', [
	{ name: 'id', type: 'uuid' },
	{ name: 'name_mm', type: 'text', label: 'Name (MM)' },
	{ name: 'name_en', type: 'text' },
	{ name: 'code', type: 'text' },
	{ name: 'headcount', type: 'integer' },
	{ name: 'lines', type: 'table' },
]);

const DEPARTMENT: FieldDefinition = { name: 'department', type: 'm2o', related_collection: 'departments' };
const M2O_SCHEMAS = { departments };

const optionsOf = (columns: ColumnDef<Record<string, unknown>>[], id: string): ColumnMenuOption[] =>
	columns.find((c) => c.id === id)?.menuOptions ?? [];

describe('displayLeafField', () => {
	it('resolves automatically to the conventional display column', () => {
		expect(displayLeafField(DEPARTMENT, departments)?.name).toBe('name_mm');
	});

	it('honours a display_template key over the conventional columns', () => {
		const field = { ...DEPARTMENT, display_template: '{{code}} — {{name_en}}' };
		expect(displayLeafField(field, departments)?.name).toBe('code');
	});

	it('lets an explicit pick win outright', () => {
		expect(displayLeafField(DEPARTMENT, departments, 'code')?.name).toBe('code');
	});

	it('falls back to automatic when the related schema no longer has the pick', () => {
		// A renamed/removed related field must degrade, never blank the column.
		expect(displayLeafField(DEPARTMENT, departments, 'gone')?.name).toBe('name_mm');
	});
});

describe('buildTableColumns — relation display picker', () => {
	it('offers automatic plus every readable related field, and nothing else', () => {
		const options = optionsOf(buildTableColumns([DEPARTMENT], M2O_SCHEMAS, { onPickDisplayLeaf: () => {} }), 'department');
		expect(options[0]).toMatchObject({ label: 'Default (name_mm)', selected: true });
		// `id` and the relation array are not offerable; the label is the field's own.
		expect(options.map((o) => o.id)).toEqual(['', 'name_mm', 'name_en', 'code', 'headcount']);
		expect(options.find((o) => o.id === 'name_mm')?.label).toBe('Name (MM)');
	});

	it('reports a pick and a clear through onSelect, and checks the picked entry', () => {
		const onPick = vi.fn();
		const options = optionsOf(
			buildTableColumns([DEPARTMENT], M2O_SCHEMAS, { displayLeaves: { department: 'code' }, onPickDisplayLeaf: onPick }),
			'department',
		);
		expect(options.find((o) => o.id === 'code')).toMatchObject({ selected: true });
		expect(options[0].selected).toBeFalsy();
		options.find((o) => o.id === 'headcount')!.onSelect();
		expect(onPick).toHaveBeenCalledWith('department', 'headcount');
		options[0].onSelect();
		expect(onPick).toHaveBeenCalledWith('department', null);
	});

	it('reverts to the automatic entry when a stored pick no longer resolves', () => {
		const options = optionsOf(
			buildTableColumns([DEPARTMENT], M2O_SCHEMAS, { displayLeaves: { department: 'gone' }, onPickDisplayLeaf: () => {} }),
			'department',
		);
		expect(options[0]).toMatchObject({ label: 'Default (name_mm)', selected: true });
		expect(options.filter((o) => o.selected === true)).toHaveLength(1);
	});

	it('offers no picker without the target schema, and none for a non-relation column', () => {
		// No related schema → no fields to offer → the column keeps the plain checkbox.
		expect(optionsOf(buildTableColumns([DEPARTMENT], {}, { onPickDisplayLeaf: () => {} }), 'department')).toEqual([]);
		expect(optionsOf(buildTableColumns([{ name: 'name_en', type: 'text' }], {}, { onPickDisplayLeaf: () => {} }), 'name_en')).toEqual([]);
	});

	it('hands the resolved leaf to the cell renderer', () => {
		const renderCell = vi.fn(() => null);
		const columns = buildTableColumns([DEPARTMENT], M2O_SCHEMAS, { displayLeaves: { department: 'code' }, renderCell });
		const value = { id: 'd1', code: 'D-1' };
		const row = { id: 'e1' };
		columns[0].cell!({ value, row: { original: row, index: 0, getValue: () => value }, index: 0 });
		expect(renderCell).toHaveBeenCalledWith(DEPARTMENT, value, row, expect.objectContaining({ name: 'code' }));
	});
});

describe('filter leaves follow the display pick', () => {
	it('targets the picked leaf in the backend path and keeps the FK for empty checks', () => {
		const meta = buildFilterFieldMap([DEPARTMENT], M2O_SCHEMAS, { department: 'code' }).get('department')!;
		expect(meta.path).toBe('department.code');
		expect(meta.nullPath).toBe('department');
		expect(meta.rawType).toBe('text');
	});

	it('serializes an applied filter onto the picked leaf', () => {
		expect(
			serializeTableFilters([{ id: 'department', operator: 'contains', value: 'Mai' }], [DEPARTMENT], M2O_SCHEMAS, { department: 'code' }),
		).toEqual({
			'department.code': { operator: '_icontains', value: 'Mai' },
		});
	});

	it('keeps the automatic leaf when nothing is picked', () => {
		expect(serializeTableFilters([{ id: 'department', operator: 'contains', value: 'Mai' }], [DEPARTMENT], M2O_SCHEMAS)).toEqual({
			'department.name_mm': { operator: '_icontains', value: 'Mai' },
		});
	});
});
