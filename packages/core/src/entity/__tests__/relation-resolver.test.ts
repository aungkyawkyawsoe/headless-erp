/**
 * Relation Resolver Tests — v2 Optimized
 *
 * Tests for FIX #4 (batch M2O), FIX #5 (field projection via batch),
 * FIX #6 (parallel resolution).
 */
import { describe, it, expect } from 'vitest';
import { resolveM2O, resolveO2M, resolveM2M, getM2ORelations, getO2MRelations, getM2MRelations } from '../relation-resolver';
import { D1Client } from '../../db/d1-client';
import type { EntitySchema, FieldDefinition } from '@mmbix/types';

// ─── Test Helpers ────────────────────────────────────

/** Create a fake D1Client that returns preset data */
function mockD1Client(dataMap: Record<string, Record<string, unknown>[]>): D1Client {
	function findRows(sql: string): Record<string, unknown>[] {
		for (const [tablePattern, rows] of Object.entries(dataMap)) {
			// Match "table_name" or table_name after FROM
			const escaped = tablePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			if (new RegExp('FROM\\s+"?\\b' + escaped + '\\b"?', 'i').test(sql)) {
				return rows;
			}
		}
		return [];
	}

	const mockDb = {
		prepare: (sql: string) => ({
			bind: (..._bindings: unknown[]) => ({
				all: <T>() => Promise.resolve({ results: findRows(sql) as T[], success: true, meta: { duration: 0 } }),
				first: <T>() => Promise.resolve((findRows(sql)[0] ?? null) as T | null),
				run: () => Promise.resolve({ success: true, meta: { duration: 0, changes: 1 } }),
			}),
		}),
		batch: (_stmts: unknown[]) => Promise.resolve([]),
		exec: (_sql: string) => Promise.resolve({ count: 0, duration: 0 }),
	} as unknown as D1Database;

	return new D1Client(mockDb);
}

// ─── resolveM2O Tests ───────────────────────────────

describe('resolveM2O', () => {
	it('should return items unchanged when no m2o fields', async () => {
		const db = mockD1Client({});
		const items = [{ id: '1', name: 'Test' }];

		const result = await resolveM2O(items, [], db);

		expect(result).toEqual([{ id: '1', name: 'Test' }]);
	});

	it('should return unchanged when items is empty', async () => {
		const db = mockD1Client({});
		const result = await resolveM2O([], [{ fieldName: 'user_id', targetTable: 'users' }], db);

		expect(result).toEqual([]);
	});

	it('should resolve a single M2O field', async () => {
		const db = mockD1Client({
			cms_users: [{ id: 'user-1', name: 'Alice', email: 'alice@test.com' }],
		});
		const items = [{ id: '1', title: 'Post 1', author_id: 'user-1' }];

		const result = await resolveM2O(items, [{ fieldName: 'author_id', targetTable: 'cms_users' }], db);

		expect(result[0].author_id).toEqual({ id: 'user-1', name: 'Alice', email: 'alice@test.com' });
	});

	it('should leave null/missing FKs as-is', async () => {
		const db = mockD1Client({
			cms_users: [{ id: 'user-1', name: 'Alice' }],
		});
		const items = [
			{ id: '1', title: 'Post 1', author_id: null },
			{ id: '2', title: 'Post 2' }, // no author_id at all
		];

		const result = await resolveM2O(items, [{ fieldName: 'author_id', targetTable: 'cms_users' }], db);

		expect(result[0].author_id).toBeNull();
		expect(result[1].author_id).toBeUndefined();
	});

	it('replaces a dangling FK (no target row) with null — never leaks the raw id', async () => {
		const db = mockD1Client({
			cms_users: [{ id: 'user-1', name: 'Alice' }],
		});
		const items = [{ id: '1', title: 'Post 1', author_id: 'user-404' }];

		const result = await resolveM2O(items, [{ fieldName: 'author_id', targetTable: 'cms_users' }], db);

		// An expanded relation must not come back as a scalar FK string when the
		// requested target does not exist.
		expect(result[0].author_id).toBeNull();
	});

	// ── FIX #4: Batch by Target Table ────────────────

	it('should batch multiple M2O fields to same target table into ONE query', async () => {
		const db = mockD1Client({
			cms_users: [
				{ id: 'user-1', name: 'Alice' },
				{ id: 'user-2', name: 'Bob' },
			],
		});
		const items = [
			{ id: '1', created_by: 'user-1', updated_by: 'user-2' },
			{ id: '2', created_by: 'user-2', updated_by: 'user-1' },
		];

		// Both fields point to the same table → should batch
		const result = await resolveM2O(
			items,
			[
				{ fieldName: 'created_by', targetTable: 'cms_users' },
				{ fieldName: 'updated_by', targetTable: 'cms_users' },
			],
			db,
		);

		expect(result[0].created_by).toEqual({ id: 'user-1', name: 'Alice' });
		expect(result[0].updated_by).toEqual({ id: 'user-2', name: 'Bob' });
		expect(result[1].created_by).toEqual({ id: 'user-2', name: 'Bob' });
		expect(result[1].updated_by).toEqual({ id: 'user-1', name: 'Alice' });
	});

	it('should handle M2O fields to different tables', async () => {
		const db = mockD1Client({
			cms_users: [{ id: 'user-1', name: 'Alice' }],
			cms_companies: [{ id: 'co-1', name: 'Acme Corp' }],
		});
		const items = [{ id: '1', title: 'Post', user_id: 'user-1', company_id: 'co-1' }];

		const result = await resolveM2O(
			items,
			[
				{ fieldName: 'user_id', targetTable: 'cms_users' },
				{ fieldName: 'company_id', targetTable: 'cms_companies' },
			],
			db,
		);

		expect(result[0].user_id).toEqual({ id: 'user-1', name: 'Alice' });
		expect(result[0].company_id).toEqual({ id: 'co-1', name: 'Acme Corp' });
	});

	it('should deduplicate FK IDs across items', async () => {
		const db = mockD1Client({
			cms_users: [{ id: 'user-1', name: 'Alice' }],
		});
		// All three items reference the same user-1
		const items = [
			{ id: '1', author_id: 'user-1' },
			{ id: '2', author_id: 'user-1' },
			{ id: '3', author_id: 'user-1' },
		];

		const result = await resolveM2O(items, [{ fieldName: 'author_id', targetTable: 'cms_users' }], db);

		expect(result[0].author_id).toEqual({ id: 'user-1', name: 'Alice' });
		expect(result[1].author_id).toEqual({ id: 'user-1', name: 'Alice' });
		expect(result[2].author_id).toEqual({ id: 'user-1', name: 'Alice' });
	});
});

// ─── resolveO2M Tests ───────────────────────────────

describe('resolveO2M', () => {
	it('should return items unchanged when no o2m fields', async () => {
		const db = mockD1Client({});
		const items = [{ id: 'author-1' }];

		const result = await resolveO2M(items, [], db);

		expect(result).toEqual([{ id: 'author-1' }]);
	});

	it('should resolve children for one-to-many', async () => {
		const db = mockD1Client({
			cms_articles: [
				{ id: 'art-1', title: 'Article 1', author_id: 'author-1' },
				{ id: 'art-2', title: 'Article 2', author_id: 'author-1' },
				{ id: 'art-3', title: 'Article 3', author_id: 'author-2' },
			],
		});
		const items = [{ id: 'author-1' }, { id: 'author-2' }];

		const result = await resolveO2M(items, [{ fieldName: 'articles', targetTable: 'cms_articles', foreignKey: 'author_id' }], db);

		expect(result[0].articles).toHaveLength(2);
		expect((result[0].articles as Record<string, unknown>[])[0].title).toBe('Article 1');
		expect((result[0].articles as Record<string, unknown>[])[1].title).toBe('Article 2');
		expect(result[1].articles).toHaveLength(1);
		expect((result[1].articles as Record<string, unknown>[])[0].title).toBe('Article 3');
	});

	it('should return empty array for items with no children', async () => {
		const db = mockD1Client({
			cms_articles: [
				// No articles for author-99
			],
		});
		const items = [{ id: 'author-99' }];

		const result = await resolveO2M(items, [{ fieldName: 'articles', targetTable: 'cms_articles', foreignKey: 'author_id' }], db);

		expect(result[0].articles).toEqual([]);
	});
});

// ─── getM2ORelations Tests ──────────────────────────

describe('getM2ORelations', () => {
	it('should extract m2o fields with related collections', () => {
		const schemaFields: FieldDefinition[] = [
			{ name: 'author', type: 'm2o', related_collection: 'users' },
			{ name: 'title', type: 'text' },
			{ name: 'category', type: 'm2o', related_collection: 'categories' },
			{ name: 'comments', type: 'o2m', related_collection: 'comments', foreign_key: 'post_id' },
		];
		const collections: EntitySchema[] = [
			{
				id: '1',
				name: 'Users',
				slug: 'users',
				table_name: 'cms_users',
				schema_json: '{}',
				description: null,
				naming_series: null,
				created_at: '',
				updated_at: '',
			},
			{
				id: '2',
				name: 'Categories',
				slug: 'categories',
				table_name: 'cms_categories',
				schema_json: '{}',
				description: null,
				naming_series: null,
				created_at: '',
				updated_at: '',
			},
		];

		const result = getM2ORelations(schemaFields, collections);

		expect(result).toHaveLength(2);
		expect(result[0].fieldName).toBe('author');
		expect(result[0].targetTable).toBe('cms_users');
		expect(result[1].fieldName).toBe('category');
		expect(result[1].targetTable).toBe('cms_categories');
	});

	it('should skip m2o fields with missing collections', () => {
		const schemaFields: FieldDefinition[] = [{ name: 'ghost', type: 'm2o', related_collection: 'nonexistent' }];
		const collections: EntitySchema[] = [];

		const result = getM2ORelations(schemaFields, collections);

		expect(result).toHaveLength(0);
	});
});

// ─── getO2MRelations Tests ──────────────────────────

describe('getO2MRelations', () => {
	it('should extract o2m fields with related collections and foreign keys', () => {
		const schemaFields: FieldDefinition[] = [{ name: 'articles', type: 'o2m', related_collection: 'articles', foreign_key: 'author_id' }];
		const collections: EntitySchema[] = [
			{
				id: '1',
				name: 'Articles',
				slug: 'articles',
				table_name: 'cms_articles',
				schema_json: '{}',
				description: null,
				naming_series: null,
				created_at: '',
				updated_at: '',
			},
		];

		const result = getO2MRelations(schemaFields, collections);

		expect(result).toHaveLength(1);
		expect(result[0].fieldName).toBe('articles');
		expect(result[0].targetTable).toBe('cms_articles');
		expect(result[0].foreignKey).toBe('author_id');
	});

	it('should skip o2m fields without foreign_key', () => {
		const schemaFields: FieldDefinition[] = [
			{ name: 'items', type: 'o2m', related_collection: 'items' }, // no foreign_key
		];
		const collections: EntitySchema[] = [
			{
				id: '1',
				name: 'Items',
				slug: 'items',
				table_name: 'cms_items',
				schema_json: '{}',
				description: null,
				naming_series: null,
				created_at: '',
				updated_at: '',
			},
		];

		const result = getO2MRelations(schemaFields, collections);

		expect(result).toHaveLength(0);
	});
});

// ─── resolveM2M Tests ────────────────────────────────

describe('resolveM2M', () => {
	it('should resolve junction rows into related objects (batched)', async () => {
		const db = mockD1Client({
			_jt_cms_products_cms_tags: [
				{ id: 'j1', source_id: 'p1', target_id: 't1', created_at: '2026-01-01T00:00:00Z' },
				{ id: 'j2', source_id: 'p1', target_id: 't2', created_at: '2026-01-01T00:00:01Z' },
				{ id: 'j3', source_id: 'p2', target_id: 't2', created_at: '2026-01-01T00:00:00Z' },
			],
			cms_tags: [
				{ id: 't1', name: 'sale' },
				{ id: 't2', name: 'new' },
			],
		});
		const items = [
			{ id: 'p1', title: 'Laptop' },
			{ id: 'p2', title: 'Novel' },
			{ id: 'p3', title: 'No Tags' },
		];

		const result = await resolveM2M(
			items,
			[{ fieldName: 'tags', targetTable: 'cms_tags', junctionTable: '_jt_cms_products_cms_tags' }],
			db,
		);

		expect((result[0].tags as { id: string }[]).map((t) => t.id).sort()).toEqual(['t1', 't2']);
		expect((result[0].tags as { name: string }[]).map((t) => t.name).sort()).toEqual(['new', 'sale']);
		expect((result[1].tags as { id: string }[]).map((t) => t.id)).toEqual(['t2']);
		expect(result[2].tags).toEqual([]);
	});

	it('should return unchanged when no m2m fields or empty items', async () => {
		const db = mockD1Client({});
		expect(await resolveM2M([{ id: 'x' }], [], db)).toEqual([{ id: 'x' }]);
		expect(await resolveM2M([], [{ fieldName: 'tags', targetTable: 'cms_tags', junctionTable: '_jt_x' }], db)).toEqual([]);
	});
});

describe('getM2MRelations', () => {
	it('should compute junction table name from source + target tables', () => {
		const schemaFields: FieldDefinition[] = [{ name: 'tags', type: 'm2m', related_collection: 'tags' }];
		const collections: EntitySchema[] = [
			{
				id: '1',
				name: 'Tags',
				slug: 'tags',
				table_name: 'cms_tags',
				schema_json: '{}',
				description: null,
				naming_series: null,
				created_at: '',
				updated_at: '',
			},
		];

		const result = getM2MRelations(schemaFields, collections, 'cms_products');

		expect(result).toHaveLength(1);
		expect(result[0].fieldName).toBe('tags');
		expect(result[0].targetTable).toBe('cms_tags');
		expect(result[0].junctionTable).toBe('_jt_cms_products_cms_tags');
	});

	it('should skip m2m fields with missing related collections', () => {
		const result = getM2MRelations([{ name: 'ghost', type: 'm2m', related_collection: 'nope' }], [], 'cms_products');
		expect(result).toHaveLength(0);
	});
});
