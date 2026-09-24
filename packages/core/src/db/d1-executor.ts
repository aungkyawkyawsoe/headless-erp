/**
 * Per-request D1 executor seam — the ONE indirection that lets a host worker
 * route an entire request's queries through a D1 SESSION (read replication)
 * WITHOUT changing a single `new D1Client(env.DB)` call site.
 *
 * D1 read replication only serves reads from a nearby replica when queries are
 * issued through the Sessions API (`db.withSession(bookmark)`); otherwise every
 * query goes to the primary in one region. `D1Client` first asks this resolver
 * for an executor, and falls back to the binding it was constructed with.
 *
 * The resolver is REGISTERED at runtime by the worker that owns a request scope
 * (see `apps/api/src/lib/d1-session.ts`, which backs it with `AsyncLocalStorage`).
 * It lives in core as a plain function reference so core stays importable by
 * browser/Node consumers (the Studio, the CLI) that must not pull in
 * `node:async_hooks` or assume a workerd request scope.
 */
import type { D1Database } from '@cloudflare/workers-types';

/** Returns the request-scoped executor, or undefined outside a request scope. */
export type D1ExecutorResolver = () => D1Database | undefined;

let resolver: D1ExecutorResolver | null = null;

/** Register (or clear) the per-request executor resolver. Idempotent. */
export function setD1ExecutorResolver(fn: D1ExecutorResolver | null): void {
	resolver = fn;
}

/** The current request-scoped executor, or undefined when none is active. */
export function resolveD1Executor(): D1Database | undefined {
	return resolver?.();
}
