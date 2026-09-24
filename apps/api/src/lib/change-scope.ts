/**
 * Request-scoped change envelope — the write-side half of "zero-waste" reads.
 *
 * A write does not only change the row it targets: server hooks, cascade
 * recalcs, lookup/computed derivation and denorm hooks may touch OTHER
 * collections (e.g. a log row advancing a parent's denormalized total). Those
 * writes already call `invalidateCollectionReads(...)` to drop the server's read
 * cache; this module turns that same signal into a machine-readable envelope the
 * client can act on — instead of the client blindly invalidating a whole domain.
 *
 * Isolation: `AsyncLocalStorage` (available via the worker's `nodejs_compat`
 * flag) keeps each request's set private, so two interleaved requests in one
 * isolate can never see each other's changes. Outside a scope every call is a
 * harmless no-op.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** What a write touched — `collections` always, per-row ids when the writer knew them. */
export interface ChangeEnvelope {
	/** Every collection whose cached reads a client must invalidate. */
	collections: string[];
	/** Known changed row ids per collection (absent ⇒ invalidate the whole collection). */
	rows: Record<string, string[]>;
}

interface ChangeSet {
	collections: Map<string, Set<string>>;
}

const storage = new AsyncLocalStorage<ChangeSet>();

/** Run `fn` with a fresh change scope. All work inside reports into it. */
export function runWithChangeScope<T>(fn: () => T): T {
	return storage.run({ collections: new Map() }, fn);
}

/** Record that `collection` changed (a specific `id` when the writer knows it). */
export function recordChange(collection: string, id?: string | null): void {
	const set = storage.getStore();
	if (!set || !collection) return;
	let ids = set.collections.get(collection);
	if (!ids) {
		ids = new Set<string>();
		set.collections.set(collection, ids);
	}
	if (id) ids.add(id);
}

/**
 * The envelope for the CURRENT scope, or undefined when nothing changed (reads,
 * untouched requests). Stable ordering keeps responses byte-deterministic.
 */
export function snapshotChanges(): ChangeEnvelope | undefined {
	const set = storage.getStore();
	if (!set || set.collections.size === 0) return undefined;
	const collections = [...set.collections.keys()].sort();
	const rows: Record<string, string[]> = {};
	for (const [slug, ids] of set.collections) {
		if (ids.size > 0) rows[slug] = [...ids].sort();
	}
	return { collections, rows };
}
