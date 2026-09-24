/**
 * Scheduler date + layout math. Reuses the shared `@/date` utilities (the same
 * engine as the Calendar/DatePicker) — no new date library.
 */
import { addDays, startOfDay } from '@/date';
import type { SchedulerEvent } from './types';

/** A `SchedulerEvent` with a resolved `start`/`end` pair and stable id. */
export interface NormalizedEvent {
	id: string;
	title: string;
	start: Date;
	end: Date;
	allDay: boolean;
	color?: string;
	location?: string;
	attendees?: string[];
	meta?: Record<string, unknown>;
}

/** One event placed inside a time-grid day column (percent geometry). */
export interface PlacedEvent {
	event: NormalizedEvent;
	/** % from the top of the time grid. */
	top: number;
	/** % of the grid height. */
	height: number;
	/** % from the left of the column. */
	left: number;
	/** % of the column width. */
	width: number;
}

export function toDate(value: Date | string | number): Date {
	if (value instanceof Date) return new Date(value.getTime());
	if (typeof value === 'number') return new Date(value);
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Local-day comparison (avoids UTC shifts when parsing 'YYYY-MM-DD'). */
export function isSameLocalDay(a: Date, b: Date): boolean {
	return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function normalizeEvent(event: SchedulerEvent, index: number): NormalizedEvent {
	const start = toDate(event.start);
	const end = event.end === undefined || event.end === null ? addDays(start, 1) : toDate(event.end);
	return {
		id: event.id ?? `evt-${index}`,
		title: event.title,
		start,
		end: end.getTime() <= start.getTime() ? new Date(start.getTime() + 60 * 60 * 1000) : end,
		allDay: Boolean(event.allDay),
		color: event.color,
		location: event.location,
		attendees: event.attendees,
		meta: event.meta,
	};
}

export function normalizeEvents(events: SchedulerEvent[] | null | undefined): NormalizedEvent[] {
	return (events ?? []).map(normalizeEvent);
}

/**
 * Does `event` occupy `day`?
 * - all-day events span every day in [start, end] (end inclusive);
 * - timed events render on their start day only (multi-day timed events are
 *   rendered on each day they touch, so they stay visible while dragging
 *   across midnight is a non-goal).
 */
export function eventSpansDay(event: NormalizedEvent, day: Date): boolean {
	const d = startOfDay(day);
	if (event.allDay) {
		const s = startOfDay(event.start);
		const e = startOfDay(event.end);
		return s.getTime() <= d.getTime() && e.getTime() >= d.getTime();
	}
	return isSameLocalDay(event.start, d);
}

export function minutesOf(date: Date): number {
	return date.getHours() * 60 + date.getMinutes();
}

function eventsOverlap(a: NormalizedEvent, b: NormalizedEvent): boolean {
	return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/**
 * Position timed events inside one day column of the time grid.
 *
 * Events that overlap (directly or through a chain) share a cluster and are
 * laid out side by side at `1/clusterSize` width — the classic calendar
 * column algorithm, good enough for the common 1–3 events per slot.
 */
export function layoutDayEvents(dayEvents: NormalizedEvent[], timeStart: number, timeEnd: number): PlacedEvent[] {
	const timed = dayEvents
		.filter((e) => !e.allDay)
		.sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());

	const totalMinutes = (timeEnd - timeStart) * 60;
	if (totalMinutes <= 0 || timed.length === 0) return [];

	const clusters: NormalizedEvent[][] = [];
	for (const ev of timed) {
		let placed = false;
		for (const cluster of clusters) {
			if (cluster.some((other) => eventsOverlap(ev, other))) {
				cluster.push(ev);
				placed = true;
				break;
			}
		}
		if (!placed) clusters.push([ev]);
	}

	const out: PlacedEvent[] = [];
	for (const cluster of clusters) {
		const width = 100 / cluster.length;
		cluster.forEach((ev, i) => {
			const startM = minutesOf(ev.start);
			const endM = Math.max(startM + 1, minutesOf(ev.end));
			out.push({
				event: ev,
				top: ((startM - timeStart * 60) / totalMinutes) * 100,
				height: Math.max(((endM - startM) / totalMinutes) * 100, 2.2),
				left: (i / cluster.length) * 100,
				width,
			});
		});
	}
	return out;
}

/** Named event tones → hex. Anything else is used as-is (a CSS color). */
const TONES: Record<string, string> = {
	blue: '#2563eb',
	indigo: '#4f46e5',
	purple: '#7c3aed',
	violet: '#8b5cf6',
	pink: '#db2777',
	rose: '#e11d48',
	red: '#dc2626',
	orange: '#ea580c',
	amber: '#d97706',
	yellow: '#ca8a04',
	lime: '#65a30d',
	green: '#16a34a',
	emerald: '#059669',
	teal: '#0d9488',
	cyan: '#0891b2',
	sky: '#0284c7',
	slate: '#475569',
	gray: '#6b7280',
};

export function colorOf(color?: string): string {
	if (!color) return TONES.blue;
	const key = color.trim().toLowerCase();
	return TONES[key] ?? color;
}

/** Append an alpha channel to a hex color (no-op for non-hex values). */
export function withAlpha(color: string, alpha: string): string {
	return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color;
}
