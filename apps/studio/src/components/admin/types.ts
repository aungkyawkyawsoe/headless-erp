/** Shared types for the Studio Admin tab components. */

/** The admin's metadata-write helper — POST/DELETE against the /__studio surface
 *  (the dev Vite plugin locally, the Studio worker's D1-backed router in
 *  production), then reloads meta + refreshes the builder palette. */
export type AdminApi = (path: string, init?: RequestInit) => Promise<void>;
