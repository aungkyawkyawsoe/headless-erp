import type { Meta, StoryObj } from '@storybook/react-vite';
import { Fragment } from 'react';
import { ScrollArea, ScrollBar } from './';
import { Separator } from '@/separator';

/**
 * ScrollArea augments native scroll functionality for custom,
 * cross-browser styling.
 *
 * Provides accessible scroll containers with customizable scrollbars.
 */
const meta: Meta<typeof ScrollArea> = {
	title: 'Components/ScrollArea',
	component: ScrollArea,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A custom-styled scroll container. Use `ScrollBar` with `orientation="horizontal"` for horizontal scrolling. The scrollbar is hidden by default and appears on hover.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Sample data ─────────────────────────────────────────────

const tags = Array.from({ length: 50 }).map((_, i, a) => `v1.2.0-beta.${a.length - i}`);

const items = Array.from({ length: 20 }).map((_, i) => ({
	id: i + 1,
	name: `Item ${i + 1}`,
}));

// ── Default ─────────────────────────────────────────────────

export const Default: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A vertical scroll area with a list of tags. The scrollbar appears on hover over the scroll area.',
			},
		},
	},
	render: () => (
		<ScrollArea className="h-72 w-48 rounded-md border">
			<div className="p-4">
				<h4 className="mb-4 text-sm leading-none font-medium">Tags</h4>
				{tags.map((tag) => (
					<Fragment key={tag}>
						<div className="text-sm">{tag}</div>
						<Separator className="my-2" />
					</Fragment>
				))}
			</div>
		</ScrollArea>
	),
};

// ── Horizontal ──────────────────────────────────────────────

export const Horizontal: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'A horizontal scroll area using `ScrollBar` with `orientation="horizontal"`. Content wraps in a `whitespace-nowrap` container and overflows horizontally.',
			},
		},
	},
	render: () => (
		<ScrollArea className="w-80 rounded-md border whitespace-nowrap">
			<div className="flex w-max gap-4 p-4">
				{items.map((item) => (
					<div
						key={item.id}
						className="flex h-24 w-24 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-medium text-muted-foreground"
					>
						{item.name}
					</div>
				))}
			</div>
			<ScrollBar orientation="horizontal" />
		</ScrollArea>
	),
};
