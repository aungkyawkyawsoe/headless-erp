import type { Meta, StoryObj } from '@storybook/react-vite';
import { Skeleton } from './';
import { Card, CardContent, CardHeader } from '@/card';

/**
 * Use to show a placeholder while content is loading.
 */
const meta: Meta<typeof Skeleton> = {
	title: 'Components/Skeleton',
	component: Skeleton,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A skeleton component for showing a placeholder while content is loading. Use the `className` prop to control the dimensions and border-radius.',
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
					'A basic skeleton with a fixed width and height. Use `className` to set dimensions and `rounded-full` for circular skeletons.',
			},
		},
	},
	render: () => (
		<div className="flex items-center gap-4">
			<Skeleton className="h-12 w-12 rounded-full" />
			<div className="flex flex-col gap-2">
				<Skeleton className="h-4 w-62.5" />
				<Skeleton className="h-4 w-50" />
			</div>
		</div>
	),
};

// ── Avatar ───────────────────────────────────────────────

export const AvatarSkeleton: Story = {
	name: 'Avatar',
	parameters: {
		docs: {
			description: {
				story:
					'A skeleton placeholder for an avatar with user details. Renders a circular skeleton for the avatar and text skeletons for the name and email.',
			},
		},
	},
	render: () => (
		<div className="flex items-center gap-4">
			<Skeleton className="h-12 w-12 rounded-full" />
			<div className="flex flex-col gap-2">
				<Skeleton className="h-4 w-37.5" />
				<Skeleton className="h-4 w-25" />
			</div>
		</div>
	),
};

// ── Card ─────────────────────────────────────────────────

export const CardSkeleton: Story = {
	name: 'Card',
	parameters: {
		docs: {
			description: {
				story: 'A skeleton placeholder for a card layout with an image area, title, description, and avatar row.',
			},
		},
	},
	render: () => (
		<Card className="w-87.5">
			<CardHeader>
				<Skeleton className="h-50 w-full rounded-sm" />
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<Skeleton className="h-5 w-62.5" />
				<Skeleton className="h-4 w-50" />
				<div className="flex items-center gap-3 pt-2">
					<Skeleton className="h-10 w-10 rounded-full" />
					<div className="flex flex-col gap-2">
						<Skeleton className="h-3 w-30" />
						<Skeleton className="h-3 w-20" />
					</div>
				</div>
			</CardContent>
		</Card>
	),
};

// ── Text ─────────────────────────────────────────────────

export const TextSkeleton: Story = {
	name: 'Text',
	parameters: {
		docs: {
			description: {
				story: 'A skeleton placeholder for a block of text content with a heading and multiple lines of body text.',
			},
		},
	},
	render: () => (
		<div className="flex w-100 flex-col gap-3">
			<Skeleton className="h-6 w-75" />
			<Skeleton className="h-4 w-full" />
			<Skeleton className="h-4 w-full" />
			<Skeleton className="h-4 w-[80%]" />
		</div>
	),
};

// ── Form ─────────────────────────────────────────────────

export const FormSkeleton: Story = {
	name: 'Form',
	parameters: {
		docs: {
			description: {
				story: 'A skeleton placeholder for a form layout with multiple label and input fields.',
			},
		},
	},
	render: () => (
		<div className="flex w-100 flex-col gap-6">
			<div className="flex flex-col gap-2">
				<Skeleton className="h-4 w-15" />
				<Skeleton className="h-10 w-full" />
			</div>
			<div className="flex flex-col gap-2">
				<Skeleton className="h-4 w-20" />
				<Skeleton className="h-10 w-full" />
			</div>
			<div className="flex flex-col gap-2">
				<Skeleton className="h-4 w-17.5" />
				<Skeleton className="h-10 w-full" />
			</div>
			<Skeleton className="h-10 w-full" />
		</div>
	),
};

// ── Table ────────────────────────────────────────────────

export const TableSkeleton: Story = {
	name: 'Table',
	parameters: {
		docs: {
			description: {
				story: 'A skeleton placeholder for a table layout with header row and multiple data rows.',
			},
		},
	},
	render: () => (
		<div className="flex w-150 flex-col gap-2">
			<div className="flex gap-4 border-b pb-3">
				<Skeleton className="h-4 w-30" />
				<Skeleton className="h-4 w-50" />
				<Skeleton className="h-4 w-25" />
				<Skeleton className="h-4 w-20" />
			</div>
			{Array.from({ length: 5 }).map((_, i) => (
				<div key={i} className="flex gap-4 py-2">
					<Skeleton className="h-4 w-30" />
					<Skeleton className="h-4 w-50" />
					<Skeleton className="h-4 w-25" />
					<Skeleton className="h-4 w-20" />
				</div>
			))}
		</div>
	),
};
