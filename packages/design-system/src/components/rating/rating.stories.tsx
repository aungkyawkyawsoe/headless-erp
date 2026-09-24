import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Rating } from './';

/**
 * Displays a star-rating input or indicator. Supports interactive selection,
 * read-only display, multiple themes, and a label slot.
 */
const meta: Meta<typeof Rating> = {
	title: 'Components/Rating',
	component: Rating,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A star-rating component. Use it for collecting user ratings (e.g. product reviews, feedback forms) or displaying a read-only score. Supports hover preview, custom star counts, and semantic color themes.',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		value: {
			control: { type: 'range', min: 0, max: 5, step: 1 },
			description: 'Current rating value',
		},
		stars: {
			control: { type: 'number', min: 1, max: 10 },
			description: 'Total number of stars to display',
		},
		readOnly: {
			control: 'boolean',
			description: 'Whether the rating is read-only',
		},
		theme: {
			control: 'select',
			options: ['default', 'primary', 'success', 'info', 'warning', 'danger'],
			description: 'Color theme for active stars',
		},
		label: {
			control: 'text',
			description: 'Label text displayed above the stars',
		},
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Default ───────────────────────────────────────────────

export const Default: Story = {
	args: {
		value: 3,
		stars: 5,
	},
	parameters: {
		docs: {
			description: {
				story: 'A basic interactive rating with 3 out of 5 stars selected.',
			},
		},
	},
};

// ── Themes ────────────────────────────────────────────────

export const Themes: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use the `theme` prop to change the color of active stars. Available themes: `default`, `primary`, `success`, `info`, `warning`, and `danger`.',
			},
		},
	},
	render: () => (
		<div className="flex flex-col gap-4">
			<Rating value={3} theme="default" label="Default" />
			<Rating value={3} theme="primary" label="Primary" />
			<Rating value={3} theme="success" label="Success" />
			<Rating value={3} theme="info" label="Info" />
			<Rating value={3} theme="warning" label="Warning" />
			<Rating value={3} theme="danger" label="Danger" />
		</div>
	),
};

// ── Read Only ─────────────────────────────────────────────

export const ReadOnly: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Set `readOnly` to `true` to display the rating without allowing changes. Useful for displaying an average score or a previously submitted rating.',
			},
		},
	},
	render: () => (
		<div className="flex flex-col gap-4">
			<Rating value={5} readOnly label="5 stars" />
			<Rating value={4} readOnly label="4 stars" />
			<Rating value={3} readOnly label="3 stars" />
			<Rating value={2} readOnly label="2 stars" />
			<Rating value={1} readOnly label="1 star" />
			<Rating value={0} readOnly label="No rating" />
		</div>
	),
};

// ── Star Count ────────────────────────────────────────────

export const StarCount: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Customize the number of stars with the `stars` prop. Default is 5.',
			},
		},
	},
	render: () => (
		<div className="flex flex-col gap-4">
			<Rating value={3} stars={3} label="3 stars" />
			<Rating value={5} stars={5} label="5 stars" />
			<Rating value={5} stars={7} label="7 stars" />
			<Rating value={5} stars={10} label="10 stars" />
		</div>
	),
};

// ── No Label ──────────────────────────────────────────────

export const NoLabel: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Omit the `label` prop to render stars without any label above them.',
			},
		},
	},
	render: () => (
		<div className="flex gap-6">
			<Rating value={4} />
			<Rating value={5} theme="primary" />
			<Rating value={3} theme="warning" />
		</div>
	),
};

// ── Zero Value ────────────────────────────────────────────

export const ZeroValue: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A rating with a value of `0` renders all stars as unfilled.',
			},
		},
	},
	render: () => <Rating value={0} label="Rate this product" />,
};

// ── Interactive ───────────────────────────────────────────

function InteractiveDemo() {
	const [value, setValue] = useState(0);

	return (
		<div className="flex flex-col items-center gap-4">
			<Rating value={value} onChange={(e) => setValue(e.value)} label="Tap to rate" />
			<p className="text-sm text-muted-foreground">{value === 0 ? 'Not rated yet' : `You rated: ${value} star${value > 1 ? 's' : ''}`}</p>
		</div>
	);
}

export const Interactive: Story = {
	parameters: {
		docs: {
			description: {
				story: 'An interactive demo showing the rating value being tracked below the stars. Tap a star to set the value.',
			},
		},
	},
	render: () => <InteractiveDemo />,
};
