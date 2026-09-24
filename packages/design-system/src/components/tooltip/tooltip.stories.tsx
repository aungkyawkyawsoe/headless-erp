import type { Meta, StoryObj } from '@storybook/react-vite';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './';
import { Button } from '../button';
import { InfoIcon, HelpCircleIcon, SettingsIcon } from 'lucide-react';

/**
 * Tooltip displays contextual information on hover or focus.
 *
 * Provides accessible tooltips with arrow support, positioning,
 * and customizable open delay.
 *
 * Compose with `TooltipProvider` (optional, for shared delay config),
 * `Tooltip` (root), `TooltipTrigger` (the element that opens the tooltip),
 * and `TooltipContent` (the popup with arrow).
 */
const meta: Meta<typeof Tooltip> = {
	title: 'Components/Tooltip',
	component: Tooltip,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A popup that displays additional information when users hover over or focus an element. Supports four side positions (top/bottom/left/right), alignment control, and customizable open delay. Wrapping multiple tooltips in a `TooltipProvider` lets you share a common delay value.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Sample content ─────────────────────────────────────────

const DEMO_TEXT = 'Add a description to help your team understand this field.';

// ── Gallery: All Positions ────────────────────────────────

export const AllPositions: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<TooltipProvider>
			<div className="flex flex-wrap items-center justify-center gap-8 py-16">
				<Tooltip>
					<TooltipTrigger>
						<Button variant="outline">Top</Button>
					</TooltipTrigger>
					<TooltipContent side="top" align="center">
						{DEMO_TEXT}
					</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger>
						<Button variant="outline">Bottom</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom" align="center">
						{DEMO_TEXT}
					</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger>
						<Button variant="outline">Left</Button>
					</TooltipTrigger>
					<TooltipContent side="left" align="center">
						{DEMO_TEXT}
					</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger>
						<Button variant="outline">Right</Button>
					</TooltipTrigger>
					<TooltipContent side="right" align="center">
						{DEMO_TEXT}
					</TooltipContent>
				</Tooltip>
			</div>
		</TooltipProvider>
	),
};

// ── Default ───────────────────────────────────────────────

export const Default: Story = {
	render: () => (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger>
					<Button>Hover me</Button>
				</TooltipTrigger>
				<TooltipContent side="top">This is a default tooltip</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	),
};

// ── With Icons ───────────────────────────────────────────

export const WithIcons: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use icon buttons as tooltip triggers to provide context for icon-only controls.',
			},
		},
	},
	render: () => (
		<TooltipProvider>
			<div className="flex items-center gap-2">
				<Tooltip>
					<TooltipTrigger>
						<Button variant="ghost" size="icon" aria-label="Info">
							<InfoIcon />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">View details about this item</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger>
						<Button variant="ghost" size="icon" aria-label="Help">
							<HelpCircleIcon />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">Get help with this section</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger>
						<Button variant="ghost" size="icon" aria-label="Settings">
							<SettingsIcon />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">Configure your preferences</TooltipContent>
				</Tooltip>
			</div>
		</TooltipProvider>
	),
};

// ── Custom Delay ──────────────────────────────────────────

export const CustomDelay: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Set a custom `delay` on `TooltipProvider` to control how long (in ms) the tooltip waits before appearing. A delay of 0 shows instantly on hover.',
			},
		},
	},
	render: () => (
		<div className="flex flex-col items-center gap-6">
			<section className="text-center">
				<p className="mb-2 text-sm text-muted-foreground">Instant (delay=0)</p>
				<TooltipProvider delay={0}>
					<Tooltip>
						<TooltipTrigger>
							<Button variant="outline" size="sm">
								Instant
							</Button>
						</TooltipTrigger>
						<TooltipContent side="top">Appears immediately on hover</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			</section>

			<section className="text-center">
				<p className="mb-2 text-sm text-muted-foreground">Slow (delay=1000)</p>
				<TooltipProvider delay={1000}>
					<Tooltip>
						<TooltipTrigger>
							<Button variant="outline" size="sm">
								Slow
							</Button>
						</TooltipTrigger>
						<TooltipContent side="top">Waits 1 second before appearing</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			</section>
		</div>
	),
};

// ── Alignment ────────────────────────────────────────────

export const Alignment: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'Use the `align` prop on `TooltipContent` to control horizontal alignment relative to the trigger. Options are `start`, `center` (default), and `end`.',
			},
		},
	},
	render: () => (
		<TooltipProvider>
			<div className="flex flex-col items-center gap-4 py-12">
				<Tooltip>
					<TooltipTrigger>
						<Button variant="outline" className="w-40">
							Align Start
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top" align="start">
						Aligned to the start
					</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger>
						<Button variant="outline" className="w-40">
							Align Center
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top" align="center">
						Aligned to center
					</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger>
						<Button variant="outline" className="w-40">
							Align End
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top" align="end">
						Aligned to the end
					</TooltipContent>
				</Tooltip>
			</div>
		</TooltipProvider>
	),
};
