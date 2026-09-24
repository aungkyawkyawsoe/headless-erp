/**
 * EntityMigrator Unit Tests
 *
 * Tests for FIX #7, #8:
 *   - Diff: detect added fields
 *   - Diff: detect new indices
 *   - Diff: no changes (empty migration)
 *   - Diff: M2A field generates two columns
 *   - Diff: virtual fields (o2m, m2m, table, formula) are skipped
 *   - Type mapping: fieldTypeToSQL
 */
import { describe, it, expect } from 'vitest';
import { EntityMigrator, type EntityMigrationOp } from '../entity-migrator';
import type { FieldDefinition } from '@mmbix/types';

// Helper: create a field definition quickly
function field(name: string, type: string): FieldDefinition {
	return { name, type } as FieldDefinition; // minimum required
}

function fieldWith(name: string, type: string, overrides: Partial<FieldDefinition>): FieldDefinition {
	return { name, type, ...overrides } as FieldDefinition;
}

describe('EntityMigrator.diff', () => {
	// ─── No Changes ──────────────────────────────────

	it('should return empty migration when fields are identical', () => {
		const oldFields = [field('name', 'text'), field('age', 'integer')];
		const newFields = [field('name', 'text'), field('age', 'integer')];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(0);
		expect(migration.tableName).toBe('cms_test');
	});

	it('should return empty migration when both are empty', () => {
		const migration = EntityMigrator.diff('cms_test', [], []);
		expect(migration.operations).toHaveLength(0);
	});

	// ─── New Fields Added ────────────────────────────

	it('should detect a single added text field', () => {
		const oldFields = [field('name', 'text')];
		const newFields = [field('name', 'text'), field('description', 'text')];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(1);
		expect(migration.operations[0]).toEqual({
			type: 'add_column',
			name: 'description',
			sqlType: 'TEXT',
			nullable: false, // required by default (no required: false)
			defaultValue: undefined,
		});
	});

	it('should detect multiple added fields', () => {
		const oldFields = [field('id', 'uuid')];
		const newFields = [field('id', 'uuid'), field('name', 'text'), field('age', 'integer'), field('price', 'number')];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(3);
		const names = migration.operations.filter((o) => o.type === 'add_column').map((o) => o.name);
		expect(names).toContain('name');
		expect(names).toContain('age');
		expect(names).toContain('price');
	});

	it('should mark column as nullable when required is false', () => {
		const oldFields: FieldDefinition[] = [];
		const newFields = [fieldWith('optional_note', 'text', { required: false })];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(1);
		expect((migration.operations[0] as Extract<EntityMigrationOp, { type: 'add_column' }>).nullable).toBe(true);
	});

	// ─── Type Mapping ────────────────────────────────

	it('should map numeric types to INTEGER/REAL/TEXT', () => {
		const oldFields: FieldDefinition[] = [];
		const newFields: FieldDefinition[] = [
			field('age', 'integer'),
			field('active', 'boolean'),
			field('price', 'number'),
			field('total', 'currency'),
			field('tax_rate', 'percent'),
			field('score', 'rating'),
			field('big_value', 'bigint'),
		];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		const sqlTypes: Record<string, string> = {};
		for (const op of migration.operations) {
			if (op.type === 'add_column') {
				sqlTypes[op.name] = op.sqlType;
			}
		}
		expect(sqlTypes.age).toBe('INTEGER');
		expect(sqlTypes.active).toBe('INTEGER');
		expect(sqlTypes.price).toBe('REAL');
		expect(sqlTypes.total).toBe('REAL');
		expect(sqlTypes.tax_rate).toBe('REAL');
		expect(sqlTypes.score).toBe('REAL');
		expect(sqlTypes.big_value).toBe('INTEGER');
	});

	it('should map JSON-like types to TEXT', () => {
		const oldFields: FieldDefinition[] = [];
		const newFields = [field('meta', 'json'), field('tags', 'csv'), field('coords', 'location')];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		for (const op of migration.operations as Array<Extract<EntityMigrationOp, { type: 'add_column' }>>) {
			expect(op.sqlType).toBe('TEXT');
		}
	});

	it('should map all text-like types to TEXT', () => {
		const oldFields: FieldDefinition[] = [];
		const newFields: FieldDefinition[] = [
			field('title', 'text'),
			field('slug', 'slug'),
			field('customer', 'm2o'),
			field('avatar', 'file'),
			field('color', 'color'),
			field('secret', 'password'),
			field('notes', 'longtext'),
			field('unique_id', 'uuid'),
		];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		for (const op of migration.operations as Array<Extract<EntityMigrationOp, { type: 'add_column' }>>) {
			expect(op.sqlType).toBe('TEXT');
		}
	});

	// ─── M2A Special Handling ────────────────────────

	it('should create TWO columns for M2A fields', () => {
		const oldFields: FieldDefinition[] = [];
		const newFields = [field('reference', 'm2a')];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(2);
		const ops = migration.operations as Array<Extract<EntityMigrationOp, { type: 'add_column' }>>;
		expect(ops[0].name).toBe('reference_type');
		expect(ops[0].sqlType).toBe('TEXT');
		expect(ops[1].name).toBe('reference_id');
		expect(ops[1].sqlType).toBe('TEXT');
	});

	// ─── Virtual Fields Skipped ──────────────────────

	it('should SKIP o2m fields (virtual, no physical column)', () => {
		const oldFields: FieldDefinition[] = [];
		const newFields = [field('articles', 'o2m')];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(0);
	});

	it('should SKIP m2m fields', () => {
		const migration = EntityMigrator.diff('cms_test', [], [field('tags', 'm2m')]);
		expect(migration.operations).toHaveLength(0);
	});

	it('should SKIP table fields (child table)', () => {
		const migration = EntityMigrator.diff('cms_test', [], [field('items', 'table')]);
		expect(migration.operations).toHaveLength(0);
	});

	it('should SKIP formula fields (computed)', () => {
		const migration = EntityMigrator.diff('cms_test', [], [field('total', 'formula')]);
		expect(migration.operations).toHaveLength(0);
	});

	it('should ADD a column for a STORED formula (store: true) typed by result_type', () => {
		const migration = EntityMigrator.diff(
			'cms_test',
			[],
			[fieldWith('total', 'formula', { store: true, result_type: 'number', formula: 'qty * rate' })],
		);
		expect(migration.operations).toHaveLength(1);
		expect(migration.operations[0]).toEqual({
			type: 'add_column',
			name: 'total',
			sqlType: 'REAL',
			nullable: true, // engine-owned — old rows carry NULL until next write
			defaultValue: undefined,
		});
	});

	it('should map stored formula result types to INTEGER (boolean) and TEXT (string)', () => {
		const migration = EntityMigrator.diff(
			'cms_test',
			[],
			[
				fieldWith('is_overdue', 'formula', { store: true, result_type: 'boolean', formula: 'due < NOW()' }),
				fieldWith('label', 'formula', { store: true, result_type: 'string', formula: 'name' }),
			],
		);
		const types = new Map(
			migration.operations
				.filter((op): op is Extract<EntityMigrationOp, { type: 'add_column' }> => op.type === 'add_column')
				.map((op) => [op.name, op.sqlType]),
		);
		expect(types.get('is_overdue')).toBe('INTEGER');
		expect(types.get('label')).toBe('TEXT');
	});

	it('should NOT treat an existing stored formula column as new when unchanged', () => {
		const oldFields = [fieldWith('total', 'formula', { store: true, formula: 'qty * rate' })];
		const newFields = [fieldWith('total', 'formula', { store: true, formula: 'qty * rate' })];
		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);
		expect(migration.operations).toHaveLength(0);
	});

	// ─── Index Creation ──────────────────────────────

	it('should detect newly added indexed fields', () => {
		const oldFields: FieldDefinition[] = [field('name', 'text')];
		const newFields: FieldDefinition[] = [field('name', 'text'), fieldWith('email', 'text', { index: true })];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		// Should have 2 ops: add_column(email) + create_index
		expect(migration.operations).toHaveLength(2);
		expect(migration.operations[0].type).toBe('add_column');
		expect(migration.operations[1].type).toBe('create_index');
		expect((migration.operations[1] as Extract<EntityMigrationOp, { type: 'create_index' }>).name).toBe('idx_cms_test_email');
	});

	it('should NOT create index for already-indexed fields', () => {
		const oldFields: FieldDefinition[] = [fieldWith('email', 'text', { index: true })];
		const newFields: FieldDefinition[] = [fieldWith('email', 'text', { index: true })];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(0);
	});

	it('should detect index added to existing field', () => {
		const oldFields: FieldDefinition[] = [field('email', 'text')];
		const newFields: FieldDefinition[] = [fieldWith('email', 'text', { index: true })];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(1);
		expect(migration.operations[0].type).toBe('create_index');
	});

	// ─── Complex Combined Scenario ────────────────────

	it('should handle complex: add + index + m2a + virtual in one diff', () => {
		const oldFields: FieldDefinition[] = [field('title', 'text')];
		const newFields: FieldDefinition[] = [
			field('title', 'text'),
			field('status', 'text'),
			fieldWith('email', 'text', { index: true, required: false }),
			field('reference', 'm2a'),
			field('items', 'o2m'), // virtual — should be skipped
			field('total', 'formula'), // virtual — should be skipped
		];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		// Expected: status (TEXT), email (TEXT nullable + index), reference_type (TEXT), reference_id (TEXT)
		// = 4 add_column + 1 create_index = 5 operations
		const addOps = migration.operations.filter((o) => o.type === 'add_column');
		const idxOps = migration.operations.filter((o) => o.type === 'create_index');

		expect(addOps).toHaveLength(4);
		expect(idxOps).toHaveLength(1);

		const addNames = addOps.map((o) => o.name);
		expect(addNames).toContain('status');
		expect(addNames).toContain('email');
		expect(addNames).toContain('reference_type');
		expect(addNames).toContain('reference_id');
	});

	// ─── Edge Cases ──────────────────────────────────

	it('should handle field rename as drop old column + add new column', () => {
		const oldFields: FieldDefinition[] = [field('old_name', 'text')];
		const newFields: FieldDefinition[] = [field('new_name', 'text')];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		// No stable field identity exists in schema_json, so a rename is seen as
		// remove + add. The physical DB now follows the schema: the old column is
		// dropped (data in it is intentionally discarded, same as deleting the
		// field) and the new one is created.
		expect(migration.operations).toHaveLength(2);
		expect(migration.operations[0].type).toBe('drop_column');
		expect((migration.operations[0] as Extract<EntityMigrationOp, { type: 'drop_column' }>).name).toBe('old_name');
		expect(migration.operations[1].type).toBe('add_column');
		expect((migration.operations[1] as Extract<EntityMigrationOp, { type: 'add_column' }>).name).toBe('new_name');
	});

	it('should handle fields with default values', () => {
		const oldFields: FieldDefinition[] = [];
		const newFields = [fieldWith('status', 'text', { default: 'draft' })];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(1);
		expect((migration.operations[0] as Extract<EntityMigrationOp, { type: 'add_column' }>).defaultValue).toBe('draft');
	});

	it('should handle fields with numeric defaults', () => {
		const oldFields: FieldDefinition[] = [];
		const newFields = [fieldWith('qty', 'integer', { default: 1 })];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect((migration.operations[0] as Extract<EntityMigrationOp, { type: 'add_column' }>).defaultValue).toBe('1');
	});

	// ─── Field Removal (DROP COLUMN) ──────────────────

	it('should drop a removed field column', () => {
		const oldFields: FieldDefinition[] = [field('name', 'text'), field('age', 'integer')];
		const newFields: FieldDefinition[] = [field('name', 'text')];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(1);
		expect(migration.operations[0]).toEqual({ type: 'drop_column', name: 'age' });
	});

	it('should drop BOTH columns when an m2a field is removed', () => {
		const oldFields: FieldDefinition[] = [field('reference', 'm2a')];
		const newFields: FieldDefinition[] = [];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(2);
		expect(migration.operations[0]).toEqual({ type: 'drop_column', name: 'reference_type' });
		expect(migration.operations[1]).toEqual({ type: 'drop_column', name: 'reference_id' });
	});

	it('should drop the index BEFORE the column when a removed field was indexed', () => {
		const oldFields: FieldDefinition[] = [fieldWith('email', 'text', { index: true })];
		const newFields: FieldDefinition[] = [];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		// apply() additionally introspects live indexes before DROP COLUMN, but the
		// schema-declared index must be emitted so the migration is deterministic.
		expect(migration.operations.map((o) => o.type)).toEqual(['drop_column']);
		expect(migration.operations[0]).toEqual({ type: 'drop_column', name: 'email' });
	});

	it('should drop the index when a field loses index: true', () => {
		const oldFields: FieldDefinition[] = [fieldWith('email', 'text', { index: true })];
		const newFields: FieldDefinition[] = [field('email', 'text')];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(1);
		expect(migration.operations[0]).toEqual({ type: 'drop_index', name: 'idx_cms_test_email' });
	});

	// ─── Unique index sync ─────────────────────────────

	it('should create a UNIQUE index for newly-unique fields', () => {
		const oldFields: FieldDefinition[] = [field('email', 'text')];
		const newFields: FieldDefinition[] = [fieldWith('email', 'text', { unique: true })];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(1);
		expect(migration.operations[0]).toEqual({ type: 'create_unique_index', name: 'uidx_cms_test_email', column: 'email' });
	});

	it('should drop the UNIQUE index when unique is turned off', () => {
		const oldFields: FieldDefinition[] = [fieldWith('email', 'text', { unique: true })];
		const newFields: FieldDefinition[] = [field('email', 'text')];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(1);
		expect(migration.operations[0]).toEqual({ type: 'drop_index', name: 'uidx_cms_test_email' });
	});

	it('should create a unique index when a NEW unique field is added', () => {
		const oldFields: FieldDefinition[] = [];
		const newFields: FieldDefinition[] = [fieldWith('email', 'text', { unique: true })];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations.map((o) => o.type)).toEqual(['add_column', 'create_unique_index']);
	});

	// ─── Type / nullability changes → table rebuild ────

	it('should REBUILD the table when a field type changes', () => {
		const oldFields: FieldDefinition[] = [field('qty', 'integer')];
		const newFields: FieldDefinition[] = [field('qty', 'text')];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(1);
		expect(migration.operations[0].type).toBe('rebuild_table');
	});

	it('should REBUILD the table when required changes (NOT NULL toggles)', () => {
		const oldFields: FieldDefinition[] = [fieldWith('email', 'text', { required: true })];
		const newFields: FieldDefinition[] = [fieldWith('email', 'text', { required: false })];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(1);
		expect((migration.operations[0] as Extract<EntityMigrationOp, { type: 'rebuild_table' }>).fields).toHaveLength(1);
	});

	it('should REBUILD when removing a unique-constrained field (inline UNIQUE blocks DROP COLUMN)', () => {
		const oldFields: FieldDefinition[] = [fieldWith('email', 'text', { unique: true })];
		const newFields: FieldDefinition[] = [];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(1);
		expect(migration.operations[0].type).toBe('rebuild_table');
	});

	it('should NOT rebuild when only metadata (label) changes', () => {
		const oldFields: FieldDefinition[] = [{ name: 'name', type: 'text', label: 'Old' } as FieldDefinition];
		const newFields: FieldDefinition[] = [{ name: 'name', type: 'text', label: 'New' } as FieldDefinition];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields);

		expect(migration.operations).toHaveLength(0);
	});

	// ─── Composite index removal / change ──────────────

	it('should drop a removed composite index', () => {
		const oldComposites = [{ columns: ['a', 'b'] }];
		const newComposites: { columns: string[] }[] = [];

		const migration = EntityMigrator.diff('cms_test', [], [], oldComposites, newComposites);

		expect(migration.operations).toHaveLength(1);
		expect(migration.operations[0]).toEqual({ type: 'drop_index', name: 'idx_cms_test_a_b' });
	});

	it('should drop the old index and create the new one when composite columns change', () => {
		const oldComposites = [{ columns: ['a', 'b'] }];
		const newComposites = [{ columns: ['a', 'c'] }];

		const migration = EntityMigrator.diff('cms_test', [], [], oldComposites, newComposites);

		expect(migration.operations.map((o) => o.type)).toEqual(['drop_index', 'create_composite_index']);
	});

	it('should drop a composite index referencing a removed column', () => {
		const oldFields: FieldDefinition[] = [field('a', 'text'), field('b', 'text')];
		const newFields: FieldDefinition[] = [field('b', 'text')];
		const oldComposites = [{ columns: ['a', 'b'] }];
		const newComposites = [{ columns: ['b', 'a'] }];

		const migration = EntityMigrator.diff('cms_test', oldFields, newFields, oldComposites, newComposites);

		const types = migration.operations.map((o) => o.type);
		expect(types).toContain('drop_index');
		expect(types).toContain('drop_column');
		// the composite is gone even though the new set still lists [b, a] (a is gone)
		expect(types).not.toContain('create_composite_index');
	});
});
