import type { HrRequest } from '../../data/types';
import { formatShiftTime12h, requestDate } from './format';
import type { RequestFact } from './request-facts';
import { RequestCardShell, type RequestCardData, type RequestCardShellProps } from './request-card-shell';

/**
 * The Early Leave card's data — the exit date leads the collapsed summary with
 * the exit time on its right, so the expanded body carries only the reason (and
 * any rejection remark) rather than repeating the date.
 */
export function earlyLeaveRequestData(request: HrRequest): RequestCardData {
	const date = request.early_date ? requestDate(request.early_date) : null;
	const exit = request.leave_time ? formatShiftTime12h(request.leave_time) : null;
	const facts: RequestFact[] = [];
	return {
		summary: { primary: date ?? '—', secondary: exit },
		facts,
	};
}

type EarlyLeaveRequestCardProps = Omit<RequestCardShellProps, 'facts' | 'summary'>;

/** Early Leave — the enterprise request card: exit date / time in the collapsed
 *  summary, the reason in the expanded details. */
export function EarlyLeaveRequestCard(props: EarlyLeaveRequestCardProps) {
	const { summary, facts } = earlyLeaveRequestData(props.request);
	return <RequestCardShell {...props} summary={summary} facts={facts} />;
}
