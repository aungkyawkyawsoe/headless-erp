/**
 * LockHandle — a held lease. Release it when done (or let the lease expire).
 */

import type { LockService } from './service';

export class LockHandle {
	constructor(
		private readonly service: LockService,
		public readonly name: string,
		public readonly owner: string,
		private readonly ttlMs: number,
		public readonly expiresAt: number,
	) {}

	/** Release the lock (owner-scoped; safe to call once). */
	async release(): Promise<boolean> {
		return this.service.release(this.name, this.owner);
	}

	/** Extend the lease by `ttlMs` (default: the original lease duration). */
	async renew(ttlMs?: number): Promise<boolean> {
		const { renewed } = await this.service.renew(this.name, this.owner, ttlMs ?? this.ttlMs);
		return renewed;
	}
}
