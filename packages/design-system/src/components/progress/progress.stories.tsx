import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Progress, ProgressLabel, ProgressValue } from './';
import { Slider } from '@/slider';

/**
 * Displays an indicator showing the completion progress of a task, typically
 * displayed as a progress bar. Displays completion progress with
 * `ProgressLabel` and `ProgressValue` slots.
 */
const meta: Meta<typeof Progress> = {
	title: 'Components/Progress',
	component: Progress,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A progress bar component. Use `ProgressLabel` and `ProgressValue` inside `Progress` to display a label and current value. The indicator animates when the `value` prop changes.',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		value: {
			control: { type: 'range', min: 0, max: 100, step: 1 },
			description: 'Current progress value (0–100)',
		},
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Default ──────────────────────────────────────────────

export const Default: Story = {
	args: {
		value: 33,
	},
	parameters: {
		docs: {
			description: {
				story: 'A basic progress bar with a value of 33%. Use the `value` prop to set the progress percentage (0–100).',
			},
		},
	},
	render: (args) => <Progress {...args} className="w-full max-w-sm" />,
};

// ── Label ────────────────────────────────────────────────

export const Label: Story = {
	args: {
		value: 56,
	},
	parameters: {
		docs: {
			description: {
				story:
					'A progress bar with a `ProgressLabel` and auto-computed `ProgressValue`. The label describes what the progress represents, and the value shows the current percentage.',
			},
		},
	},
	render: (args) => (
		<Progress {...args} className="w-full max-w-sm">
			<ProgressLabel>Upload progress</ProgressLabel>
			<ProgressValue />
		</Progress>
	),
};

// ── Zero ─────────────────────────────────────────────────

export const Zero: Story = {
	args: {
		value: 0,
	},
	parameters: {
		docs: {
			description: {
				story: 'A progress bar at 0%. The indicator is hidden, showing an empty track.',
			},
		},
	},
	render: (args) => (
		<Progress {...args} className="w-full max-w-sm">
			<ProgressLabel>Starting...</ProgressLabel>
			<ProgressValue />
		</Progress>
	),
};

// ── Complete ─────────────────────────────────────────────

export const Complete: Story = {
	args: {
		value: 100,
	},
	parameters: {
		docs: {
			description: {
				story: 'A progress bar at 100%. The indicator fills the entire track.',
			},
		},
	},
	render: (args) => (
		<Progress {...args} className="w-full max-w-sm">
			<ProgressLabel>Complete</ProgressLabel>
			<ProgressValue />
		</Progress>
	),
};

// ── Indeterminate ────────────────────────────────────────

export const Indeterminate: Story = {
	args: {
		value: null,
	},
	parameters: {
		docs: {
			description: {
				story:
					'An indeterminate progress bar (no `value` prop). Use this when the duration or progress cannot be determined, such as during file uploads or background syncs. The indicator animates continuously.',
			},
		},
	},
	render: (args) => (
		<Progress {...args} className="w-full max-w-sm">
			<ProgressLabel>Loading...</ProgressLabel>
		</Progress>
	),
};

// ── Controlled ───────────────────────────────────────────

function ControlledDemo() {
	const [value, setValue] = useState(45);

	return (
		<div className="flex w-full max-w-sm flex-col gap-6">
			<Progress value={value}>
				<ProgressLabel>Progress</ProgressLabel>
				<ProgressValue />
			</Progress>
			<div className="flex items-center gap-4">
				<span className="w-8 text-right text-sm text-muted-foreground tabular-nums">{value}%</span>
				<Slider
					className="flex-1"
					value={[value]}
					onValueChange={(v) => setValue(Array.isArray(v) ? v[0] : v)}
					min={0}
					max={100}
					step={1}
				/>
			</div>
		</div>
	);
}

export const Controlled: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A controlled progress bar linked to a slider. Drag the slider to update the progress value in real-time.',
			},
		},
	},
	render: () => <ControlledDemo />,
};

// ── Multiple Bars ────────────────────────────────────────

export const MultipleBars: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Multiple progress bars displayed together, useful for dashboards or multi-step processes.',
			},
		},
	},
	render: () => (
		<div className="flex w-full max-w-sm flex-col gap-4">
			<Progress value={90}>
				<ProgressLabel>Processing</ProgressLabel>
				<ProgressValue />
			</Progress>
			<Progress value={65}>
				<ProgressLabel>Uploading</ProgressLabel>
				<ProgressValue />
			</Progress>
			<Progress value={30}>
				<ProgressLabel>Indexing</ProgressLabel>
				<ProgressValue />
			</Progress>
		</div>
	),
};
