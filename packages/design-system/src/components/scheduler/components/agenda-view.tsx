/**
 * AgendaView — the "List" view. The cursor month's events grouped by day,
 * each group headed by a date block, each row showing time + title + location.
 */
import { useMemo } from 'react';
import { cn } from '@/utils';
import { endOfMonth, startOfDay, startOfMonth } from '@/date';
import { colorOf, eventSpansDay, type NormalizedEvent } from '../core/utils';

export interface AgendaViewProps {
	events: NormalizedEvent[];
	cursor: Date;
	weekdayShort: string[];
	weekStartsOn: number;
	code: string;
	noEventsLabel: string;
	onEventClick?: (event: NormalizedEvent) => void;
}

interface DayGroup {
	day: Date;
	events: NormalizedEvent[];
}

function groupByDay(events: NormalizedEvent[], cursor: Date): DayGroup[] {
	const monthStart = startOfMonth(cursor);
	const monthEnd = endOfMonth(cursor);
	const inMonth = events
		.filter(
			(ev) =>
				eventSpansDay(ev, monthStart) ||
				eventSpansDay(ev, monthEnd) ||
				(ev.start.getTime() >= monthStart.getTime() && ev.start.getTime() <= monthEnd.getTime()),
		)
		.sort((a, b) => a.start.getTime() - b.start.getTime());

	const map = new Map<string, DayGroup>();
	for (const ev of inMonth) {
		const key = `${ev.start.getFullYear()}-${ev.start.getMonth()}-${ev.start.getDate()}`;
		const group = map.get(key) ?? { day: startOfDay(ev.start), events: [] };
		if (group.events.length === 0) map.set(key, group);
		group.events.push(ev);
	}
	return [...map.values()].sort((a, b) => a.day.getTime() - b.day.getTime());
}

function formatTime(date: Date): string {
	return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

export function AgendaView({ events, cursor, weekdayShort, weekStartsOn, code, noEventsLabel, onEventClick }: AgendaViewProps) {
	const groups = useMemo(() => groupByDay(events, cursor), [events, cursor]);
	const weekdayLong = useMemo(() => new Intl.DateTimeFormat(code, { weekday: 'long' }), [code]);

	if (groups.length === 0) {
		return (
			<div className="flex items-center justify-center rounded border border-border bg-background p-8 text-sm text-muted-foreground">
				{noEventsLabel}
			</div>
		);
	}

	return (
		<div className="w-full divide-y divide-border overflow-hidden rounded border border-border bg-background">
			{groups.map((group) => {
				const isToday = group.day.getTime() === startOfDay(new Date()).getTime();
				return (
					<div key={group.day.getTime()} className="flex gap-3 p-2">
						<div className="flex w-24 shrink-0 flex-col items-center justify-start gap-0.5 pt-0.5">
							<span
								className={cn('text-[0.65rem] uppercase tracking-wide', isToday ? 'font-semibold text-primary' : 'text-muted-foreground')}
							>
								{weekdayShort[(group.day.getDay() - weekStartsOn + 7) % 7]}
							</span>
							<span className={cn('text-xl font-bold leading-none', isToday && 'text-primary')}>{group.day.getDate()}</span>
							<span className="text-[0.65rem] text-muted-foreground">{weekdayLong.format(group.day)}</span>
						</div>
						<div className="flex min-w-0 flex-1 flex-col gap-1">
							{group.events.map((ev) => (
								<button
									key={ev.id}
									type="button"
									onClick={() => onEventClick?.(ev)}
									className="flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted"
								>
									<span className="w-14 shrink-0 text-[0.68rem] tabular-nums text-muted-foreground">
										{ev.allDay ? 'All day' : formatTime(ev.start)}
									</span>
									<span className="size-2 shrink-0 rounded-full" style={{ background: colorOf(ev.color) }} />
									<span className="truncate text-sm font-medium">{ev.title}</span>
									{ev.location ? (
										<span className="ml-auto shrink-0 truncate text-[0.68rem] text-muted-foreground">{ev.location}</span>
									) : null}
								</button>
							))}
						</div>
					</div>
				);
			})}
		</div>
	);
}
