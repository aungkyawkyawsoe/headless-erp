/**
 * Request-scoped D1 statement counter.
 *
 * `performance.now()` only advances on I/O in Workers, so `Server-Timing: app`
 * already reflects the request's I/O time — but it cannot say HOW MANY D1 round
 * trips that time was spent on. "1 statement taking 300ms" (a cold D1) and "40
 * statements taking 300ms" (an N+1) look identical and need opposite fixes.
 *
 * This counts every `prepare()` the request issues (a proxy around the request's
 * D1 executor) so the number can be attached to the response and read straight
 * off the wire. Nested under the request scope exactly like the D1 session and
 * change scope; outside a request (scheduled/queue handlers) it is a no-op.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { D1Database } from '@cloudflare/workers-types';

interface DbStats {
	statements: number;
}

const storage = new AsyncLocalStorage<DbStats>();

/** Run `fn` with a fresh statement counter for the current request. */
export function runWithDbStats<T>(fn: () => T): T {
	return storage.run({ statements: 0 }, fn);
}

/** Count one statement (called by the counting executor's `prepare`). */
function recordStatement(): void {
	const stats = storage.getStore();
	if (stats) stats.statements += 1;
}

/** Statements issued so far in this request (0 outside a scope). */
export function statementCount(): number {
	return storage.getStore()?.statements ?? 0;
}

/**
 * Wrap a D1 executor so every `prepare()` increments the current request's
 * counter. Everything else passes through (methods stay bound to the real
 * binding, so the Sessions API keeps working).
 */
export function countD1Statements(db: D1Database): D1Database {
	return new Proxy(db, {
		get(target, prop, receiver) {
			if (prop === 'prepare') {
				return (sql: string) => {
					recordStatement();
					return target.prepare(sql);
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	}) as D1Database;
}
