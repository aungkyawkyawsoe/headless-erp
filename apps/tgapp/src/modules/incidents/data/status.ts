import type { IncidentKind, IncidentSeverity } from './types';

/**
 * Severity pill look per incident severity — the same tinted pill palette as the
 * store / maintenance cards, mapped onto the urgency tiers (high → danger,
 * medium → warning, low → success). Labels stay English across the ops UI.
 */
export const SEVERITY_META: Record<IncidentSeverity, { label: string; className: string }> = {
	high: { label: 'High', className: 'bg-status-danger-soft text-status-danger' },
	medium: { label: 'Medium', className: 'bg-status-warning-soft text-status-warning' },
	low: { label: 'Low', className: 'bg-status-success-soft text-status-success' },
};

/** The accident-vs-incident kind chip — the soft chip (`className`, the kind
 *  pill) plus its bare TEXT tone (`textClassName`, for the event card's icon
 *  circle + label, which paint the tone without the soft background). */
export const KIND_META: Record<IncidentKind, { label: string; className: string; textClassName: string }> = {
	accident: { label: 'Accident', className: 'bg-status-danger-soft text-status-danger', textClassName: 'text-status-danger' },
	incident: { label: 'Incident', className: 'bg-status-info-soft text-status-info', textClassName: 'text-status-info' },
};

/** The severity-filter sheet options (`'all'` = every record). */
export type IncidentSeverityFilterValue = IncidentSeverity | 'all';

export const INCIDENT_SEVERITY_OPTIONS: ReadonlyArray<{ value: IncidentSeverityFilterValue; label: string }> = [
	{ value: 'all', label: 'All' },
	{ value: 'high', label: SEVERITY_META.high.label },
	{ value: 'medium', label: SEVERITY_META.medium.label },
	{ value: 'low', label: SEVERITY_META.low.label },
];

export const INCIDENT_SEVERITY_LABELS = Object.fromEntries(
	INCIDENT_SEVERITY_OPTIONS.map((option) => [option.value, option.label]),
) as Record<IncidentSeverityFilterValue, string>;
