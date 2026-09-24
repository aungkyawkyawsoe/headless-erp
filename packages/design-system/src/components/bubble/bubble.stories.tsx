import type { Meta, StoryObj } from '@storybook/react-vite';
import { BubbleGroup, Bubble, BubbleContent, BubbleReactions } from './';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../tooltip';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../collapsible';
import { ChevronDownIcon, InfoIcon, CheckIcon } from 'lucide-react';

/**
 * Bubble displays conversational content in a message bubble.
 */
const meta: Meta<typeof Bubble> = {
	title: 'Components/Bubble',
	component: Bubble,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A chat-bubble component for messaging UIs. Supports 7 visual variants, start/end alignment, grouping via <b>BubbleGroup</b>, reactions via <b>BubbleReactions</b>, polymorphic content via the <code>render</code> prop, and composition with Collapsible, Tooltip, and Popover.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── All Variants ───────────────────────────────────────

export const AllVariants: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="mx-auto flex max-w-lg flex-col gap-6 py-8">
			{(['default', 'secondary', 'muted', 'tinted', 'outline', 'ghost', 'destructive'] as const).map((v) => (
				<div key={v} className="flex flex-col gap-1">
					<span className="mb-1 text-xs text-muted-foreground capitalize">{v}</span>
					<Bubble variant={v} align="start">
						<BubbleContent>This is the {v} bubble variant.</BubbleContent>
					</Bubble>
				</div>
			))}
		</div>
	),
};

// ── Default (primary) ─────────────────────────────────

export const Default: Story = {
	render: () => (
		<Bubble variant="default" align="end">
			<BubbleContent>Hey there! what&apos;s up?</BubbleContent>
		</Bubble>
	),
};

// ── Secondary ──────────────────────────────────────────

export const Secondary: Story = {
	render: () => (
		<Bubble variant="secondary" align="start">
			<BubbleContent>
				Hey! Want to see chat bubbles? I can group messages, switch sides, and keep the whole thread easy to scan.
			</BubbleContent>
		</Bubble>
	),
};

// ── Muted ──────────────────────────────────────────────

export const Muted: Story = {
	render: () => (
		<Bubble variant="muted" align="start">
			<BubbleContent>This one is muted. It uses a lower emphasis color for the chat bubble.</BubbleContent>
		</Bubble>
	),
};

// ── Tinted ─────────────────────────────────────────────

export const Tinted: Story = {
	render: () => (
		<Bubble variant="tinted" align="start">
			<BubbleContent>This one is tinted. The tint is a softer color derived from the primary color.</BubbleContent>
		</Bubble>
	),
};

// ── Outline ────────────────────────────────────────────

export const Outline: Story = {
	render: () => (
		<Bubble variant="outline" align="start">
			<BubbleContent>We can also use an outlined variant. It has a border and transparent background.</BubbleContent>
		</Bubble>
	),
};

// ── Ghost ──────────────────────────────────────────────

export const Ghost: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Ghost bubbles work for assistant text, markdown, and other content that should not be framed. They remove all bubble styling and can take the full width of the container.',
			},
		},
	},
	render: () => (
		<Bubble variant="ghost" align="start">
			<BubbleContent>
				Ghost bubbles are full width and can take the full width of the container. This is perfect for assistant messages that should not
				have a frame.
			</BubbleContent>
		</Bubble>
	),
};

// ── Destructive ────────────────────────────────────────

export const Destructive: Story = {
	render: () => (
		<Bubble variant="destructive" align="start">
			<BubbleContent>This message could not be delivered.</BubbleContent>
		</Bubble>
	),
};

// ── Alignment ──────────────────────────────────────────

export const Alignment: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Use `align="start"` for incoming messages (left) and `align="end"` for outgoing messages (right).',
			},
		},
	},
	render: () => (
		<div className="mx-auto w-full max-w-lg space-y-2 py-8">
			<Bubble variant="secondary" align="start">
				<BubbleContent>This bubble is aligned to the start. This is the default alignment.</BubbleContent>
			</Bubble>
			<Bubble variant="default" align="end">
				<BubbleContent>This bubble is aligned to the end. Use this for user messages.</BubbleContent>
			</Bubble>
		</div>
	),
};

// ── Bubble Group ───────────────────────────────────────

export const Grouped: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'Use `BubbleGroup` to group consecutive bubbles from the same sender. The `align` prop should be on each `Bubble`, not the group.',
			},
		},
	},
	render: () => (
		<BubbleGroup className="mx-auto w-full max-w-lg py-8">
			<Bubble variant="secondary" align="start">
				<BubbleContent>Can you tell me what&apos;s the issue?</BubbleContent>
			</Bubble>
			<Bubble variant="secondary" align="start">
				<BubbleContent>You tell me! It worked yesterday. You broke it!</BubbleContent>
			</Bubble>
			<Bubble variant="secondary" align="start">
				<BubbleContent>
					Find the bug and fix it.{' '}
					<span role="img" aria-label="eyes">
						👀
					</span>
				</BubbleContent>
			</Bubble>
			<Bubble variant="default" align="end">
				<BubbleContent>Want me to diff yesterday&apos;s you against today&apos;s you? It&apos;s a bit embarrassing.</BubbleContent>
			</Bubble>
		</BubbleGroup>
	),
};

// ── Links and Buttons ─────────────────────────────────

export const LinksAndButtons: Story = {
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story: 'Use the `render` prop on `BubbleContent` to turn a bubble into a clickable link or button.',
			},
		},
	},
	render: () => (
		<Bubble variant="secondary" align="start" className="max-w-sm">
			<BubbleContent>How can I help you today?</BubbleContent>
			<div className="flex flex-col gap-1.5 px-1 pt-1">
				<Bubble variant="muted" align="start">
					<BubbleContent render={<button type="button" />}>I forgot my password</BubbleContent>
				</Bubble>
				<Bubble variant="muted" align="start">
					<BubbleContent render={<button type="button" />}>I need help with my subscription</BubbleContent>
				</Bubble>
				<Bubble variant="muted" align="start">
					<BubbleContent render={<button type="button" />}>Something else. Talk to a human.</BubbleContent>
				</Bubble>
			</div>
		</Bubble>
	),
};

// ── Reactions ──────────────────────────────────────────

export const WithReactions: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					"Use `BubbleReactions` for reactions anchored to the bubble edge. Configure `side` (top/bottom) and `align` (start/end). Leave vertical space between rows so reactions don't overlap.",
			},
		},
	},
	render: () => (
		<BubbleGroup className="mx-auto w-full max-w-lg gap-6 py-8">
			<Bubble variant="secondary" align="start">
				<BubbleContent>I don&apos;t need tests, I know my code works.</BubbleContent>
				<BubbleReactions side="bottom" align="end" role="img" aria-label="Reactions: thumbs up, surprised">
					<span>👍</span>
					<span>😮</span>
				</BubbleReactions>
			</Bubble>

			<Bubble variant="default" align="end">
				<BubbleContent>Bold. Fine I&apos;ll add some tests. I&apos;ll let you know when they&apos;re done.</BubbleContent>
				<BubbleReactions side="bottom" align="end" role="img" aria-label="Reactions: eyes, rocket, and 2 more">
					<span>👀</span>
					<span>🚀</span>
					<span>+2</span>
				</BubbleReactions>
			</Bubble>

			<Bubble variant="secondary" align="start">
				<BubbleContent>Tests passed on the first try. All 142 of them. Looking good!</BubbleContent>
				<BubbleReactions side="bottom" align="end" role="img" aria-label="Reactions: party popper, clap">
					<span>🎉</span>
					<span>👏</span>
				</BubbleReactions>
			</Bubble>

			<Bubble variant="secondary" align="start">
				<BubbleContent>Are you sure I can run this command?</BubbleContent>
				<BubbleReactions side="bottom" align="end" role="img" aria-label="Reactions: thumbs up">
					<BubbleContent render={<button type="button" />} className="rounded-full bg-transparent! px-1.5 py-0.5! text-sm!">
						Yes, run it
					</BubbleContent>
				</BubbleReactions>
			</Bubble>
		</BubbleGroup>
	),
};

// ── Show More / Collapsible ────────────────────────────

export const ShowMore: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Compose `Bubble` with `Collapsible` for a show-more interaction on long content.',
			},
		},
	},
	render: () => (
		<div className="mx-auto max-w-lg py-8">
			<Bubble variant="secondary" align="start">
				<BubbleContent>How can I help you today?</BubbleContent>
			</Bubble>
			<Bubble variant="default" align="end" className="mt-2">
				<Collapsible>
					<BubbleContent>
						The accessibility review found two focus states that were visually too subtle in dark mode. I checked the dialog, menu, and
						drawer paths because each one renders focusable control...
					</BubbleContent>
					<CollapsibleTrigger className="flex cursor-pointer items-center gap-1 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
						Show more
						<ChevronDownIcon className="size-3.5 transition-transform group-data-open/collapsible-trigger:rotate-180" />
					</CollapsibleTrigger>
					<CollapsibleContent className="px-3 pb-2 text-sm text-muted-foreground data-open:animate-in data-open:fade-in data-open:slide-in-from-top-1">
						<p>
							After reviewing the codebase, I found that the focus ring contrast ratio was below 3:1 in dark mode across dialog overlays,
							menu items, and drawer close buttons. The fix involves updating the focus ring color in dark mode to use a higher contrast
							value.
						</p>
					</CollapsibleContent>
				</Collapsible>
			</Bubble>
		</div>
	),
};

// ── Tooltip ────────────────────────────────────────────

export const WithTooltip: Story = {
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story: 'Wrap a bubble in a `Tooltip` to reveal metadata on hover, such as when a message was read.',
			},
		},
	},
	render: () => (
		<TooltipProvider>
			<BubbleGroup className="w-full max-w-lg gap-4">
				<Bubble variant="secondary" align="start">
					<Tooltip>
						<TooltipTrigger>
							<BubbleContent>Did you remove the stale route?</BubbleContent>
						</TooltipTrigger>
						<TooltipContent side="top">Seen 2 min ago</TooltipContent>
					</Tooltip>
				</Bubble>

				<Bubble variant="default" align="end">
					<Tooltip>
						<TooltipTrigger>
							<BubbleContent>
								Yes, removed it from the registry.
								<CheckIcon className="ml-1 inline size-3.5 text-primary" />
							</BubbleContent>
						</TooltipTrigger>
						<TooltipContent side="top">Sent just now</TooltipContent>
					</Tooltip>
				</Bubble>
			</BubbleGroup>
		</TooltipProvider>
	),
};

// ── Popover ────────────────────────────────────────────

export const WithPopover: Story = {
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story: 'Pair a bubble with a Popover to surface more information on demand, such as the full error message.',
			},
		},
	},
	render: () => (
		<BubbleGroup className="w-full max-w-lg gap-4">
			<Bubble variant="secondary" align="start">
				<BubbleContent>Run the build script.</BubbleContent>
			</Bubble>
			<Bubble variant="destructive" align="end">
				<BubbleContent>
					Failed to run the command.
					<button
						type="button"
						className="ml-1 inline-flex cursor-pointer items-center gap-1 text-xs underline underline-offset-2 hover:no-underline"
						onClick={() => alert("Error details:\n\nExit code: 1\nCommand: npm run build\nError: Module not found: 'cmdk'")}
					>
						<InfoIcon className="size-3" />
						Details
					</button>
				</BubbleContent>
			</Bubble>
		</BubbleGroup>
	),
};
