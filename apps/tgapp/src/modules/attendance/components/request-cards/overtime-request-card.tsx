import type { HrRequest } from '../../data/types';
import { OT_TYPE_LABELS, formatShiftTime12h, otHoursLabel, requestDate } from './format';
import type { RequestFact } from './request-facts';
import { RequestCardShell, type RequestCardData, type RequestCardShellProps } from './request-card-shell';

/**
 * The Overtime card's data — the date leads the collapsed summary with the total
 * hours on its right; the expanded body carries the time span and the OT type.
 */
export function overtimeRequestData(request: HrRequest): RequestCardData {
	const date = request.ot_date ? requestDate(request.ot_date) : null;
	const span =
		request.start_time && request.end_time
			? `${formatShiftTime12h(request.start_time)} → ${formatShiftTime12h(request.end_time)}`
			: request.start_time
				? formatShiftTime12h(request.start_time)
				: null;
	// OT stores its span on both `hours_count` and `total_hours`, but some rows
	// carry it on only one — read whichever is present.
	const total = otHoursLabel(request.hours_count ?? request.total_hours);

	const facts: RequestFact[] = [];
	if (span) facts.push({ kind: 'label-value', label: 'Time', value: span });
	if (request.ot_type) facts.push({ kind: 'label-value', label: 'Type', value: OT_TYPE_LABELS[request.ot_type] ?? request.ot_type });

	return {
		summary: { primary: date ?? '—', secondary: total },
		facts,
	};
}

type OvertimeRequestCardProps = Omit<RequestCardShellProps, 'facts' | 'summary'>;

/** Overtime — the enterprise request card: date / total hours in the collapsed
 *  summary, the time span and OT type in the expanded details. */
export function OvertimeRequestCard(props: OvertimeRequestCardProps) {
	const { summary, facts } = overtimeRequestData(props.request);
	return <RequestCardShell {...props} summary={summary} facts={facts} />;
}
