/**
 * Canonical error-code catalog — the SINGLE source of truth for the wire
 * contract shared by the worker (`apps/api`), the SDK (`@mmbix/sdk`), and every
 * frontend integration.
 *
 * It lives in `@mmbix/utils` (the leaf package) rather than `@mmbix/types`
 * because the error CLASSES in this same package need to reference it, and
 * `types` imports `utils` — the reverse edge would be a cycle. `@mmbix/types`
 * re-exports everything here, so consumers keep importing from
 * `@mmbix/types` / `@mmbix/types/contract` unchanged.
 *
 * Before this move the codes were ALSO hardcoded inside the error classes in
 * `./index`, byte-identical but a second copy that could silently drift.
 */

// ─── Error envelope ─────────────────────────────────────

/**
 * Error codes the API emits on its `{ success: false, error, code, … }`
 * envelope. The union is the *complete* supported surface — if a route throws
 * with a code not listed here it is an intentional extension (schemas are open
 * for forward-compat), but the canonical set is what SDK/UI tooling keys on.
 */
export const ERROR_CODES = [
	// ── 4xx — client / resource ──────────────────────────
	'VALIDATION_ERROR', // 400 — invalid input / failed declarative validation
	'INVALID_JSON', // 400 — malformed request body
	'UNAUTHORIZED', // 401 — missing/invalid credentials
	'FORBIDDEN', // 403 — authenticated but denied (role / row / field)
	'NOT_FOUND', // 404 — collection or item missing
	'CONFLICT', // 409 — duplicate / state conflict / optimistic-concurrency
	'PAYLOAD_TOO_LARGE', // 413 — body exceeds the upload/body limit
	'UNSUPPORTED_MEDIA_TYPE', // 415 — bad Content-Type
	'RATE_LIMIT_EXCEEDED', // 429 — per-role quota exhausted
	// ── 5xx — server ─────────────────────────────────────
	'NOT_CONFIGURED', // 501 — a required provider/integration is not configured
	'DATABASE_ERROR', // 502 — D1 failed (never leaks raw internals)
	'INTERNAL_ERROR', // 500 — unexpected failure
	// ── SDK-side (never emitted by the API) ──────────────
	'NETWORK_ERROR', // the request never reached the server
	'SDK_ERROR', // generic client-side failure
	'API_ERROR', // unclassified API failure
	'BAD_ENVELOPE', // the server responded but with an unrecognized envelope
] as const;

/** Distinct error codes the API worker can emit (no SDK-only codes here). */
export const API_ERROR_CODES = ERROR_CODES.filter(
	(c) => c !== 'NETWORK_ERROR' && c !== 'SDK_ERROR' && c !== 'API_ERROR' && c !== 'BAD_ENVELOPE',
) as readonly string[];

export type ErrorCode = (typeof ERROR_CODES)[number];
export type ApiErrorCode = Exclude<ErrorCode, 'NETWORK_ERROR' | 'SDK_ERROR' | 'API_ERROR' | 'BAD_ENVELOPE'>;

/** Canonical HTTP status → default error-code mapping (replaces `inferErrorCode`). */
export const STATUS_TO_ERROR_CODE: Record<number, ApiErrorCode> = {
	400: 'VALIDATION_ERROR',
	401: 'UNAUTHORIZED',
	403: 'FORBIDDEN',
	404: 'NOT_FOUND',
	409: 'CONFLICT',
	413: 'PAYLOAD_TOO_LARGE',
	415: 'UNSUPPORTED_MEDIA_TYPE',
	422: 'VALIDATION_ERROR',
	429: 'RATE_LIMIT_EXCEEDED',
	500: 'INTERNAL_ERROR',
	501: 'NOT_CONFIGURED',
	502: 'DATABASE_ERROR',
};

/** Narrow an arbitrary status to its canonical code, defaulting to `VALIDATION_ERROR`. */
export function errorCodeForStatus(status: number): ApiErrorCode {
	return STATUS_TO_ERROR_CODE[status] ?? 'VALIDATION_ERROR';
}

/** Validate that a code is in the canonical catalog (runtime guard for dynamic throws). */
export function isErrorCode(candidate: unknown): candidate is ApiErrorCode {
	return typeof candidate === 'string' && (API_ERROR_CODES as readonly string[]).includes(candidate);
}
