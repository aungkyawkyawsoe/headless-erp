/**
 * SchedulerWidget — the Minecraft-canvas wrapper around the Scheduler.
 *
 * One widget = one DS file. It holds NO business data: events come from
 *   - a `bind` spec (live collection records → reserved `data` prop, mapped
 *     via the `*Field` props below), and/or
 *   - a static `events` JSON array (design/demo — fallback when no bind).
 * Field mapping follows the EmployeeCard convention: which record field feeds
 * which calendar slot (`titleField`, `startField`, …).
 */
import { Scheduler } from '@/scheduler';
import type { WidgetDef } from './types';
import type { SchedulerEvent, SchedulerView } from '@/scheduler';

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** `data` arrives as a list (bind) — also tolerate a single item / {rows}. */
function toRecords(data: unknown): Array<Record<string, unknown>> {
	if (Array.isArray(data)) return data.map(asRecord).filter((r): r is Record<string, unknown> => r !== null);
	const obj = asRecord(data);
	if (obj) {
		if (Array.isArray(obj.rows)) return obj.rows.map(asRecord).filter((r): r is Record<string, unknown> => r !== null);
		return [obj];
	}
	return [];
}

function parseStaticEvents(raw: unknown): SchedulerEvent[] {
	if (Array.isArray(raw)) return raw as SchedulerEvent[];
	if (typeof raw === 'string') {
		try {
			const value = JSON.parse(raw);
			return Array.isArray(value) ? (value as SchedulerEvent[]) : [];
		} catch {
			return [];
		}
	}
	return [];
}

export function SchedulerWidget(props: Record<string, unknown>) {
	// ── Field mapping — which bound-record field feeds which calendar slot ──
	const field = (key: string, fallback = ''): string => {
		const v = props[key];
		return typeof v === 'string' && v.trim() ? v : fallback;
	};
	const titleField = field('titleField', 'title');
	const startField = field('startField', 'start');
	const endField = field('endField', '');
	const allDayField = field('allDayField', '');
	const colorField = field('colorField', '');
	const locationField = field('locationField', '');

	// ── Events: bound records (live) + static JSON (fallback/demo) ─────────
	const bound = toRecords(props.data).map((rec, i) => {
		const event: SchedulerEvent = {
			id: typeof rec.id === 'string' ? rec.id : `row-${i}`,
			title: String(rec[titleField] ?? ''),
			start: (rec[startField] as Date | string | number) ?? new Date(),
			meta: rec,
		};
		if (endField && rec[endField] !== undefined && rec[endField] !== null) {
			event.end = rec[endField] as Date | string | number;
		}
		if (allDayField && rec[allDayField] !== undefined) {
			event.allDay = Boolean(rec[allDayField]);
		}
		if (colorField && rec[colorField] !== undefined && rec[colorField] !== null) {
			event.color = String(rec[colorField]);
		}
		if (locationField && rec[locationField] !== undefined && rec[locationField] !== null) {
			event.location = String(rec[locationField]);
		}
		return event;
	});

	const events = [...parseStaticEvents(props.events), ...bound];

	// ── Config passthrough (defaults live in widgetMeta.defaultProps) ──────
	const asBool = (key: string, fallback: boolean): boolean => {
		const v = props[key];
		return typeof v === 'boolean' ? v : fallback;
	};
	const asNumber = (key: string, fallback: number): number => {
		const v = props[key];
		if (typeof v === 'number' && Number.isFinite(v)) return v;
		if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
		return fallback;
	};
	const view = (['month', 'week', 'day', 'agenda'] as SchedulerView[]).includes(props.view as SchedulerView)
		? (props.view as SchedulerView)
		: 'week';

	return (
		<Scheduler
			events={events}
			defaultView={view}
			showToolbar={asBool('showToolbar', true)}
			showMiniMonth={asBool('showMiniMonth', false)}
			weekStartsOn={asNumber('weekStartsOn', 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6}
			timeStart={asNumber('timeStart', 6)}
			timeEnd={asNumber('timeEnd', 20)}
		/>
	);
}

/**
 * Registry metadata — one per widget file (see scripts/widgets.mjs).
 * The `bind` spec resolves live data through the host data source; every
 * config prop is editable in the Studio inspector.
 */
export const widgetMeta: WidgetDef = {
	type: 'widget:scheduler',
	label: 'Calendar (Scheduler)',
	group: 'Widgets',
	icon: 'calendar-days',
	defaultColSpan: 8,
	defaultProps: {
		view: 'week',
		showToolbar: true,
		showMiniMonth: true,
		weekStartsOn: 0,
		timeStart: 6,
		timeEnd: 20,
		titleField: 'title',
		startField: 'start',
		endField: 'end',
		allDayField: 'allDay',
		colorField: '',
		locationField: '',
		// NO business data — this widget holds no demo meetings. Events come from
		// a `bind` spec or a static `events` JSON config, both authored by the user.
		events: [],
	},
	props: {
		bind: {
			label: 'Data binding (JSON)',
			type: 'code',
			group: 'Data',
			default: '',
			hint: '{ "kind": "list", "collection": "meetings", "limit": 50 } — resolves live records; map them via the field props below.',
		},
		collection: { label: 'Collection (for field mapping)', type: 'collection', group: 'Data', hint: 'Populates the field dropdowns below' },
		titleField: { label: 'Title field', type: 'field', group: 'Data', default: 'title' },
		startField: { label: 'Start field', type: 'field', group: 'Data', default: 'start' },
		endField: { label: 'End field', type: 'field', group: 'Data', default: 'end', hint: 'Optional — defaults to start + 1 hour' },
		allDayField: { label: 'All-day field', type: 'field', group: 'Data', default: 'allDay', hint: 'Optional boolean field' },
		colorField: {
			label: 'Color field',
			type: 'field',
			group: 'Data',
			default: '',
			hint: 'Optional — a hex value or tone name (blue/teal/amber/…)',
		},
		locationField: { label: 'Location field', type: 'field', group: 'Data', default: '' },
		events: {
			label: 'Events (JSON array)',
			type: 'code',
			group: 'Data',
			default: '',
			hint: '[{ "title": "…", "start": "2026-08-04T16:50:00", "end": "…", "allDay": false, "color": "blue" }] — shown when no bind is set.',
		},
		view: {
			label: 'Default view',
			type: 'select',
			group: 'General',
			options: [
				{ value: 'week', label: 'Week (Clock)' },
				{ value: 'month', label: 'Month (Cal)' },
				{ value: 'day', label: 'Day' },
				{ value: 'agenda', label: 'Agenda (List)' },
			],
			default: 'week',
		},
		showToolbar: { label: 'Show toolbar', type: 'boolean', group: 'General', default: true },
		showMiniMonth: { label: 'Show mini month (sidebar)', type: 'boolean', group: 'General', default: true },
		weekStartsOn: {
			label: 'Week starts on',
			type: 'select',
			group: 'General',
			options: [
				{ value: '0', label: 'Sunday' },
				{ value: '1', label: 'Monday' },
			],
			default: '0',
		},
		timeStart: { label: 'Time grid starts (hour, 24h)', type: 'number', group: 'General', default: 6 },
		timeEnd: { label: 'Time grid ends (hour, 24h)', type: 'number', group: 'General', default: 20 },
	},
	Component: SchedulerWidget,
	exportName: 'SchedulerWidget',
};
