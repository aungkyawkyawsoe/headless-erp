import type { HrRequest } from '../../data/types';
import { leaveDateRangeLabel, leaveDaysLabel } from './format';
import type { RequestFact } from './request-facts';
import { RequestCardShell, type RequestCardData, type RequestCardShellProps } from './request-card-shell';

/**
 * The Leave card's data — the date range is the COLLAPSED summary's primary
 * token and the duration its secondary, so the expanded body only adds the
 * Reliever row (nothing repeats what the summary already shows).
 */
export function leaveRequestData(request: HrRequest): RequestCardData {
	// Effective session for a SINGLE-date leave — the row stores it in the
	// derived `leave_type` (half-day morning/afternoon), NOT `start_period`
	// (which the mapper leaves null for a single date). Feed that session into
	// the compact range so it reads “Sep 1, Morning” / “Sep 1, Afternoon”.
	const from = request.from_date;
	const to = request.to_date;
	const single = from != null && to != null && to === from;
	let singlePeriod = request.start_period;
	if (single) {
		const lt = request.leave_type;
		if (lt === 'half_day_morning') singlePeriod = 'morning';
		else if (lt === 'half_day_afternoon') singlePeriod = 'evening';
		else singlePeriod = null;
	}
	const range = leaveDateRangeLabel(from, to, single ? singlePeriod : request.start_period, request.end_period);
	const daysValue = leaveDaysLabel(request.days_count);

	const facts: RequestFact[] = [];
	if (request.reliever_name) facts.push({ kind: 'label-value', label: 'Reliever', value: request.reliever_name });

	return {
		summary: {
			primary: range,
			secondary: daysValue !== '—' && range !== '—' ? daysValue : null,
		},
		facts,
	};
}

type LeaveRequestCardProps = Omit<RequestCardShellProps, 'facts' | 'summary'>;

/** Leave — the enterprise request card: date range / duration in the collapsed
 *  summary, Reliever in the expanded details. */
export function LeaveRequestCard(props: LeaveRequestCardProps) {
	const { summary, facts } = leaveRequestData(props.request);
	return <RequestCardShell {...props} summary={summary} facts={facts} />;
}
