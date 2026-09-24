import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { DateRange } from '@/date';
import { parseDate } from 'chrono-node';
import { formatDate } from '@/date';
import { CalendarIcon, ChevronDownIcon } from 'lucide-react';

import { DatePicker, DateRangePicker } from './';
import { Button } from '@/button';
import { Calendar } from '@/calendar';
import { Field, FieldGroup, FieldLabel } from '@/field';
import { Input } from '@/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/popover';

/**
 * Date pickers built as a composition of `Calendar` + a surface that adapts
 * to the device: a small anchored `Popover` on desktop, a full-width bottom
 * `Sheet` (dialog) on mobile.
 *
 * `DatePicker` handles single dates; `DateRangePicker` handles ranges.
 * Both are uncontrolled by default — pass `value`/`onValueChange` to
 * control them. Calendar props (e.g. `startMonth`, `endMonth`, `locale`)
 * pass through to the underlying Calendar.
 */
const meta: Meta<typeof DatePicker> = {
	title: 'Components/Date Picker',
	component: DatePicker,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A date picker that opens an anchored `Popover` on desktop and a full-width bottom `Sheet` on mobile. `DatePicker` for single dates, `DateRangePicker` for ranges. Calendar props pass through.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

// ── Basic ──────────────────────────────────────────────────

export const Basic: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A basic single-date picker. Uncontrolled — manage the selected date with `value`/`onValueChange` if needed.',
			},
		},
	},
	render: () => {
		const [date, setDate] = React.useState<Date | undefined>(undefined);

		return (
			<div className="flex flex-col items-center gap-3">
				<DatePicker value={date} onValueChange={setDate} />
				{date && <p className="text-sm text-muted-foreground">Selected: {formatDate(date, 'PPP')}</p>}
			</div>
		);
	},
};

// ── Preselected ────────────────────────────────────────────

export const Preselected: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Pass a `value` to preselect a date. The calendar opens at the selected month.',
			},
		},
	},
	render: () => {
		const [date, setDate] = React.useState<Date | undefined>(new Date(2026, 6, 15));

		return (
			<div className="flex flex-col items-center gap-3">
				<DatePicker value={date} onValueChange={setDate} />
				{date && <p className="text-sm text-muted-foreground">Selected: {formatDate(date, 'PPP')}</p>}
			</div>
		);
	},
};

// ── Range picker ───────────────────────────────────────────

export const RangePicker: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Select a start and end date. Two months are shown side by side; `numberOfMonths` can be changed.',
			},
		},
	},
	render: () => {
		const [range, setRange] = React.useState<DateRange | undefined>(undefined);

		return <DateRangePicker value={range} onValueChange={setRange} />;
	},
};

// ── With date limits ───────────────────────────────────────

export const WithDateLimits: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use `startMonth` and `endMonth` to restrict the selectable range. The month/year pickers in the calendar respect these limits too.',
			},
		},
	},
	render: () => {
		const [date, setDate] = React.useState<Date | undefined>(undefined);

		return (
			<div className="flex flex-col items-center gap-3">
				<DatePicker value={date} onValueChange={setDate} startMonth={new Date(2025, 0, 1)} endMonth={new Date(2027, 11, 31)} />
				<p className="max-w-60 text-center text-xs text-muted-foreground">Only dates between Jan 2025 and Dec 2027 are selectable.</p>
			</div>
		);
	},
};

// ── Dropdown caption ───────────────────────────────────────

export const DropdownCaption: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use `captionLayout="dropdown"` for native month/year dropdown navigation instead of the clickable grid picker — useful for date-of-birth pickers.',
			},
		},
	},
	render: () => {
		const [date, setDate] = React.useState<Date | undefined>(undefined);

		return <DatePicker value={date} onValueChange={setDate} captionLayout="dropdown" />;
	},
};

// ── Disabled ───────────────────────────────────────────────

export const Disabled: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Set `disabled` to prevent opening the picker.',
			},
		},
	},
	render: () => <DatePicker disabled placeholder="Disabled date picker" />,
};

// ── With input field ───────────────────────────────────────

function formatInputValue(date: Date | undefined) {
	if (!date) {
		return '';
	}

	return date.toLocaleDateString('en-US', {
		day: '2-digit',
		month: 'long',
		year: 'numeric',
	});
}

function isValidDate(date: Date) {
	return !isNaN(date.getTime());
}

export const WithInputField: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Compose the picker with an `InputGroup` for a text input that stays in sync with the calendar. Type a date directly, or press ArrowDown / click the calendar button to open the popover.',
			},
		},
	},
	render: () => {
		const [open, setOpen] = React.useState(false);
		const [date, setDate] = React.useState<Date | undefined>(new Date('2025-06-01'));
		const [month, setMonth] = React.useState<Date | undefined>(date);
		const [value, setValue] = React.useState(formatInputValue(date));

		return (
			<Field className="mx-auto w-48">
				<FieldLabel htmlFor="date-required">Subscription Date</FieldLabel>
				<InputGroup>
					<InputGroupInput
						id="date-required"
						value={value}
						placeholder="June 01, 2025"
						onChange={(e) => {
							const nextDate = new Date(e.target.value);
							setValue(e.target.value);
							if (isValidDate(nextDate)) {
								setDate(nextDate);
								setMonth(nextDate);
							}
						}}
						onKeyDown={(e) => {
							if (e.key === 'ArrowDown') {
								e.preventDefault();
								setOpen(true);
							}
						}}
					/>
					<InputGroupAddon align="inline-end">
						<Popover open={open} onOpenChange={setOpen}>
							<PopoverTrigger
								render={
									<InputGroupButton id="date-picker" variant="ghost" size="icon-xs" aria-label="Select date">
										<CalendarIcon />
										<span className="sr-only">Select date</span>
									</InputGroupButton>
								}
							/>
							<PopoverContent className="w-auto overflow-hidden p-0" align="end" alignOffset={-8} sideOffset={10}>
								<Calendar
									mode="single"
									selected={date}
									month={month}
									onMonthChange={setMonth}
									onSelect={(date) => {
										setDate(date);
										setValue(formatInputValue(date));
										setOpen(false);
									}}
								/>
							</PopoverContent>
						</Popover>
					</InputGroupAddon>
				</InputGroup>
			</Field>
		);
	},
};

// ── With time input ────────────────────────────────────────

export const WithTimeInput: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Pair the date picker with a native time input to capture a date and a time. The two values are tracked separately.',
			},
		},
	},
	render: () => {
		const [open, setOpen] = React.useState(false);
		const [date, setDate] = React.useState<Date | undefined>(undefined);

		return (
			<FieldGroup className="mx-auto w-80 flex-row">
				<Field className="flex-1">
					<FieldLabel htmlFor="date-picker-optional">Date</FieldLabel>
					<Popover open={open} onOpenChange={setOpen}>
						<PopoverTrigger
							render={
								<Button variant="outline" id="date-picker-optional" className="w-full justify-between font-normal">
									{date ? formatDate(date, 'PPP') : 'Select date'}
									<ChevronDownIcon data-icon="inline-end" />
								</Button>
							}
						/>
						<PopoverContent className="w-auto overflow-hidden p-0" align="start">
							<Calendar
								mode="single"
								selected={date}
								captionLayout="dropdown"
								defaultMonth={date}
								onSelect={(date) => {
									setDate(date);
									setOpen(false);
								}}
							/>
						</PopoverContent>
					</Popover>
				</Field>
				<Field className="w-32">
					<FieldLabel htmlFor="time-picker-optional">Time</FieldLabel>
					<Input
						type="time"
						id="time-picker-optional"
						step="1"
						defaultValue="10:30:00"
						className="appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
					/>
				</Field>
			</FieldGroup>
		);
	},
};

// ── Natural language ───────────────────────────────────────

export const NaturalLanguage: Story = {
	name: 'Natural Language Picker',
	parameters: {
		docs: {
			description: {
				story:
					'Type a natural language date — e.g. "tomorrow" or "next week" — and it\'s parsed with `chrono-node`. The parsed date drives the calendar selection and the preview text.',
			},
		},
	},
	render: () => {
		const [open, setOpen] = React.useState(false);
		const [value, setValue] = React.useState('In 2 days');
		const [date, setDate] = React.useState<Date | undefined>(parseDate(value) || undefined);

		return (
			<Field className="mx-auto w-64">
				<FieldLabel htmlFor="date-optional">Schedule Date</FieldLabel>
				<InputGroup>
					<InputGroupInput
						id="date-optional"
						value={value}
						placeholder="Tomorrow or next week"
						onChange={(e) => {
							setValue(e.target.value);
							const nextDate = parseDate(e.target.value);
							if (nextDate) {
								setDate(nextDate);
							}
						}}
						onKeyDown={(e) => {
							if (e.key === 'ArrowDown') {
								e.preventDefault();
								setOpen(true);
							}
						}}
					/>
					<InputGroupAddon align="inline-end">
						<Popover open={open} onOpenChange={setOpen}>
							<PopoverTrigger
								render={
									<InputGroupButton id="date-picker" variant="ghost" size="icon-xs" aria-label="Select date">
										<CalendarIcon />
										<span className="sr-only">Select date</span>
									</InputGroupButton>
								}
							/>
							<PopoverContent className="w-auto overflow-hidden p-0" align="end" sideOffset={8}>
								<Calendar
									mode="single"
									selected={date}
									captionLayout="dropdown"
									defaultMonth={date}
									onSelect={(date) => {
										setDate(date);
										setValue(formatInputValue(date));
										setOpen(false);
									}}
								/>
							</PopoverContent>
						</Popover>
					</InputGroupAddon>
				</InputGroup>
				<div className="px-1 text-sm text-muted-foreground">
					Your post will be published on <span className="font-medium">{formatInputValue(date)}</span>.
				</div>
			</Field>
		);
	},
};
