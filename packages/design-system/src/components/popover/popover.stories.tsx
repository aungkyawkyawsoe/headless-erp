import type { Meta, StoryObj } from '@storybook/react-vite';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from './';
import { Button } from '@/button';
import { Input } from '@/input';
import { Field } from '@/field';
import { Label } from '@/label';

/**
 * Displays rich content in a portal, triggered by a button. Provides
 * styled header, title, and description slots.
 */
const meta: Meta<typeof Popover> = {
	title: 'Components/Popover',
	component: Popover,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A popover that renders rich content in a portal, triggered by a button. Composes `PopoverTrigger`, `PopoverContent`, `PopoverHeader`, `PopoverTitle`, and `PopoverDescription`.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Basic ────────────────────────────────────────────────

export const Basic: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A simple popover with a title and description. Click the trigger to open and close it.',
			},
		},
	},
	render: () => (
		<Popover>
			<PopoverTrigger render={<Button variant="outline" />}>Open Popover</PopoverTrigger>
			<PopoverContent>
				<PopoverHeader>
					<PopoverTitle>Title</PopoverTitle>
					<PopoverDescription>Description text here. This provides additional context for the popover content.</PopoverDescription>
				</PopoverHeader>
			</PopoverContent>
		</Popover>
	),
};

// ── With Form ────────────────────────────────────────────

export const WithForm: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A popover with form fields inside — useful for quick-edit or filter panels.',
			},
		},
	},
	render: () => (
		<Popover>
			<PopoverTrigger render={<Button variant="outline" />}>Edit Dimensions</PopoverTrigger>
			<PopoverContent className="w-80">
				<PopoverHeader>
					<PopoverTitle>Dimensions</PopoverTitle>
					<PopoverDescription>Set the width and height of the element.</PopoverDescription>
				</PopoverHeader>
				<div className="flex flex-col gap-3">
					<Field orientation="horizontal" className="items-center gap-3">
						<Label className="w-12 shrink-0 text-muted-foreground">Width</Label>
						<Input type="number" defaultValue="100%" className="h-7" />
					</Field>
					<Field orientation="horizontal" className="items-center gap-3">
						<Label className="w-12 shrink-0 text-muted-foreground">Height</Label>
						<Input type="number" defaultValue="auto" className="h-7" />
					</Field>
				</div>
			</PopoverContent>
		</Popover>
	),
};

// ── Align ────────────────────────────────────────────────

export const AlignStart: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Popover content aligned to the start (left) of the trigger using `align="start"`.',
			},
		},
	},
	render: () => (
		<Popover>
			<PopoverTrigger render={<Button variant="outline" />}>Start</PopoverTrigger>
			<PopoverContent align="start" className="w-56">
				<PopoverHeader>
					<PopoverTitle>Aligned Start</PopoverTitle>
					<PopoverDescription>This popover is aligned to the start edge of the trigger.</PopoverDescription>
				</PopoverHeader>
			</PopoverContent>
		</Popover>
	),
};

export const AlignCenter: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Popover content aligned to the center of the trigger using `align="center"` (default).',
			},
		},
	},
	render: () => (
		<Popover>
			<PopoverTrigger render={<Button variant="outline" />}>Center</PopoverTrigger>
			<PopoverContent align="center" className="w-56">
				<PopoverHeader>
					<PopoverTitle>Aligned Center</PopoverTitle>
					<PopoverDescription>This popover is centered on the trigger (default).</PopoverDescription>
				</PopoverHeader>
			</PopoverContent>
		</Popover>
	),
};

export const AlignEnd: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Popover content aligned to the end (right) of the trigger using `align="end"`.',
			},
		},
	},
	render: () => (
		<Popover>
			<PopoverTrigger render={<Button variant="outline" />}>End</PopoverTrigger>
			<PopoverContent align="end" className="w-56">
				<PopoverHeader>
					<PopoverTitle>Aligned End</PopoverTitle>
					<PopoverDescription>This popover is aligned to the end edge of the trigger.</PopoverDescription>
				</PopoverHeader>
			</PopoverContent>
		</Popover>
	),
};

// ── Side ─────────────────────────────────────────────────

export const SideTop: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Popover content rendered above the trigger using `side="top"`.',
			},
		},
	},
	render: () => (
		<Popover>
			<PopoverTrigger render={<Button variant="outline" />}>Top</PopoverTrigger>
			<PopoverContent side="top" className="w-56">
				<PopoverHeader>
					<PopoverTitle>Placed on Top</PopoverTitle>
					<PopoverDescription>This popover appears above the trigger.</PopoverDescription>
				</PopoverHeader>
			</PopoverContent>
		</Popover>
	),
};

export const SideRight: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Popover content rendered to the right of the trigger using `side="right"`.',
			},
		},
	},
	render: () => (
		<Popover>
			<PopoverTrigger render={<Button variant="outline" />}>Right</PopoverTrigger>
			<PopoverContent side="right" className="w-56">
				<PopoverHeader>
					<PopoverTitle>Placed on Right</PopoverTitle>
					<PopoverDescription>This popover appears to the right of the trigger.</PopoverDescription>
				</PopoverHeader>
			</PopoverContent>
		</Popover>
	),
};

export const SideLeft: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Popover content rendered to the left of the trigger using `side="left"`.',
			},
		},
	},
	render: () => (
		<Popover>
			<PopoverTrigger render={<Button variant="outline" />}>Left</PopoverTrigger>
			<PopoverContent side="left" className="w-56">
				<PopoverHeader>
					<PopoverTitle>Placed on Left</PopoverTitle>
					<PopoverDescription>This popover appears to the left of the trigger.</PopoverDescription>
				</PopoverHeader>
			</PopoverContent>
		</Popover>
	),
};

// ── No Header ────────────────────────────────────────────

export const NoHeader: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A popover without the header — just raw content inside the popover. Useful for quick actions or simple menus.',
			},
		},
	},
	render: () => (
		<Popover>
			<PopoverTrigger render={<Button variant="outline" />}>Quick Actions</PopoverTrigger>
			<PopoverContent className="flex flex-col gap-1 p-1.5">
				<Button variant="ghost" size="sm" className="justify-start">
					Edit
				</Button>
				<Button variant="ghost" size="sm" className="justify-start">
					Duplicate
				</Button>
				<Button variant="ghost" size="sm" className="justify-start text-destructive">
					Delete
				</Button>
			</PopoverContent>
		</Popover>
	),
};
