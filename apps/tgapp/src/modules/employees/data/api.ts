import type { MmbixClient } from '@mmbix/sdk';

import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { LIST_PAGE_SIZE, SEARCH_LIMIT } from '@/shared/constants';
import { sdk } from '@/shared/api/sdk';
import type { EmployeeRow, ShiftInfo } from './types';

/**
 * The employees module's typed client — same cast pattern as the attendance
 * module: the app-wide client is typed against the placeholder `Schema = {}`,
 * so entity reads here go through a locally-typed view of the same instance.
 */
type OpsSchema = {
	hrm_employees: EmployeeRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/**
 * The module-prefixed `hrm_employees` collection — slug `hrm_employees`,
 * physical table `cms_hrm_employees`.
 */

/**
 * The DIRECTORY projection — every column the card renders, SCALARS ONLY: no
 * m2o expansion (`department` / `designation`) and no `shifts` m2m, so the
 * paginated list never drags related rows across the whole company. The card
 * needs only identity (name/eid/avatar), the status dot (`active`) and the
 * service-years badge (`doj`); `gender` feeds the card's corner icon. The full
 * profile — with its relations — is fetched ON DEMAND for the one tapped
 * employee (`fetchEmployeeDetails`), keeping the initial list writes cheap.
 */
const DIRECTORY_FIELDS: string[] = ['id', 'name_mm', 'name_en', 'eid', 'avatar', 'active', 'gender', 'doj'];

/**
 * The DETAILS projection — every column the bottom sheet shows, INCLUDING the
 * relation expansions: the bare m2o names (`department` / `designation`), which
 * the engine expands to the full related row, and the `shifts` m2m dotted path,
 * which expands to an ARRAY of shift rows (a lean default hides FKs; naming a
 * relation expands it with all its data). Fetched per-tapped-employee only.
 */
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

/** The raw API row — a wide object whose m2o names carry expanded rows. */
type RawEmployee = Record<string, unknown>;

/**
 * The entity engine stores booleans as SQLite INTEGER (1/0) and D1 returns
 * them as numbers — the API JSON carries `active: 1 | 0`, while the row type
 * and every consumer check `true`/`false` strictly. Normalize ONCE at the
 * data boundary so the card's status dot, the directory filter and the
 * details sheet all see a real boolean. `null`/unset passes through unchanged.
 */
function normalizeActive(value: unknown): boolean | null {
	if (value === true || value === 1 || value === '1' || value === 'true') return true;
	if (value === false || value === 0 || value === '0' || value === 'false') return false;
	return null;
}

/**
 * A bare m2o relation name expands to the FULL related row (`{ id, name, ... }`)
 * when the FK is a declared relation, or stays a plain string id otherwise.
 * Normalize BOTH shapes to `{ id, name }` so consumers see one stable shape.
 */
function normalizeRel(value: unknown): { id: string | null; name: string | null } {
	if (typeof value === 'string') return { id: value, name: null };
	if (value && typeof value === 'object') {
		const row = value as { id?: unknown; name?: unknown; name_mm?: unknown; name_en?: unknown };
		return {
			id: typeof row.id === 'string' ? row.id : null,
			name: String(row.name_mm ?? row.name_en ?? row.name ?? '') || null,
		};
	}
	return { id: null, name: null };
}

/**
 * `hrm_employees.shifts` — a virtual m2m to the `hrm_shifts` collection.
 * Requesting the dotted `shifts.*` path makes the engine expand the junction
 * into an ARRAY of related shift rows (vs the m2o relations above, which come
 * back as one object). Map each expanded row to its scalar id + name + schedule
 * (the range label needs `time_in` + `working_hours`); null when there are no
 * assignments.
 */
function normalizeShifts(value: unknown): ShiftInfo[] | null {
	const raw = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : null;
	if (!raw || raw.length === 0) return null;
	const rows = raw.reduce<ShiftInfo[]>((acc, row) => {
		const id = typeof row.id === 'string' && row.id ? row.id : null;
		if (!id) return acc;
		const name = typeof row.name === 'string' && row.name ? row.name : null;
		const timeIn = typeof row.time_in === 'string' && row.time_in ? row.time_in.slice(0, 5) : null;
		const workingHours = typeof row.working_hours === 'number' ? row.working_hours : null;
		acc.push({ id, name, time_in: timeIn, working_hours: workingHours });
		return acc;
	}, []);
	return rows.length > 0 ? rows : null;
}

/** Flatten ONE raw API row into the module's stable `EmployeeRow` shape. */
function toEmployeeRow(row: RawEmployee): EmployeeRow {
	const department = normalizeRel(row.department);
	const designation = normalizeRel(row.designation);
	const gender = row.gender === 'male' || row.gender === 'female' ? row.gender : null;
	return {
		id: typeof row.id === 'string' ? row.id : '',
		name_mm: typeof row.name_mm === 'string' && row.name_mm ? row.name_mm : null,
		name_en: typeof row.name_en === 'string' && row.name_en ? row.name_en : null,
		eid: typeof row.eid === 'string' && row.eid ? row.eid : null,
		avatar: typeof row.avatar === 'string' && row.avatar ? row.avatar : null,
		etg_id: typeof row.etg_id === 'string' && row.etg_id ? row.etg_id : null,
		gender,
		doj: typeof row.doj === 'string' && row.doj ? row.doj : null,
		dob: typeof row.dob === 'string' && row.dob ? row.dob : null,
		active: normalizeActive(row.active),
		department_name: department.name,
		designation_name: designation.name,
		shifts: normalizeShifts(row.shifts),
	};
}

/**
 * One page of the employee directory, `LIST_PAGE_SIZE` rows at a time
 * (cursor-based — the list page streams pages via `useCursorList` +
 * `LoadMoreSentinel` instead of walking the whole company up front).
 *
 * Reads ONLY the scalar `DIRECTORY_FIELDS` (name/eid/avatar/`active`/`doj`/
 * `gender`) — no relation joins, so paginating the whole company never pulls
 * related rows. Tapping a card fetches the full profile on demand via
 * `fetchEmployeeDetails`; the list payload stays lean by design.
 */
export async function fetchEmployeesPage(cursor?: string): Promise<CursorPage<EmployeeRow>> {
	const res = await ops.items('hrm_employees').list({
		fields: DIRECTORY_FIELDS,
		sort: 'name_en',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	const rows = (res.data as unknown as RawEmployee[]).map(toEmployeeRow);
	return {
		rows,
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/**
 * ONE employee's full profile — fetched ON DEMAND when its directory card is
 * tapped (the sheet's shimmer plays while this resolves), instead of joining the
 * `department` / `designation` m2o rows and the `shifts` m2m for every row of
 * every paginated page up front. Reads via `id` through the collection engine
 * (same normalizers as the list rows) and returns `null` when the row is gone.
 */
export async function fetchEmployeeDetails(id: string): Promise<EmployeeRow | null> {
	const res = await ops.items('hrm_employees').list({
		fields: DETAIL_FIELDS,
		filter: { id: { _eq: id } },
		limit: 1,
	});
	const row = (res.data as unknown as RawEmployee[])[0];
	return row ? toEmployeeRow(row) : null;
}

/**
 * The toolbar search — a server-side `?search=` read across the directory's
 * text fields (name MM/EN, eid), normalized EXACTLY like the list rows so the
 * SAME `EmployeeCard` renders the results.
 */
export async function fetchEmployeesSearch(query: string): Promise<EmployeeRow[]> {
	const res = await ops.items('hrm_employees').list({
		fields: DIRECTORY_FIELDS,
		search: query,
		sort: 'name_en',
		limit: SEARCH_LIMIT,
	});
	return (res.data as unknown as RawEmployee[]).map(toEmployeeRow);
}
