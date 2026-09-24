import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter } from './';
import { Button } from '../button';
import { EllipsisVerticalIcon, HeartIcon, Share2Icon } from 'lucide-react';

/**
 * Card groups related content into a contained visual panel.
 *
 * Composed of `Card` (container with `size`: default/sm), `CardHeader`,
 * `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, and
 * `CardFooter`. Automatically adjusts spacing via the `size` prop.
 */
const meta: Meta<typeof Card> = {
	title: 'Components/Card',
	component: Card,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A versatile content container with header, body, and footer sections. The `size` prop (default/sm) controls internal spacing. `CardAction` slots into the header for secondary controls.',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		size: {
			control: 'select',
			description: 'Spacing density preset',
			options: ['default', 'sm'],
			table: {
				type: { summary: 'string' },
				defaultValue: { summary: 'default' },
			},
		},
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Gallery: All Variations ─────────────────────────────

export const AllVariations: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="mx-auto flex max-w-md flex-col gap-6 py-8">
			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Default</h3>
				<Card>
					<CardHeader>
						<CardTitle>Getting Started</CardTitle>
						<CardDescription>Learn how to set up and configure the design system in your project.</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-sm text-muted-foreground">Install the package, import the CSS, and wrap your app in the ThemeProvider.</p>
					</CardContent>
					<CardFooter>
						<Button size="sm">Read Docs</Button>
						<Button variant="ghost" size="sm">
							Dismiss
						</Button>
					</CardFooter>
				</Card>
			</section>

			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Small</h3>
				<Card size="sm">
					<CardHeader>
						<CardTitle>Quick Tip</CardTitle>
						<CardDescription>
							Use <code className="rounded bg-muted px-1">size="sm"</code> for denser layouts.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-xs text-muted-foreground">Compact cards are great for sidebars and dashboards where space is tight.</p>
					</CardContent>
				</Card>
			</section>

			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">With Action</h3>
				<Card>
					<CardHeader>
						<CardTitle>Notifications</CardTitle>
						<CardDescription>Manage your notification preferences.</CardDescription>
						<CardAction>
							<Button variant="ghost" size="icon-xs" aria-label="More options">
								<EllipsisVerticalIcon />
							</Button>
						</CardAction>
					</CardHeader>
					<CardContent>
						<p className="text-sm text-muted-foreground">You have 3 unread notifications from your team.</p>
					</CardContent>
				</Card>
			</section>
		</div>
	),
};

// ── Default ─────────────────────────────────────────────

export const Default: Story = {
	render: () => (
		<Card className="w-80">
			<CardHeader>
				<CardTitle>Card Title</CardTitle>
				<CardDescription>A short description of the card content.</CardDescription>
			</CardHeader>
			<CardContent>
				<p className="text-sm text-muted-foreground">
					This is the main content area of the card. It can contain text, images, or any React elements.
				</p>
			</CardContent>
			<CardFooter>
				<Button size="sm">Action</Button>
			</CardFooter>
		</Card>
	),
};

// ── Small ────────────────────────────────────────────────

export const Small: Story = {
	parameters: {
		docs: {
			description: {
				story: 'The `sm` size reduces internal padding for compact layouts — ideal for sidebars, metrics, or dense dashboards.',
			},
		},
	},
	render: () => (
		<Card size="sm" className="w-72">
			<CardHeader>
				<CardTitle>Usage</CardTitle>
				<CardDescription>API calls this month</CardDescription>
			</CardHeader>
			<CardContent>
				<p className="text-2xl font-semibold">12,483</p>
				<p className="mt-1 text-xs text-muted-foreground">+8.2% from last month</p>
			</CardContent>
		</Card>
	),
};

// ── With Action ─────────────────────────────────────────

export const WithAction: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Place `CardAction` inside `CardHeader` for a secondary action button, such as a menu, dismiss, or settings trigger.',
			},
		},
	},
	render: () => (
		<Card className="w-80">
			<CardHeader>
				<CardTitle>Project Settings</CardTitle>
				<CardDescription>Configure your project preferences.</CardDescription>
				<CardAction>
					<Button variant="ghost" size="icon-xs" aria-label="Settings">
						<EllipsisVerticalIcon />
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent>
				<p className="text-sm text-muted-foreground">Adjust team permissions, notification rules, and integration settings.</p>
			</CardContent>
		</Card>
	),
};

// ── With Footer Actions ────────────────────────────────

export const WithFooterActions: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Use `CardFooter` for primary and secondary actions like buttons or links.',
			},
		},
	},
	render: () => (
		<div className="flex gap-4">
			<Card className="w-64">
				<CardHeader>
					<CardTitle>Share</CardTitle>
					<CardDescription>Share this document with your team.</CardDescription>
				</CardHeader>
				<CardContent className="flex gap-2">
					<Button variant="outline" size="icon" aria-label="Like">
						<HeartIcon />
					</Button>
					<Button variant="outline" size="icon" aria-label="Share">
						<Share2Icon />
					</Button>
				</CardContent>
				<CardFooter>
					<Button size="sm" className="w-full">
						Share Link
					</Button>
				</CardFooter>
			</Card>

			<Card className="w-64">
				<CardHeader>
					<CardTitle>Delete Project</CardTitle>
					<CardDescription>This action cannot be undone.</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">Are you sure you want to permanently delete this project and all of its data?</p>
				</CardContent>
				<CardFooter>
					<Button variant="destructive" size="sm">
						Delete
					</Button>
					<Button variant="ghost" size="sm" className="ml-auto">
						Cancel
					</Button>
				</CardFooter>
			</Card>
		</div>
	),
};
