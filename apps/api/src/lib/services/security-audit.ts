/**
 * Security Audit — a durable trace for NON-document security events.
 *
 * A sign-in, a machine-key lifecycle change and an access-control (role /
 * permission) grant are not entity writes: they have no collection of their own,
 * so before this they left NO trace at all. A brute-force run, a leaked key or a
 * silent privilege grant was invisible after the fact (STRIDE: Repudiation /
 * Information Visibility).
 *
 * They belong in the ONE audit trail — `_audit_log`, written by `AuditService` and
 * read by the ONE viewer (`GET /api/audit/…`). This helper is a thin, bounded,
 * fire-and-forget wrapper over `AuditService.log`; it deliberately does NOT invent
 * a second log.
 *
 * Events are grouped under PSEUDO collection slugs so they are queryable and
 * clearly distinguishable from entity writes:
 *   `_auth`      — sign-in success/failure (`GET /api/audit/_auth/:id`)
 *   `_api_keys`  — machine-key create/revoke
 *   `_users`     — role + permission writes (the access-control surface)
 * These are NOT real collections: no schema, no rows, no collision with a user's
 * own slug (which can never start with `_`).
 *
 * 🔒 Secret hygiene is by CONSTRUCTION, not by the masker: callers must never put
 * a password, secret or plaintext API key into `changes`. `AuditService._mask` is
 * a second line of defence, never the first.
 */

import type { Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { AuditService } from '@/lib/services/audit.service';

/** The non-document security actions this module records (a subset of `AuditEntry['action']`). */
export type SecurityAuditAction = 'login' | 'login_failed' | 'logout' | 'grant' | 'revoke';

/**
 * Pseudo collection slugs grouping non-document security events. Real collections
 * are user-named and never `_`-prefixed, so these can never collide.
 */
export const SECURITY_COLLECTIONS = {
	auth: '_auth',
	apiKeys: '_api_keys',
	access: '_users',
} as const;

/** Payloads stay bounded: an audit write must never grow with the request. */
const MAX_CHANGE_KEYS = 16;
const MAX_CHANGE_VALUE_LENGTH = 200;

/** Truncate long scalars and cap the key count so a payload is always bounded. */
function boundChanges(changes: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
	if (!changes) return null;
	const out: Record<string, unknown> = {};
	let n = 0;
	for (const [key, value] of Object.entries(changes)) {
		if (n++ >= MAX_CHANGE_KEYS) break;
		out[key] = typeof value === 'string' && value.length > MAX_CHANGE_VALUE_LENGTH ? `${value.slice(0, MAX_CHANGE_VALUE_LENGTH)}…` : value;
	}
	return out;
}

export interface SecurityAuditEvent {
	/** One of `SECURITY_COLLECTIONS` (a `_`-prefixed pseudo slug). */
	collection: string;
	action: SecurityAuditAction;
	/** The subject's id — a user id, key id, role id, or an attempted email. */
	document_id: string;
	/** Who acted (the authenticated admin), when known. */
	user_id?: string | null;
	/** Bounded, SECRET-FREE context. Never a password, secret or plaintext key. */
	changes?: Record<string, unknown> | null;
}

/**
 * Record a security event. Fire-and-forget and NEVER throws — an audit failure
 * must not turn a successful sign-in (or a refused one) into a 500. Handed to
 * `ctx.waitUntil` so the write survives the response, through the SAME
 * `AuditService` the entity pipeline uses.
 */
export function securityAudit(c: Context, event: SecurityAuditEvent): void {
	try {
		const db = new D1Client((c.env as { DB: D1Database }).DB);
		// `c.executionCtx` throws outside a Worker invocation (CLI / direct call);
		// `AuditService.log(null, …)` then runs the write unconcealed.
		let execCtx: { executionCtx?: { waitUntil: (p: Promise<unknown>) => void } } | null = null;
		try {
			const ctx = c.executionCtx;
			execCtx = ctx ? { executionCtx: { waitUntil: ctx.waitUntil.bind(ctx) } } : null;
		} catch {
			execCtx = null;
		}
		void new AuditService(db)
			.log(
				execCtx,
				{
					collection_slug: event.collection,
					document_id: event.document_id,
					action: event.action,
					user_id: event.user_id ?? null,
					changes: boundChanges(event.changes),
				},
				'none',
			)
			.catch((err) => console.error('[security-audit] write failed:', err instanceof Error ? err.message : err));
	} catch (err) {
		console.error('[security-audit] failed:', err instanceof Error ? err.message : err);
	}
}
