import type { Meta, StoryObj } from '@storybook/react-vite';
import { HoverCard, HoverCardTrigger, HoverCardContent } from './';
import { Button } from '../button';

/**
 * Hover Card displays rich content in a popup when users hover
 * over a trigger element.
 *
 * Provides accessible hover interactions with configurable delay,
 * positioning (top/bottom/left/right), and alignment control.
 */
const meta: Meta<typeof HoverCard> = {
	title: 'Components/HoverCard',
	component: HoverCard,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A popup card that appears when hovering over a trigger element. Supports four side positions (top/bottom/left/right), alignment (start/center/end), and configurable open/close delays via the trigger.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Shared Card Content ──────────────────────────────────

function UserInfoCard() {
	return (
		<div className="flex gap-3">
			<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
				CN
			</div>
			<div className="flex flex-col gap-1">
				<p className="text-sm leading-none font-medium">@nextjs</p>
				<p className="text-xs leading-normal text-muted-foreground">The React Framework</p>
			</div>
		</div>
	);
}

// ── Basic ────────────────────────────────────────────────

export const Basic: Story = {
	render: () => (
		<HoverCard>
			<HoverCardTrigger>
				<Button variant="outline">Hover Here</Button>
			</HoverCardTrigger>
			<HoverCardContent side="bottom" align="center">
				<UserInfoCard />
			</HoverCardContent>
		</HoverCard>
	),
	parameters: {
		docs: {
			description: {
				story:
					'Hover or focus the trigger to reveal a card with user info. The card shows an avatar fallback with initials (CN), a username (@nextjs), and a short description.',
			},
		},
	},
};

// ── Sides ────────────────────────────────────────────────

export const Sides: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'Use the `side` prop to control which side the hover card appears on. Available options are `top`, `bottom` (default), `left`, and `right`.',
			},
		},
	},
	render: () => (
		<div className="flex flex-wrap items-center justify-center gap-16 py-24">
			<HoverCard>
				<HoverCardTrigger>
					<Button variant="outline">Left</Button>
				</HoverCardTrigger>
				<HoverCardContent side="left" align="center">
					<UserInfoCard />
				</HoverCardContent>
			</HoverCard>

			<HoverCard>
				<HoverCardTrigger>
					<Button variant="outline">Top</Button>
				</HoverCardTrigger>
				<HoverCardContent side="top" align="center">
					<UserInfoCard />
				</HoverCardContent>
			</HoverCard>

			<HoverCard>
				<HoverCardTrigger>
					<Button variant="outline">Bottom</Button>
				</HoverCardTrigger>
				<HoverCardContent side="bottom" align="center">
					<UserInfoCard />
				</HoverCardContent>
			</HoverCard>

			<HoverCard>
				<HoverCardTrigger>
					<Button variant="outline">Right</Button>
				</HoverCardTrigger>
				<HoverCardContent side="right" align="center">
					<UserInfoCard />
				</HoverCardContent>
			</HoverCard>
		</div>
	),
};
