import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Slider } from './';

/**
 * An input where the user selects a value from within a given range.
 */
const meta: Meta<typeof Slider> = {
	title: 'Components/Slider',
	component: Slider,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A slider component. Allows users to select a value (or range of values) from a continuous or discrete range. Supports single thumb, multiple thumbs, vertical orientation, controlled mode, and disabled state.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Default ──────────────────────────────────────────────

export const Default: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'A basic slider with a default value. Use `defaultValue` to set the initial position and `max` / `step` to configure the range.',
			},
		},
	},
	render: () => (
		<div className="w-80">
			<Slider defaultValue={[33]} max={100} step={1} />
		</div>
	),
};

// ── Range ────────────────────────────────────────────────

export const Range: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use an array with two values for a range slider. This lets the user select a start and end value within the range.',
			},
		},
	},
	render: () => (
		<div className="w-80">
			<Slider defaultValue={[25, 75]} max={100} step={1} />
		</div>
	),
};

// ── Multiple Thumbs ──────────────────────────────────────

export const Multiple: Story = {
	name: 'Multiple Thumbs',
	parameters: {
		docs: {
			description: {
				story: 'Use an array with multiple values for multiple thumbs. Each thumb can be moved independently within the range.',
			},
		},
	},
	render: () => (
		<div className="w-80">
			<Slider defaultValue={[20, 50, 80]} max={100} step={1} />
		</div>
	),
};

// ── Vertical ─────────────────────────────────────────────

export const Vertical: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `orientation="vertical"` for a vertical slider. The slider will expand to fill the available height.',
			},
		},
	},
	render: () => (
		<div className="flex h-48 justify-center">
			<Slider defaultValue={[50]} max={100} step={1} orientation="vertical" />
		</div>
	),
};

// ── Controlled ───────────────────────────────────────────

export const Controlled: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A controlled slider using `value` and `onValueChange` props. The current value is displayed alongside the slider.',
			},
		},
	},
	render: function ControlledStory() {
		const [value, setValue] = useState([0.3]);
		return (
			<div className="flex w-80 flex-col gap-4">
				<Slider value={value} onValueChange={(v) => setValue(Array.isArray(v) ? v : [v])} max={1} step={0.01} />
				<div className="text-center text-sm text-muted-foreground">Value: {value.map((v) => v.toFixed(2)).join(', ')}</div>
			</div>
		);
	},
};

// ── Disabled ─────────────────────────────────────────────

export const Disabled: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use the `disabled` prop to disable the slider. The slider will be non-interactive and visually dimmed.',
			},
		},
	},
	render: () => (
		<div className="flex w-80 flex-col gap-4">
			<Slider defaultValue={[60]} max={100} step={1} disabled />
			<p className="text-center text-xs text-muted-foreground">This slider is disabled</p>
		</div>
	),
};
