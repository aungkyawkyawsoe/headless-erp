import type { MyTask } from '@/modules/projects/data/types';
import { fetchMyTasks } from '@/modules/projects/data/api';
import { serializeQuery } from '@mmbix/sdk';

import { sdk } from '@/shared/api/sdk';
import type { MeUser } from '@/shared/auth';
import { canReadCollection } from '@/shared/app-access';

/**
 * The widget board's data layer — one INDEPENDENT query per widget, so each
 * paints the moment ITS read lands instead of the whole board waiting for the
 * slowest one:
 *
 *   `fleet` — ONE batched `POST /api/query` of the fleet masters; their
 *             denormalized care + document POINTERS (`last_odo`,
 *             `last_engine_oil`, `last_gear_oil`, `last_license.expiry_date`,
 *             `last_insurance.expiry_date`) carry the alert grid.
 *   `tasks` — the BOUNDED `my-tasks?limit=` feed for the to-do widget.
 *
 * RBAC gates which widget RENDERS — and therefore which read runs — so an
 * ungranted collection is never fetched. A widget that is REMOVED from the board
 * must take its query and read function with it: a view that does not render the
 * data must not keep fetching it (the approvals card's three pending feeds were
 * exactly that waste).
 */

export const WIDGETS_QUERY_KEY = ['widgets', 'board'] as const;
const WIDGETS_FLEET_KEY = [...WIDGETS_QUERY_KEY, 'fleet'] as const;
const WIDGETS_TASKS_KEY = [...WIDGETS_QUERY_KEY, 'tasks'] as const;

/** How many to-dos the widget shows — the to-do list's bound, so the feed walks
 *  ONE page instead of the whole task list (see the route's `?limit=`). */
export const WIDGET_TASKS_LIMIT = 8;

/** The board's per-role visibility — resolved from `/auth/me`'s DB grants (the
 *  app-access predicate's twin). ONE flag per widget that RENDERS: a removed
 *  widget drops its flag, so its read can never be re-enabled by accident. */
export interface WidgetGrants {
	/** can_read on `veh_fleets` — the Fleet & Operations alert grid. */
	fleet: boolean;
	/** can_read on `hrm_tasks` — the My Tasks to-do list. */
	tasks: boolean;
}

/** True when at least one widget may render — the launcher's own gate. */
export function anyWidgetVisible(grants: WidgetGrants): boolean {
	return grants.fleet || grants.tasks;
}

/**
 * The session's widget grants — resolved ONCE from the memoized `/auth/me`.
 * A `null` me degrades to nothing visible (the safe direction: the API
 * enforces the true answer; the board only decides whether to fetch).
 */
export function grantsOf(me: MeUser | null): WidgetGrants {
	if (!me) return { fleet: false, tasks: false };
	return {
		fleet: canReadCollection(me, 'veh_fleets'),
		tasks: canReadCollection(me, 'hrm_tasks'),
	};
}

export interface WidgetsFleetRow {
	id: string;
	plate_no?: string | null;
	brand?: string | null;
	last_odo?: number | null;
	last_engine_oil?: number | null;
	last_gear_oil?: number | null;
	last_license?: { expiry_date?: string | null } | null;
	last_insurance?: { expiry_date?: string | null } | null;
}

/** The bounded projection the whole alert grid needs — nothing else. */
const FLEET_WIDGET_FIELDS = [
	'id',
	'plate_no',
	'last_odo',
	'last_engine_oil',
	'last_gear_oil',
	'last_license.expiry_date',
	'last_insurance.expiry_date',
] as const;

/** The minified SDK batch shape the generic engine answers with. `query` is the
 *  SDK's OWN contract — a `URLSearchParams` (or a params record), NEVER a
 *  serialized string: a string is not `instanceof URLSearchParams` and has no
 *  enumerable string values, so the SDK would forward one junk param per
 *  CHARACTER and fall back to the default page size, silently reading the wrong
 *  rows with no projection. Typed as the SDK types it so that failure cannot be
 *  written again. */
interface BatchedClient {
	queryMany: (
		specs: Array<{ key: string; collection: string; query: URLSearchParams | Record<string, string | number | boolean | undefined> }>,
	) => Promise<{
		results: Array<{ key: string; data: Record<string, unknown>[] }>;
	}>;
}

/** The board's fleet read as a QUERY — pure, so the contract above is unit-testable
 *  (`fleet-query.spec.ts`). */
export function fleetWidgetQuery(): URLSearchParams {
	return serializeQuery({ fields: [...FLEET_WIDGET_FIELDS], limit: 100, sort: 'plate_no' });
}

function toFleetRow(raw: Record<string, unknown>): WidgetsFleetRow {
	const pointer = (value: unknown): { expiry_date?: string | null } | null =>
		value && typeof value === 'object' ? (value as { expiry_date?: string | null }) : null;
	const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
	return {
		id: String(raw.id),
		plate_no: typeof raw.plate_no === 'string' ? raw.plate_no : null,
		brand: typeof raw.brand === 'string' ? raw.brand : null,
		last_odo: num(raw.last_odo),
		last_engine_oil: num(raw.last_engine_oil),
		last_gear_oil: num(raw.last_gear_oil),
		last_license: pointer(raw.last_license),
		last_insurance: pointer(raw.last_insurance),
	};
}

/** The fleet masters — ONE batched round trip (bounded; masters are small). */
export async function fetchWidgetFleet(): Promise<WidgetsFleetRow[]> {
	const batched = sdk as unknown as BatchedClient;
	const res = await batched.queryMany([{ key: 'fleets', collection: 'veh_fleets', query: fleetWidgetQuery() }]);
	return (res.results.find((r) => r.key === 'fleets')?.data ?? []).map(toFleetRow);
}

/**
 * The My Tasks to-do read — the SAME server-scoped feed the projects board uses,
 * asked for a small bound (`WIDGET_TASKS_LIMIT`) so the route returns after ONE
 * engine page. The server resolves the acting employee from the session when no
 * `employee_id` is passed (no client-supplied identity).
 */
export async function fetchWidgetTasks(employeeId: string | null): Promise<MyTask[]> {
	if (!employeeId) return [];
	const { tasks } = await fetchMyTasks(employeeId, WIDGET_TASKS_LIMIT);
	return tasks;
}

/** The query keys the board's widget groups read under. */
export const widgetsKeys = {
	fleet: (identity: string) => [...WIDGETS_FLEET_KEY, identity] as const,
	tasks: (identity: string) => [...WIDGETS_TASKS_KEY, identity] as const,
};
