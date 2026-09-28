/**
 * Refresh Token Service — the long-lived companion to the 24h JWT.
 *
 * The JWT is a *session pointer*: every request re-validates the user and the
 * acting employee against the database, so a disable/offboard revokes it
 * immediately. What the JWT cannot do is outlive 24h — and for a standalone
 * app there is no other path to "stay signed in" (design §7.3). This service
 * owns that credential:
 *
 *   - issue()   — mint a 256-bit random token at login; only its SHA-256 hash
 *                 is stored (the `_api_keys` precedent: plaintext exists only
 *                 in the response, never in the database, never in logs).
 *   - rotate()  — the single-use contract: a successful refresh revokes the
 *                 presented row and issues a successor whose `rotated_from`
 *                 names it. Presenting an already-rotated token again is a
 *                 THEFT signal → the whole descendant chain is revoked (the
 *                 reuse response), which logs the attacker and the victim out
 *                 together — the victim re-authenticates, the thief cannot.
 *   - revoke()  — logout: kills the presented chain (or every chain of the
 *                 user when `all`), idempotent and oracle-free.
 *   - revokeAllForUser() — the blast radius of a dead account: called when a
 *                 refresh finds the account disabled or its employee link
 *                 gone, so offboarding ends the chain exactly like it ends
 *                 the bearer (design §7.3: "offboard ဆို bearer ရော refresh
 *                 chain ရော ကုန်").
 *
 * Concurrency: rotation is exactly-one-winner. The presented row is revoked
 * with a `revoked_at IS NULL` guard, so two racing refreshes cannot both mint
 * successors; the loser lands on the reuse path (its predecessor was revoked
 * under it) and the chain is killed — the standard cost of refresh-token
 * rotation, accepted because a well-behaved client fires one refresh at a time.
 *
 * Retention: rows are tiny and audit-relevant (revocation times, device
 * binding); no pruning happens here. A future maintenance job can drop rows
 * whose `expires_at` is long past.
 */
import { D1Client, QueryBuilder } from '@mmbix/core';
import { sha256Hex } from './api-key.service';

export interface RefreshTokenRecord {
	id: string;
	user_id: string;
	token_hash: string;
	device_id: string | null;
	created_at: string;
	expires_at: string;
	rotated_from: string | null;
	revoked_at: string | null;
}

/** What `rotate` tells the caller — the outcomes are MECE. */
export type RotateOutcome =
	| { status: 'ok'; userId: string; deviceId: string | null; token: string }
	| { status: 'invalid' }
	| { status: 'reuse'; userId: string; revokedCount: number };

export class RefreshTokenService {
	/** Sliding TTL — every rotation extends the window by this much (30 days). */
	static readonly TTL_MS = 30 * 24 * 60 * 60 * 1000;

	/**
	 * Family-walk bound. A rotation chain this deep is pathological (over 50
	 * refreshes on one lineage), and walking further would let a hostile chain
	 * amplify one request into unbounded reads — at the bound we escalate to a
	 * user-wide revoke instead (safety over surgical precision).
	 */
	private static readonly MAX_FAMILY_HOPS = 50;

	constructor(private db: D1Client) {}

	/** Mint a token for a user (optionally bound to a device) — returns the plaintext ONCE. */
	async issue(userId: string, deviceId: string | null = null): Promise<string> {
		const token = RefreshTokenService._randomToken();
		const now = Date.now();
		await this.db.run(
			QueryBuilder.from('_refresh_tokens').toInsert({
				id: crypto.randomUUID(),
				user_id: userId,
				token_hash: await sha256Hex(token),
				device_id: deviceId,
				created_at: new Date(now).toISOString(),
				expires_at: new Date(now + RefreshTokenService.TTL_MS).toISOString(),
			}),
		);
		return token;
	}

	/**
	 * Single-use rotation. On success the presented row is revoked and a
	 * successor (same user, same device, `rotated_from` = presented) is issued;
	 * `expires_at` slides forward on every rotation.
	 */
	async rotate(presented: string): Promise<RotateOutcome> {
		const row = await this._find(presented);
		if (!row) return { status: 'invalid' };

		const expiresAt = Date.parse(row.expires_at);
		if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
			// Expired — kill the dead row so a stale client stops retrying it.
			await this._revokeIds([row.id]);
			return { status: 'invalid' };
		}

		if (row.revoked_at) return this._reuseOutcome(row);

		// Exactly-one-winner: the guarded revoke flips `revoked_at` for ONE caller.
		if (!(await this._revokeIfActive(row.id))) {
			// Lost the race between read and write — the row was revoked under us.
			// Same theft response: if successors exist, they die with it.
			return this._reuseOutcome(row);
		}

		const token = RefreshTokenService._randomToken();
		const now = Date.now();
		await this.db.run(
			QueryBuilder.from('_refresh_tokens').toInsert({
				id: crypto.randomUUID(),
				user_id: row.user_id,
				token_hash: await sha256Hex(token),
				device_id: row.device_id,
				created_at: new Date(now).toISOString(),
				expires_at: new Date(now + RefreshTokenService.TTL_MS).toISOString(),
				rotated_from: row.id,
			}),
		);
		return { status: 'ok', userId: row.user_id, deviceId: row.device_id, token };
	}

	/**
	 * Logout. `all` revokes every live chain the user owns (sign out
	 * everywhere); otherwise only the presented token. Unknown tokens are a
	 * no-op — the endpoint stays idempotent and never becomes an oracle.
	 */
	async revoke(presented: string, all = false): Promise<{ userId: string | null; revoked: number }> {
		const row = await this._find(presented);
		if (!row) return { userId: null, revoked: 0 };
		if (all) return { userId: row.user_id, revoked: await this.revokeAllForUser(row.user_id) };
		return { userId: row.user_id, revoked: await this._revokeIds([row.id]) };
	}

	/** Revoke every live token of a user — offboarding, disable, theft escalation. */
	async revokeAllForUser(userId: string): Promise<number> {
		if (!userId) return 0;
		const res = await this.db.run(
			QueryBuilder.from('_refresh_tokens').where('user_id', userId).whereNull('revoked_at').toUpdate({
				revoked_at: new Date().toISOString(),
			}),
		);
		return RefreshTokenService._changedRows(res);
	}

	// ── Internals ───────────────────────────────────────

	/** Reuse response: kill the descendants of an already-revoked token. */
	private async _reuseOutcome(row: RefreshTokenRecord): Promise<RotateOutcome> {
		const { ids, leftover } = await this._descendantIds(row.id);
		let revoked = await this._revokeIds(ids);
		if (leftover) {
			// Chain deeper than the hop bound — escalate: every live token the user
			// holds dies (a theft signal outranks surgical precision).
			revoked += await this.revokeAllForUser(row.user_id);
		}
		return revoked > 0 ? { status: 'reuse', userId: row.user_id, revokedCount: revoked } : { status: 'invalid' };
	}

	/** BFS over `rotated_from` edges, bounded by MAX_FAMILY_HOPS. */
	private async _descendantIds(rootId: string): Promise<{ ids: string[]; leftover: boolean }> {
		const ids: string[] = [];
		let frontier = [rootId];
		for (let hop = 0; hop < RefreshTokenService.MAX_FAMILY_HOPS && frontier.length > 0; hop++) {
			const children = await this.db.all<{ id: string }>(
				QueryBuilder.from('_refresh_tokens').select('id').where('rotated_from', 'IN', frontier).toSelect(),
			);
			frontier = children.map((c) => c.id);
			ids.push(...frontier);
		}
		return { ids, leftover: frontier.length > 0 };
	}

	private async _find(presented: string): Promise<RefreshTokenRecord | null> {
		if (!presented) return null;
		const tokenHash = await sha256Hex(presented);
		return this.db.first<RefreshTokenRecord>(QueryBuilder.from('_refresh_tokens').select('*').where('token_hash', tokenHash).toSelect());
	}

	/** Revoke one row only if still live — the exactly-one-winner guard. */
	private async _revokeIfActive(id: string): Promise<boolean> {
		const res = await this.db.run(
			QueryBuilder.from('_refresh_tokens').where('id', id).whereNull('revoked_at').toUpdate({ revoked_at: new Date().toISOString() }),
		);
		return RefreshTokenService._changedRows(res) > 0;
	}

	/** Revoke a set of rows (live ones only); returns how many actually flipped. */
	private async _revokeIds(ids: string[]): Promise<number> {
		if (ids.length === 0) return 0;
		const res = await this.db.run(
			QueryBuilder.from('_refresh_tokens').where('id', 'IN', ids).whereNull('revoked_at').toUpdate({
				revoked_at: new Date().toISOString(),
			}),
		);
		return RefreshTokenService._changedRows(res);
	}

	/** D1 reports affected rows under `meta.changes`; fall back to success. */
	private static _changedRows(res: unknown): number {
		const changed = (res as { meta?: { changes?: number } }).meta?.changes;
		if (typeof changed === 'number') return changed;
		return (res as { success?: boolean }).success ? Number.MAX_SAFE_INTEGER : 0;
	}

	/** 256-bit random token — 64 hex chars; the plaintext exists only client-side. */
	private static _randomToken(): string {
		const bytes = crypto.getRandomValues(new Uint8Array(32));
		return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
	}
}
