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
 * Values here are compile-time constants + a runtime array. The values now
 * live in `@mmbix/utils/errors/codes` (the leaf package) because the error
 * CLASSES in that package must reference the same catalog, and `types` already
 * depends on `utils` — this module re-exports them so every existing importer
 * (`apps/api`, `@mmbix/sdk`, …) is unchanged. The API imports the array to
 * validate/serialize, the SDK imports the array to build typed errors, and both
 * typecheck against the same catalog — there is exactly ONE copy.
 */

import type { ApiErrorCode } from '@mmbix/utils';

// ─── Error envelope ─────────────────────────────────────

export { ERROR_CODES, API_ERROR_CODES, STATUS_TO_ERROR_CODE, errorCodeForStatus, isErrorCode } from '@mmbix/utils';
export type { ErrorCode, ApiErrorCode } from '@mmbix/utils';

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

/** Canonical HTTP status → default error-code mapping (moved to @mmbix/utils). */
// (re-exported above)

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
