/**
 * API Key Service — machine tokens for headless/integration access.
 *
 * Keys are long random strings prefixed `mmk_`. Only the SHA-256 hash is
 * stored; the plaintext is returned exactly once at creation. Each key is
 * bound to a user (permissions + audit identity) with an optional role
 * override. `requireAuth` resolves `mmk_…` tokens against this table.
 */
import { D1Client, QueryBuilder } from '@mmbix/core';

export interface ApiKeyRecord {
	id: string;
	name: string;
	key_hash: string;
	user_id: string;
	role_id: string | null;
	/** PoLP scope — `read` (default) | `write` | `admin`; null on legacy keys. */
	scope: string | null;
	is_active: number;
	created_at: string;
	last_used_at: string | null;
	revoked_at: string | null;
	/** ISO timestamp after which the key is refused at auth; `null` = never expires. */
	expires_at: string | null;
}

export type ApiKeyScope = 'read' | 'write' | 'admin';

/** SHA-256 hex digest — used to store/compare keys without keeping plaintext. */
export async function sha256Hex(input: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class ApiKeyService {
	constructor(private db: D1Client) {}

	/**
	 * Create a key — returns the plaintext ONCE (not retrievable later).
	 *
	 * `source` is an optional durable ownership marker (`'manifest'`): a control-plane
	 * write stamps the row so a later reconcile may delete it. A plain/Studio/CLI
	 * key is unmarked (`NULL`) and therefore INVISIBLE to reconciliation.
	 */
	async create(input: {
		name: string;
		user_id: string;
		role_id?: string | null;
		scope?: ApiKeyScope;
		source?: string;
		/**
		 * Optional ISO expiry. `undefined`/`null` = never expires (the non-breaking
		 * default): a new key with no explicit TTL keeps working forever, exactly as
		 * before. Enforced at auth time in `requireAuth`'s `mmk_` branch.
		 */
		expires_at?: string | null;
	}): Promise<{
		id: string;
		name: string;
		key: string;
		user_id: string;
		scope: ApiKeyScope;
		created_at: string;
		expires_at: string | null;
	}> {
		const plain = `mmk_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
		const keyHash = await sha256Hex(plain);
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		// Deny-by-default: a new key is READ-ONLY unless a scope is named.
		const scope: ApiKeyScope = input.scope ?? 'read';
		await this.db.run(
			QueryBuilder.from('_api_keys').toInsert({
				id,
				name: input.name,
				key_hash: keyHash,
				user_id: input.user_id,
				role_id: input.role_id ?? null,
				scope,
				is_active: 1,
				created_at: now,
				last_used_at: null,
				revoked_at: null,
				expires_at: input.expires_at ?? null,
				source: input.source ?? null,
			}),
		);
		return { id, name: input.name, key: plain, user_id: input.user_id, scope, created_at: now, expires_at: input.expires_at ?? null };
	}

	async list(): Promise<Array<Omit<ApiKeyRecord, 'key_hash'>>> {
		const rows = await this.db.all<ApiKeyRecord>(
			QueryBuilder.from('_api_keys')
				.select('id', 'name', 'user_id', 'role_id', 'scope', 'is_active', 'created_at', 'last_used_at', 'revoked_at', 'expires_at')
				.orderBy('created_at', 'desc')
				.toSelect(),
		);
		return rows;
	}

	async revoke(id: string): Promise<boolean> {
		const now = new Date().toISOString();
		const res = await this.db.run(QueryBuilder.from('_api_keys').where('id', id).toUpdate({ is_active: 0, revoked_at: now }));
		return (res as unknown as { meta?: { changes?: number } }).meta?.changes ? true : res.success;
	}

	/**
	 * Hard-delete a key row (the reconcile path — a manifest no longer declares it).
	 * Deleting rather than revoking is deliberate: a revoked-but-present row keeps
	 * squatting its `name`, so a later re-declaration would plan as "already exists"
	 * and never provision a working key. Returns true when a row was removed.
	 */
	async delete(id: string): Promise<boolean> {
		const res = await this.db.run(QueryBuilder.from('_api_keys').where('id', id).toDelete());
		const changed = (res as unknown as { meta?: { changes?: number } }).meta?.changes;
		return changed !== undefined ? changed > 0 : res.success;
	}
}
