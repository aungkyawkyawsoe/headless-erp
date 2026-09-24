/**
 * TanStack Query key factory for the app-wide MASTER lookups — the shared,
 * slow-moving collections every module joins against (vehicles, employees).
 *
 * All masters live under ONE `['masters', ...]` namespace so a module never
 * re-fetches what a sibling module already cached: the ဆီဖြည့် / မှတ်တမ်း /
 * ပြင်ဆင် pages used to each fetch the whole `vehicle_vehicles` +
 * `hr_employees` pair under their own keys (`['fuelings','lookups']`,
 * `['incidents','lookups']`, …) — one duplicated fetch per module. They now
 * ALL read the same `['masters','vehicles']` / `['masters','hr-employees']`
 * entries, so the first page visited pays for the master fetch and every other
 * page collides into the same cached query.
 */

export const masterQk = {
	/** `fleets` — plate (+ brand) rows every fleet module joins. */
	vehicles: () => ['masters', 'vehicles'] as const,
	/** `hr_employees` — the directory rows every fleet/store module joins. */
	employees: () => ['masters', 'hr-employees'] as const,
	/** ONE truck's identity by id — shared by every fleet module's per-truck page,
	 *  so the same truck named from two modules is fetched once, not twice. */
	vehicle: (vehicleId: string) => ['masters', 'vehicle-identity', vehicleId] as const,
	/** The personnel picker's type-ahead — one `?search=` over the `hrm_employees`
	 *  directory per settled term (personnel-picker-sheet). `designation` narrows
	 *  the scope (e.g. `driver`), so a narrowed search is its OWN cache entry and
	 *  can never be served the whole-directory answer. Transient: a new term is a
	 *  NEW key, so it needs no write-through invalidation. */
	employeeSearch: (term: string, designation = '') => ['employees', 'search', designation, term] as const,
};
