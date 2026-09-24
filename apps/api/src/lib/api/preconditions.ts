/**
 * HTTP preconditions — optimistic concurrency for schema/policy writes.
 *
 * Two admins editing one collection used to be last-write-wins: the second save
 * silently clobbered the first. A client that loaded a resource sends
 * `If-Match: <_schema_version>` (the version the detail read returned); when the
 * stored version has moved, the write is refused **409 CONFLICT** with the
 * CURRENT version so the client can reload and re-apply.
 *
 * An absent header means "no check" — the CLI, SDK and legacy writers keep
 * working unchanged (backward compatible).
 */
import type { Context } from 'hono';

/** `null` when the write may proceed; a 409 Response when the version moved. */
export function ifMatchGuard(c: Context, currentVersion: number): Response | null {
	const raw = c.req.header('If-Match');
	if (!raw) return null;
	// Accept `"3"`, `W/"3"` and `3` (weak/quoted/plain).
	const expected = raw.replace(/^W\//, '').replace(/^"|"$/g, '').trim();
	if (expected === '' || expected === '*') return null;
	if (String(currentVersion) !== expected) {
		return c.json(
			{
				success: false,
				error: 'This resource changed since you loaded it — reload and re-apply your change.',
				code: 'CONFLICT',
				data: { current_version: currentVersion },
			},
			409,
		);
	}
	return null;
}
