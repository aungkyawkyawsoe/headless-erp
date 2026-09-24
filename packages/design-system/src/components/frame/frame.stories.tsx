import type { Meta, StoryObj } from '@storybook/react-vite';
import { Frame, FramePanel } from './';
import { Card, CardContent, CardHeader, CardTitle } from '../card';

/**
 * Frame is a lightweight container with two variants:
 * - `default` — bordered card surface (uses `--card` tokens)
 * - `ghost` — transparent, no border (useful for spacing/layout)
 *
 * `FramePanel` adds standard padding for grouped content.
 */
const meta: Meta<typeof Frame> = {
	title: 'Components/Frame',
	component: Frame,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A simple container with `default` (bordered card) and `ghost` (transparent) variants. Use `FramePanel` for padded content.',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		variant: {
			control: 'select',
			options: ['default', 'ghost'],
			description: 'Visual style of the frame.',
		},
	},
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: { variant: 'default' },
	render: (args) => (
		<Frame {...args} className="w-80">
			<FramePanel>
				<p className="text-sm text-muted-foreground">A bordered frame with the default card surface.</p>
			</FramePanel>
		</Frame>
	),
};

export const Ghost: Story = {
	args: { variant: 'ghost' },
	render: (args) => (
		<Frame {...args} className="w-80">
			<FramePanel>
				<p className="text-sm text-muted-foreground">A transparent frame — useful as a layout wrapper.</p>
			</FramePanel>
		</Frame>
	),
};

export const WithCard: Story = {
	render: () => (
		<Frame className="w-80">
			<Card>
				<CardHeader>
					<CardTitle>Inside a frame</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">Frame can wrap other components, e.g. Card, for consistent surfaces.</p>
				</CardContent>
			</Card>
		</Frame>
	),
};
