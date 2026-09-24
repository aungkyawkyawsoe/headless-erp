/**
 * Headless Response Cache — cost-efficient read caching for the entity engine.
 *
 * Policy-driven: a collection opt-in via `schema_json.policies.cache` (REST,
 * no code). When enabled, `listItems`/`getItem` results are cached keyed by
 * `(collection, auth-fingerprint, canonical-url)` so one user's data never leaks
 * to another, and every write to the collection invalidates it (tag-based).
 *
 * Pure + deterministic: same request → same key. No crypto (workerd-safe, sync).
 */
import { cache, CacheLayer, readDependencyTag } from '../cache/cache-layer';

/** Fast, deterministic, non-crypto string hash (workerd-safe, no async). */
export function fnv1a(str: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36);
}

/** Cache key for a read query: collection + auth-fingerprint + canonical URL. */
export function readCacheKey(collection: string, authFp: string, canonUrl: string): string {
	return `readc:${collection}:${authFp}:${fnv1a(canonUrl)}`;
}

export function readCached<T>(key: string): T | undefined {
	return cache.get<T>(key);
}

/** Store a read result, tagged with the OTHER collections its payload embeds.
 *
 *  A read that expands relations (`?fields=vehicle,model`) embeds rows from those
 *  collections, so a write to any of them must drop this entry — even though the
 *  WRITER only knows its own slug. `dependsOn` carries those slugs; each becomes a
 *  `readdep:<slug>` tag that `invalidateCollectionReads`/`invalidateCollection`
 *  clears. An own-rows-only read passes nothing and is invalidated by the key
 *  pattern alone. */
export function storeCached<T>(key: string, data: T, ttlMs: number, dependsOn?: string[]): void {
	cache.set(key, data, ttlMs, dependsOn && dependsOn.length > 0 ? dependsOn.map(readDependencyTag) : undefined);
}

/** Invalidate every cached read of a collection (any user) after a write.
 *
 *  `id` is OPTIONAL and purely informational: writers that know which row moved
 *  pass it so an observer can build a precise change envelope; callers that only
 *  know the collection (hook/plugin writes) omit it and the whole collection is
 *  reported. It never narrows the cache drop itself — the collection's reads are
 *  invalidated either way. */
export function invalidateCollectionReads(collection: string, id?: string | null): void {
	cache.invalidatePattern(`readc:${collection}:*`);
	// Reads of OTHER collections that embedded this one's rows (relation expansion).
	cache.invalidateTag(readDependencyTag(collection));
	readInvalidationObserver?.(collection, id ?? undefined);
}

/**
 * Observer notified on every `invalidateCollectionReads` call — the engine's
 * write paths already invalidate here, so this is the single seam that captures
 * the FULL set of collections a request changed (primary row + cascade parents
 * + hook/denorm writes). The API registers a request-scoped collector; nothing
 * else should rely on it being set (unset ⇒ no-op).
 */
type ReadInvalidationObserver = (collection: string, id?: string) => void;

let readInvalidationObserver: ReadInvalidationObserver | undefined;

export function setReadInvalidationObserver(observer?: ReadInvalidationObserver): void {
	readInvalidationObserver = observer;
}

export { CacheLayer };
