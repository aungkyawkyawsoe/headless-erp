/**
 * Canonical platform contract — the SINGLE source of truth for the wire
 * contract shared by the worker (`apps/api`), the SDK (`@mmbix/sdk`), and
 * every frontend integration.
 *
 * Until this module existed, the error envelope and its codes were defined
 * again in three places (`lib/api/response.ts`, `middleware/error-handler.ts`,
 * `@mmbix/utils/errors`) and translated yet again in the SDK (`errors.ts`).
 * That was the "inconsistency/duplication" the zero-waste effort removes:
 * now any new code path that fails with a code MUST reference a value here, and
 * the SDK's typed errors are built FROM this catalog — so a backend code can
 * never silently drift away from what SDK clients are prepared to match.
 *
 * Values here are compile-time constants + a runtime array. The API imports
 * the array to validate/serialize, the SDK imports the array to build typed
 * errors, and both typecheck against the same catalog.
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

/** The API's error envelope — the canonical wire shape thrown by fail()/error-handler. */
export interface ApiErrorEnvelope {
	success: false;
	/** Human-readable message (never a raw DB/SQL string in production). */
	error: string;
	/** Machine code — must be a member of `ERROR_CODES`. */
	code: ApiErrorCode;
	/** Which field (if any) the failure pertains to. */
	field?: string;
	/** Extra structured context (e.g. validation failures). */
	details?: unknown;
	/** Correlation id — present when the request was traced. */
	request_id?: string;
}

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

// ─── Query limits (shared by the engine and its clients) ─

/**
 * Ceiling on ONE `?fields=` selection, counted as flat comma-separated entries
 * (`*` included) — the engine rejects a larger list with `VALIDATION_ERROR`.
 *
 * Lives here, not in the engine, because clients must be able to BUILD a legal
 * projection: the Studio's table projection (`buildListFields`) spends this
 * budget, and a wide schema (many m2o fields) otherwise produced a 400 that
 * blanked the whole table read.
 */
export const MAX_FIELD_SELECTIONS = 100;

// ─── Platform contract (GET /api/meta) ──────────────────

/** The keys the backend exposes under `data.pagination`. */
export interface PaginationContract {
	default_page_size: number;
	max_page_size: number;
}

/**
 * The keys the backend exposes under `data.aggregate`. A grouped read is NOT
 * page-limited (`?limit=` does not apply — a chart needs every bucket), so it
 * carries its own bucket ceiling instead of reusing `PaginationContract`.
 */
export interface AggregateContract {
	/** Max GROUP BY buckets one aggregate response may contain (engine-enforced). */
	max_groups: number;
}

/** The per-role rate-limit tiers the backend enforces (requests per window). */
export interface RateLimitTierContract {
	window: number;
	max: number;
}

export interface RateLimitsContract {
	anonymous: RateLimitTierContract;
	authenticated: RateLimitTierContract;
	admin: RateLimitTierContract;
}

/**
 * The full `GET /api/meta` payload. Clients (`@mmbix/sdk` `loadLimits()`,
 * integrations) and tooling read limits/policy from HERE — they never
 * hardcode. This is the machine-readable contract registry.
 */
export interface PlatformContractData {
	platform: 'mmbix-headless';
	version: string;
	pagination: PaginationContract;
	aggregate: AggregateContract;
	rate_limits: RateLimitsContract;
	/** Canonical error codes this deployment is prepared to emit. */
	error_codes: readonly string[];
}
