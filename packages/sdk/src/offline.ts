/**
 * Offline mutation queue — formalized from the miniapp's offline.ts pattern.
 *
 * Writes that fail at the network level are stashed here and replayed when
 * connectivity returns. Replays are idempotent by construction: POST bodies
 * carry a client-generated UUID (`id`), so a replayed create can never
 * duplicate a row (the API is idempotent on the primary key) — and a 409 on
 * replay means the row already landed, which is treated as success.
 *
 * Framework-agnostic: storage + fetch + token are injected, so the same queue
 * runs in the browser, a Cloudflare Worker, or Node.
 */
import { tokenSubjectOf } from './auth';
export interface QueuedMutation {
	/** Client UUID — replay-safe identity (POST bodies carry it as `id`). */
	id: string;
	method: 'POST' | 'PUT' | 'DELETE';
	/** Path relative to the API base, e.g. `/entities/records`. */
	path: string;
	body?: unknown;
	/** Optimistic-concurrency token captured when the write was queued. */
	ifMatch?: string | null;
	/** Stable idempotency key captured when the write was queued — replays reuse it. */
	idempotencyKey?: string | null;
	createdAt: number;
}

/**
 * Stable dependency-free string hash (FNV-1a 32-bit) — used to fingerprint the
 * auth identity device-local state belongs to. NOT cryptographic: the token it
 * hashes already lives in the same storage, so this is an equality check ("same
 * user"), not a secret. Synchronous so it works in the browser AND Node without
 * awaits.
 */
export function fingerprint(value: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		h ^= value.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

export interface QueueStorage {
	get(): QueuedMutation[];
	set(items: QueuedMutation[]): void;
	/** Auth fingerprint of the user the stored items belong to (null = unclaimed/legacy). */
	getFingerprint?(): string | null;
	setFingerprint?(fp: string | null): void;
}

export function memoryQueueStorage(): QueueStorage {
	let items: QueuedMutation[] = [];
	let fp: string | null = null;
	return {
		get: () => items,
		set: (next) => (items = next),
		getFingerprint: () => fp,
		setFingerprint: (next) => (fp = next),
	};
}

/**
 * localStorage-backed queue — survives reloads. globalThis-guarded (no DOM crash).
 *
 * Persisted shape is a versioned envelope `{ v: 2, fp, items }` where `fp` is the
 * auth fingerprint of the user who queued the writes (null = unclaimed). Legacy
 * v1 keys (a bare array) are read transparently and adopted on first write.
 */
export function localStorageQueueStorage(key = 'mmbix-sdk-offline-queue'): QueueStorage {
	const store = () =>
		(globalThis as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } }).localStorage;

	const readEnvelope = (): { fp: string | null; items: QueuedMutation[] } => {
		try {
			const raw = store()?.getItem(key);
			if (!raw) return { fp: null, items: [] };
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) return { fp: null, items: parsed as QueuedMutation[] }; // legacy v1
			if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)) {
				const env = parsed as { fp?: unknown; items: QueuedMutation[] };
				return { fp: typeof env.fp === 'string' ? env.fp : null, items: env.items };
			}
			return { fp: null, items: [] };
		} catch {
			return { fp: null, items: [] };
		}
	};

	const write = (fp: string | null, items: QueuedMutation[]): void => {
		try {
			store()?.setItem(key, JSON.stringify({ v: 2, fp, items }));
		} catch {
			/* storage unavailable — the in-memory copy still works this session */
		}
	};

	return {
		get() {
			return readEnvelope().items;
		},
		set(items) {
			write(readEnvelope().fp, items);
		},
		getFingerprint() {
			return readEnvelope().fp;
		},
		setFingerprint(fp) {
			write(fp, readEnvelope().items);
		},
	};
}

export interface OfflineQueueOptions {
	storage?: QueueStorage;
	/** API base prefix — default `/api`. */
	baseUrl?: string;
	/** Supplies the bearer token used when replaying (may have rotated). */
	getToken?: () => string | null;
	/**
	 * Stable per-user identity used to scope the queue (defaults to a hash of the
	 * token's ACCOUNT subject — see `tokenSubjectOf`). The stored queue is tagged
	 * with this fingerprint so writes queued by one account are never replayed
	 * under another.
	 */
	fingerprint?: () => string | null;
	fetchImpl?: typeof fetch;
	/** Called after each successful replay. */
	onReplayed?: (item: QueuedMutation) => void;
	/** Called when a replay attempt fails — the item stays queued. */
	onFailed?: (item: QueuedMutation, error: unknown) => void;
}

export interface OfflineQueue {
	enqueue(
		method: QueuedMutation['method'],
		path: string,
		body?: unknown,
		ifMatch?: string | null,
		idempotencyKey?: string | null,
	): QueuedMutation;
	/** All pending mutations, oldest first. */
	pending(): QueuedMutation[];
	/** Drop everything (e.g. after logout). */
	clear(): void;
	/** Subscribe to queue changes (drives sync banners). Returns unsubscribe. */
	subscribe(listener: () => void): () => void;
	/** Replay all pending mutations in order. Resolves with the replayed count. */
	flush(): Promise<number>;
}

export function createOfflineQueue(options: OfflineQueueOptions = {}): OfflineQueue {
	const storage = options.storage ?? memoryQueueStorage();
	const baseUrl = (options.baseUrl ?? '/api').replace(/\/+$/, '');
	// Resolved LAZILY at flush time so a fetch stub/polyfill installed after
	// queue construction (tests, mock service workers) is honored.
	const fetchImpl = () => options.fetchImpl ?? (globalThis as { fetch: typeof fetch }).fetch;
	const listeners = new Set<() => void>();
	const emit = () => listeners.forEach((l) => l());

	// Current user's fingerprint (null when no token — e.g. public/anon writes).
	// Hashes the token's ACCOUNT subject, never the token bytes: the server mints a
	// fresh token on every login/refresh, so a byte-wise hash would read the same
	// human as a different account and strand their pending writes.
	const currentFingerprint = (): string | null => {
		if (options.fingerprint) return options.fingerprint();
		const token = options.getToken?.();
		return token ? fingerprint(tokenSubjectOf(token)) : null;
	};

	return {
		enqueue(method, path, body, ifMatch, idempotencyKey) {
			const fp = currentFingerprint();
			const stored = storage.getFingerprint?.() ?? null;
			if (stored !== null && fp !== null && stored !== fp) {
				// A different account's session — never mix accounts in one queue. Any
				// pending writes are dropped (they can never be replayed by the right
				// account from this device) and the tag moves to the writing identity. An
				// EMPTY queue has nothing to drop, so it just adopts the new identity
				// instead of warning about writes that do not exist.
				if (storage.get().length > 0) {
					console.warn('[mmbix-sdk] offline queue: auth identity changed — discarding queued mutations from the previous session');
					storage.set([]);
				}
				storage.setFingerprint?.(fp);
			} else if (stored === null && fp !== null) {
				// Unclaimed/legacy queue — adopt it for this identity.
				storage.setFingerprint?.(fp);
			}
			const item: QueuedMutation = {
				id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Date.now()),
				method,
				path,
				body,
				ifMatch: ifMatch ?? null,
				idempotencyKey: idempotencyKey ?? null,
				createdAt: Date.now(),
			};
			storage.set([...storage.get(), item]);
			emit();
			return item;
		},

		pending: () => storage.get(),

		clear() {
			storage.set([]);
			storage.setFingerprint?.(null);
			emit();
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		async flush(): Promise<number> {
			const items = storage.get();
			// Cross-account guard: a queue left by ANOTHER user must never replay
			// under the current token. Keep the items intact (no data loss — the
			// owning user may return) and surface the mismatch instead. With nothing
			// queued there is nothing to protect: adopt the current identity silently,
			// or a re-minted token would warn on every boot forever.
			const fp = currentFingerprint();
			const stored = storage.getFingerprint?.() ?? null;
			if (stored !== null && fp !== null && stored !== fp) {
				if (items.length === 0) {
					storage.setFingerprint?.(fp);
					return 0;
				}
				console.warn(
					'[mmbix-sdk] offline queue: stored mutations belong to a different account — skipping replay; call clearQueue() to discard',
				);
				return 0;
			}
			if (stored === null && fp !== null) storage.setFingerprint?.(fp);
			const remaining: QueuedMutation[] = [];
			let replayed = 0;

			for (const item of items) {
				try {
					const headers: Record<string, string> = { 'Content-Type': 'application/json' };
					const token = options.getToken?.();
					if (token) headers['Authorization'] = `Bearer ${token}`;
					if (item.ifMatch) headers['If-Match'] = item.ifMatch;
					// A keyed replay that already landed gets the middleware's cached 2xx
					// instead of a duplicate write — never a double-apply on reconnect.
					if (item.idempotencyKey) headers['Idempotency-Key'] = item.idempotencyKey;

					const init: RequestInit = { method: item.method, headers };
					if (item.body !== undefined) init.body = JSON.stringify(item.body);

					const res = await fetchImpl()(`${baseUrl}${item.path}`, init);
					// 2xx = applied now; 409 = the write already landed (duplicate replay
					// of an idempotent create) — both are success. EXCEPT a 409 on a queued
					// write that carried `ifMatch`: that is a REAL optimistic-concurrency
					// rejection — the record moved while offline, the server refused the
					// stale write. Permanent: drop it (surfaced via onFailed), never count
					// it as replayed. Other 4xx (non-409) are permanent client errors too:
					// retrying can never help, so the item is DROPPED instead of retried
					// forever. 5xx/network stay queued for the next attempt.
					if (item.ifMatch && res.status === 409) {
						options.onFailed?.(item, new Error('Replay conflict: the record changed while offline (If-Match mismatch)'));
					} else if (res.ok || res.status === 409) {
						replayed++;
						options.onReplayed?.(item);
					} else if (res.status < 500) {
						options.onFailed?.(item, new Error(`Replay dropped: permanent client error ${res.status}`));
					} else {
						remaining.push(item);
						options.onFailed?.(item, new Error(`Replay failed with ${res.status}`));
					}
				} catch (err) {
					// Still offline — keep the item and stop trying the rest this pass.
					remaining.push(item);
					options.onFailed?.(item, err);
				}
			}

			if (remaining.length !== items.length) {
				storage.set(remaining);
				emit(); // something was replayed or dropped
			}
			return replayed;
		},
	};
}
