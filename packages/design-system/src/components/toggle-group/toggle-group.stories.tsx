import type { Meta, StoryObj } from '@storybook/react-vite';
import { ToggleGroup, ToggleGroupItem } from './';
import { Toggle } from '../toggle';
import { useState } from 'react';
import { BoldIcon, ItalicIcon, UnderlineIcon, AlignLeftIcon, AlignCenterIcon, AlignRightIcon, ListIcon, Grid3X3Icon } from 'lucide-react';

/**
 * ToggleGroup groups related toggle options together.
 *
 * Supports single and multiple selection, context-based variant/size
 * inheritance, configurable spacing, and horizontal/vertical orientation.
 */
const meta: Meta<typeof ToggleGroup> = {
	title: 'Components/ToggleGroup',
	component: ToggleGroup,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A group of toggles sharing variant, size, spacing, and orientation via React context. Supports horizontal (default) and vertical layout, configurable gap spacing, and `spacing=0` for attached/segmented appearance without borders between adjacent items.',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		variant: {
			control: 'select',
			description: 'Visual variant inherited by all ToggleGroupItems',
			options: ['default', 'outline'],
			table: {
				type: { summary: 'string' },
				defaultValue: { summary: 'default' },
			},
		},
		size: {
			control: 'select',
			description: 'Size preset inherited by all ToggleGroupItems',
			options: ['default', 'sm', 'lg'],
			table: {
				type: { summary: 'string' },
				defaultValue: { summary: 'default' },
			},
		},
		spacing: {
			control: 'number',
			description: 'Gap between items in pixels. Set to 0 for attached appearance.',
			table: { type: { summary: 'number' }, defaultValue: { summary: '2' } },
		},
		orientation: {
			control: 'radio',
			description: 'Layout direction',
			options: ['horizontal', 'vertical'],
			table: {
				type: { summary: 'string' },
				defaultValue: { summary: 'horizontal' },
			},
		},
	},
	args: {
		variant: 'default',
		size: 'default',
		spacing: 2,
		orientation: 'horizontal',
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Gallery ─────────────────────────────────────────────

export const AllVariants: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="flex flex-col gap-6">
			<section>
				<h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Default</h3>
				<ToggleGroup variant="default">
					<ToggleGroupItem value="bold" aria-label="Toggle bold">
						<BoldIcon />
					</ToggleGroupItem>
					<ToggleGroupItem value="italic" aria-label="Toggle italic">
						<ItalicIcon />
					</ToggleGroupItem>
					<ToggleGroupItem value="underline" aria-label="Toggle underline">
						<UnderlineIcon />
					</ToggleGroupItem>
				</ToggleGroup>
			</section>

			<section>
				<h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Outline</h3>
				<ToggleGroup variant="outline">
					<ToggleGroupItem value="bold" aria-label="Toggle bold">
						<BoldIcon />
					</ToggleGroupItem>
					<ToggleGroupItem value="italic" aria-label="Toggle italic">
						<ItalicIcon />
					</ToggleGroupItem>
					<ToggleGroupItem value="underline" aria-label="Toggle underline">
						<UnderlineIcon />
					</ToggleGroupItem>
				</ToggleGroup>
			</section>
		</div>
	),
};

export const AllSizes: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="flex flex-col gap-6">
			{(['sm', 'default', 'lg'] as const).map((s) => (
				<section key={s}>
					<h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{s}</h3>
					<ToggleGroup variant="outline" size={s}>
						<ToggleGroupItem value="bold" aria-label="Toggle bold">
							<BoldIcon />
						</ToggleGroupItem>
						<ToggleGroupItem value="italic" aria-label="Toggle italic">
							<ItalicIcon />
						</ToggleGroupItem>
						<ToggleGroupItem value="underline" aria-label="Toggle underline">
							<UnderlineIcon />
						</ToggleGroupItem>
					</ToggleGroup>
				</section>
			))}
		</div>
	),
};

// ── States ──────────────────────────────────────────────

export const Default: Story = {
	render: () => (
		<ToggleGroup>
			<ToggleGroupItem value="bold" aria-label="Toggle bold">
				<BoldIcon />
			</ToggleGroupItem>
			<ToggleGroupItem value="italic" aria-label="Toggle italic">
				<ItalicIcon />
			</ToggleGroupItem>
			<ToggleGroupItem value="underline" aria-label="Toggle underline">
				<UnderlineIcon />
			</ToggleGroupItem>
		</ToggleGroup>
	),
};

export const Outline: Story = {
	render: () => (
		<ToggleGroup variant="outline">
			<ToggleGroupItem value="bold" aria-label="Toggle bold">
				<BoldIcon />
			</ToggleGroupItem>
			<ToggleGroupItem value="italic" aria-label="Toggle italic">
				<ItalicIcon />
			</ToggleGroupItem>
			<ToggleGroupItem value="underline" aria-label="Toggle underline">
				<UnderlineIcon />
			</ToggleGroupItem>
		</ToggleGroup>
	),
};

export const WithDefaultValue: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Pass `defaultValue` to pre-select one or more items. The group supports both single and multiple selection via `defaultValue` as a string or array.',
			},
		},
	},
	render: () => (
		<ToggleGroup defaultValue={['italic']}>
			<ToggleGroupItem value="bold" aria-label="Toggle bold">
				<BoldIcon />
			</ToggleGroupItem>
			<ToggleGroupItem value="italic" aria-label="Toggle italic">
				<ItalicIcon />
			</ToggleGroupItem>
			<ToggleGroupItem value="underline" aria-label="Toggle underline">
				<UnderlineIcon />
			</ToggleGroupItem>
		</ToggleGroup>
	),
};

export const Disabled: Story = {
	render: () => (
		<ToggleGroup disabled>
			<ToggleGroupItem value="bold" aria-label="Toggle bold">
				<BoldIcon />
			</ToggleGroupItem>
			<ToggleGroupItem value="italic" aria-label="Toggle italic">
				<ItalicIcon />
			</ToggleGroupItem>
			<ToggleGroupItem value="underline" aria-label="Toggle underline">
				<UnderlineIcon />
			</ToggleGroupItem>
		</ToggleGroup>
	),
};

// ── Orientation ─────────────────────────────────────────

export const Vertical: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Use `orientation="vertical"` to stack toggles vertically. Useful for side toolbars or compact action panels.',
			},
		},
	},
	render: () => (
		<ToggleGroup orientation="vertical" variant="outline">
			<ToggleGroupItem value="bold" aria-label="Toggle bold">
				<BoldIcon />
			</ToggleGroupItem>
			<ToggleGroupItem value="italic" aria-label="Toggle italic">
				<ItalicIcon />
			</ToggleGroupItem>
			<ToggleGroupItem value="underline" aria-label="Toggle underline">
				<UnderlineIcon />
			</ToggleGroupItem>
		</ToggleGroup>
	),
};

// ── Spacing ─────────────────────────────────────────────

export const NoSpacing: Story = {
	name: 'No Spacing (Attached)',
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'Set `spacing=0` for an attached segmented-control appearance. Adjacent borders collapse, and the first/last items get rounded corners.',
			},
		},
	},
	render: () => (
		<div className="flex flex-col gap-6">
			<section>
				<h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Horizontal (spacing=0)</h3>
				<ToggleGroup spacing={0} variant="outline">
					<ToggleGroupItem value="left" aria-label="Align left">
						<AlignLeftIcon />
					</ToggleGroupItem>
					<ToggleGroupItem value="center" aria-label="Align center">
						<AlignCenterIcon />
					</ToggleGroupItem>
					<ToggleGroupItem value="right" aria-label="Align right">
						<AlignRightIcon />
					</ToggleGroupItem>
				</ToggleGroup>
			</section>

			<section>
				<h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Vertical (spacing=0)</h3>
				<ToggleGroup spacing={0} orientation="vertical" variant="outline">
					<ToggleGroupItem value="list" aria-label="List view">
						<ListIcon />
					</ToggleGroupItem>
					<ToggleGroupItem value="grid" aria-label="Grid view">
						<Grid3X3Icon />
					</ToggleGroupItem>
				</ToggleGroup>
			</section>
		</div>
	),
};

// ── Interactive ─────────────────────────────────────────

export const Interactive: Story = {
	name: 'Interactive (Single Select)',
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'A controlled single-selection toggle group. Uses `useState` to track the active value and reacts to changes.',
			},
		},
	},
	render: () => {
		const [value, setValue] = useState<string[]>(['italic']);
		return (
			<div className="flex flex-col items-center gap-4">
				<ToggleGroup value={value} onValueChange={setValue} variant="outline">
					<ToggleGroupItem value="bold" aria-label="Toggle bold">
						<BoldIcon />
					</ToggleGroupItem>
					<ToggleGroupItem value="italic" aria-label="Toggle italic">
						<ItalicIcon />
					</ToggleGroupItem>
					<ToggleGroupItem value="underline" aria-label="Toggle underline">
						<UnderlineIcon />
					</ToggleGroupItem>
				</ToggleGroup>
				<span className="text-xs text-muted-foreground">Active: {value.join(', ') || '(none)'}</span>
			</div>
		);
	},
};

// ── With Toggle ─────────────────────────────────────────

export const WithStandaloneToggle: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'A ToggleGroup can include standalone `Toggle` components alongside `ToggleGroupItem`s. This is useful when some toggles should not participate in group selection.',
			},
		},
	},
	render: () => (
		<div className="flex items-center gap-3">
			<Toggle variant="outline" aria-label="Toggle bold">
				<BoldIcon />
			</Toggle>
			<ToggleGroup variant="outline">
				<ToggleGroupItem value="italic" aria-label="Toggle italic">
					<ItalicIcon />
				</ToggleGroupItem>
				<ToggleGroupItem value="underline" aria-label="Toggle underline">
					<UnderlineIcon />
				</ToggleGroupItem>
			</ToggleGroup>
		</div>
	),
};
