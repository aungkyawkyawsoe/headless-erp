/**
 * TimeGrid — the "Clock" view (week + day). A header row of day headers, an
 * all-day row when any event spans days, and a fixed-height hour grid with
 * events absolutely positioned per day column. `days` is 7 dates for the week
 * view and a single date for the day view — same component, no duplication.
 */
import { Fragment, useMemo } from 'react';
import { cn } from '@/utils';
import { startOfDay } from '@/date';
import { EventChip } from './event-chip';
import { eventSpansDay, isSameLocalDay, layoutDayEvents, type NormalizedEvent } from '../core/utils';

const HOUR_HEIGHT = 44;
const TIME_COL_WIDTH = 56;

export interface TimeGridProps {
	days: Date[];
	events: NormalizedEvent[];
	timeStart: number;
	timeEnd: number;
	weekStartsOn: number;
	code: string;
	weekdayShort: string[];
	allDayLabel: string;
	onEventClick?: (event: NormalizedEvent) => void;
}

export function TimeGrid({ days, events, timeStart, timeEnd, weekStartsOn, code, weekdayShort, allDayLabel, onEventClick }: TimeGridProps) {
	const hours = useMemo(() => {
		const list: number[] = [];
		for (let h = timeStart; h < timeEnd; h++) list.push(h);
		return list;
	}, [timeStart, timeEnd]);

	const hourFormat = useMemo(() => new Intl.DateTimeFormat(code, { hour: 'numeric' }), [code]);

	const placedByDay = useMemo(
		() =>
			days.map((day) =>
				layoutDayEvents(
					events.filter((e) => eventSpansDay(e, day)),
					timeStart,
					timeEnd,
				),
			),
		[days, events, timeStart, timeEnd],
	);

	const allDayByDay = useMemo(() => days.map((day) => events.filter((e) => e.allDay && eventSpansDay(e, day))), [days, events]);

	const hasAllDay = allDayByDay.some((list) => list.length > 0);
	const today = startOfDay(new Date());

	const gridTemplateColumns = `${TIME_COL_WIDTH}px repeat(${days.length}, minmax(0, 1fr))`;

	return (
		<div className="w-full overflow-x-auto rounded border border-border bg-background">
			<div className="min-w-max">
				{/* Header */}
				<div className="grid" style={{ gridTemplateColumns }}>
					<div className="border-b border-border" />
					{days.map((day, i) => {
						const isToday = isSameLocalDay(day, today);
						return (
							<div
								key={day.getTime()}
								className={cn('flex flex-col items-center gap-0.5 border-b border-l border-border py-1', i === 0 && 'border-l-0')}
							>
								<span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
									{weekdayShort[(day.getDay() - weekStartsOn + 7) % 7]}
								</span>
								<span
									className={cn(
										'flex size-6 items-center justify-center rounded-full text-xs',
										isToday && 'bg-primary font-semibold text-primary-foreground',
									)}
								>
									{day.getDate()}
								</span>
							</div>
						);
					})}
				</div>

				{/* All-day row */}
				{hasAllDay ? (
					<div className="grid" style={{ gridTemplateColumns }}>
						<div className="flex items-start justify-end gap-1 px-2 py-1 text-[0.65rem] uppercase tracking-wide text-muted-foreground">
							<span className="translate-y-1">{allDayLabel}</span>
						</div>
						{allDayByDay.map((list, i) => (
							<div
								key={days[i].getTime()}
								className={cn('flex min-h-7 flex-col gap-0.5 border-l border-border px-1 py-0.5', i === 0 && 'border-l-0')}
							>
								{list.map((ev) => (
									<EventChip key={ev.id} event={ev} compact onClick={onEventClick} />
								))}
							</div>
						))}
					</div>
				) : null}

				{/* Hour rows + event overlay */}
				<div className="relative overflow-hidden">
					<div className="grid" style={{ gridTemplateColumns }}>
						{hours.map((h, row) => (
							<Fragment key={h}>
								<div className="relative border-t border-border text-muted-foreground" style={{ height: HOUR_HEIGHT }}>
									<span className="absolute -top-2 right-2 text-[0.62rem]">{hourFormat.format(new Date(2026, 0, 1, h))}</span>
								</div>
								{days.map((day, i) => (
									<div
										key={`${h}-${day.getTime()}`}
										className={cn('border-t border-l border-border', i === 0 && 'border-l-0', row % 2 === 1 && 'bg-muted/20')}
										style={{ height: HOUR_HEIGHT }}
									/>
								))}
							</Fragment>
						))}
					</div>

					{/* Event layer — aligned to the hour grid via the same columns */}
					<div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns }}>
						<div />
						{placedByDay.map((placed, i) => (
							<div key={days[i].getTime()} className="pointer-events-none relative border-l border-l-transparent">
								{placed.map((p) => (
									<EventChip
										key={p.event.id}
										event={p.event}
										onClick={onEventClick}
										className="pointer-events-auto"
										style={{ position: 'absolute', top: `${p.top}%`, height: `${p.height}%`, left: `${p.left}%`, width: `${p.width}%` }}
									/>
								))}
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
