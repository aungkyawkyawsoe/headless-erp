import type { HrRequestStatus, HrRequestType } from './types';

/**
 * Request-type metadata shared by the list pages and the `/+` create pages —
 * single source for titles, row labels, and the list route each create page
 * navigates back to.
 *
 * Wording rule for the attendance module: ရုံးတက် (the app's own name) and
 * ဆုံးဖြတ် (its action verb) stay Burmese because they are what the crew looks
 * for; every other label — request types, statuses, buttons — is English.
 */

/** Route → page metadata for the request destinations this page serves. */
export const REQUEST_META: Record<HrRequestType | 'all', { title: string }> = {
	leave: { title: 'Leave' },
	ot: { title: 'Overtime' },
	early: { title: 'Early Leave' },
	all: { title: 'Requests' },
};

/** App-bar title for the `/+` create page (e.g. 'New Leave Request'). */
export const REQUEST_CREATE_TITLE: Record<HrRequestType, string> = {
	leave: 'New Leave Request',
	early: 'New Early Leave',
	ot: 'New Overtime',
};

/** App-bar title for the `/:id/edit` page (e.g. 'Edit Leave Request'). */
export const REQUEST_EDIT_TITLE: Record<HrRequestType, string> = {
	leave: 'Edit Leave Request',
	early: 'Edit Early Leave',
	ot: 'Edit Overtime',
};

/** Submit-button label per editable type — the `/:id/edit` page's submit. */
export const REQUEST_UPDATE_LABEL: Record<HrRequestType, string> = {
	leave: 'Save Changes',
	early: 'Save Changes',
	ot: 'Save Changes',
};

/**
 * The request types that support editing — leave / early-leave / overtime.
 * Cards of these types are tappable while the row is `pending`; approved/rejected
 * rows never link to the edit page.
 */
export const EDITABLE_REQUEST_TYPES: ReadonlySet<HrRequestType> = new Set(['leave', 'early', 'ot']);

/** Row label per request type (list rows + approvals). */
export const REQUEST_TYPE_LABELS: Record<HrRequestType, string> = {
	leave: 'Leave',
	ot: 'Overtime',
	early: 'Early Leave',
};

/** The list route for each create-able type — the `/+` page's back target. */
export const REQUEST_LIST_ROUTE: Record<HrRequestType, string> = {
	leave: '/app/attendance/leave',
	early: '/app/attendance/early-leave',
	ot: '/app/attendance/overtime',
};

/** Status pill look per request status (list rows + approvals). */
export const STATUS_META: Record<HrRequestStatus, { label: string; className: string }> = {
	pending: { label: 'Pending', className: 'bg-status-warning-soft text-status-warning' },
	approved: { label: 'Approved', className: 'bg-status-success-soft text-status-success' },
	rejected: { label: 'Rejected', className: 'bg-status-danger-soft text-status-danger' },
	cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
};

/** Submit-button label per type (Telegram MainButton + browser fallback). */
export const REQUEST_SUBMIT_LABEL: Record<HrRequestType, string> = {
	leave: 'Submit Leave Request',
	early: 'Submit Early Leave',
	ot: 'Submit Overtime',
};
