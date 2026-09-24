import { MASTER_STALE_MS } from '@/shared/constants';

/**
 * TanStack Query key factory for the ဝန်ထမ်းများ (employees) directory.
 *
 * Keyed under `['hr',...]` so the directory read stays in the same cache
 * namespace as the attendance module's employee reads — one shared,
 * stale-time-bounded copy of the directory across the app.
 *
 * The directory cache holds SCALAR-ONLY rows (see `DIRECTORY_FIELDS` in
 * `api.ts`); the full profile — relations included — is a SEPARATE per-employee
 * key (`employee(id)`), fetched on demand when a card is tapped, so opening the
 * details sheet never bloats the paginated list payload.
 */

/** Directory reads change rarely (eid/designation/department/status) — the
 *  shared master tier (`MASTER_STALE_MS`, single source in shared/constants). */
export const DIRECTORY_STALE_MS = MASTER_STALE_MS;

export const qk = {
	/** The full employee directory — the ဝန်ထမ်းများ card list, SCALARS ONLY
	 *  (identity + `active` + `doj` + `gender`) from the `hrm_employees` collection
	 *  (`cms_hrm_employees` table); relations are not fetched here. The `v4` suffix is
	 *  a row-shape version: the directory read dropped its relation joins in favor
	 *  of the on-demand per-employee detail read (`employee(id)`). Bumping the key
	 *  discards rows cached under the older relation-heavy shape. */
	employees: () => ['hr', 'employees', 'directory', 'v4'] as const,
	/** ONE employee's full profile — relations (`department` / `designation` /
	 *  `shifts`) plus the extra fact columns, fetched only when the directory card
	 *  is tapped and the details sheet plays its loading shimmer. */
	employee: (id: string) => ['hr', 'employees', 'detail', id] as const,
};
