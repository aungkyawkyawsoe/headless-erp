/**
 * Scheduler — event-calendar types.
 *
 * The Scheduler is a DataTable-style, fully-configurable event calendar:
 * month/week/day/agenda views, a nav toolbar and an optional mini-month
 * navigator, driven by a plain `SchedulerEvent[]`. All layout/date math lives
 * in `core/` (utils + use-scheduler); the views are dumb presentational
 * components. Widgets and apps feed it normalized events — the widget layer is
 * responsible for mapping bound collection records onto `SchedulerEvent`.
 */

export type SchedulerView = 'month' | 'week' | 'day' | 'agenda';

export const SCHEDULER_VIEWS: SchedulerView[] = ['month', 'week', 'day', 'agenda'];

/** One calendar entry. `start`/`end` accept `Date` or ISO-8601 strings. */
export interface SchedulerEvent {
	id?: string;
	title: string;
	start: Date | string | number;
	/** Defaults to `start` + 1 hour when omitted. */
	end?: Date | string | number;
	/** Whole-day event — all-day row in the time grid, full-width chip in month. */
	allDay?: boolean;
	/** CSS color or a named tone ('blue' | 'teal' | 'amber' | …). */
	color?: string;
	location?: string;
	attendees?: string[];
	/** Arbitrary payload (e.g. the source record). */
	meta?: Record<string, unknown>;
}

/** Overridable UI strings. */
export interface SchedulerLabels {
	today?: string;
	month?: string;
	week?: string;
	day?: string;
	agenda?: string;
	allDay?: string;
	noEvents?: string;
	/** "+{n} more" — receives the count. */
	more?: string;
}

export interface SchedulerProps {
	events?: SchedulerEvent[];
	className?: string;
	/** Controlled/uncontrolled view. */
	view?: SchedulerView;
	defaultView?: SchedulerView;
	onViewChange?: (view: SchedulerView) => void;
	/** Controlled/uncontrolled "cursor" date (the visible month/week/day). */
	date?: Date;
	defaultDate?: Date;
	onDateChange?: (date: Date) => void;
	/** Show the nav toolbar (prev/today/next + view switcher). */
	showToolbar?: boolean;
	/** Compact month navigator rendered to the right (mockup sidebar). */
	showMiniMonth?: boolean;
	/** First day of the week: 0 = Sunday … 6 = Saturday. */
	weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
	/** First hour of the time grid (24h). Default 6. */
	timeStart?: number;
	/** Last hour of the time grid (24h, exclusive). Default 20. */
	timeEnd?: number;
	/** BCP 47 language tag for labels/dates. Default 'en-US'. */
	locale?: string;
	labels?: SchedulerLabels;
	onEventClick?: (event: SchedulerEvent) => void;
}
