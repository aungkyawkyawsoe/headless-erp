import { useQuery } from '@tanstack/react-query';

import type { MmbixClient } from '@mmbix/sdk';

import { sdk } from '@/shared/api/sdk';
import { DIRECTORY_STALE_MS } from './query-keys';

/**
 * The employee-detail page's SECONDARY reads — the three tab bodies that are not
 * the profile itself (Belonging Assets / Tasks / Projects) plus the ONE identity
 * resolution the page needs when it is opened by id alone (a cold deep link).
 *
 * These live in the employees module (not in `projects/` or `tyres/`) because
 * they are views OVER those domains shaped for THIS profile — the same way
 * `tyres/pages/employee-assets-page.tsx` composes the shared `AssetRegister`
 * rather than the tyres module owning a person-shaped register.
 *
 * ### One scoped read, two answers
 *
 * The engine cannot filter the `assignee` m2m (`filter[assignee][_null]` is a D1
 * error), so "this person's tasks" is resolved SERVER-SIDE by `GET
 * /api/hr/my-tasks?employee_id=` (one indexed junction lookup, then one engine
 * read of just those rows — see the route). The Tasks tab and the Projects tab
 * reduce that SAME response (keyed `['hrm_tasks','employee-facets',id]`) rather
 * than each reading the collection again.
 *
 * This used to be a whole-collection walk of `hrm_tasks` reduced in the browser,
 * which made opening a profile scale with the ENTIRE task table and fail on a
 * slow connection — the reported "Could not load" on the task tabs. The endpoint
 * makes the read scale with the person's own assignments instead.
 *
 * The assets register is deliberately NOT read here — the page's banner chip takes
 * the count from the SHARED holder-register cache (`tyreQk.holderAssetsOfEmployee`,
 * via `getQueryData`), and a tap on the chip is what triggers that page's own
 * fetch. The task-facets read is EAGER but gated: the Tasks / Projects tabs are
 * painted only for a person who actually HAS tasks, so the page must ask — ONE
 * small scoped read, issued only when the caller may read `hrm_tasks`, and shared
 * by both tab bodies (opening or switching a tab never reads again).
 */

/** The SDK narrowed to this module's collections (same cast pattern as `api.ts`). */
type OpsSchema = {
	hrm_employees: Record<string, unknown>;
	hrm_tasks: Record<string, unknown>;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/* ── Identity ───────────────────────────────────────────────────────────────
 * The directory (and therefore `useEmployeeMasters`) reads a SCALAR projection
 * with NO relations, so a cold `/app/employees/:id` deep link cannot show the
 * department / designation / shifts. This reads THIS one row with the relation
 * expansions — the same shape `fetchEmployeeDetails` produces for the directory
 * sheet — so the profile page renders identically however it was opened. */

const DETAIL_FIELDS: string[] = [
	'id',
	'name_mm',
	'name_en',
	'eid',
	'avatar',
	'etg_id',
	'active',
	'gender',
	'doj',
	'dob',
	'department',
	'designation',
	'shifts.name',
	'shifts.id',
	'shifts.time_in',
	'shifts.working_hours',
];

/**
 * ONE employee's profile row by id — the deep-link counterpart of the directory's
 * on-demand `fetchEmployeeDetails`. It deliberately does NOT go through
 * `useEmployeeMasters`: that walk is the heaviest master read in the app
 * (200+ people, ~10 paginated requests) and would cost the whole directory to
 * answer for one person. This is a single `hrm_employees` row read.
 *
 * The normalizer is intentionally shallow (raw strings + the m2o `name` fields),
 * because the page only renders a handful of scalars; anything absent renders
 * as `—` rather than blocking the header.
 */
export interface EmployeeProfile {
	id: string;
	nameMm: string | null;
	nameEn: string | null;
	eid: string | null;
	avatar: string | null;
	etgId: string | null;
	gender: 'male' | 'female' | null;
	doj: string | null;
	dob: string | null;
	active: boolean | null;
	departmentName: string | null;
	designationName: string | null;
	shifts: Array<{ id: string; name: string | null; timeIn: string | null; workingHours: number | null }>;
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** A bare m2o name arrives as `{ id, name_mm, name_en }` (expanded) or a bare id. */
function relName(value: unknown): string | null {
	if (!value || typeof value !== 'object') return null;
	const row = value as { name_mm?: unknown; name_en?: unknown; name?: unknown };
	return text(row.name_mm) ?? text(row.name_en) ?? text(row.name);
}

/** The `active` INTEGER 1/0 the engine stores → a real boolean (null when unset). */
function toBool(value: unknown): boolean | null {
	if (value === true || value === 1 || value === '1' || value === 'true') return true;
	if (value === false || value === 0 || value === '0' || value === 'false') return false;
	return null;
}

export function toEmployeeProfile(raw: Record<string, unknown>): EmployeeProfile {
	const gender = raw.gender === 'male' || raw.gender === 'female' ? raw.gender : null;
	const rawShifts = Array.isArray(raw.shifts) ? (raw.shifts as Array<Record<string, unknown>>) : [];
	const shifts = rawShifts.reduce<EmployeeProfile['shifts']>((acc, shift) => {
		const id = text(shift.id);
		if (!id) return acc;
		const timeIn = text(shift.time_in);
		acc.push({
			id,
			name: text(shift.name),
			timeIn: timeIn ? timeIn.slice(0, 5) : null,
			workingHours: typeof shift.working_hours === 'number' ? shift.working_hours : null,
		});
		return acc;
	}, []);
	return {
		id: text(raw.id) ?? '',
		nameMm: text(raw.name_mm),
		nameEn: text(raw.name_en),
		eid: text(raw.eid),
		avatar: text(raw.avatar),
		etgId: text(raw.etg_id),
		gender,
		doj: text(raw.doj),
		dob: text(raw.dob),
		active: toBool(raw.active),
		departmentName: relName(raw.department),
		designationName: relName(raw.designation),
		shifts,
	};
}

export async function fetchEmployeeProfile(id: string): Promise<EmployeeProfile | null> {
	const row = await ops.items('hrm_employees').get(id, { fields: DETAIL_FIELDS });
	return row ? toEmployeeProfile(row) : null;
}

/* ── Belonging assets ─────────────────────────────────────────────────────────
 * The assets register is NOT read here. It has no tab and no prefetch: the page's
 * banner chip takes the count straight out of the SHARED holder-register cache
 * (`tyreQk.holderAssetsOfEmployee`, the same entry `/app/employees/:id/assets`
 * and a truck's board fill), via `getQueryData` — so the profile never pays for a
 * belongings read just to paint a badge, and a tap on the chip is what triggers
 * the register page's own fetch. */

/* ── This person's tasks + the projects they touch ────────────────────────────
 * The engine cannot filter the `assignee` m2m (`filter[assignee][_null]` is a D1
 * error), so — exactly like the attendance dashboard's `fetchMyTasks` — this reads
 * `GET /api/hr/my-tasks?employee_id=`, which resolves the junction server-side and
 * returns just THIS person's rows. It used to walk the whole `hrm_tasks`
 * collection and filter in the browser, which scaled with the entire table and
 * failed on slow networks.
 *
 * ONE read answers BOTH the Tasks tab and the Projects tab (a person's projects
 * ARE the projects of their tasks — `hrm_projects` has no membership column), so
 * the two tabs can never disagree and never read twice. */

export interface EmployeeTaskRow {
	id: string;
	name: string;
	state: string | null;
	priority: string | null;
	dueDate: string | null;
	projectName: string | null;
}

export interface EmployeeProjectRow {
	id: string;
	name: string;
	total: number;
	done: number;
}

/** Everything the task-derived tabs need, from ONE scoped read. */
export interface EmployeeTaskFacets {
	tasks: EmployeeTaskRow[];
	projects: EmployeeProjectRow[];
}

interface RawFacetTask {
	id?: unknown;
	name?: unknown;
	priority?: unknown;
	state?: unknown;
	due_date?: unknown;
	project?: { id?: unknown; name?: unknown } | string | null;
	assignee?: unknown;
}

export async function fetchEmployeeTaskFacets(employeeId: string): Promise<EmployeeTaskFacets> {
	if (!employeeId) return { tasks: [], projects: [] };
	// ONE scoped round trip: the endpoint resolves the `assignee` m2m junction
	// server-side (the engine URL syntax cannot) and returns just this person's
	// rows. Each row keeps `assignee` (the pruner always keeps relation ids) plus
	// the expanded `project`, which is exactly what `reduceTaskFacets` reads.
	const { tasks } = await sdk.request<{ tasks: RawFacetTask[] }>('/hr/my-tasks', {
		query: { employee_id: employeeId },
	});
	return reduceTaskFacets(tasks ?? [], employeeId);
}

/**
 * The pure half of the facets read — reduce the endpoint's rows down to THIS
 * employee's tasks plus the projects those tasks belong to. Split out (and
 * exported) so the project bucketing and the ordering can be unit tested without
 * a network round trip. The `assignee` filter is retained as defence in depth —
 * the server already scoped the set — and it is what keeps the reducer honest for
 * any caller that passes a wider page.
 */
export function reduceTaskFacets(rows: RawFacetTask[], employeeId: string): EmployeeTaskFacets {
	const tasks: EmployeeTaskRow[] = [];
	const buckets = new Map<string, EmployeeProjectRow>();

	for (const row of rows) {
		const assignees = Array.isArray(row.assignee) ? (row.assignee as Array<{ id?: unknown }>) : [];
		if (!assignees.some((person) => person && typeof person === 'object' && person.id === employeeId)) continue;

		const state = text(row.state);
		const project = row.project && typeof row.project === 'object' ? (row.project as { id?: unknown; name?: unknown }) : null;
		const projectId = text(project?.id);
		const projectName = text(project?.name);

		tasks.push({
			id: text(row.id) ?? '',
			name: text(row.name) ?? '—',
			state,
			priority: text(row.priority)?.toLowerCase() ?? null,
			dueDate: text(row.due_date),
			projectName,
		});

		if (!projectId) continue;
		const bucket = buckets.get(projectId) ?? { id: projectId, name: projectName ?? '—', total: 0, done: 0 };
		bucket.total += 1;
		if (state === 'done') bucket.done += 1;
		buckets.set(projectId, bucket);
	}

	// Open work first, then nearest due date (undated last) — the same ordering the
	// attendance feed uses, so both surfaces read alike. A done row here is a row
	// whose state stores exactly `done` (the schema's own value).
	tasks.sort((a, b) => {
		const aDone = a.state === 'done' ? 1 : 0;
		const bDone = b.state === 'done' ? 1 : 0;
		if (aDone !== bDone) return aDone - bDone;
		return (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31');
	});

	return {
		tasks,
		projects: [...buckets.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
	};
}

/* ── The shared facets hook ───────────────────────────────────────────────────
 * Keyed under `hrm_tasks` (the SDK prefix-matches `[collection, …]` for
 * write-through invalidation, and a task write's change envelope names it), so
 * the profile never fires a SECOND read when the board mutates.
 *
 * The page reads this EAGERLY (gated on the caller's Projects access) because the
 * Tasks / Projects tabs are painted only when this person really has tasks — a
 * question that cannot be answered without asking. It is ONE small scoped read
 * (one junction lookup + this person's rows) and both tab bodies reuse the SAME
 * cache entry, so opening either tab, or switching between them, reads nothing. */

/**
 * This person's tasks + projects — ONE scoped read, shared by the Tasks tab and
 * the Projects tab (a `null`/empty id never fires). Pass `enabled: false` to keep
 * the read off entirely (a caller who may not read `hrm_tasks`).
 */
/**
 * The ONE rule for whether the task-derived tabs (Tasks / Projects) belong on an
 * employee's profile: the caller must be able to READ `hrm_tasks`, and THIS
 * employee must actually have tasks. Pure and exported so the tab strip's gate is
 * pinned by a test instead of re-derived inline in the page.
 */
export function shouldShowTaskTabs(canReadTasks: boolean, facets: EmployeeTaskFacets | undefined): boolean {
	return canReadTasks && (facets?.tasks.length ?? 0) > 0;
}

export function useEmployeeTaskFacets(employeeId: string, enabled = true) {
	return useQuery({
		queryKey: ['hrm_tasks', 'employee-facets', employeeId] as const,
		queryFn: () => fetchEmployeeTaskFacets(employeeId),
		enabled: Boolean(employeeId) && enabled,
		staleTime: DIRECTORY_STALE_MS,
	});
}
