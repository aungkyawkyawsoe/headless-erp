import type { Meta, StoryObj } from '@storybook/react-vite';
import { Separator } from './';

/**
 * Separator visually divides content into sections.
 *
 * Renders a `<div>` with `role="separator"`. Use `orientation` to switch
 * between horizontal (full-width line) and vertical (full-height line).
 */
const meta: Meta<typeof Separator> = {
	title: 'Components/Separator',
	component: Separator,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A thin visual divider. Horizontal separators stretch the width of their container; vertical separators stretch the height. Supports `aria-labelledby` and other ARIA attributes.',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		orientation: {
			control: 'select',
			description: 'Direction of the separator',
			options: ['horizontal', 'vertical'],
			table: {
				defaultValue: { summary: 'horizontal' },
				type: { summary: '"horizontal" | "vertical"' },
			},
		},
	},
	args: {
		orientation: 'horizontal',
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Horizontal ──────────────────────────────────────────

export const Horizontal: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A horizontal separator spans the full width of its container. Commonly used between sections of content.',
			},
		},
	},
	render: () => (
		<div className="flex w-80 flex-col gap-3">
			<div>
				<p className="text-sm font-medium">Content Section A</p>
				<p className="mt-1 text-xs text-muted-foreground">This is the first section above the separator.</p>
			</div>
			<Separator />
			<div>
				<p className="text-sm font-medium">Content Section B</p>
				<p className="mt-1 text-xs text-muted-foreground">This is the second section below the separator.</p>
			</div>
		</div>
	),
};

// ── Vertical ────────────────────────────────────────────

export const Vertical: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A vertical separator sits between inline elements. Useful in toolbars, menus, or breadcrumb-like layouts.',
			},
		},
	},
	render: () => (
		<div className="flex h-8 items-center gap-3">
			<span className="text-sm font-medium">Home</span>
			<Separator orientation="vertical" />
			<span className="text-sm font-medium">Products</span>
			<Separator orientation="vertical" />
			<span className="text-sm text-muted-foreground">Details</span>
		</div>
	),
};
