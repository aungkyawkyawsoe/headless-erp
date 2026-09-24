/**
 * LockDO — one Durable Object per lock name (`lock:<name>`), on demand.
 *
 * The DO instance IS the lock owner: workerd serializes requests per instance,
 * so the acquire/release logic is atomic across every isolate of every worker
 * that binds the namespace. Leases are time-based (expires_at) — a crashed
 * holder's lock expires naturally; a matching owner can renew/re-acquire
 * (reentrant).
 *
 * RPC surface (called by LockService over the stub):
 *   POST /acquire { name, owner, ttlMs } → { acquired, owner?, expiresAt?, stolen? }
 *   POST /release { name, owner }        → { released }
 *   POST /renew   { name, owner, ttlMs } → { renewed, expiresAt }
 *   GET  /status  { name }               → { locked, owner?, expiresAt? }
 */

const LOCK_TABLE = `CREATE TABLE IF NOT EXISTS locks (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL)`;

function json(body: unknown, status = 200): Response {
	return Response.json(body, { status });
}

/** First row or undefined — `one()` throws on empty result sets. */
function firstRow<T extends Record<string, unknown>>(cursor: SqlStorageCursor<Record<string, SqlStorageValue>>): T | undefined {
	const rows = cursor.toArray() as unknown as T[];
	return rows[0];
}

export class LockDO {
	private readonly sql: SqlStorage;

	constructor(
		private readonly ctx: DurableObjectState,
		_env: unknown,
	) {
		this.sql = ctx.storage.sql;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		try {
			switch (url.pathname) {
				case '/acquire': {
					const { name, owner, ttlMs } = (await request.json()) as { name?: string; owner?: string; ttlMs?: number };
					const res = this.acquire(String(name ?? ''), String(owner ?? ''), Math.max(1, ttlMs ?? 60_000));
					return json(res);
				}
				case '/release': {
					const { name, owner } = (await request.json()) as { name?: string; owner?: string };
					return json(this.release(String(name ?? ''), String(owner ?? '')));
				}
				case '/renew': {
					const { name, owner, ttlMs } = (await request.json()) as { name?: string; owner?: string; ttlMs?: number };
					return json(this.renew(String(name ?? ''), String(owner ?? ''), Math.max(1, ttlMs ?? 60_000)));
				}
				case '/status': {
					const { name } = (await request.json()) as { name?: string };
					return json(this.status(String(name ?? '')));
				}
				default:
					return json({ ok: false, error: `unknown path ${url.pathname}` }, 404);
			}
		} catch (err) {
			return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
		}
	}

	private ensure(): void {
		this.sql.exec(LOCK_TABLE);
	}

	private acquire(name: string, owner: string, ttlMs: number): Record<string, unknown> {
		if (!name) throw new Error('lock name is required');
		if (!owner) throw new Error('lock owner is required');
		this.ensure();
		const now = Date.now();
		const expiresAt = now + ttlMs;
		const row = firstRow<{ owner: string; expires_at: number }>(this.sql.exec('SELECT owner, expires_at FROM locks WHERE name = ?', name));

		if (!row) {
			this.sql.exec('INSERT INTO locks (name, owner, expires_at) VALUES (?, ?, ?)', name, owner, expiresAt);
			return { acquired: true, owner, expiresAt };
		}
		if (row.owner === owner) {
			// Reentrant — refresh the lease.
			this.sql.exec('UPDATE locks SET expires_at = ? WHERE name = ?', expiresAt, name);
			return { acquired: true, owner, expiresAt, reentrant: true };
		}
		if (Number(row.expires_at) <= now) {
			// Lease expired — take over (the previous holder is gone).
			this.sql.exec('UPDATE locks SET owner = ?, expires_at = ? WHERE name = ?', owner, expiresAt, name);
			return { acquired: true, owner, expiresAt, stolen: true };
		}
		return { acquired: false, owner: row.owner, expiresAt: Number(row.expires_at) };
	}

	private release(name: string, owner: string): { released: boolean } {
		this.ensure();
		const row = firstRow<{ owner: string }>(this.sql.exec('SELECT owner FROM locks WHERE name = ?', name));
		if (!row || row.owner !== owner) return { released: false };
		this.sql.exec('DELETE FROM locks WHERE name = ? AND owner = ?', name, owner);
		return { released: true };
	}

	private renew(name: string, owner: string, ttlMs: number): { renewed: boolean; expiresAt: number } {
		this.ensure();
		const row = firstRow<{ owner: string }>(this.sql.exec('SELECT owner FROM locks WHERE name = ?', name));
		if (!row || row.owner !== owner) return { renewed: false, expiresAt: 0 };
		const expiresAt = Date.now() + ttlMs;
		this.sql.exec('UPDATE locks SET expires_at = ? WHERE name = ? AND owner = ?', expiresAt, name, owner);
		return { renewed: true, expiresAt };
	}

	private status(name: string): { locked: boolean; owner: string | null; expiresAt: number | null } {
		this.ensure();
		const row = firstRow<{ owner: string; expires_at: number }>(this.sql.exec('SELECT owner, expires_at FROM locks WHERE name = ?', name));
		if (!row || Number(row.expires_at) <= Date.now()) return { locked: false, owner: null, expiresAt: null };
		return { locked: true, owner: row.owner, expiresAt: Number(row.expires_at) };
	}
}
