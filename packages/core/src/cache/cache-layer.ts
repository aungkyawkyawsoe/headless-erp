/**
 * Centralized Cache Layer — Tag-based invalidation
 *
 * Replaces the 3 independent cache layers (CollectionService._schemaCache,
 * CollectionService._allSchemasCache, PermissionEvaluator._businessCache)
 * with a single store that supports pattern-based invalidation.
 *
 * Fixes:
 *   7A - Stale reads after collection create/update/delete
 *   7B - Permission cache not invalidated on schema changes
 *   7C - Missing invalidation on entity schema update
 *   7D - Static TTL (now per-entry adaptive TTL)
 *
 * All caches that previously lived in CollectionService and PermissionEvaluator
 * now delegate to this single instance (shared via module-level singleton).
 */

// ─── Types ─────────────────────────────────────────────

type CacheTag = string; // e.g. "schema:invoices", "schemas:all", "perm:role_1:invoices:read"

interface CacheEntry<T> {
	data: T;
	ts: number;
	ttl: number;
	/** Tags this entry is registered under — so a delete is O(tags) to unregister. */
	tags?: string[];
}

export interface CacheStats {
	size: number;
	entries: Array<{ key: string; age: number; ttl: number }>;
}

// ─── Cache Layer ───────────────────────────────────────

export class CacheLayer {
	private store = new Map<CacheTag, CacheEntry<unknown>>();
	/** Reverse index for tag invalidation: tag → the keys currently carrying it. */
	private tags = new Map<string, Set<CacheTag>>();

	/** Max entries before eviction kicks in */
	private static readonly MAX_SIZE = 10_000;

	/** Default TTL in milliseconds */
	static readonly DEFAULT_TTL = 60_000; // 60s

	/** TTL for rarely-changed data */
	static readonly LONG_TTL = 300_000; // 5min

	/** TTL for frequently-changed data */
	static readonly SHORT_TTL = 15_000; // 15s

	// ── Core Operations ─────────────────────────────────

	/**
	 * Get a cached value. Returns undefined if missing or expired.
	 */
	get<T>(key: CacheTag): T | undefined {
		const entry = this.store.get(key);
		if (!entry) return undefined;
		if (Date.now() - entry.ts > entry.ttl) {
			this.delete(key);
			return undefined;
		}
		return entry.data as T;
	}

	/**
	 * Set a cached value with optional per-entry TTL and invalidation tags.
	 *
	 * Tags are a SECOND invalidation axis keyed by semantics rather than key
	 * shape: a cache key can only be pattern-matched left-to-right, so an entry
	 * that depends on several things (e.g. a read embedding rows from three
	 * collections) needs a way to be dropped when ANY of them changes. Overwriting
	 * an existing key first drops its old tag registrations, so the index never
	 * accumulates stale keys.
	 */
	set<T>(key: CacheTag, data: T, ttl?: number, tags?: string[]): void {
		// Overwriting must clear previous tags, or the reverse index would point at
		// this key under tags the new value no longer belongs to.
		if (this.store.has(key)) this.delete(key);
		this._enforceSize();
		const unique = tags && tags.length > 0 ? [...new Set(tags)] : undefined;
		this.store.set(key, {
			data,
			ts: Date.now(),
			ttl: ttl ?? CacheLayer.DEFAULT_TTL,
			tags: unique,
		});
		if (unique) {
			for (const tag of unique) {
				let keys = this.tags.get(tag);
				if (!keys) {
					keys = new Set();
					this.tags.set(tag, keys);
				}
				keys.add(key);
			}
		}
	}

	/**
	 * Delete a specific key (and unregister it from every tag it carried).
	 */
	delete(key: CacheTag): boolean {
		const entry = this.store.get(key);
		if (!entry) return false;
		this.store.delete(key);
		if (entry.tags) {
			for (const tag of entry.tags) {
				const keys = this.tags.get(tag);
				if (!keys) continue;
				keys.delete(key);
				if (keys.size === 0) this.tags.delete(tag);
			}
		}
		return true;
	}

	/**
	 * Check if a key exists and is not expired.
	 */
	has(key: CacheTag): boolean {
		const entry = this.store.get(key);
		if (!entry) return false;
		if (Date.now() - entry.ts > entry.ttl) {
			this.delete(key);
			return false;
		}
		return true;
	}

	/**
	 * Clear all entries.
	 */
	clear(): void {
		this.store.clear();
		this.tags.clear();
	}

	// ── Tag-Based Invalidation ──────────────────────────

	/**
	 * Invalidate all entries matching a glob-like pattern.
	 * Pattern uses `*` as wildcard (converted to `.*` regex).
	 *
	 * Examples:
	 *   invalidatePattern('schema:*')     → clears all schema entries
	 *   invalidatePattern('perm:*')       → clears all permission entries
	 *   invalidatePattern('perm:*:invoices:*') → clears all perms for "invoices"
	 */
	invalidatePattern(pattern: string): void {
		const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
		const regex = new RegExp('^' + escaped + '$');
		// Snapshot first: delete() mutates the store (and the tag index) as it goes.
		for (const key of [...this.store.keys()]) {
			if (regex.test(key)) this.delete(key);
		}
	}

	/**
	 * Invalidate every entry registered under `tag` (any key shape).
	 *
	 * This is the multi-dependency counterpart of `invalidatePattern`: a read whose
	 * body embeds OTHER collections' rows is tagged with each of them, so one write
	 * drops it regardless of where in the key those dependencies sit. O(keys ∩ tag).
	 */
	invalidateTag(tag: string): void {
		const keys = this.tags.get(tag);
		if (!keys || keys.size === 0) {
			this.tags.delete(tag);
			return;
		}
		// Copy before deleting — delete() unregisters from this same Set.
		for (const key of [...keys]) this.delete(key);
		this.tags.delete(tag);
	}

	/**
	 * Invalidate all caches related to a collection (schema + permissions).
	 * Should be called after ANY collection mutation (create/update/delete).
	 *
	 * This is the single entry point that FIXES 7A+7B+7C —
	 * all cache layers are invalidated atomically.
	 */
	invalidateCollection(slug: string): void {
		// Schema caches — full rows (`schemas:all`) AND the lean registry rows
		// (`schemas:summaries`) both describe every collection, so either list
		// must be dropped when one changes.
		this.delete(`schema:${slug}`);
		// The RAW `_entity_schemas` row serving the schema-plane detail route is a
		// second derivation of the same row (`schema:<slug>:raw`); it must not
		// outlive the mutation either. Named under the `schema:*` family so the
		// slug-less `invalidatePattern('schema:*')` path clears it too.
		this.delete(`schema:${slug}:raw`);
		this.delete('schemas:all');
		this.delete('schemas:summaries');

		// All permission entries for this collection (any role, any action)
		this.invalidatePattern(`perm:*:${slug}:*`);

		// Report results derived from this collection (any role/definition)
		this.invalidatePattern(`report:${slug}:*`);

		// Response-cache payloads shaped under the OLD field set / row policy.
		// A field rename/type change or policy toggle must never keep serving
		// stale-shaped rows until the TTL expires.
		this.invalidatePattern(`readc:${slug}:*`);

		// Reads of OTHER collections that EMBEDDED this collection's rows (relation
		// expansion) are tagged `readdep:<slug>` — a schema/policy change here makes
		// their embedded copy stale just as a row write does.
		this.invalidateTag(readDependencyTag(slug));
	}

	/**
	 * Invalidate permission cache for a role (all collections or specific).
	 *
	 * @param roleId - The role whose permissions changed
	 * @param collectionSlug - Optional: only invalidate for this collection
	 */
	invalidatePermission(roleId: string, collectionSlug?: string): void {
		const pattern = collectionSlug ? `perm:${roleId}:${collectionSlug}:*` : `perm:${roleId}:*`;
		this.invalidatePattern(pattern);
	}

	// ── Stats & Debugging ───────────────────────────────

	getStats(): CacheStats {
		const now = Date.now();
		const entries = [...this.store.entries()].map(([key, val]) => ({
			key,
			age: now - val.ts,
			ttl: val.ttl,
		}));
		return { size: this.store.size, entries };
	}

	// ── Private ─────────────────────────────────────────

	private _enforceSize(): void {
		if (this.store.size < CacheLayer.MAX_SIZE) return;
		const now = Date.now();
		// Prefer evicting expired entries first — free win, no live data dropped.
		// Routed through delete() so the tag index stays in sync.
		for (const [key, entry] of [...this.store]) {
			if (now - entry.ts > entry.ttl) this.delete(key);
		}
		if (this.store.size < CacheLayer.MAX_SIZE) return;
		// Otherwise evict the oldest-inserted key (O(1)) — Map preserves
		// insertion order, so the first key is the oldest write. Amortized O(1)
		// per set() at capacity instead of a full-store sort (O(n log n)).
		// Routed through delete() so the tag index stays in sync.
		const oldestKey = this.store.keys().next().value;
		if (oldestKey !== undefined) this.delete(oldestKey);
	}
}

/**
 * Canonical tag for a response-cache entry that EMBEDS another collection's rows
 * (relation expansion). Tagging by the embedded collection lets `invalidateCollection`
 * and `invalidateCollectionReads` drop every reader that embedded it, without those
 * readers having to know who they are. Single definition so the producer
 * (`@mmbix/core` response-cache) and the consumer (`invalidateCollection`) can never
 * drift apart on the tag shape.
 */
export function readDependencyTag(collection: string): string {
	return `readdep:${collection}`;
}

// ─── Module-Level Singleton ─────────────────────────────

/**
 * Shared cache instance used by CollectionService and PermissionEvaluator.
 * Lives for the lifetime of the Worker isolate and persists ACROSS requests
 * in that isolate (Workers reuse an isolate for many requests). Because D1 is
 * global while this store is per-isolate, entries use adaptive TTLs (default
 * 60s) — a schema change applied through a different isolate propagates here
 * within one TTL window instead of forever. Cross-request sharing beyond a
 * single isolate needs Cloudflare KV or Durable Objects.
 */
export const cache = new CacheLayer();
