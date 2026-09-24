/** Page-size policy — canonical cross-package defaults (env-overridable at deploy time via
 *  API_DEFAULT_LIMIT / API_MAX_LIMIT; config re-exports and applies the overrides). */
export const DEFAULT_PAGE_SIZE = 25;
/**
 * The MOST rows a single read may return. Raised from 100 to 500 because every
 * whole-set master/directory read (the ~238-row employee directory, item models,
 * fleets) walked the keyset cursor one 100-row page at a time — three serial
 * round trips on remote D1 + mobile instead of one. 500 keeps a single response
 * bounded (lean lookup projections, gzipped) while making those directory reads
 * a SINGLE round trip. Only clients that explicitly ask for a larger page get
 * one — the default stays 25.
 */
export const MAX_PAGE_SIZE = 500;
