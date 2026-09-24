import type { Meta, StoryObj } from '@storybook/react-vite';
import { Scheduler } from './scheduler';
import type { SchedulerEvent } from './core/types';

/**
 * Scheduler — an event calendar with month / week / day / agenda views, a nav
 * toolbar and an optional mini-month navigator. Feed it a plain
 * `SchedulerEvent[]`; colors accept hex or named tones (blue/teal/amber/…).
 */
const meta: Meta<typeof Scheduler> = {
	title: 'Components/Scheduler',
	component: Scheduler,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'DataTable-style event calendar: month, week, day and agenda views; toolbar with prev/today/next + view switcher; optional mini-month sidebar. Configure timeStart/timeEnd for the grid hours, weekStartsOn for the first day of the week.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

// Events relative to "now" so the stories always have content.
function sampleEvents(): SchedulerEvent[] {
	const now = new Date();
	const day = (offset: number, h = 9, m = 0) => {
		const d = new Date(now);
		d.setDate(d.getDate() + offset);
		d.setHours(h, m, 0, 0);
		return d;
	};
	return [
		{ id: '1', title: 'Marc Demo Time Off: 3 days', start: day(-3), end: day(-1), allDay: true, color: 'teal' },
		{ id: '2', title: 'Mitchell Admin Time Off', start: day(-1), end: day(1), allDay: true, color: 'purple' },
		{ id: '3', title: 'Follow up for Project proposal', start: day(0, 16, 50), end: day(0, 17, 50), color: 'blue', location: 'Room 4' },
		{ id: '4', title: 'Check option prod.', start: day(1, 9), end: day(1, 10), color: 'green' },
		{ id: '5', title: '2 pending', start: day(2, 11, 30), end: day(2, 12), color: 'amber' },
		{ id: '6', title: '18 pending', start: day(3, 14), end: day(3, 15), color: 'amber' },
		{ id: '7', title: '3 pending', start: day(4, 8, 30), end: day(4, 9, 30), color: 'amber' },
	];
}

export const Week: Story = {
	render: () => <Scheduler events={sampleEvents()} defaultView="week" showMiniMonth timeStart={6} timeEnd={20} />,
};

export const Month: Story = {
	render: () => <Scheduler events={sampleEvents()} defaultView="month" showMiniMonth />,
};

export const Day: Story = {
	render: () => <Scheduler events={sampleEvents()} defaultView="day" />,
};

export const Agenda: Story = {
	render: () => <Scheduler events={sampleEvents()} defaultView="agenda" />,
};

export const NoToolbar: Story = {
	render: () => <Scheduler events={sampleEvents()} defaultView="week" showToolbar={false} />,
};
