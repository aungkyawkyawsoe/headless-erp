import type { Meta, StoryObj } from '@storybook/react-vite';
import { ButtonGroup, ButtonGroupText, ButtonGroupSeparator } from './';
import { Button } from '../button';
import {
	BoldIcon,
	ItalicIcon,
	UnderlineIcon,
	AlignLeftIcon,
	AlignCenterIcon,
	AlignRightIcon,
	ChevronDownIcon,
	EyeIcon,
	EyeOffIcon,
} from 'lucide-react';

/**
 * ButtonGroup groups related buttons edge-to-edge with merged corners.
 *
 * Supports `horizontal` (default) and `vertical` orientations. Includes
 * `ButtonGroupText` for non-interactive labels and `ButtonGroupSeparator`
 * for visual dividers.
 */
const meta: Meta<typeof ButtonGroup> = {
	title: 'Components/Button Group',
	component: ButtonGroup,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A segmented button group that merges adjacent buttons into a single visual cluster. Use `ButtonGroupText` for static labels and `ButtonGroupSeparator` for dividers between sections.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Gallery: All Variations ─────────────────────────────

export const AllVariations: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="mx-auto flex max-w-xl flex-col gap-8 py-8">
			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Horizontal</h3>
				<ButtonGroup orientation="horizontal">
					<Button variant="outline">Left</Button>
					<Button variant="outline">Center</Button>
					<Button variant="outline">Right</Button>
				</ButtonGroup>
			</section>

			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Vertical</h3>
				<ButtonGroup orientation="vertical">
					<Button variant="outline">Top</Button>
					<Button variant="outline">Middle</Button>
					<Button variant="outline">Bottom</Button>
				</ButtonGroup>
			</section>

			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">With Text Label</h3>
				<ButtonGroup orientation="horizontal">
					<ButtonGroupText>View</ButtonGroupText>
					<Button variant="outline" size="icon" aria-label="Show">
						<EyeIcon />
					</Button>
					<Button variant="outline" size="icon" aria-label="Hide">
						<EyeOffIcon />
					</Button>
				</ButtonGroup>
			</section>

			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">With Separator</h3>
				<ButtonGroup orientation="horizontal">
					<Button variant="outline" size="icon" aria-label="Bold">
						<BoldIcon />
					</Button>
					<Button variant="outline" size="icon" aria-label="Italic">
						<ItalicIcon />
					</Button>
					<Button variant="outline" size="icon" aria-label="Underline">
						<UnderlineIcon />
					</Button>
					<ButtonGroupSeparator orientation="horizontal" />
					<Button variant="outline" size="icon" aria-label="Align left">
						<AlignLeftIcon />
					</Button>
					<Button variant="outline" size="icon" aria-label="Align center">
						<AlignCenterIcon />
					</Button>
					<Button variant="outline" size="icon" aria-label="Align right">
						<AlignRightIcon />
					</Button>
				</ButtonGroup>
			</section>
		</div>
	),
};

// ── Default ─────────────────────────────────────────────

export const Default: Story = {
	render: () => (
		<ButtonGroup>
			<Button variant="outline">One</Button>
			<Button variant="outline">Two</Button>
			<Button variant="outline">Three</Button>
		</ButtonGroup>
	),
};

// ── With Icons ─────────────────────────────────────────

export const WithIcons: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Icon-only button groups are common for formatting toolbars or view toggles.',
			},
		},
	},
	render: () => (
		<ButtonGroup>
			<Button variant="outline" size="icon" aria-label="Bold">
				<BoldIcon />
			</Button>
			<Button variant="outline" size="icon" aria-label="Italic">
				<ItalicIcon />
			</Button>
			<Button variant="outline" size="icon" aria-label="Underline">
				<UnderlineIcon />
			</Button>
		</ButtonGroup>
	),
};

// ── Vertical ───────────────────────────────────────────

export const Vertical: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `orientation="vertical"` for a stacked button group, ideal for sidebar actions or mobile navigation.',
			},
		},
	},
	render: () => (
		<ButtonGroup orientation="vertical">
			<Button variant="outline">Save</Button>
			<Button variant="outline">Save &amp; Continue</Button>
			<Button variant="outline">Cancel</Button>
		</ButtonGroup>
	),
};

// ── With Separator ──────────────────────────────────────

export const WithSeparator: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `ButtonGroupSeparator` to visually divide a button group into logical sections.',
			},
		},
	},
	render: () => (
		<div className="flex flex-col items-center gap-4">
			<ButtonGroup orientation="horizontal">
				<Button variant="outline" size="icon" aria-label="Align left">
					<AlignLeftIcon />
				</Button>
				<Button variant="outline" size="icon" aria-label="Align center">
					<AlignCenterIcon />
				</Button>
				<Button variant="outline" size="icon" aria-label="Align right">
					<AlignRightIcon />
				</Button>
				<ButtonGroupSeparator orientation="horizontal" />
				<Button variant="outline" size="icon" aria-label="More options">
					<ChevronDownIcon />
				</Button>
			</ButtonGroup>

			<ButtonGroup orientation="vertical">
				<Button variant="outline" size="sm">
					Cut
				</Button>
				<Button variant="outline" size="sm">
					Copy
				</Button>
				<Button variant="outline" size="sm">
					Paste
				</Button>
				<ButtonGroupSeparator orientation="vertical" />
				<Button variant="outline" size="sm">
					Delete
				</Button>
			</ButtonGroup>
		</div>
	),
};

// ── With Text ──────────────────────────────────────────

export const WithText: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use `ButtonGroupText` to add a non-interactive label inside the group, such as a view toggle label or a dropdown placeholder.',
			},
		},
	},
	render: () => (
		<ButtonGroup>
			<ButtonGroupText>View</ButtonGroupText>
			<Button variant="outline" size="icon" aria-label="Show">
				<EyeIcon />
			</Button>
			<Button variant="outline" size="icon" aria-label="Hide">
				<EyeOffIcon />
			</Button>
		</ButtonGroup>
	),
};
