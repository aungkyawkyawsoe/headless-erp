import type { Meta, StoryObj } from '@storybook/react-vite';
import { Alert, AlertTitle, AlertDescription, AlertAction } from './';
import { Frame, FramePanel } from '../frame';
import { Button } from '../button';
import { Avatar, AvatarFallback, AvatarImage } from '../avatar';
import { CircleAlertIcon, CircleCheckIcon, AlertTriangleIcon, ShieldCheckIcon, LightbulbIcon, XIcon, Info, Terminal } from 'lucide-react';

type AlertArgs = {
	variant: 'default' | 'destructive' | 'info' | 'success' | 'warning' | 'invert';
	title: string;
	description: string;
	showIcon: boolean;
	showAction: boolean;
};

/**
 * Alert displays brief, important messages that require user
 * attention without interrupting the current task.
 *
 * Composed of `Alert` (container), `AlertTitle`, `AlertDescription`,
 * and `AlertAction`. Supports `default`, `destructive`, `info`,
 * `success`, `warning`, and `invert` variants.
 */
const meta: Meta<AlertArgs> = {
	title: 'Components/Alert',
	component: Alert,
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				component:
					'A container for feedback messages. Best paired with an icon (via `lucide-react`) and optional action. Six variants: `default` (informational), `destructive` (errors/warnings), `info`, `success`, `warning`, and `invert` (inverted surface).',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		variant: {
			control: 'select',
			description: 'Visual style variant',
			options: ['default', 'destructive', 'info', 'success', 'warning', 'invert'],
			table: { defaultValue: { summary: 'default' } },
		},
		title: {
			control: 'text',
			description: 'Alert title text',
			table: { category: 'Content' },
		},
		description: {
			control: 'text',
			description: 'Alert description text',
			table: { category: 'Content' },
		},
		showIcon: {
			control: 'boolean',
			description: 'Show an icon before the title',
			table: { category: 'Content' },
		},
		showAction: {
			control: 'boolean',
			description: 'Show a dismiss / action button',
			table: { category: 'Action' },
		},
	},
	args: {
		variant: 'default',
		title: 'Heads up!',
		description: "This is an informational message to draw the user's attention.",
		showIcon: true,
		showAction: false,
	},
	render: (args) => (
		<Alert variant={args.variant}>
			{args.showIcon && <Info className="size-4" />}
			<AlertTitle>{args.title}</AlertTitle>
			<AlertDescription>{args.description}</AlertDescription>
			{args.showAction && (
				<AlertAction>
					<Button variant="ghost" size="icon-xs" aria-label="Dismiss">
						<XIcon />
					</Button>
				</AlertAction>
			)}
		</Alert>
	),
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Gallery: All variants ──────────────────────────────

export const AllVariants: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="mx-auto flex max-w-lg flex-col gap-6">
			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Default</h3>
				<Alert>
					<Info className="size-4" />
					<AlertTitle>Informational message</AlertTitle>
					<AlertDescription>A default alert with an icon and description text.</AlertDescription>
				</Alert>
			</section>

			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Destructive</h3>
				<Alert variant="destructive">
					<CircleAlertIcon />
					<AlertTitle>Something went wrong</AlertTitle>
					<AlertDescription>A destructive alert for error or warning scenarios.</AlertDescription>
				</Alert>
			</section>

			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Info</h3>
				<Alert variant="info">
					<CircleAlertIcon />
					<AlertTitle>Something important</AlertTitle>
					<AlertDescription>An informational alert for neutral, important notices.</AlertDescription>
				</Alert>
			</section>

			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Success</h3>
				<Alert variant="success">
					<CircleCheckIcon />
					<AlertTitle>Everything is working</AlertTitle>
					<AlertDescription>A success alert for positive confirmations.</AlertDescription>
				</Alert>
			</section>

			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Warning</h3>
				<Alert variant="warning">
					<AlertTriangleIcon />
					<AlertTitle>Something needs attention</AlertTitle>
					<AlertDescription>A warning alert for cautionary messages.</AlertDescription>
				</Alert>
			</section>

			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Invert</h3>
				<Alert variant="invert">
					<CircleAlertIcon />
					<AlertTitle>Inverted surface</AlertTitle>
					<AlertDescription>An invert alert on a dark (or inverted) surface.</AlertDescription>
				</Alert>
			</section>
		</div>
	),
};

// ── Variant patterns ───────────────────────────────────

export const Destructive: Story = {
	render: () => (
		<Alert variant="destructive">
			<CircleAlertIcon />
			<AlertTitle>Payment Failed</AlertTitle>
			<AlertDescription>
				<p>Please check your payment details:</p>
				<ul className="mt-1 list-inside list-disc space-y-0.5 text-sm">
					<li>Card number and expiry</li>
					<li>Billing address</li>
					<li>Available funds</li>
				</ul>
			</AlertDescription>
		</Alert>
	),
};

export const InfoAlert: Story = {
	name: 'Info',
	render: () => (
		<Alert variant="info">
			<CircleAlertIcon />
			<AlertTitle>Info! Something important</AlertTitle>
			<AlertDescription>This is an important message. Please read it carefully.</AlertDescription>
		</Alert>
	),
};

export const Success: Story = {
	render: () => (
		<Alert variant="success">
			<CircleCheckIcon />
			<AlertTitle>Success! All good</AlertTitle>
			<AlertDescription>Everything is working as expected. You can continue with your task.</AlertDescription>
		</Alert>
	),
};

export const Warning: Story = {
	render: () => (
		<Alert variant="warning">
			<AlertTriangleIcon />
			<AlertTitle>Warning! Something is wrong</AlertTitle>
			<AlertDescription>Please check your settings. If the problem persists, contact support.</AlertDescription>
		</Alert>
	),
};

export const Invert: Story = {
	render: () => (
		<Alert variant="invert">
			<CircleAlertIcon className="text-success" />
			<AlertTitle>Notification! All good</AlertTitle>
			<AlertDescription>This is a notification alert with a title and description.</AlertDescription>
		</Alert>
	),
};

// ── With action buttons ────────────────────────────────

export const WithActionButtons: Story = {
	render: () => (
		<Alert>
			<ShieldCheckIcon />
			<AlertTitle>Update your password and enable 2FA.</AlertTitle>
			<AlertAction>
				<Button variant="outline" size="xs">
					Dismiss
				</Button>
				<Button size="xs">Update</Button>
			</AlertAction>
		</Alert>
	),
};

// ── Inside a Frame ─────────────────────────────────────

export const InFrame: Story = {
	name: 'In a Frame',
	render: () => (
		<div className="mx-auto mb-auto w-full max-w-lg">
			<Frame variant="ghost">
				<FramePanel className="overflow-hidden p-0!">
					<Alert variant="info" className="border-0 shadow-none">
						<LightbulbIcon />
						<AlertTitle>New: Advanced Analytics</AlertTitle>
						<AlertAction>
							<Button
								size="xs"
								variant="ghost"
								className="-mt-1 -mr-2 size-7 p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
							>
								<XIcon className="size-3.5" />
							</Button>
						</AlertAction>
						<AlertDescription>
							We&apos;ve just released a new dashboard for tracking your team&apos;s performance.
							<Button variant="link" size="sm" className="h-auto p-0 text-info underline">
								Explore features
							</Button>
						</AlertDescription>
					</Alert>
				</FramePanel>
			</Frame>
		</div>
	),
};

// ── Notification patterns ──────────────────────────────

export const Notification: Story = {
	render: () => (
		<div className="mx-auto mb-auto w-full max-w-lg">
			<Frame>
				<FramePanel className="overflow-hidden p-0!">
					<Alert className="grid-cols-[32px_1fr] gap-x-3 border-0 shadow-none">
						<Avatar className="row-span-2 size-8 border">
							<AvatarImage src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=96&h=96&dpr=2&q=80" alt="Alex Johnson" />
							<AvatarFallback>AJ</AvatarFallback>
						</Avatar>
						<AlertTitle className="flex items-center gap-2">
							<span className="truncate">Alex Johnson</span>
							<span className="truncate font-normal text-muted-foreground">sent you a message</span>
						</AlertTitle>
						<AlertAction>
							<Button size="xs" variant="outline">
								View
							</Button>
							<Button size="xs">Reply</Button>
						</AlertAction>
						<AlertDescription className="line-clamp-1">
							&quot;Hey! I&apos;ve finished the draft for the new design system. Let me know what you think when you have a moment.&quot;
						</AlertDescription>
					</Alert>
				</FramePanel>
			</Frame>
		</div>
	),
};

export const NotificationInvert: Story = {
	name: 'Notification (Invert)',
	render: () => (
		<div className="mx-auto mb-auto w-full max-w-lg">
			<Frame>
				<FramePanel className="overflow-hidden p-0!">
					<Alert variant="invert" className="grid-cols-[32px_1fr] gap-x-3 border-0 shadow-none">
						<Avatar className="row-span-2 size-8 border border-border/10">
							<AvatarImage src="https://images.unsplash.com/photo-1519699047748-de8e457a634e?w=96&h=96&dpr=2&q=80" alt="Sarah Chen" />
							<AvatarFallback>SC</AvatarFallback>
						</Avatar>
						<AlertTitle className="flex items-center gap-2">
							<span className="truncate">Sarah Chen</span>
							<span className="truncate font-normal text-invert-foreground/60">mentioned you in a comment</span>
						</AlertTitle>
						<AlertAction>
							<Button variant="outline" size="xs" className="border-border/10 bg-background/10">
								Dismiss
							</Button>
							<Button size="xs" className="border-blue-800 bg-blue-500 text-white hover:border-blue-900 hover:bg-blue-600">
								View
							</Button>
						</AlertAction>
						<AlertDescription className="line-clamp-1 text-invert-foreground/70">
							&quot;Great work on the user profile layout! I&apos;ve added some suggestions for the avatar spacing.&quot;
						</AlertDescription>
					</Alert>
				</FramePanel>
			</Frame>
		</div>
	),
};

// ── Different icons ────────────────────────────────────

export const CustomIcon: Story = {
	render: () => (
		<div className="flex max-w-lg flex-col gap-4">
			<Alert>
				<Info className="size-4" />
				<AlertTitle>Information</AlertTitle>
				<AlertDescription>Use any lucide-react icon — Info, CircleAlertIcon, CircleCheckIcon, etc.</AlertDescription>
			</Alert>

			<Alert variant="destructive">
				<AlertTriangleIcon />
				<AlertTitle>Warning</AlertTitle>
				<AlertDescription>Destructive variant with a warning icon.</AlertDescription>
			</Alert>

			<Alert>
				<Terminal className="size-4" />
				<AlertTitle>Terminal</AlertTitle>
				<AlertDescription>
					<code className="rounded bg-muted px-1">npm run build</code> — Build completed successfully.
				</AlertDescription>
			</Alert>
		</div>
	),
};

// ── Args-driven stories ────────────────────────────────

export const Default: Story = {
	args: {
		title: 'Heads up!',
		description: 'Your session will expire in 10 minutes. Save your work.',
		showIcon: true,
		showAction: false,
	},
};

export const WithDismissButton: Story = {
	args: {
		title: 'Update available',
		description: 'A new version is ready. Reload to get the latest features.',
		showIcon: true,
		showAction: true,
	},
};

export const WithoutIcon: Story = {
	args: {
		title: 'Note',
		description: 'You can use alerts without an icon when space is tight.',
		showIcon: false,
	},
};
