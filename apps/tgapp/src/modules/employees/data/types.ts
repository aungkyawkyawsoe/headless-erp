/**
 * Row shapes for the employees directory + its details bottom sheet.
 *
 * The generated schema (`src/generated/schema.ts`) covers the collections the app
 * reads through the shared lookups; this module types its own rows against the
 * registered dev schema and narrows the SDK client to them locally (`api.ts`).
 *
 * Of the three relations, `department` and `designation` are DECLARED m2o fields
 * whose names ARE the FK column names (`cms_hrm_employees.department` etc.), so
 * a bare relation name in `fields` expands to the full related row — the module
 * flattens that expansion at the data boundary (`api.ts`). `shifts`, by contrast,
 * is a virtual m2m to the `hrm_shifts` collection — a dotted `shifts.name` in
 * `fields` expands to an ARRAY of related shift rows.
 *
 * Relations are ONLY requested for the one-on-demand detail read
 * (`fetchEmployeeDetails`); the paginated directory read is a scalar-only
 * projection (see `DIRECTORY_FIELDS` in `api.ts`) so relation columns stay
 * null/absent on list rows.
 */

/** One related shift row from the `hrm_employees.shifts` m2m expansion — its name,
 *  plus the schedule columns (`time_in` + `working_hours`) used for the range
 *  label. Both stay null when the related collection omits them. */
export interface ShiftInfo {
	id: string;
	name?: string | null;
	/** Expected start time (`HH:MM`) — the shift's ဝင်ချိန်. */
	time_in?: string | null;
	/** Working hours (decimal hours) — the shift's duration. */
	working_hours?: number | null;
}

/** `hrm_employees` — one directory row, as the API returns it after the module's
 *  flattening (relation expansions → scalar names, INTEGER booleans → real
 *  booleans). Every field is optional so reads stay resilient to schema drift. */
export interface EmployeeRow {
	id: string;
	/** Burmese display name (primary — falls back to `name_en` at the card). */
	name_mm?: string | null;
	name_en?: string | null;
	/** Employee id shown under the name (e.g. "WH-0001"). */
	eid?: string | null;
	/** Directory photo — `/api/media/<uuid>.jpg` (the `avatar` media field), or
	 *  null when the employee has no photo (the card/sheet fall back to the icon). */
	avatar?: string | null;
	/** The legacy employee↔Telegram id, when populated. */
	etg_id?: string | null;
	/** ကျား/မ — schema enum: `male | female`. */
	gender?: 'male' | 'female' | null;
	/** အလုပ်ဝင်ရက်စွဲ — `YYYY-MM-DD`. */
	doj?: string | null;
	/** မွေးသက္ကရာဇ် — `YYYY-MM-DD`. */
	dob?: string | null;
	/** Employment status — `true` = currently working (အလုပ်တက်နေ). */
	active?: boolean | null;
	/** Expanded `department.name` (m2o flattened at the data boundary). */
	department_name?: string | null;
	/** Expanded `designation.name` (m2o flattened at the data boundary). */
	designation_name?: string | null;
	/** The employee's assigned shifts (the `shifts` m2m expansion → an array of
	 *  related rows), when any are assigned. */
	shifts?: ShiftInfo[] | null;
}
