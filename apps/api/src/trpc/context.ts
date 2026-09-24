/**
 * tRPC Context Factory — with full AuthContext
 */
import type { D1Client } from '@mmbix/core';
import type { AuthContext } from '@/lib/services/auth.service';
import type { ExecutionCtx } from '@/lib/services/collection.shared';

export interface TrpcContext {
	db: D1Client;
	env: Record<string, unknown>;
	auth: AuthContext | null;
	/** Client IP for per-IP rate limiting (login). */
	ip?: string;
	/** Workers execution context — enables webhooks/audit (waitUntil) on entity writes. */
	execCtx?: ExecutionCtx;
}

export function createTrpcContext(opts: {
	db: D1Client;
	env: Record<string, unknown>;
	auth: AuthContext | null;
	ip?: string;
	execCtx?: ExecutionCtx;
}): TrpcContext {
	return {
		db: opts.db,
		env: opts.env,
		auth: opts.auth,
		ip: opts.ip,
		execCtx: opts.execCtx,
	};
}
