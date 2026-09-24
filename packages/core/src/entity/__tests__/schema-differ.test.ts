/**
 * SchemaDiffer Unit Tests
 */
import { describe, it, expect } from 'vitest';
import { SchemaDiffer } from '../schema-differ';
import type { SchemaSnapshot, EntitySchema } from '@mmbix/types';

function makeCollection(slug: string, fields: Array<{ name: string; type: string }>): EntitySchema {
	return {
		id: 'col-' + slug,
		name: slug,
		slug,
		table_name: `cms_${slug}`,
		schema_json: JSON.stringify(fields),
		description: null,
		naming_series: null,
		created_at: '2026-01-01',
		updated_at: '2026-01-01',
	} as EntitySchema;
}

function makeSnapshot(collections: EntitySchema[]): SchemaSnapshot {
	return {
		version: '0.7.0',
		timestamp: new Date().toISOString(),
		checksum: 'abc123',
		collections,
		roles: [],
		permissions: [],
		webhooks: [],
		plugins: [],
	};
}

describe('SchemaDiffer', () => {
	it('should detect no changes when snapshots are identical', () => {
		const cols = [makeCollection('products', [{ name: 'title', type: 'text' }])];
		const diff = SchemaDiffer.diff(makeSnapshot(cols), makeSnapshot(cols));

		expect(diff.summary.totalChanges).toBe(0);
		expect(diff.summary.safeToApply).toBe(true);
	});

	it('should detect added collections', () => {
		const current = makeSnapshot([]);
		const incoming = makeSnapshot([makeCollection('products', [{ name: 'title', type: 'text' }])]);

		const diff = SchemaDiffer.diff(current, incoming);
		expect(diff.collectionsAdded).toHaveLength(1);
		expect(diff.collectionsAdded[0].slug).toBe('products');
		expect(diff.summary.totalChanges).toBe(1);
	});

	it('should detect removed collections (BREAKING)', () => {
		const current = makeSnapshot([makeCollection('products', [])]);
		const incoming = makeSnapshot([]);

		const diff = SchemaDiffer.diff(current, incoming);
		expect(diff.collectionsRemoved).toHaveLength(1);
		expect(diff.collectionsRemoved[0]).toBe('products');
		expect(diff.summary.safeToApply).toBe(false); // removal is breaking
	});

	it('should detect added fields', () => {
		const current = makeSnapshot([makeCollection('products', [{ name: 'title', type: 'text' }])]);
		const incoming = makeSnapshot([
			makeCollection('products', [
				{ name: 'title', type: 'text' },
				{ name: 'price', type: 'number' },
			]),
		]);

		const diff = SchemaDiffer.diff(current, incoming);
		expect(diff.collectionsModified).toHaveLength(1);
		expect(diff.collectionsModified[0].slug).toBe('products');
		expect(diff.collectionsModified[0].fieldChanges).toContainEqual({ field: 'price', change: 'added', newValue: 'number' });
	});

	it('should detect removed fields (BREAKING)', () => {
		const current = makeSnapshot([
			makeCollection('products', [
				{ name: 'title', type: 'text' },
				{ name: 'price', type: 'number' },
			]),
		]);
		const incoming = makeSnapshot([makeCollection('products', [{ name: 'title', type: 'text' }])]);

		const diff = SchemaDiffer.diff(current, incoming);
		expect(diff.collectionsModified[0].fieldChanges).toContainEqual({ field: 'price', change: 'removed', oldValue: 'number' });
		expect(diff.summary.safeToApply).toBe(false);
	});

	it('should detect type changed fields (BREAKING)', () => {
		const current = makeSnapshot([makeCollection('products', [{ name: 'price', type: 'integer' }])]);
		const incoming = makeSnapshot([makeCollection('products', [{ name: 'price', type: 'number' }])]);

		const diff = SchemaDiffer.diff(current, incoming);
		expect(diff.collectionsModified[0].fieldChanges).toContainEqual({
			field: 'price',
			change: 'type_changed',
			oldValue: 'integer',
			newValue: 'number',
		});
		expect(diff.summary.breakingChanges.length).toBeGreaterThan(0);
	});

	it('should detect new roles', () => {
		const current = makeSnapshot([]);
		const incoming: SchemaSnapshot = {
			...makeSnapshot([]),
			roles: [{ id: 'r1', name: 'editor', description: null, is_system: false, created_at: '', updated_at: '' }],
		};

		const diff = SchemaDiffer.diff(current, incoming);
		expect(diff.rolesAdded).toContain('editor');
	});

	it('should detect new permissions', () => {
		const current = makeSnapshot([]);
		const incoming: SchemaSnapshot = {
			...makeSnapshot([]),
			permissions: [
				{
					id: 'p1',
					role_id: 'r1',
					collection_slug: 'products',
					can_read: true,
					can_write: false,
					can_create: false,
					can_delete: false,
					can_approve: false,
					can_submit: false,
					created_at: '',
					updated_at: '',
				},
			],
		};

		const diff = SchemaDiffer.diff(current, incoming);
		expect(diff.permissionsChanged).toHaveLength(1);
		expect(diff.permissionsChanged[0].changes).toContain('added');
	});

	it('should handle empty snapshots', () => {
		const empty = makeSnapshot([]);
		const diff = SchemaDiffer.diff(empty, empty);
		expect(diff.summary.totalChanges).toBe(0);
		expect(diff.summary.safeToApply).toBe(true);
	});

	it('still handles malformed schema_json on a NEW collection (never parsed)', () => {
		const current = makeSnapshot([]);
		const bad = makeSnapshot([{ ...makeCollection('bad', []), schema_json: 'not-json' }]);

		const diff = SchemaDiffer.diff(current, bad);
		expect(diff.collectionsAdded).toHaveLength(1);
	});

	it('THROWS on malformed schema_json for a collection present in BOTH snapshots', () => {
		// Returning [] would make this look like "all fields removed" → spurious
		// breaking-change flags / dangerous migrations.
		const current = makeSnapshot([makeCollection('products', [{ name: 'title', type: 'text' }])]);
		const bad = makeSnapshot([{ ...makeCollection('products', []), schema_json: 'not-json' }]);

		expect(() => SchemaDiffer.diff(current, bad)).toThrow(/cannot parse schema_json/i);
	});

	it('THROWS when schema_json is not a JSON array', () => {
		const current = makeSnapshot([makeCollection('products', [{ name: 'title', type: 'text' }])]);
		const bad = makeSnapshot([{ ...makeCollection('products', []), schema_json: '{"fields":[]}' }]);

		expect(() => SchemaDiffer.diff(current, bad)).toThrow(/must be a JSON array/i);
	});
});
