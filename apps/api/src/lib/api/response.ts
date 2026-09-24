/**
 * Shared API Response Helpers
 *
 * Standardizes success/error envelopes across ALL route files.
 *
 * Success: { success: true, data, meta? }
 * Error:   { success: false, error: string, code: string, details?, field?, request_id? }
 *
 * The error envelope matches the global error handler (middleware/error-handler.ts)
 * so clients can rely on a single, consistent shape — the "ERP standard".
 */

import type { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import { errorCodeForStatus } from '@mmbix/types';
import { fnv1a } from '@mmbix/core';
import { snapshotChanges } from '@/lib/change-scope';

// ─── Success ─────────────────────────────────────────────

/**
 * RFC 9110 §13.1.2 weak comparison of a caller's `If-None-Match` against the
 * ETag we are about to send. Handles a comma-separated list and `*` ("any
 * existing representation"). `W/` is stripped on both sides, so a strong/weak
 * mismatch still revalidates.
 */
function ifNoneMatchMatches(header: string | undefined, etag: string): boolean {
	if (!header) return false;
	if (header.trim() === '*') return true;
	const target = etag.replace(/^W\//, '');
	return header.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === target);
}

/**
 * `{ success: true, data, meta? }`.
 *
 * When the request performed tracked writes (any `invalidateCollectionReads`
 * call — primary row, cascade parents, hook/denorm writes), the exact set of
 * touched collections is attached as `meta.changed` so clients can invalidate
 * precisely instead of nuking whole domains. Reads carry no such key.
 *
 * Every successful GET also carries a weak `ETag` — a hash of the exact bytes we
 * would send — and a matching `If-None-Match` answers `304` with no body. That
 * turns an unchanged re-read (focus refetch, reconnect, a write that touched a
 * sibling collection) into headers only, without inventing a version to store:
 * the tag IS the content, so it can never be stale, and two users share a tag
 * only when their RBAC-filtered payloads are byte-identical. Correct across
 * isolates for the same reason — nothing to replicate. Routes that set their own
 * version-based ETag (app manifest, MVE templates) keep it.
 */
export function success(c: Context, data: unknown, status = 200, meta?: Record<string, unknown>) {
	const changed = snapshotChanges();
	const mergedMeta = changed ? { ...(meta ?? {}), changed } : meta;
	const envelope = { success: true as const, data, ...(mergedMeta ? { meta: mergedMeta } : {}) };
	const body = JSON.stringify(envelope);
	const json = { 'Content-Type': 'application/json' };
	const code = status as StatusCode;

	if (status === 200 && c.req.method === 'GET' && !c.res.headers.has('ETag')) {
		// `W/` — compression negotiates the on-the-wire bytes; the representation
		// (and therefore the hash input) is what stays equal.
		const etag = `W/"${fnv1a(body)}"`;
		if (ifNoneMatchMatches(c.req.header('If-None-Match'), etag)) return c.newResponse(null, 304, { ETag: etag });
		return c.newResponse(body, code, { ...json, ETag: etag });
	}
	return c.newResponse(body, code, json);
}

// ─── Error ───────────────────────────────────────────────

/**
 * Standard error response: { success: false, error, code, request_id? }
 *
 * Default codes come from the canonical `STATUS_TO_ERROR_CODE` map in
 * @mmbix/types (single source — the SDK consumes the same catalog), so a
 * status here can never drift from what SDK clients match on:
 *
 *   fail(c, 'Collection not found')            → 400 VALIDATION_ERROR
 *   fail(c, 'Route not found', 404)            → 404 NOT_FOUND
 *   fail(c, 'Duplicate', 409, 'CONFLICT')      → 409 CONFLICT
 */
export function fail(c: Context, error: string, status = 400, code?: string) {
	return c.json(
		{
			success: false as const,
			error,
			code: code || errorCodeForStatus(status),
			request_id: c.res.headers.get('X-Request-Id') || crypto.randomUUID(),
		},
		status as Parameters<typeof c.json>[1],
	);
}
