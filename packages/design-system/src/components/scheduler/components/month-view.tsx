/**
 * MonthView — the "Cal" view. A fixed 6-week grid of day cells; each cell
 * shows its date (today highlighted), the day's events (all-day first, then
 * timed) and a "+N more" affordance that jumps to the day view.
 */
import { useMemo } from 'react';
import { cn } from '@/utils';
import { type CalendarWeek } from '@/date';
import { EventChip } from './event-chip';
import { eventSpansDay, isSameLocalDay, type NormalizedEvent } from '../core/utils';

const MAX_EVENTS_PER_CELL = 3;

export interface MonthViewProps {
	monthGrid: CalendarWeek[];
	events: NormalizedEvent[];
	weekdayShort: string[];
	weekStartsOn: number;
	moreLabel: string;
	onEventClick?: (event: NormalizedEvent) => void;
	/** Open the day view for `date` (used by the "+N more" affordance). */
	onOpenDay?: (date: Date) => void;
}

export function MonthView({
	monthGrid,
	events,
	weekdayShort,
	weekStartsOn: _weekStartsOn,
	moreLabel,
	onEventClick,
	onOpenDay,
}: MonthViewProps) {
	const today = new Date();

	const eventsByDay = useMemo(() => {
		const map = new Map<string, NormalizedEvent[]>();
		for (const ev of events) {
			for (const week of monthGrid) {
				for (const cell of week.days) {
					if (eventSpansDay(ev, cell.date)) {
						const key = `${cell.date.getFullYear()}-${cell.date.getMonth()}-${cell.date.getDate()}`;
						const list = map.get(key) ?? [];
						if (list.length === 0) map.set(key, list);
						list.push(ev);
					}
				}
			}
		}
		// All-day first, then by start time.
		for (const list of map.values()) {
			list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
		}
		return map;
	}, [events, monthGrid]);

	const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

	return (
		<div className="w-full overflow-x-auto rounded border border-border">
			<div className="min-w-max">
				{/* Weekday header */}
				<div className="grid grid-cols-7 border-b border-border bg-muted/30">
					{weekdayShort.map((name) => (
						<div key={name} className="px-1 py-1 text-center text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
							{name}
						</div>
					))}
				</div>
				{/* Day cells — `gap-px` + `bg-border` renders crisp 1px grid lines */}
				{monthGrid.map((week) => (
					<div key={week.weekNumber} className="grid grid-cols-7 gap-px bg-border">
						{week.days.map((cell) => {
							const isToday = isSameLocalDay(cell.date, today);
							const dayEvents = eventsByDay.get(dayKey(cell.date)) ?? [];
							const visible = dayEvents.slice(0, MAX_EVENTS_PER_CELL);
							const more = dayEvents.length - visible.length;
							return (
								<div
									key={cell.date.getTime()}
									className={cn(
										'flex h-24 min-w-28 flex-col gap-0.5 bg-background p-1',
										cell.isOutside && 'bg-muted/40',
										isToday && 'bg-primary/5',
									)}
								>
									<div className="flex justify-end">
										<button
											type="button"
											onClick={() => onOpenDay?.(cell.date)}
											className={cn(
												'flex size-5 items-center justify-center rounded-full text-[0.7rem] hover:bg-muted',
												isToday && 'bg-primary font-semibold text-primary-foreground hover:bg-primary/90',
											)}
										>
											{cell.date.getDate()}
										</button>
									</div>
									<div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
										{visible.map((ev) => (
											<EventChip key={ev.id} event={ev} compact onClick={onEventClick} />
										))}
										{more > 0 ? (
											<button
												type="button"
												onClick={() => onOpenDay?.(cell.date)}
												className="px-1 text-left text-[0.65rem] font-medium text-muted-foreground hover:text-foreground"
											>
												{moreLabel.replace('{n}', String(more))}
											</button>
										) : null}
									</div>
								</div>
							);
						})}
					</div>
				))}
			</div>
		</div>
	);
}
