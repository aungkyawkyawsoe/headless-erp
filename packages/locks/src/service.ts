/**
 * LockService — distributed mutex with leases, built on LockDO.
 *
 * One DO instance per lock name → atomic acquire/release across every isolate
 * of every worker that binds the namespace. A crashed holder's lease expires
 * (ttlMs); same-owner re-acquire refreshes (reentrant).
 *
 *   await locks.withLock('inventory:sku-1', async () => { … }, { timeoutMs });
 *   const h = await locks.tryAcquire('batch:orders', 30_000); // or null
 */

import { LockHandle } from './handle';

export interface LockEnv {
	/** DO namespace binding (class `LockDO`). */
	LOCK?: DurableObjectNamespace;
}

export interface LockOptions {
	/** Lease duration in ms (default 60s). */
	ttlMs?: number;
	/** Base poll interval while waiting (default 100ms). */
	waitMs?: number;
	/** How long to keep trying before giving up (default 30s). */
	timeoutMs?: number;
}

/** Thrown by withLock when the lock could not be acquired in time. */
export class LockTimeoutError extends Error {
	constructor(name: string) {
		super(`could not acquire lock "${name}" within the timeout`);
		this.name = 'LockTimeoutError';
	}
}

const LOCK_PREFIX = 'lock:';

/**
 * Renew a held lease on an interval so a long-running critical section never
 * silently loses the lock to another caller mid-flight (lease-TTL bypass →
 * concurrent execution). Renewals fire at half the TTL; a failed renewal means
 * the lease was lost (or the DO is unreachable) — the caller keeps running but
 * the next interval retries, and release() stays owner-scoped and safe.
 */
function startRenewer(handle: LockHandle, ttlMs: number): ReturnType<typeof setInterval> {
	const interval = Math.max(1_000, Math.floor(ttlMs / 2));
	return setInterval(() => {
		void handle.renew(ttlMs).catch(() => {});
	}, interval);
}

function stopRenewer(renewer: ReturnType<typeof setInterval>): void {
	clearInterval(renewer);
}

export class LockService {
	constructor(private readonly env: LockEnv) {}

	private stub(name: string): DurableObjectStub {
		const ns = this.env.LOCK;
		if (!ns) throw new Error('LOCK DO binding is not configured');
		return ns.get(ns.idFromName(LOCK_PREFIX + name));
	}

	/** Try once — returns a handle or null when the lock is held. */
	async tryAcquire(name: string, ttlMs = 60_000): Promise<LockHandle | null> {
		return this.acquire(name, { ttlMs, timeoutMs: 0 });
	}

	/** Acquire, waiting (with backoff) until `timeoutMs`; null on timeout. */
	async acquire(name: string, opts: LockOptions = {}): Promise<LockHandle | null> {
		const ttlMs = opts.ttlMs ?? 60_000;
		const timeoutMs = opts.timeoutMs ?? 30_000;
		const waitMs = opts.waitMs ?? 100;
		const owner = crypto.randomUUID();
		const deadline = Date.now() + timeoutMs;
		let backoff = waitMs;

		for (;;) {
			const res = await this.stub(name).fetch('https://lock/acquire', {
				method: 'POST',
				body: JSON.stringify({ name, owner, ttlMs }),
			});
			const data = (await res.json()) as { acquired: boolean; expiresAt?: number };
			if (data.acquired) {
				return new LockHandle(this, name, owner, ttlMs, data.expiresAt ?? Date.now() + ttlMs);
			}
			if (Date.now() >= deadline) return null;
			await new Promise((r) => setTimeout(r, backoff));
			backoff = Math.min(backoff * 2, 1000);
		}
	}

	/** Acquire → run → release (always releases, even on error). */
	async withLock<T>(name: string, fn: () => Promise<T> | T, opts: LockOptions = {}): Promise<T> {
		const handle = await this.acquire(name, opts);
		if (!handle) throw new LockTimeoutError(name);
		const renewer = startRenewer(handle, opts.ttlMs ?? 60_000);
		try {
			return await fn();
		} finally {
			stopRenewer(renewer);
			await handle.release().catch(() => {});
		}
	}

	/** Run only if the lock is free — returns null when it is held. */
	async tryWithLock<T>(name: string, fn: () => Promise<T> | T, ttlMs = 60_000): Promise<T | null> {
		const handle = await this.tryAcquire(name, ttlMs);
		if (!handle) return null;
		const renewer = startRenewer(handle, ttlMs);
		try {
			return await fn();
		} finally {
			stopRenewer(renewer);
			await handle.release().catch(() => {});
		}
	}

	/** Release a lock (owner-scoped — wrong owners are rejected). */
	async release(name: string, owner: string): Promise<boolean> {
		const res = await this.stub(name).fetch('https://lock/release', {
			method: 'POST',
			body: JSON.stringify({ name, owner }),
		});
		const data = (await res.json()) as { released: boolean };
		return data.released;
	}

	/** Extend a held lease (owner-scoped). */
	async renew(name: string, owner: string, ttlMs = 60_000): Promise<{ renewed: boolean; expiresAt: number }> {
		const res = await this.stub(name).fetch('https://lock/renew', {
			method: 'POST',
			body: JSON.stringify({ name, owner, ttlMs }),
		});
		return (await res.json()) as { renewed: boolean; expiresAt: number };
	}

	/** Inspect a lock without touching it. */
	async status(name: string): Promise<{ locked: boolean; owner: string | null; expiresAt: number | null }> {
		const res = await this.stub(name).fetch('https://lock/status', {
			method: 'POST',
			body: JSON.stringify({ name }),
		});
		return (await res.json()) as { locked: boolean; owner: string | null; expiresAt: number | null };
	}
}
