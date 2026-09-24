/**
 * MiniMonth — compact month navigator (the mockup's sidebar mini-calendar).
 * Uses the same `getMonthGrid` engine as the main views; clicking a day
 * navigates the scheduler cursor. Tracks its own visible month and follows
 * the cursor when it changes externally.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/utils';
import { addMonths, getMonthGrid, getMonthNames, getWeekdayNames, startOfMonth } from '@/date';
import { isSameLocalDay } from '../core/utils';
import { Button } from '@/button';

export interface MiniMonthProps {
	date: Date;
	weekStartsOn: number;
	code: string;
	onDateChange?: (date: Date) => void;
}

export function MiniMonth({ date, weekStartsOn, code, onDateChange }: MiniMonthProps) {
	const [month, setMonth] = useState(() => startOfMonth(date));

	// Follow the scheduler cursor when it moves (toolbar nav, external control).
	useEffect(() => {
		setMonth(startOfMonth(date));
	}, [date]);

	const monthNames = getMonthNames(code);
	const weekdayShort = useMemo(() => {
		const names = getWeekdayNames(code, 'narrow');
		return names.slice(weekStartsOn).concat(names.slice(0, weekStartsOn));
	}, [code, weekStartsOn]);

	const grid = useMemo(() => getMonthGrid(month, { weekStartsOn, firstWeekContainsDate: 1, fixedWeeks: true }), [month, weekStartsOn]);

	return (
		<div className="w-60 shrink-0 rounded border border-border bg-background p-2">
			<div className="mb-1 flex items-center justify-between">
				<Button variant="ghost" size="icon-xs" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
					<ChevronLeft />
				</Button>
				<span className="text-xs font-semibold">
					{monthNames[month.getMonth()]} {month.getFullYear()}
				</span>
				<Button variant="ghost" size="icon-xs" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
					<ChevronRight />
				</Button>
			</div>
			<div className="mb-0.5 grid grid-cols-7 text-center text-[0.62rem] text-muted-foreground">
				{weekdayShort.map((name, i) => (
					<span key={`${name}-${i}`} className="py-0.5">
						{name}
					</span>
				))}
			</div>
			<div className="grid grid-cols-7 gap-0.5">
				{grid
					.flatMap((week) => week.days)
					.map((cell) => {
						const isToday = isSameLocalDay(cell.date, new Date());
						const isCursor = isSameLocalDay(cell.date, date);
						return (
							<button
								key={cell.date.getTime()}
								type="button"
								onClick={() => onDateChange?.(cell.date)}
								className={cn(
									'flex size-7 items-center justify-center rounded text-xs transition-colors hover:bg-muted',
									cell.isOutside && 'text-muted-foreground/40',
									isToday && !isCursor && 'ring-1 ring-inset ring-primary',
									isCursor && 'bg-primary font-semibold text-primary-foreground hover:bg-primary',
								)}
							>
								{cell.date.getDate()}
							</button>
						);
					})}
			</div>
		</div>
	);
}
