import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { DateRange } from '@/date';
import { addDays, formatDate } from '@/date';
import { CircleCheckIcon, PlusIcon } from 'lucide-react';
import { Calendar } from './';
import { Button } from '../button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../card';
import { ScrollArea } from '../scroll-area';
import { cn } from '@/utils';

/**
 * Calendar provides a date picker with single, multiple, and range selection modes.
 *
 * Fully self-contained (no react-day-picker), it includes month/year dropdown
 * navigation, keyboard support, and customizable disabled dates.
 */
const meta: Meta<typeof Calendar> = {
	title: 'Components/Calendar',
	component: Calendar,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A date picker with month and year dropdown navigation. Supports single, multiple, and range selection modes. Customize with `startMonth`/`endMonth` for date limits, `disabled` for individual dates, and `showOutsideDays` to control visibility of adjacent month days.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

// ── Default (single mode, no preselection) ────────────────

export const Default: Story = {
	render: () => {
		const [selected, setSelected] = React.useState<Date | undefined>(undefined);

		return <Calendar mode="single" selected={selected} onSelect={setSelected} />;
	},
};

// ── Single mode with preselected date ─────────────────────

export const SinglePreselected: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'A single-mode calendar with a preselected date. The `selected` prop accepts a `Date` object and `onSelect` provides the new selection.',
			},
		},
	},
	render: () => {
		const [selected, setSelected] = React.useState<Date | undefined>(new Date(2026, 6, 15));

		return (
			<div className="flex flex-col items-center gap-3">
				<Calendar mode="single" selected={selected} onSelect={setSelected} month={new Date(2026, 6)} />
				{selected && <p className="text-sm text-muted-foreground">Selected: {formatDate(selected, 'PPP')}</p>}
			</div>
		);
	},
};

// ── Range mode ────────────────────────────────────────────

export const RangeMode: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use `mode="range"` to allow selecting a start and end date. The `selected` prop accepts a `DateRange` object `{ from, to }`.',
			},
		},
	},
	render: () => {
		const [range, setRange] = React.useState<DateRange | undefined>({
			from: new Date(2026, 6, 10),
			to: new Date(2026, 6, 20),
		});

		return (
			<div className="flex flex-col items-center gap-3">
				<Calendar mode="range" selected={range} onSelect={setRange} month={new Date(2026, 6)} />
				{range?.from && (
					<p className="text-sm text-muted-foreground">
						{range.to ? `${formatDate(range.from, 'PP')} – ${formatDate(range.to, 'PP')}` : `From: ${formatDate(range.from, 'PP')}`}
					</p>
				)}
			</div>
		);
	},
};

// ── Range mode (two months) ───────────────────────────────

export const RangeModeTwoMonths: Story = {
	name: 'Range Mode (Two Months)',
	parameters: {
		docs: {
			description: {
				story:
					'Set `numberOfMonths={2}` to display two months side by side. Each month shows its own clickable caption; the shared arrows navigate both. The month/year pickers open for the clicked month.',
			},
		},
	},
	render: () => {
		const [range, setRange] = React.useState<DateRange | undefined>({
			from: new Date(2026, 6, 10),
			to: new Date(2026, 6, 20),
		});

		return (
			<div className="flex flex-col items-center gap-3">
				<Calendar mode="range" selected={range} onSelect={setRange} numberOfMonths={2} month={new Date(2026, 6)} />
				{range?.from && (
					<p className="text-sm text-muted-foreground">
						{range.to ? `${formatDate(range.from, 'PP')} – ${formatDate(range.to, 'PP')}` : `From: ${formatDate(range.from, 'PP')}`}
					</p>
				)}
			</div>
		);
	},
};

// ── Multiple mode ─────────────────────────────────────────

export const MultipleMode: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `mode="multiple"` to allow selecting multiple individual dates. The `selected` prop accepts a `Date[]` array.',
			},
		},
	},
	render: () => {
		const [selectedDates, setSelectedDates] = React.useState<Date[] | undefined>([
			new Date(2026, 6, 5),
			new Date(2026, 6, 12),
			new Date(2026, 6, 20),
		]);

		return (
			<div className="flex flex-col items-center gap-3">
				<Calendar mode="multiple" selected={selectedDates} onSelect={setSelectedDates} month={new Date(2026, 6)} />
				{selectedDates && selectedDates.length > 0 && (
					<p className="text-sm text-muted-foreground">
						{selectedDates.length} date{selectedDates.length !== 1 ? 's' : ''} selected
					</p>
				)}
			</div>
		);
	},
};

// ── Month picker ──────────────────────────────────────────

export const MonthPicker: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Pass `defaultView="month"` to open directly in the month picker. Click the month label to toggle between the calendar and month grid. Use arrow keys to navigate, Enter to select, Escape to go back.',
			},
		},
	},
	render: () => {
		const [selected, setSelected] = React.useState<Date | undefined>(undefined);

		return (
			<div className="flex flex-col items-center gap-3">
				<Calendar mode="single" selected={selected} onSelect={setSelected} defaultView="month" />
				{selected && <p className="text-sm text-muted-foreground">Selected: {formatDate(selected, 'PPP')}</p>}
			</div>
		);
	},
};

// ── Year picker ───────────────────────────────────────────

export const YearPicker: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Pass `defaultView="year"` to open directly in the year picker. Click the year label to toggle between the calendar and year grid. The arrow buttons shift the decade range by 12 years; Escape goes back.',
			},
		},
	},
	render: () => {
		const [selected, setSelected] = React.useState<Date | undefined>(undefined);

		return (
			<div className="flex flex-col items-center gap-3">
				<Calendar mode="single" selected={selected} onSelect={setSelected} defaultView="year" />
				{selected && <p className="text-sm text-muted-foreground">Selected: {formatDate(selected, 'PPP')}</p>}
			</div>
		);
	},
};

// ── Month/Year picker with date limits ────────────────────

export const WithLimits: Story = {
	name: 'With Date Limits',
	parameters: {
		docs: {
			description: {
				story:
					'When `startMonth` and `endMonth` are set, months and years outside the allowed range are disabled in the picker grids. Navigation arrows are also disabled when they would exit the range.',
			},
		},
	},
	render: () => {
		const [selected, setSelected] = React.useState<Date | undefined>(undefined);

		return (
			<div className="flex flex-col items-center gap-3">
				<Calendar
					mode="single"
					selected={selected}
					onSelect={setSelected}
					month={new Date(2026, 6)}
					startMonth={new Date(2025, 0, 1)}
					endMonth={new Date(2027, 11, 31)}
				/>
				{selected && <p className="text-sm text-muted-foreground">Selected: {formatDate(selected, 'PPP')}</p>}
				<p className="max-w-60 text-center text-xs text-muted-foreground">
					Months outside Jan 2025 – Dec 2027 are disabled. Try opening the month or year picker.
				</p>
			</div>
		);
	},
};

// ── Disabled past dates ───────────────────────────────────

export const DisabledPastDates: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use `startMonth` to prevent selection of dates before a certain month. Combined with `disabled` matchers for finer-grained date disabling.',
			},
		},
	},
	render: () => {
		const [selected, setSelected] = React.useState<Date | undefined>(undefined);

		return (
			<div className="flex flex-col items-center gap-3">
				<Calendar mode="single" selected={selected} onSelect={setSelected} startMonth={new Date(2026, 6, 1)} month={new Date(2026, 6)} />
				<p className="max-w-60 text-center text-xs text-muted-foreground">
					Dates before July 2026 are disabled — only July and future months can be selected.
				</p>
			</div>
		);
	},
};

// ── Today button ──────────────────────────────────────────

export const WithTodayButton: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'A Today button in the card footer jumps back to the current month. Use `month` and `onMonthChange` for controlled month navigation.',
			},
		},
	},
	render: () => {
		const [selected, setSelected] = React.useState<Date | undefined>(undefined);
		const [month, setMonth] = React.useState<Date>(new Date(2026, 6, 1));
		const today = React.useMemo(() => new Date(), []);

		const handleTodayClick = React.useCallback(() => {
			setMonth(today);
		}, [today]);

		return (
			<Card size="sm" className="mx-auto w-fit">
				<CardContent>
					<Calendar mode="single" selected={selected} onSelect={setSelected} month={month} onMonthChange={setMonth} className="p-0" />
				</CardContent>
				<CardFooter className="justify-center">
					<Button variant="outline" size="sm" onClick={handleTodayClick}>
						Today
					</Button>
				</CardFooter>
			</Card>
		);
	},
};

// ── Calendar with presets ──────────────────────────────────

export const CalendarWithPresets: Story = {
	name: 'Calendar with Presets',
	parameters: {
		docs: {
			description: {
				story:
					'A single-mode calendar composed inside a Card with quick date presets in the footer. Clicking a preset selects the date and navigates the calendar to its month. Works well with `fixedWeeks` for a stable grid height.',
			},
		},
	},
	render: () => {
		const [date, setDate] = React.useState<Date | undefined>(new Date(new Date().getFullYear(), 1, 12));
		const [currentMonth, setCurrentMonth] = React.useState<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

		return (
			<Card className="mx-auto w-fit max-w-75" size="sm">
				<CardContent>
					<Calendar
						mode="single"
						selected={date}
						onSelect={setDate}
						month={currentMonth}
						onMonthChange={setCurrentMonth}
						fixedWeeks
						className="p-0 [--cell-size:--spacing(9.5)]"
					/>
				</CardContent>
				<CardFooter className="flex flex-wrap gap-2 border-t">
					{[
						{ label: 'Today', value: 0 },
						{ label: 'Tomorrow', value: 1 },
						{ label: '3 days', value: 3 },
						{ label: 'Week', value: 7 },
						{ label: '2 weeks', value: 14 },
					].map((preset) => (
						<Button
							key={preset.value}
							variant="outline"
							size="sm"
							className="flex-1"
							onClick={() => {
								const newDate = addDays(new Date(), preset.value);
								setDate(newDate);
								setCurrentMonth(new Date(newDate.getFullYear(), newDate.getMonth(), 1));
							}}
						>
							{preset.label}
						</Button>
					))}
				</CardFooter>
			</Card>
		);
	},
};

// ── Calendar with time ────────────────────────────────────

export const CalendarWithTime: Story = {
	name: 'Calendar with Time',
	parameters: {
		docs: {
			description: {
				story:
					'An appointment-booking pattern: pick a date on the calendar and a time slot from the scrollable sidebar. Booked dates are disabled, and the footer summarizes the selection.',
			},
		},
	},
	render: () => {
		const [date, setDate] = React.useState<Date | undefined>(new Date());
		const [selectedTime, setSelectedTime] = React.useState<string | null>('10:00');

		const timeSlots = Array.from({ length: 37 }, (_, i) => {
			const totalMinutes = i * 15;
			const hour = Math.floor(totalMinutes / 60) + 9;
			const minute = totalMinutes % 60;

			return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
		});

		const bookedDates = Array.from(
			{ length: 3 },
			(_, i) => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + i),
		);

		return (
			<Card className="gap-0 p-0">
				<CardHeader className="flex h-max items-center justify-start border-b px-4! py-3!">
					<CardTitle>Book your appointment</CardTitle>
				</CardHeader>
				<CardContent className="relative p-0 md:pr-48">
					<div className="p-4">
						<Calendar
							mode="single"
							selected={date}
							onSelect={setDate}
							defaultMonth={date}
							disabled={bookedDates}
							showOutsideDays={false}
							modifiers={{
								booked: bookedDates,
							}}
						/>
					</div>
					<div className="inset-y-0 right-0 flex w-full flex-col gap-4 border-t max-md:h-60 md:absolute md:w-48 md:border-t-0 md:border-l">
						<ScrollArea className="h-full">
							<div className="flex flex-col gap-2 p-4">
								{timeSlots.map((time) => (
									<Button
										key={time}
										variant={selectedTime === time ? 'default' : 'outline'}
										onClick={() => setSelectedTime(time)}
										className="w-full shadow-none"
									>
										{time}
									</Button>
								))}
							</div>
						</ScrollArea>
					</div>
				</CardContent>
				<CardFooter className="flex flex-col gap-4 border-t px-4 py-3! md:flex-row">
					<div className="flex max-w-64 items-center gap-2 text-sm">
						{date && selectedTime ? (
							<>
								<CircleCheckIcon className="size-4 shrink-0" />
								<span className="text-sm">
									Your meeting is booked for{' '}
									<span className="font-medium">
										{' '}
										{date?.toLocaleDateString('en-US', {
											weekday: 'long',
											day: 'numeric',
											month: 'long',
										})}{' '}
									</span>
									at <span className="font-medium">{selectedTime}</span>
								</span>
							</>
						) : (
							<>Select a date and time for your meeting.</>
						)}
					</div>
					<Button disabled={!date || !selectedTime} className="w-full md:ml-auto md:w-auto" variant="outline">
						Confirm
					</Button>
				</CardFooter>
			</Card>
		);
	},
};

// ── Calendar with events ───────────────────────────────────

const events = [
	{
		title: 'Product Launch',
		start: '2026-01-24T10:00:00',
		end: '2026-01-24T11:30:00',
		colorful: 'after:bg-green-500',
	},
	{
		title: 'Weekly Standup',
		start: '2026-01-28T13:00:00',
		end: '2026-01-28T13:30:00',
		colorful: 'after:bg-yellow-500',
	},
	{
		title: 'Code Review Session',
		start: '2026-01-31T15:00:00',
		end: '2026-01-31T16:00:00',
		colorful: 'after:bg-blue-500',
	},
];

export const CalendarWithEvents: Story = {
	name: 'Calendar with Events',
	parameters: {
		docs: {
			description: {
				story:
					'A calendar with an events list below. Each event shows a color-coded accent, its title, and its time range; the plus button adds a new event.',
			},
		},
	},
	render: () => {
		const [date, setDate] = React.useState<Date | undefined>(new Date());

		return (
			<Card className="w-2xs py-4">
				<CardContent className="px-4">
					<Calendar mode="single" selected={date} onSelect={setDate} className="w-full bg-transparent p-0" required />
				</CardContent>
				<CardFooter className="flex flex-col items-start gap-3 border-t px-4! pt-3! pb-0!">
					<div className="flex w-full items-center justify-between px-1">
						<div className="text-sm font-medium">
							{date?.toLocaleDateString('en-US', {
								day: 'numeric',
								month: 'long',
								year: 'numeric',
							})}
						</div>
						<Button variant="ghost" size="icon" className="size-6" title="Add Event">
							<PlusIcon />
							<span className="sr-only">Add Event</span>
						</Button>
					</div>
					<div className="flex w-full flex-col gap-2">
						{events.map((event) => (
							<div
								key={event.title}
								className={cn(
									'relative bg-muted p-2 pl-6 text-sm after:absolute after:inset-y-2 after:left-2 after:w-1',
									'rounded-md',
									'after:rounded-full',
									event.colorful,
								)}
							>
								<div className="font-medium">{event.title}</div>
								<div className="text-xs text-muted-foreground">
									{formatDate(new Date(event.start), 'h:mm a')} – {formatDate(new Date(event.end), 'h:mm a')}
								</div>
							</div>
						))}
					</div>
				</CardFooter>
			</Card>
		);
	},
};

// ── Week numbers ───────────────────────────────────────────

export const WeekNumbers: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Pass `showWeekNumber` to display the week number on the left of each row. Works with `ISOWeek` to use ISO 8601 week numbering.',
			},
		},
	},
	render: () => {
		const [date, setDate] = React.useState<Date | undefined>(new Date(new Date().getFullYear(), 0, 12));

		return (
			<Card className="mx-auto w-fit p-0">
				<CardContent className="p-0">
					<Calendar mode="single" defaultMonth={date} selected={date} onSelect={setDate} showWeekNumber />
				</CardContent>
			</Card>
		);
	},
};

// ── Sizes ─────────────────────────────────────────────────

export const Sizes: Story = {
	parameters: { layout: 'padded' },
	render: () => {
		const [selected, setSelected] = React.useState<Date | undefined>(undefined);

		return (
			<div className="flex flex-wrap items-start justify-center gap-8">
				<div className="flex flex-col items-center gap-2">
					<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Small</p>
					<Calendar mode="single" selected={selected} onSelect={setSelected} className="[--cell-size:--spacing(6)]" />
				</div>
				<div className="flex flex-col items-center gap-2">
					<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Default</p>
					<Calendar mode="single" selected={selected} onSelect={setSelected} />
				</div>
				<div className="flex flex-col items-center gap-2">
					<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Large</p>
					<Calendar mode="single" selected={selected} onSelect={setSelected} className="[--cell-size:--spacing(10)]" />
				</div>
			</div>
		);
	},
};
