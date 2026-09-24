'use client';

import * as React from 'react';
import { Clock } from 'lucide-react';

import { cn } from '@/utils';
import { Button } from '@/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/popover';

/** 12h hours (1–12), 5-minute steps (00–55), and AM/PM. */
const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
const PERIODS = ['AM', 'PM'] as const;
type Period = (typeof PERIODS)[number];

/** "18:30" → { hour12: 6, minute: '30', period: 'PM' }; unparsable → midnight. */
function parseTime(value?: string): { hour12: number; minute: string; period: Period } {
	const [h24, m] = (value ?? '').split(':');
	const h = Number(h24);
	if (Number.isNaN(h)) return { hour12: 12, minute: '00', period: 'AM' };
	const period: Period = h >= 12 ? 'PM' : 'AM';
	return { hour12: h % 12 === 0 ? 12 : h % 12, minute: m ?? '00', period };
}

/** { hour12: 6, minute: '30', period: 'PM' } → "18:30" (24h — what the API stores). */
function to24(hour12: number, minute: string, period: Period): string {
	const h24 = period === 'PM' ? (hour12 % 12) + 12 : hour12 % 12;
	return `${String(h24).padStart(2, '0')}:${minute}`;
}

/**
 * TimePicker — a popover with hour/minute/AM-PM columns (iOS-style wheels).
 * Fully custom so it works in every browser/WebView (native `<input
 * type="time">` pickers silently do nothing in Firefox desktop and some
 * Telegram WebViews). The UI is 12-hour; the value stays `HH:MM` (24h).
 *
 * <TimePicker value="18:30" onValueChange={setTime} />
 */
function TimePicker({
	value,
	onValueChange,
	placeholder = 'Pick a time',
	disabled,
	className,
}: {
	value?: string;
	onValueChange?: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
	className?: string;
}) {
	const [open, setOpen] = React.useState(false);
	const { hour12, minute, period } = parseTime(value);

	// Keep the selected hour/minute visible when the popover opens.
	const hourRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
	const minuteRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
	React.useEffect(() => {
		if (!open) return;
		(hourRefs.current[hour12 - 1] ?? hourRefs.current[0])?.scrollIntoView({ block: 'center' });
		const minuteIndex = Math.max(0, Math.min(Math.round((Number(minute) || 0) / 5), MINUTES.length - 1));
		(minuteRefs.current[minuteIndex] ?? minuteRefs.current[0])?.scrollIntoView({ block: 'center' });
	}, [open, hour12, minute]);

	const commit = (h: number, m: string, p: Period, close = false) => {
		onValueChange?.(to24(h, m, p));
		if (close) setOpen(false);
	};

	const optionCls = (active: boolean) =>
		cn(
			'flex h-10 w-16 items-center justify-center rounded-md text-sm tabular-nums transition-colors',
			active ? 'bg-primary font-semibold text-primary-foreground' : 'text-foreground hover:bg-muted',
		);

	// Trigger display — "18:30" → "6:30 PM".
	const displayMinute = minute.length === 1 ? `0${minute}` : minute;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				disabled={disabled}
				render={
					<Button
						variant="outline"
						disabled={disabled}
						data-empty={!value}
						className={cn('justify-start px-2 text-left font-normal data-[empty=true]:text-muted-foreground', className)}
					/>
				}
			>
				<Clock strokeWidth={1.6} />
				{value ? (
					<span className="tabular-nums">
						{hour12}:{displayMinute} {period}
					</span>
				) : (
					<span>{placeholder}</span>
				)}
			</PopoverTrigger>
			<PopoverContent className="w-auto p-0" align="start">
				<div className="flex divide-x divide-border">
					<div className="h-56 overflow-y-auto p-1" role="listbox" aria-label="Hour">
						{HOURS_12.map((h, i) => {
							const active = h === hour12;
							return (
								<button
									key={h}
									type="button"
									ref={(el) => {
										hourRefs.current[i] = el;
									}}
									role="option"
									aria-selected={active}
									onClick={() => commit(h, minute, period)}
									className={optionCls(active)}
								>
									{h}
								</button>
							);
						})}
					</div>
					<div className="h-56 overflow-y-auto p-1" role="listbox" aria-label="Minute">
						{MINUTES.map((m, i) => {
							const active = m === minute;
							return (
								<button
									key={m}
									type="button"
									ref={(el) => {
										minuteRefs.current[i] = el;
									}}
									role="option"
									aria-selected={active}
									onClick={() => commit(hour12, m, period, true)}
									className={optionCls(active)}
								>
									{m}
								</button>
							);
						})}
					</div>
					<div className="flex flex-col justify-center gap-1 p-1" role="listbox" aria-label="Period">
						{PERIODS.map((p) => {
							const active = p === period;
							return (
								<button
									key={p}
									type="button"
									role="option"
									aria-selected={active}
									onClick={() => commit(hour12, minute, p)}
									className={optionCls(active)}
								>
									{p}
								</button>
							);
						})}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

export { TimePicker };
