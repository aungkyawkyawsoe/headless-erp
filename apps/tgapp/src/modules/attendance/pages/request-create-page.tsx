import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { ModuleShell } from '@/shared/components/module-shell';
import { FormSubmitBar } from '@/shared/components/form-submit';
import { hapticImpact } from '@/shared/platform/haptics';
import { popBack } from '@/shared/platform/history';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';
import { qk } from '../data/query-keys';
import { REQUEST_CREATE_TITLE, REQUEST_LIST_ROUTE, REQUEST_SUBMIT_LABEL } from '../data/request-meta';
import { LeaveFormBody } from '../components/leave-form-body';
import { EarlyLeaveFormBody } from '../components/early-leave-form-body';
import { RequestFormBody } from '../components/request-form-body';
import { useActingEmployee } from '../hooks/use-acting-employee';
import { DEFAULT_FORM_STATE, type FormState } from '@/shared/components/form-state';
import type { HrRequestType } from '../data/types';

/**
 * The create-request page at `.../+` (Leave / Early Leave / Overtime) —
 * one component, three routes. Reached FIRST from the dashboard's quick actions
 * (entry form first) and from the list page's + FAB; back (native BackButton or
 * the browser pill) returns to the list.
 *
 * The type-specific form body owns the fields + validation; this page hosts the
 * submission affordance. Inside Telegram the native MainButton carries the
 * submit on Android/Desktop (Apple clients skip it — the native button clips
 * Burmese text, see `use-main-button.ts`); every other surface gets the in-page
 * fallback button — never both, same rule as the BackButton pill.
 *
 * The page deliberately carries NO fixed bottom bar: the app's glass
 * `BottomActionBar` is a LIST-page affordance, and on Telegram it stacked its
 * pill directly over the client's own native MainButton. Back (native pill /
 * BackButton) already returns to this type's list, so a second in-page toggle
 * was ink without information.
 */
export default function RequestCreatePage({ requestType }: { requestType: HrRequestType }) {
	const title = REQUEST_CREATE_TITLE[requestType];
	const listRoute = REQUEST_LIST_ROUTE[requestType];
	const submitLabel = REQUEST_SUBMIT_LABEL[requestType];

	const navigate = useNavigate();
	const queryClient = useQueryClient();

	// Who the session acts as — the SAME one identity read the dashboard uses (the
	// session's `employee_id` first, the Telegram id only as the fallback). The
	// applicant is an `hrm_employees` uuid, so a WEB sign-in — which has no Telegram
	// id at all — can file a request instead of staring at a submit button that could
	// never enable.
	const identity = useActingEmployee();

	// The body reports submit/validity/loading to this page (drives the submit
	// button). Resets only via a fresh mount — a new visit gets a fresh form.
	const [formState, setFormState] = useState<FormState>(DEFAULT_FORM_STATE);
	const onReady = useCallback((state: FormState) => setFormState(state), []);

	// Successful create → refresh every request list (this type + Requests +
	// approvals badge), then land back on the list with the new row on top.
	// `refetchType: 'active'` refetches the MOUNTED lists here; unmounted ones
	// (deeper cached pages / the all-types inbox) are stale-marked and refetch
	// once on the next visit — a fresh row still shows after returning without a
	// manual reload, but no background burst re-reads every cached page for
	// screens that aren't open.
	// Cached single-row `detail` queries are excluded: nothing on this page wrote
	// them, so refetching each on every submit is a wasted request per edited row.
	// Pop (not push): a pushed list entry would leave the create page beneath it,
	// so back from the list would re-open a fresh empty form.
	const handleDone = useCallback(() => {
		hapticImpact('medium');
		void queryClient.invalidateQueries({
			queryKey: qk.requestsAll(),
			refetchType: 'active',
			predicate: (query) => !query.queryKey.includes('detail'),
		});
		popBack(navigate, listRoute);
	}, [queryClient, navigate, listRoute]);

	// The submit affordance: the native MainButton on Android/Desktop Telegram
	// (Apple clients fall back — native iOS clips Burmese labels); the in-page
	// button everywhere else. Never both — same rule as the native BackButton
	// pill. While a form body hides its submit (e.g. the reliever sheet is
	// open) the native button is tucked away, then resurfaced when the sheet
	// closes; the in-page fallback is disabled instead (canSubmit goes false).
	const isMainButton = useTelegramMainButton({
		text: formState.submitting ? 'Submitting…' : submitLabel,
		onClick: () => formState.submit(),
		visible: !formState.hideMainButton,
		disabled: !formState.canSubmit,
		loading: formState.submitting,
	});

	return (
		<ModuleShell title={title} backTo={listRoute}>
			<div className="flex flex-1 flex-col gap-5 pt-2">
				{requestType === 'leave' && (
					<LeaveFormBody
						employeeId={identity.employeeId}
						employeeName={identity.employee?.name_mm ?? identity.employee?.name_en ?? null}
						employeeEid={identity.employee?.eid ?? null}
						onReady={onReady}
						onDone={handleDone}
					/>
				)}
				{requestType === 'early' && (
					<EarlyLeaveFormBody
						employeeId={identity.employeeId}
						employeeName={identity.employee?.name_mm ?? identity.employee?.name_en ?? null}
						employeeEid={identity.employee?.eid ?? null}
						onReady={onReady}
						onDone={handleDone}
					/>
				)}
				{requestType === 'ot' && (
					<RequestFormBody
						employeeId={identity.employeeId}
						employeeName={identity.employee?.name_mm ?? identity.employee?.name_en ?? null}
						employeeEid={identity.employee?.eid ?? null}
						onReady={onReady}
						onDone={handleDone}
					/>
				)}

				<FormSubmitBar
					label={submitLabel}
					isMainButton={isMainButton}
					disabled={!formState.canSubmit}
					submitting={formState.submitting}
					submittingLabel="Submitting…"
					onSubmit={() => formState.submit()}
				/>
			</div>
		</ModuleShell>
	);
}
