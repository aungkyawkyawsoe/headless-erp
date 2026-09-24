/**
 * Conditional-GET cache — revalidation for read requests, optionally persisted.
 *
 * The API stamps a weak `ETag` on every successful GET. Replaying that tag as
 * `If-None-Match` lets an unchanged read answer `304 Not Modified`: no body
 * crosses the wire and the client keeps exactly what it already had. To honour
 * a 304 the client must still hold the previous body, so this store keeps the
 * tag together with the last `{ data, meta }` for that URL.
 *
 * Correctness needs no invalidation logic: the server decides equality, and a
 * matching tag is a hash of the very body it would send — so a hit is proof the
 * cached body is current. That is also why it is inherently safe per user: two
 * accounts can only share a tag when their payloads are byte-identical.
 *
 * ── Persistence (offline reads) ──────────────────────────────────────────────
 * An entry is written to `storage` ONLY when the server blessed the response with
 * `X-Offline-Max-Age` (the collection's `policies.offline_reads`), and only for
 * that many seconds. So the allowlist lives with the schema, is enforced by the
 * server per response, and a policy flip is reflected on the very next read — the
 * storage adapter carries no collection list of its own.
 *
 * A persisted body is a copy the server can no longer reach, so the envelope is
 * tagged with the auth fingerprint that wrote it: hydrate() discards a copy that
 * belongs to another account rather than serving it to this session.
 */

export interface CachedResponse {
	/** The `ETag` the server sent with this body. */
	etag: string;
	/** The parsed `data` of the last 200 for this URL. */
	data: unknown;
	/** The `meta` that accompanied it (pagination/count), if any. */
	meta?: Record<string, unknown>;
	/** Epoch ms the entry was stored — the clock the offline window runs on. */
	storedAt?: number;
	/** Server-granted offline window in seconds (`X-Offline-Max-Age`). Absent ⇒
	 *  the server did not authorize persisting this response. */
	maxAgeS?: number;
}

export interface PersistedResponse {
	key: string;
	entry: CachedResponse;
}

export interface ResponseCacheStorage {
	get(): PersistedResponse[];
	set(entries: PersistedResponse[]): void;
	/** Auth fingerprint the stored entries belong to (null = unclaimed/legacy). */
	getFingerprint?(): string | null;
	setFingerprint?(fp: string | null): void;
}

/** Every member present — the adapters here have nothing optional to omit. */
export type ConcreteResponseCacheStorage = Required<ResponseCacheStorage>;

export function memoryResponseCacheStorage(): ConcreteResponseCacheStorage {
	let entries: PersistedResponse[] = [];
	let fp: string | null = null;
	return {
		get: () => entries,
		set: (next) => (entries = next),
		getFingerprint: () => fp,
		setFingerprint: (next) => (fp = next),
	};
}

/**
 * localStorage-backed response store — survives a WebView reload. globalThis-
 * guarded (no DOM crash outside a browser). Persisted shape is a versioned
 * envelope `{ v: 1, fp, entries }`; `fp` is the auth fingerprint of the account
 * whose rows these are, so a device shared between two accounts never serves one
 * user's cached rows to the other.
 */
export function localStorageResponseStorage(key = 'mmbix-sdk-read-cache'): ConcreteResponseCacheStorage {
	const store = () =>
		(globalThis as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } }).localStorage;

	const readEnvelope = (): { fp: string | null; entries: PersistedResponse[] } => {
		try {
			const raw = store()?.getItem(key);
			if (!raw) return { fp: null, entries: [] };
			const parsed = JSON.parse(raw) as { fp?: unknown; entries?: unknown };
			if (parsed && typeof parsed === 'object' && Array.isArray(parsed.entries)) {
				return { fp: typeof parsed.fp === 'string' ? parsed.fp : null, entries: parsed.entries as PersistedResponse[] };
			}
			return { fp: null, entries: [] };
		} catch {
			return { fp: null, entries: [] };
		}
	};

	const write = (fp: string | null, entries: PersistedResponse[]): void => {
		try {
			store()?.setItem(key, JSON.stringify({ v: 1, fp, entries }));
		} catch {
			// Quota/private-mode — persistence is best-effort, never fatal.
		}
	};

	return {
		get: () => readEnvelope().entries,
		set: (entries) => write(readEnvelope().fp, entries),
		getFingerprint: () => readEnvelope().fp,
		setFingerprint: (fp) => write(fp, readEnvelope().entries),
	};
}

export class ConditionalResponseCache {
	/** Insertion-ordered Map doubles as the LRU: `get` re-inserts on hit. */
	private readonly store = new Map<string, CachedResponse>();
	private readonly maxEntries: number;
	private readonly storage?: ResponseCacheStorage;
	/** Cap on PERSISTED entries — a device store is far scarcer than memory. */
	private readonly maxPersisted: number;
	private hydrated = false;
	private fp: string | null = null;

	constructor(maxEntries = 200, storage?: ResponseCacheStorage, maxPersisted = 60) {
		this.maxEntries = maxEntries;
		this.storage = storage;
		this.maxPersisted = maxPersisted;
	}

	get(key: string): CachedResponse | undefined {
		const hit = this.store.get(key);
		if (!hit) return undefined;
		this.store.delete(key);
		this.store.set(key, hit);
		return hit;
	}

	set(key: string, entry: CachedResponse): void {
		this.store.delete(key);
		this.store.set(key, entry);
		while (this.store.size > this.maxEntries) {
			const oldest = this.store.keys().next().value;
			if (oldest === undefined) break;
			this.store.delete(oldest);
		}
		if (entry.maxAgeS !== undefined) this.persist();
	}

	delete(key: string): boolean {
		const removed = this.store.delete(key);
		if (removed && this.storage) this.persist();
		return removed;
	}

	/** Drop everything, memory AND device. Called on logout. */
	clear(): void {
		this.store.clear();
		this.storage?.set([]);
		this.storage?.setFingerprint?.(null);
		this.hydrated = true;
		this.fp = null;
	}

	get size(): number {
		return this.store.size;
	}

	/** May this entry be served without the network? */
	isFresh(entry: CachedResponse, now = Date.now()): boolean {
		return entry.maxAgeS !== undefined && entry.storedAt !== undefined && now - entry.storedAt < entry.maxAgeS * 1000;
	}

	/**
	 * Adopt device-persisted entries for `fingerprint`'s account. Idempotent per
	 * identity: a changed identity (login/logout/another account) drops the
	 * previous copy instead of letting it be replayed under the new session.
	 */
	hydrate(fingerprint: string | null): void {
		if (!this.storage) return;
		if (this.hydrated && fingerprint === this.fp) return;
		if (this.hydrated) {
			this.store.clear();
			this.storage.set([]);
			this.storage.setFingerprint?.(null);
		}
		this.fp = fingerprint;
		this.hydrated = true;

		const storedFp = this.storage.getFingerprint?.() ?? null;
		if (storedFp !== null && fingerprint !== null && storedFp !== fingerprint) {
			// Another account's device copy — never serve it to this session.
			this.storage.set([]);
			this.storage.setFingerprint?.(null);
			return;
		}
		if (storedFp === null && fingerprint !== null) this.storage.setFingerprint?.(fingerprint);

		const now = Date.now();
		for (const { key, entry } of this.storage.get()) {
			if (!this.isFresh(entry, now) || this.store.has(key)) continue;
			this.store.set(key, entry);
		}
	}

	/** Write the persistable (server-blessed, unexpired) entries to the device. */
	private persist(): void {
		if (!this.storage) return;
		const entries: PersistedResponse[] = [];
		for (const [key, entry] of this.store) {
			if (entry.maxAgeS !== undefined && this.isFresh(entry)) entries.push({ key, entry });
		}
		this.storage.set(entries.slice(-this.maxPersisted));
		this.storage.setFingerprint?.(this.fp);
	}
}
