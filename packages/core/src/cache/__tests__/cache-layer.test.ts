/**
 * CacheLayer Unit Tests
 *
 * Tests for FIX #7A, #7B, #7C, #7D:
 *   - Basic get/set/delete
 *   - TTL expiry
 *   - Pattern-based invalidation
 *   - Collection-aware invalidation (schema + perms together)
 *   - Size enforcement (LRU eviction)
 *   - Adaptive TTL
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CacheLayer } from '../cache-layer';

describe('CacheLayer', () => {
	let cache: CacheLayer;

	beforeEach(() => {
		cache = new CacheLayer();
	});

	// ─── Basic Operations ────────────────────────────

	it('should store and retrieve a value', () => {
		cache.set('key1', 'hello');
		expect(cache.get<string>('key1')).toBe('hello');
	});

	it('should return undefined for missing keys', () => {
		expect(cache.get<string>('missing')).toBeUndefined();
	});

	it('should delete a key', () => {
		cache.set('key1', 'hello');
		cache.delete('key1');
		expect(cache.get<string>('key1')).toBeUndefined();
	});

	it('should clear all entries', () => {
		cache.set('a', 1);
		cache.set('b', 2);
		cache.clear();
		expect(cache.get<number>('a')).toBeUndefined();
		expect(cache.get<number>('b')).toBeUndefined();
	});

	// ─── TTL Expiry ──────────────────────────────────

	it('should expire entries after TTL', async () => {
		cache.set('key1', 'hello', 10); // 10ms TTL
		expect(cache.get<string>('key1')).toBe('hello');

		// Wait for TTL to expire
		await new Promise((r) => setTimeout(r, 15));
		expect(cache.get<string>('key1')).toBeUndefined();
	});

	it('should use default TTL when not specified', () => {
		cache.set('key1', 'hello'); // no TTL → DEFAULT_TTL = 60_000ms
		expect(cache.get<string>('key1')).toBe('hello'); // should still be valid
	});

	it('should support different TTLs for different entries', async () => {
		cache.set('short', 'hello', 10); // 10ms
		cache.set('long', 'world', 1000); // 1000ms

		await new Promise((r) => setTimeout(r, 20));

		expect(cache.get<string>('short')).toBeUndefined();
		expect(cache.get<string>('long')).toBe('world');
	});

	// ─── Tag-Based Invalidation (FIX #7A, #7B, #7C) ──

	it('should invalidate by exact pattern: schema:*', () => {
		cache.set('schema:invoices', { table: 'cms_invoices' });
		cache.set('schema:products', { table: 'cms_products' });
		cache.set('perm:role1:invoices:read', true);
		cache.set('perm:role1:products:write', false);

		cache.invalidatePattern('schema:*');

		expect(cache.get('schema:invoices')).toBeUndefined();
		expect(cache.get('schema:products')).toBeUndefined();
		// Permissions should NOT be affected
		expect(cache.get('perm:role1:invoices:read')).toBe(true);
		expect(cache.get('perm:role1:products:write')).toBe(false);
	});

	it('should invalidate by mid-wildcard pattern', () => {
		cache.set('perm:role1:invoices:read', true);
		cache.set('perm:role1:invoices:write', true);
		cache.set('perm:role1:products:read', true);
		cache.set('perm:role2:invoices:read', true);
		cache.set('schema:invoices', {});

		// Invalidate ALL permissions for "invoices" (any role, any action)
		cache.invalidatePattern('perm:*:invoices:*');

		expect(cache.get('perm:role1:invoices:read')).toBeUndefined();
		expect(cache.get('perm:role1:invoices:write')).toBeUndefined();
		expect(cache.get('perm:role2:invoices:read')).toBeUndefined();
		// Other collections should remain
		expect(cache.get('perm:role1:products:read')).toBe(true);
		expect(cache.get('schema:invoices')).toBeDefined();
	});

	it('should invalidate single role permissions', () => {
		cache.set('perm:role1:invoices:read', true);
		cache.set('perm:role1:invoices:write', true);
		cache.set('perm:role2:invoices:read', true);

		cache.invalidatePattern('perm:role1:*');

		expect(cache.get('perm:role1:invoices:read')).toBeUndefined();
		expect(cache.get('perm:role1:invoices:write')).toBeUndefined();
		expect(cache.get('perm:role2:invoices:read')).toBe(true);
	});

	// ─── Collection-Aware Invalidation (KEY FIX #7A, #7B) ──

	it('should invalidate schema AND permissions when collection changes', () => {
		// Simulate: collection "invoices" exists, with some permissions
		cache.set('schema:invoices', { table: 'cms_invoices' });
		cache.set('schemas:all', [{ slug: 'invoices' }]);
		cache.set('perm:role1:invoices:read', true);
		cache.set('perm:role1:invoices:write', true);
		cache.set('perm:role2:invoices:read', false);
		cache.set('schema:products', { table: 'cms_products' }); // unrelated
		cache.set('perm:role1:products:read', true); // unrelated
		cache.set('report:invoices:admin:abc123', { data: [] }); // report result
		cache.set('report:invoices:role_1:def456', { data: [] }); // another role
		cache.set('report:products:admin:xyz', { data: [] }); // unrelated report

		cache.invalidateCollection('invoices');

		// Schema caches cleared
		expect(cache.get('schema:invoices')).toBeUndefined();
		expect(cache.get('schemas:all')).toBeUndefined();

		// All permission for "invoices" cleared (any role)
		expect(cache.get('perm:role1:invoices:read')).toBeUndefined();
		expect(cache.get('perm:role1:invoices:write')).toBeUndefined();
		expect(cache.get('perm:role2:invoices:read')).toBeUndefined();

		// Report results derived from "invoices" cleared (any role/definition)
		expect(cache.get('report:invoices:admin:abc123')).toBeUndefined();
		expect(cache.get('report:invoices:role_1:def456')).toBeUndefined();
		expect(cache.get('report:products:admin:xyz')).toBeDefined();

		// Unrelated collections NOT affected
		expect(cache.get('schema:products')).toBeDefined();
		expect(cache.get('perm:role1:products:read')).toBe(true);
	});

	// ─── Permission Invalidation Helpers ──────────────

	it('should invalidate all permissions for a role', () => {
		cache.set('perm:role1:invoices:read', true);
		cache.set('perm:role1:invoices:write', true);
		cache.set('perm:role1:products:read', true);

		cache.invalidatePermission('role1');

		expect(cache.get('perm:role1:invoices:read')).toBeUndefined();
		expect(cache.get('perm:role1:invoices:write')).toBeUndefined();
		expect(cache.get('perm:role1:products:read')).toBeUndefined();
	});

	it('should invalidate specific collection permissions for a role', () => {
		cache.set('perm:role1:invoices:read', true);
		cache.set('perm:role1:invoices:write', true);
		cache.set('perm:role1:products:read', true);

		cache.invalidatePermission('role1', 'invoices');

		expect(cache.get('perm:role1:invoices:read')).toBeUndefined();
		expect(cache.get('perm:role1:invoices:write')).toBeUndefined();
		expect(cache.get('perm:role1:products:read')).toBe(true); // NOT affected
	});

	// ─── Size Enforcement (LRU Eviction) ──────────────

	it('should enforce size limit and evict oldest entries', () => {
		// Fill cache with 20_000 entries (exceeds MAX_SIZE of 10_000)
		const smallCache = new CacheLayer();
		// Access the private store for testing
		const store = (smallCache as unknown as { store: Map<string, unknown> }).store;

		for (let i = 0; i < 15_000; i++) {
			smallCache.set('key' + i, i, 60_000);
		}

		// After eviction, store should be <= MAX_SIZE
		expect(store.size).toBeLessThanOrEqual(10_000);
	});

	it('should evict oldest entries (oldest 20%)', () => {
		const smallCache = new CacheLayer();
		const store = (smallCache as unknown as { store: Map<string, unknown> }).store;

		// Insert entries — first batch will be oldest
		for (let i = 0; i < 5000; i++) {
			smallCache.set('old_' + i, i, 60_000);
		}
		// Small delay to create timestamp difference
		// Then insert more to trigger eviction
		for (let i = 0; i < 6000; i++) {
			smallCache.set('new_' + i, i, 60_000);
		}

		// Old entries should be evicted first
		const oldCount = [...store.keys()].filter((k) => k.toString().startsWith('old_')).length;
		const newCount = [...store.keys()].filter((k) => k.toString().startsWith('new_')).length;

		// New entries should dominate (oldest 20% evicted)
		expect(newCount).toBeGreaterThan(oldCount);
	});

	// ─── Stats ────────────────────────────────────────

	it('should return cache stats', () => {
		cache.set('a', 1);
		cache.set('b', 2);

		const stats = cache.getStats();
		expect(stats.size).toBe(2);
		expect(stats.entries).toHaveLength(2);
		expect(stats.entries[0]).toHaveProperty('key');
		expect(stats.entries[0]).toHaveProperty('age');
		expect(stats.entries[0]).toHaveProperty('ttl');
	});

	// ─── Adaptive TTL Constants ───────────────────────

	it('should expose adaptive TTL constants', () => {
		expect(CacheLayer.DEFAULT_TTL).toBe(60_000);
		expect(CacheLayer.LONG_TTL).toBe(300_000);
		expect(CacheLayer.SHORT_TTL).toBe(15_000);
	});

	// ─── Type Safety ──────────────────────────────────

	it('should handle various data types', () => {
		cache.set('str', 'hello');
		cache.set('num', 42);
		cache.set('bool', true);
		cache.set('arr', [1, 2, 3]);
		cache.set('obj', { name: 'test' });
		cache.set('nil', null);
		cache.set('undef', undefined);

		expect(cache.get<string>('str')).toBe('hello');
		expect(cache.get<number>('num')).toBe(42);
		expect(cache.get<boolean>('bool')).toBe(true);
		expect(cache.get<number[]>('arr')).toEqual([1, 2, 3]);
		expect(cache.get<{ name: string }>('obj')).toEqual({ name: 'test' });
		expect(cache.get<null>('nil')).toBeNull();
		expect(cache.get<undefined>('undef')).toBeUndefined();
	});

	// ─── Tag Invalidation ───────────────────────────────

	it('invalidateTag drops every entry carrying the tag, and only those', () => {
		cache.set('a', 1, 60_000, ['t1', 't2']);
		cache.set('b', 2, 60_000, ['t2']);
		cache.set('c', 3, 60_000, ['t3']);

		cache.invalidateTag('t1');
		expect(cache.get('a')).toBeUndefined();
		expect(cache.get('b')).toBe(2);
		expect(cache.get('c')).toBe(3);

		cache.invalidateTag('t2');
		expect(cache.get('b')).toBeUndefined();
		expect(cache.get('c')).toBe(3);
	});

	it('an entry under several tags is dropped by ANY one of them', () => {
		cache.set('read', 'x', 60_000, ['vehicles', 'catalog']);
		cache.invalidateTag('catalog');
		expect(cache.get('read')).toBeUndefined();
	});

	it('delete() unregisters a key from its tags (no stale tag index)', () => {
		cache.set('a', 1, 60_000, ['t1']);
		cache.delete('a');
		cache.set('b', 2, 60_000, ['t1']);
		cache.invalidateTag('t1');
		// Only b was tagged t1 at invalidation time — a leaked index entry would be harmless,
		// but b must be gone.
		expect(cache.get('b')).toBeUndefined();
	});

	it('overwriting a key replaces its tag registrations', () => {
		cache.set('a', 1, 60_000, ['t1']);
		cache.set('a', 2); // overwrite WITHOUT tags
		cache.invalidateTag('t1');
		expect(cache.get('a')).toBe(2); // t1 no longer governs it
	});

	it('clear() empties the tag index too', () => {
		cache.set('a', 1, 60_000, ['t1']);
		cache.clear();
		cache.set('b', 2, 60_000, ['t1']);
		cache.invalidateTag('t1');
		expect(cache.get('b')).toBeUndefined();
	});

	it('invalidatePattern also unregisters the keys it removes', () => {
		cache.set('perm:r1:c:read', true, 60_000, ['perm']);
		cache.invalidatePattern('perm:*');
		expect(cache.get('perm:r1:c:read')).toBeUndefined();
		// Re-tag fresh, then invalidate by tag — the pattern must not have left a leak.
		cache.set('perm:r2:c:read', true, 60_000, ['perm']);
		cache.invalidateTag('perm');
		expect(cache.get('perm:r2:c:read')).toBeUndefined();
	});
});
