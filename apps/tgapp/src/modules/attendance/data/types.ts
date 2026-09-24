/**
 * Row shapes for the HR collections consumed by the ရုံးတက် (attendance) module.
 *
 * The generated schema (`src/generated/schema.ts`) covers the core HR collections
 * (hr_attendance, hr_requests, …). These module rows deliberately re-declare only
 * the columns the UI reads — typed against the verified dev schema (see
 * packages/sdk/test/schema.ts) — and the SDK client is narrowed to them locally
 * (`api.ts`) so the app surface stays stable if the engine adds columns.
 */

/** The request kind — the three the quick actions open (leave / ခွင့်, ot /
 *  အချိန်ပို, early / စောပြန်ခွင့်). On-duty was removed (no backing table). */
export type HrRequestType = 'leave' | 'ot' | 'early';

/** The UI request status — derived from the engine's system `doc_status`
 *  (pending_review → approved / rejected / cancelled; the data layer maps
 *  `pending` ⇄ `doc_status: 'pending_review'`). */
export type HrRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** `hr_attendance` — one punch (check-in / check-out). */
export interface AttendancePunch {
	id: string;
	employee_tg_id?: string | null;
	type?: 'check-in' | 'check-out' | null;
	timestamp?: string | null;
	location?: string | null;
	shift?: string | null;
	shift_id?: string | null;
	note?: string | null;
	status?: string | null;
	created_at?: string | null;
}

/** `hr_employees` — the directory row backing the header (name / eid / photo). */
export interface EmployeeRow {
	id: string;
	name_mm?: string | null;
	name_en?: string | null;
	eid?: string | null;
	tg_id?: string | null;
	photo_url?: string | null;
	/** Expanded `designation.name` (bare m2o `designation_id` expansion) — the role label. */
	designation_name?: string | null;
	/** The bare m2o FK — the engine expands it to the related row; flattened to `designation_name` at the data boundary. */
	designation_id?: unknown;
	/** Denormalized role/department label (e.g. "Vehicle · Incharge"), when populated. */
	summary?: string | null;
}

/** `hr_requests` — leave / overtime / early-leave / duty requests. */
export interface HrRequest {
	id: string;
	request_type?: HrRequestType | null;
	status?: HrRequestStatus | null;
	employee_name?: string | null;
	employee_eid?: string | null;
	employee_tg_id?: string | null;
	/** The applicant's avatar image (`/api/media/...`), from the expanded `employee` m2o. */
	applicant_avatar?: string | null;
	superior_tg_id?: string | null;
	/** တာဝန်လွှဲအပ်မည့်သူ — the colleague handed over to during the leave. */
	reliever_name?: string | null;
	/** The reliever's `hrm_employees` uuid (the native m2o `reliever_to` FK), carried
	 *  so edits/submits never need a name→id directory lookup. */
	reliever_id?: string | null;
	reason?: string | null;
	from_date?: string | null;
	to_date?: string | null;
	days_count?: number | null;
	leave_type?: string | null;
	/** ခွင့် disposition — `half_day` | `full_day` | `hourly` (verified hr_requests enum). */
	disposition?: string | null;
	/** Range leave only — the first day's work window (မနက် → ညနေ). Frontend contract; the backend column is pending. */
	start_period?: 'morning' | 'evening' | null;
	/** Range leave only — the last day's work window (မနက် → ညနေ). Backend column pending. */
	end_period?: 'morning' | 'evening' | null;
	early_date?: string | null;
	leave_time?: string | null;
	ot_date?: string | null;
	start_time?: string | null;
	end_time?: string | null;
	ot_type?: string | null;
	/** Computed OT span — stored on both `hours_count` and `total_hours` (verified hr_requests columns). */
	hours_count?: number | null;
	total_hours?: number | null;
	/** The approving superior's note — carried for EVERY status (a rejection's note
	 *  also lands in `reject_reason`, but an approved row's note is shown too). */
	superior_comment?: string | null;
	reject_reason?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
}
