import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './';
import { Button } from '../button';
import { Card, CardHeader, CardTitle, CardContent } from '../card';
import { Checkbox } from '../checkbox';
import { Field, FieldLabel } from '../field';
import { Input } from '../input';
import { ChevronDownIcon, ChevronRightIcon, SettingsIcon, HelpCircleIcon } from 'lucide-react';

/**
 * Collapsible toggles the visibility of content sections.
 *
 * Supports controlled and uncontrolled modes, disabled state, and
 * `keepMounted` to preserve content in the DOM while hidden.
 */
const meta: Meta<typeof Collapsible> = {
	title: 'Components/Collapsible',
	component: Collapsible,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A container that can be expanded and collapsed. Supports controlled (`open`/`onOpenChange`) and uncontrolled (`defaultOpen`) usage, disabled state, and `keepMounted` to keep hidden content in the DOM. Use `CollapsibleTrigger` for the toggle button and `CollapsibleContent` for the collapsible panel.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Gallery: All States ─────────────────────────────────

export const AllStates: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="mx-auto flex max-w-sm flex-col gap-10 py-8">
			{/* Closed (default) */}
			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Closed</h3>
				<Collapsible>
					<CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50">
						What is this design system?
						<ChevronDownIcon className="size-4 text-muted-foreground transition-transform data-open:rotate-180" />
					</CollapsibleTrigger>
					<CollapsibleContent className="mt-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground data-open:animate-in data-open:fade-in data-open:slide-in-from-top-1">
						<p>
							This is a React-based design system built with Tailwind CSS v4 and TypeScript. It provides accessible, composable components.
						</p>
					</CollapsibleContent>
				</Collapsible>
			</section>

			{/* Open by default */}
			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Open by Default</h3>
				<Collapsible defaultOpen>
					<CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50">
						How do I install it?
						<ChevronDownIcon className="size-4 text-muted-foreground transition-transform data-open:rotate-180" />
					</CollapsibleTrigger>
					<CollapsibleContent className="mt-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground data-open:animate-in data-open:fade-in data-open:slide-in-from-top-1">
						<p>
							Run <code className="rounded bg-muted px-1">pnpm add @mmbix/design-system</code> and import the components you need. Make sure
							you have React 19 and Tailwind CSS v4 set up.
						</p>
					</CollapsibleContent>
				</Collapsible>
			</section>

			{/* Disabled */}
			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Disabled</h3>
				<Collapsible disabled>
					<CollapsibleTrigger className="flex w-full cursor-not-allowed items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium opacity-50">
						Disabled section
						<ChevronDownIcon className="size-4 text-muted-foreground" />
					</CollapsibleTrigger>
					<CollapsibleContent className="mt-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground data-open:animate-in data-open:fade-in data-open:slide-in-from-top-1">
						<p>This content cannot be revealed because the collapsible is disabled.</p>
					</CollapsibleContent>
				</Collapsible>
			</section>
		</div>
	),
};

// ── Default (closed) ─────────────────────────────────────

export const Default: Story = {
	render: () => (
		<div className="w-80">
			<Collapsible>
				<CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50">
					<span>Show Details</span>
					<ChevronDownIcon className="size-4 text-muted-foreground transition-transform data-open:rotate-180" />
				</CollapsibleTrigger>
				<CollapsibleContent className="mt-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground data-open:animate-in data-open:fade-in data-open:slide-in-from-top-1">
					<p>This content is hidden by default and revealed when the trigger is clicked.</p>
				</CollapsibleContent>
			</Collapsible>
		</div>
	),
};

// ── Default Open ─────────────────────────────────────────

export const DefaultOpen: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `defaultOpen` to render the collapsible in the expanded state by default (uncontrolled).',
			},
		},
	},
	render: () => (
		<div className="w-80">
			<Collapsible defaultOpen>
				<CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50">
					<span>Configuration</span>
					<ChevronDownIcon className="size-4 text-muted-foreground transition-transform data-open:rotate-180" />
				</CollapsibleTrigger>
				<CollapsibleContent className="mt-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground data-open:animate-in data-open:fade-in data-open:slide-in-from-top-1">
					<ul className="list-disc space-y-1 pl-4">
						<li>Theme: dark</li>
						<li>Language: TypeScript</li>
						<li>Notifications: enabled</li>
					</ul>
				</CollapsibleContent>
			</Collapsible>
		</div>
	),
};

// ── Controlled ───────────────────────────────────────────

export const Controlled: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `open` and `onOpenChange` for fully controlled state. This lets an external button toggle the collapsible.',
			},
		},
	},
	render: () => {
		const [open, setOpen] = React.useState(false);

		return (
			<div className="flex w-80 flex-col items-center gap-3">
				<Button variant="outline" onClick={() => setOpen((prev) => !prev)}>
					{open ? 'Close' : 'Open'} Settings
				</Button>
				<Collapsible open={open} onOpenChange={setOpen}>
					<CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50">
						<span className="flex items-center gap-2">
							<SettingsIcon className="size-4" />
							Settings
						</span>
						<ChevronDownIcon className="size-4 text-muted-foreground transition-transform data-open:rotate-180" />
					</CollapsibleTrigger>
					<CollapsibleContent className="mt-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground data-open:animate-in data-open:fade-in data-open:slide-in-from-top-1">
						<div className="space-y-2">
							<Field orientation="horizontal">
								<Checkbox id="collapsible-notifications" defaultChecked />
								<FieldLabel htmlFor="collapsible-notifications">Enable notifications</FieldLabel>
							</Field>
							<Field orientation="horizontal">
								<Checkbox id="collapsible-dark-mode" />
								<FieldLabel htmlFor="collapsible-dark-mode">Dark mode</FieldLabel>
							</Field>
						</div>
					</CollapsibleContent>
				</Collapsible>
			</div>
		);
	},
};

// ── Disabled ─────────────────────────────────────────────

export const Disabled: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Set `disabled` on `Collapsible` to prevent interaction. The trigger becomes non-interactive and the content cannot be toggled.',
			},
		},
	},
	render: () => (
		<div className="w-80">
			<Collapsible disabled>
				<CollapsibleTrigger className="flex w-full cursor-not-allowed items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium opacity-50">
					<span className="flex items-center gap-2">
						<HelpCircleIcon className="size-4" />
						Help
					</span>
					<ChevronDownIcon className="size-4 text-muted-foreground" />
				</CollapsibleTrigger>
				<CollapsibleContent className="mt-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground data-open:animate-in data-open:fade-in data-open:slide-in-from-top-1">
					<p>This help section is currently unavailable.</p>
				</CollapsibleContent>
			</Collapsible>
		</div>
	),
};

// ── Keep Mounted ─────────────────────────────────────────

export const KeepMounted: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'`keepMounted` preserves the content in the DOM even when collapsed. Use this for animations or when the content should maintain its state (e.g., form inputs).',
			},
		},
	},
	render: () => (
		<div className="w-80">
			<Collapsible>
				<CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50">
					<span>Form (with keepMounted)</span>
					<ChevronDownIcon className="size-4 text-muted-foreground transition-transform data-open:rotate-180" />
				</CollapsibleTrigger>
				<CollapsibleContent
					keepMounted
					className="mt-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground data-open:animate-in data-open:fade-in data-open:slide-in-from-top-1"
				>
					<div className="space-y-3">
						<p>Your input is preserved in the DOM even when collapsed:</p>
						<Input placeholder="Type something..." />
					</div>
				</CollapsibleContent>
			</Collapsible>
		</div>
	),
};

// ── Nested Collapsibles ─────────────────────────────────

export const Nested: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Collapsibles can be nested within each other for hierarchical content. Each collapsible operates independently.',
			},
		},
	},
	render: () => (
		<div className="mx-auto w-80">
			<Collapsible defaultOpen>
				<CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50">
					<span>Parent Section</span>
					<ChevronDownIcon className="size-4 text-muted-foreground transition-transform data-open:rotate-180" />
				</CollapsibleTrigger>
				<CollapsibleContent className="mt-2 space-y-2 pl-4 data-open:animate-in data-open:fade-in data-open:slide-in-from-top-1">
					<p className="text-sm text-muted-foreground">This parent section contains a nested collapsible below.</p>
					<Collapsible>
						<CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted/50">
							<span>Child Section</span>
							<ChevronRightIcon className="size-4 text-muted-foreground transition-transform data-open:rotate-90" />
						</CollapsibleTrigger>
						<CollapsibleContent className="mt-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground data-open:animate-in data-open:fade-in data-open:slide-in-from-top-1">
							<p>Nested content inside a child collapsible. Each level toggles independently.</p>
						</CollapsibleContent>
					</Collapsible>
				</CollapsibleContent>
			</Collapsible>
		</div>
	),
};

// ── With Card Layout ─────────────────────────────────────

export const WithCard: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Combine `Collapsible` with `Card` for a structured panel layout with expandable content sections.',
			},
		},
	},
	render: () => (
		<Card className="w-80">
			<CardHeader>
				<CardTitle>FAQ</CardTitle>
				<p className="text-sm text-muted-foreground">Frequently asked questions about the design system.</p>
			</CardHeader>
			<CardContent className="space-y-3">
				<Collapsible>
					<CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm font-medium transition-colors hover:bg-muted">
						<span>What is this?</span>
						<ChevronDownIcon className="size-4 text-muted-foreground transition-transform data-open:rotate-180" />
					</CollapsibleTrigger>
					<CollapsibleContent className="mt-2 rounded-lg bg-muted/30 px-4 py-3 text-sm text-muted-foreground data-open:animate-in data-open:fade-in data-open:slide-in-from-top-1">
						<p>A React-based design system with accessible, composable components.</p>
					</CollapsibleContent>
				</Collapsible>

				<Collapsible>
					<CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm font-medium transition-colors hover:bg-muted">
						<span>How do I install it?</span>
						<ChevronDownIcon className="size-4 text-muted-foreground transition-transform data-open:rotate-180" />
					</CollapsibleTrigger>
					<CollapsibleContent className="mt-2 rounded-lg bg-muted/30 px-4 py-3 text-sm text-muted-foreground data-open:animate-in data-open:fade-in data-open:slide-in-from-top-1">
						<pre className="rounded bg-muted p-2 text-xs">
							<code>pnpm add @mmbix/design-system</code>
						</pre>
					</CollapsibleContent>
				</Collapsible>

				<Collapsible>
					<CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm font-medium transition-colors hover:bg-muted">
						<span>Does it support dark mode?</span>
						<ChevronDownIcon className="size-4 text-muted-foreground transition-transform data-open:rotate-180" />
					</CollapsibleTrigger>
					<CollapsibleContent className="mt-2 rounded-lg bg-muted/30 px-4 py-3 text-sm text-muted-foreground data-open:animate-in data-open:fade-in data-open:slide-in-from-top-1">
						<p>
							Yes. Use the <code className="rounded bg-muted px-1">ThemeProvider</code> component to switch between light, dark, and system
							themes.
						</p>
					</CollapsibleContent>
				</Collapsible>
			</CardContent>
		</Card>
	),
};
