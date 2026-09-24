import type { RequestCardShellProps } from './request-cards/request-card-shell';
import { LeaveRequestCard } from './request-cards/leave-request-card';
import { OvertimeRequestCard } from './request-cards/overtime-request-card';
import { EarlyLeaveRequestCard } from './request-cards/early-request-card';

/**
 * Thin dispatcher — every HR-request page (my-request lists, the approval
 * center, search results, the all-types inbox) imports ONE `RequestCard` and
 * gets the card for whichever type the row carries. The actual anatomy lives
 * in the shared shell + the per-type fact builders under `request-cards/`
 * (`leave-request-card`, `overtime-request-card`, …), so each type's card stays
 * a tiny focused file.
 */
export type RequestCardProps = Omit<RequestCardShellProps, 'facts' | 'summary'>;

export function RequestCard({ request, ...rest }: RequestCardProps) {
	switch (request.request_type) {
		case 'leave':
			return <LeaveRequestCard request={request} {...rest} />;
		case 'ot':
			return <OvertimeRequestCard request={request} {...rest} />;
		case 'early':
			return <EarlyLeaveRequestCard request={request} {...rest} />;
		default:
			return null;
	}
}

export { RequestStatusBadge } from './request-cards/status-badge';
export type { RequestCardShellProps, RequestSummary } from './request-cards/request-card-shell';
