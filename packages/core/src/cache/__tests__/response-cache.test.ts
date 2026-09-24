import { describe, it, expect, afterEach } from 'vitest';
import { fnv1a, readCacheKey, readCached, storeCached, invalidateCollectionReads, setReadInvalidationObserver } from '../response-cache';
import { cache } from '../cache-layer';

describe('ResponseCache helpers', () => {
	it('fnv1a is deterministic and collision-resistant enough for cache keys', () => {
		expect(fnv1a('hr_tasks?filter[assignee_tg_id][_eq]=2')).toBe(fnv1a('hr_tasks?filter[assignee_tg_id][_eq]=2'));
		expect(fnv1a('a')).not.toBe(fnv1a('b'));
		expect(fnv1a('')).toBe(fnv1a(''));
	});

	it('readCacheKey scopes by collection + auth-fingerprint + canonical url', () => {
		const u1 = readCacheKey('orders', 'user_1', '?status=pending');
		const u2 = readCacheKey('orders', 'user_2', '?status=pending');
		const u3 = readCacheKey('orders', 'user_1', '?status=paid');
		expect(u1 === u2).toBe(false); // different users never share a key (no leak)
		expect(u1 === u3).toBe(false); // different queries never share a key
	});

	it('auth-scoped keys prevent cross-user cache hits', () => {
		const a = readCacheKey('orders', 'user_a', '?limit=10');
		const b = readCacheKey('orders', 'user_b', '?limit=10');
		expect(a).not.toBe(b);
	});
});

describe('read-invalidation observer (change-envelope seam)', () => {
	afterEach(() => setReadInvalidationObserver(undefined));

	it('reports the collection and optional row id on every invalidation', () => {
		const seen: Array<[string, string | undefined]> = [];
		setReadInvalidationObserver((collection, id) => seen.push([collection, id]));

		invalidateCollectionReads('mro_inbounds', 'inv-1');
		invalidateCollectionReads('mro_inventory');

		expect(seen).toEqual([
			['mro_inbounds', 'inv-1'],
			['mro_inventory', undefined],
		]);
	});

	it('is a harmless no-op with no observer registered', () => {
		expect(() => invalidateCollectionReads('x', 'y')).not.toThrow();
	});
});

/**
 * Dependency (relation) tagging — the mechanism that makes a relation-expanded
 * read safely cacheable. The entry is dropped when ANY collection it embeds is
 * written, even though the writer only knows its own slug.
 */
describe('response cache — dependency tagging', () => {
	afterEach(() => cache.clear());

	const key = () => readCacheKey('orders', 'admin', '?fields=id,customer');

	it('drops a read tagged with an embedded collection when that collection is written', () => {
		const k = key();
		storeCached(k, { data: [] }, 60_000, ['customers']);
		expect(readCached(k)).toBeDefined();
		invalidateCollectionReads('customers');
		expect(readCached(k)).toBeUndefined();
	});

	it('drops the entry when the read OWN collection is written (key pattern)', () => {
		const k = key();
		storeCached(k, { data: [] }, 60_000, ['customers']);
		invalidateCollectionReads('orders');
		expect(readCached(k)).toBeUndefined();
	});

	it('leaves it cached when an UNRELATED collection is written', () => {
		const k = key();
		storeCached(k, { data: [] }, 60_000, ['customers']);
		invalidateCollectionReads('products');
		expect(readCached(k)).toBeDefined();
	});

	it('an own-rows-only read (no dependencies) survives a dependency-shaped write', () => {
		const k = key();
		storeCached(k, { data: [] }, 60_000);
		invalidateCollectionReads('customers');
		expect(readCached(k)).toBeDefined();
	});
});
