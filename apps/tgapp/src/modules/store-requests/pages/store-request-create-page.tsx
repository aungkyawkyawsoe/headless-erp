import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { checkRequisitionDuplicate, createRequisition } from '../data/api';
import { fetchCurrentEmployee } from '@/modules/attendance/data/api';
import { qk } from '../data/query-keys';
import type { CreateRequisitionInput } from '../data/types';
import { ModuleShell } from '@/shared/components/module-shell';
import { RequisitionForm, type RequestScope, type RequisitionFormValue, type RequisitionWarning } from '../components/requisition-form';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';

/** Read the one-shot URL prefill (`?vehicle=<id>&scope=tyre|equipment`) — the
 *  truck board's on-board list opens this form already bound to that truck and
 *  filtered to the catalog the tapped request means. Read once as INITIAL state
 *  only; the URL is never kept in sync after that. */
function parseRequestPrefill(search: string): { vehicleId: string | null; scope: RequestScope | null } {
	const params = new URLSearchParams(search);
	const vehicleId = params.get('vehicle')?.trim() || null;
	const scope = params.get('scope');
	return { vehicleId, scope: scope === 'tyre' || scope === 'equipment' ? scope : null };
}

/**
 * တောင်းခံလွှာအသစ် — the requisition create form (`/app/store-requests/+`),
 * behind the list's + button. Reached from the list; back returns there.
 *
 * The form itself is the SHARED `RequisitionForm` (one implementation with the
 * detail page's amend view); this page only supplies the create-mode wiring —
 * the requester resolved from the session, the `mro_requisitions` POST, and the
 * list invalidation on success.
 */
export default function StoreRequestCreatePage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const { search } = useLocation();
	const prefill = useMemo(() => parseRequestPrefill(search), [search]);

	/** The requester of a new request is the current login employee — resolved
	 *  here for BOTH the pre-flight and the create, so the two can never disagree
	 *  about whose same-day basket is being checked. */
	const requesterId = async (): Promise<string | null> => {
		const me = await fetchCurrentEmployee();
		return me?.id ?? null;
	};

	/**
	 * The engine's pre-flight for the basket being filed — the SAME same-day
	 * duplicate rule the compiled guard enforces. A duplicate is a warning, not a
	 * refusal: the form shows it and, on confirm, re-submits with the returned
	 * ack token so the request is filed anyway.
	 */
	const preflight = async (value: RequisitionFormValue): Promise<RequisitionWarning | null> => {
		const requestedBy = await requesterId();
		// No linked employee — the create path owns that failure (and its message).
		if (!requestedBy) return null;
		const check = await checkRequisitionDuplicate({
			request_date: value.request_date,
			requested_by: requestedBy,
			lines: value.lines,
		});
		return check.duplicate && check.message && check.ack ? { message: check.message, ack: check.ack } : null;
	};

	const submit = async (value: RequisitionFormValue, options?: { ack?: string }) => {
		// The requester is the CURRENT logged-in employee (m2o → `hrm_employees`) —
		// resolved at submit from the session. The engine refuses a request with no
		// requester.
		const me = await fetchCurrentEmployee();
		if (!me) throw new Error('No employee account is linked to this session — ask your admin to link it.');
		const payload: CreateRequisitionInput = {
			...value,
			requested_by: me.id,
			requisition_status: 'requested',
		};
		// `ack` only rides on a user-confirmed duplicate (`preflight` above).
		await createRequisition(payload, options);
		notifySaved('Requisition created');
		// A fresh requisition must show on the list — refetch under the requisitions
		// PREFIX (every status group's cache refreshes, including deep pages), then
		// return to it. Pop (not push): a pushed list entry would leave the create
		// page beneath it, so back from the list would re-open a fresh empty form.
		void queryClient.invalidateQueries({ queryKey: qk.requisitionsAll(), refetchType: 'active' });
		popBack(navigate, '/app/store-requests');
	};

	return (
		<ModuleShell title="New Requisition" backTo="/app/store-requests">
			<RequisitionForm mode="create" scope={prefill.scope} boundVehicleId={prefill.vehicleId} onPreflight={preflight} onSubmit={submit} />
		</ModuleShell>
	);
}
