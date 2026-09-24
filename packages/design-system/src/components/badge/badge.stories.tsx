import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from './';
import { Spinner } from '../spinner';
import { BadgeCheck, BookmarkIcon } from 'lucide-react';
import { ArrowUpRightIcon } from 'lucide-react';

/**
 * Displays a badge or a component that looks like a badge.
 */
const meta: Meta<typeof Badge> = {
	title: 'Components/Badge',
	component: Badge,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A badge component for displaying labels, statuses, and counts. Supports multiple variants, icons, spinners, links, and custom colors.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Variants ─────────────────────────────────────────────

export const Variants: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use the `variant` prop to change the visual style of the badge. Available variants: `default`, `secondary`, `destructive`, `outline`, and `ghost`.',
			},
		},
	},
	render: () => (
		<div className="flex flex-wrap items-center gap-4">
			<Badge variant="default">Default</Badge>
			<Badge variant="secondary">Secondary</Badge>
			<Badge variant="destructive">Destructive</Badge>
			<Badge variant="outline">Outline</Badge>
			<Badge variant="ghost">Ghost</Badge>
		</div>
	),
};

// ── With Icon ────────────────────────────────────────────

export const WithIcon: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Render an icon inside the badge. Use `data-icon="inline-start"` for the icon on the left and `data-icon="inline-end"` for the icon on the right.',
			},
		},
	},
	render: () => (
		<div className="flex flex-wrap items-center gap-4">
			<Badge variant="default">
				<BadgeCheck data-icon="inline-start" />
				Verified
			</Badge>
			<Badge variant="secondary">
				<BookmarkIcon data-icon="inline-start" />
				Bookmark
			</Badge>
			<Badge variant="outline">
				Bookmark
				<BookmarkIcon data-icon="inline-end" />
			</Badge>
		</div>
	),
};

// ── With Spinner ─────────────────────────────────────────

export const WithSpinner: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Render a spinner inside the badge. Add the `data-icon="inline-start"` or `data-icon="inline-end"` prop to the spinner for proper spacing.',
			},
		},
	},
	render: () => (
		<div className="flex flex-wrap items-center gap-4">
			<Badge variant="default">
				<Spinner data-icon="inline-start" />
				Deleting
			</Badge>
			<Badge variant="secondary">
				<Spinner data-icon="inline-start" />
				Generating
			</Badge>
		</div>
	),
};

// ── Link ─────────────────────────────────────────────────

export const Link: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use the `render` prop to render a link as a badge. The badge will inherit link styling from the `link` variant.',
			},
		},
	},
	render: () => (
		<Badge variant="link" render={<a href="https://example.com" target="_blank" rel="noopener noreferrer" />}>
			Open Link
			<ArrowUpRightIcon data-icon="inline-end" />
		</Badge>
	),
};

// ── Custom Colors ────────────────────────────────────────

export const CustomColors: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Customize the colors of a badge by adding custom utility classes to override the default theme colors.',
			},
		},
	},
	render: () => (
		<div className="flex flex-wrap items-center gap-4">
			<Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300">Blue</Badge>
			<Badge className="bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900 dark:text-green-300">Green</Badge>
			<Badge className="bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900 dark:text-purple-300">Sky</Badge>
			<Badge className="bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-300">Amber</Badge>
			<Badge className="bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300">Red</Badge>
		</div>
	),
};
