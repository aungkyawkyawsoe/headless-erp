import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@mmbix/config';

/**
 * Page-size policy — the BACKEND is the single source of truth for how many
 * rows ONE call may return.
 *
 * The values themselves live in `@mmbix/config` (env-overridable at deploy
 * time via API_DEFAULT_LIMIT / API_MAX_LIMIT) and are mirrored by the SDK's
 * compile-time defaults; the effective contract is exposed to clients via
 * `GET /api/meta`, and `@mmbix/sdk` adopts it at runtime via
 * `client.loadLimits()`. A frontend can only *adjust* its page size within
 * `[1, MAX_PAGE_SIZE]` — it can never exceed the ceiling.
 *
 * The only exceptions are SERVER-INTERNAL jobs (scheduled-report generation,
 * archive janitor, KPI analytics) that are not client-driven row fetches and
 * pass their own explicit limits.
 */
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };

/** Clamp a requested page size: missing/invalid/0 → `fallback`; > MAX → MAX. */
export function clampPageSize(limit: number | undefined | null, fallback = DEFAULT_PAGE_SIZE): number {
	if (limit === undefined || limit === null || !Number.isFinite(limit) || limit < 1) return fallback;
	return Math.min(Math.trunc(limit), MAX_PAGE_SIZE);
}
