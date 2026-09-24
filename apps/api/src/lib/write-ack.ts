/**
 * Request-scoped write acknowledgements — the "confirm the warning, then
 * proceed" channel for engine guards that would otherwise hard-refuse.
 *
 * Some compiled guards (see `domain-modules/mro/requisition-guard.ts`) refuse a
 * write the CALLER may legitimately want anyway: the same-day duplicate
 * requisition is a warning, not a rule violation — the operator reads it, agrees
 * and files the request a second time on purpose. Before this module the only
 * answers were "refuse" (correct but blocks real work) or "drop the guard"
 * (loses the protection on Studio / CLI / import). The third answer is an
 * EXPLICIT, per-request acknowledgement:
 *
 *   - the guard still refuses every unacknowledged write (deny-by-default, on
 *     every path — nothing changes for a blind or replayed write);
 *   - a caller that has SEEN the warning may confirm it by naming its token in
 *     the `X-Write-Ack` request header and the guard steps aside;
 *   - the confirmation is REQUEST metadata, never record data — it is read here
 *     once and never reaches the row (a body flag would land in `_meta`).
 *
 * Isolation: `AsyncLocalStorage` (via the worker's `nodejs_compat` flag) keeps
 * each request's set private, so two interleaved requests in one isolate can
 * never see each other's confirmations. Outside a scope every read is `false`,
 * which is the safe direction. Mirrors `change-scope.ts` / `request-tasks.ts`.
 *
 * Threat model: an acknowledgement only lets the caller past a SOFT data-quality
 * guard the UI has already shown them. It is not an authorization boundary —
 * RBAC, write policies and frozen/actor fields are enforced regardless — and it
 * is scoped to the named guard token and the single request it arrives on.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** The request header carrying acknowledged guard tokens (comma-separated).
 *  Header names are case-insensitive; the SDK sends the same spelling. */
export const WRITE_ACK_HEADER = 'X-Write-Ack';

/** Shared empty set — an unacknowledged request allocates nothing. */
const NONE: ReadonlySet<string> = new Set();

const storage = new AsyncLocalStorage<ReadonlySet<string>>();

/**
 * The tokens a request acknowledges — a comma-separated header split into a
 * trimmed, de-duplicated set (blank entries dropped, so the header an empty
 * client might send can never acknowledge the empty-string token).
 */
export function parseWriteAcks(header: string | undefined | null): ReadonlySet<string> {
	if (!header) return NONE;
	const tokens = header
		.split(',')
		.map((token) => token.trim())
		.filter(Boolean);
	return tokens.length === 0 ? NONE : new Set(tokens);
}

/** Run `fn` with `acks` bound as the current request's acknowledgements. */
export function runWithWriteAcks<T>(acks: ReadonlySet<string>, fn: () => T): T {
	return storage.run(acks, fn);
}

/** Has the CURRENT request explicitly acknowledged `token`? (false outside a scope.) */
export function writeAcknowledged(token: string): boolean {
	return storage.getStore()?.has(token) ?? false;
}
