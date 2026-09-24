import type { Meta, StoryObj } from '@storybook/react-vite';
import { Spinner } from './';
import { Button } from '../button';
import { Badge } from '../badge';

/**
 * An indicator that can be used to show a loading state.
 */
const meta: Meta<typeof Spinner> = {
	title: 'Components/Spinner',
	component: Spinner,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A spinner component for showing a loading state. Use the `size-*` utility class to change the size. Use `variant="ios"` for an iOS-style segmented spinner. Can be used inside buttons, badges, and other components.',
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
				story: 'A basic spinner with the default size.',
			},
		},
	},
	render: () => <Spinner />,
};

// ── Size ─────────────────────────────────────────────────

export const Size: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use the `size-*` utility class to change the size of the spinner.',
			},
		},
	},
	render: () => (
		<div className="flex items-center gap-4">
			<Spinner className="size-4" />
			<Spinner className="size-5" />
			<Spinner className="size-6" />
			<Spinner className="size-8" />
			<Spinner className="size-10" />
		</div>
	),
};

// ── iOS ──────────────────────────────────────────────────

export const IOS: Story = {
	name: 'iOS',
	parameters: {
		docs: {
			description: {
				story:
					'Use `variant="ios"` for an iOS-style spinner — a ring of segments with a fading trail, like the classic `UIActivityIndicatorView`. Inherits the current text color and scales with `size-*` utilities.',
			},
		},
	},
	render: () => (
		<div className="flex flex-col items-center gap-6">
			<div className="flex items-center gap-4">
				<Spinner variant="ios" />
				<Spinner variant="ios" className="size-5" />
				<Spinner variant="ios" className="size-6" />
				<Spinner variant="ios" className="size-8" />
				<Spinner variant="ios" className="size-10" />
			</div>
			<div className="flex flex-wrap items-center justify-center gap-4">
				<Button disabled>
					<Spinner variant="ios" data-icon="inline-start" />
					Loading...
				</Button>
				<Badge variant="secondary">
					<Spinner variant="ios" data-icon="inline-start" />
					Syncing
				</Badge>
			</div>
		</div>
	),
};

// ── Button ───────────────────────────────────────────────

export const ButtonSpinner: Story = {
	name: 'Button',
	parameters: {
		docs: {
			description: {
				story:
					'Add a spinner to a button to indicate a loading state. Place the `<Spinner />` before the label with `data-icon="inline-start"` for a start position, or after the label with `data-icon="inline-end"` for an end position. Use `variant="ios"` for an iOS-style spinner.',
			},
		},
	},
	render: () => (
		<div className="flex flex-wrap items-center gap-4">
			<Button disabled>
				<Spinner data-icon="inline-start" />
				Loading...
			</Button>
			<Button disabled variant="secondary">
				<Spinner data-icon="inline-start" />
				Please wait
			</Button>
			<Button disabled>
				Processing
				<Spinner data-icon="inline-end" />
			</Button>
			<Button disabled variant="outline">
				<Spinner variant="ios" data-icon="inline-start" />
				Loading...
			</Button>
			<Button disabled>
				Syncing
				<Spinner variant="ios" data-icon="inline-end" />
			</Button>
		</div>
	),
};

// ── Badge ────────────────────────────────────────────────

export const BadgeSpinner: Story = {
	name: 'Badge',
	parameters: {
		docs: {
			description: {
				story:
					'Add a spinner to a badge to indicate a loading state. Place the `<Spinner />` before the label with `data-icon="inline-start"` for a start position, or after the label with `data-icon="inline-end"` for an end position. Use `variant="ios"` for an iOS-style spinner.',
			},
		},
	},
	render: () => (
		<div className="flex flex-wrap items-center gap-4">
			<Badge>
				<Spinner data-icon="inline-start" />
				Syncing
			</Badge>
			<Badge variant="secondary">
				<Spinner data-icon="inline-start" />
				Updating
			</Badge>
			<Badge variant="outline">
				Processing
				<Spinner data-icon="inline-end" />
			</Badge>
			<Badge variant="outline">
				<Spinner variant="ios" data-icon="inline-start" />
				Syncing
			</Badge>
			<Badge variant="secondary">
				Updating
				<Spinner variant="ios" className="size-3" data-icon="inline-end" />
			</Badge>
		</div>
	),
};
