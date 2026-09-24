import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowUpRightIcon, CircleCheckIcon, QrCodeIcon } from 'lucide-react';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './';
import { Badge } from '@/badge';
import { Button } from '@/button';
import { ButtonGroup } from '@/button-group';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card';
import { Input } from '@/input';
import { Spinner } from '@/spinner';

/**
 * Accordion displays collapsible content panels for presenting
 * information in a space-efficient way.
 *
 * Handles keyboard navigation, focus management, and ARIA
 * attributes out of the box.
 */
const meta: Meta<typeof Accordion> = {
	title: 'Components/Accordion',
	component: Accordion,
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				component:
					'A vertically stacked set of interactive headings that reveal or hide associated content sections. Supports single and multiple panel expansion.',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		disabled: {
			control: 'boolean',
			description: 'When true, the accordion is disabled',
		},
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Sample content ─────────────────────────────────────────

const SAMPLE_ITEMS = [
	{
		value: 'item-1',
		title: 'What is this design system?',
		content:
			'This is a React-based design system built with Tailwind CSS v4 and TypeScript. It provides accessible, composable components for building modern web applications.',
	},
	{
		value: 'item-2',
		title: 'How do I install it?',
		content:
			'Run `pnpm add @mmbix/design-system` and import the components you need. Make sure you have React 19 and Tailwind CSS v4 set up in your project.',
	},
	{
		value: 'item-3',
		title: 'Does it support dark mode?',
		content:
			'Yes. The design system includes a ThemeProvider component that handles light/dark/system theme switching. All components automatically adapt to the current theme.',
	},
	{
		value: 'item-4',
		title: 'Is it accessible?',
		content:
			'Absolutely. Every component provides WAI-ARIA compliant patterns, keyboard navigation, and screen reader support out of the box.',
	},
];

// ── Gallery: All states ─────────────────────────────────

export const AllStates: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="mx-auto flex max-w-lg flex-col gap-12">
			{/* Collapsed */}
			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Collapsed</h3>
				<Accordion>
					{SAMPLE_ITEMS.slice(0, 2).map((item) => (
						<AccordionItem key={item.value} value={item.value}>
							<AccordionTrigger>{item.title}</AccordionTrigger>
							<AccordionContent>
								<p>{item.content}</p>
							</AccordionContent>
						</AccordionItem>
					))}
				</Accordion>
			</section>

			{/* Expanded */}
			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Expanded</h3>
				<Accordion defaultValue={['item-1']}>
					{SAMPLE_ITEMS.slice(0, 2).map((item) => (
						<AccordionItem key={item.value} value={item.value}>
							<AccordionTrigger>{item.title}</AccordionTrigger>
							<AccordionContent>
								<p>{item.content}</p>
							</AccordionContent>
						</AccordionItem>
					))}
				</Accordion>
			</section>

			{/* Disabled */}
			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">With Disabled Item</h3>
				<Accordion>
					<AccordionItem value="enabled-1">
						<AccordionTrigger>Enabled item</AccordionTrigger>
						<AccordionContent>
							<p>This item is interactive.</p>
						</AccordionContent>
					</AccordionItem>
					<AccordionItem value="disabled-1" disabled>
						<AccordionTrigger>Disabled item</AccordionTrigger>
						<AccordionContent>
							<p>This item cannot be opened.</p>
						</AccordionContent>
					</AccordionItem>
				</Accordion>
			</section>
		</div>
	),
};

// ── Basic ───────────────────────────────────────────────

export const Default: Story = {
	render: () => (
		<div className="mx-auto w-full max-w-md">
			<Accordion defaultValue={['item-1']}>
				{SAMPLE_ITEMS.map((item) => (
					<AccordionItem key={item.value} value={item.value}>
						<AccordionTrigger>{item.title}</AccordionTrigger>
						<AccordionContent>
							<p>{item.content}</p>
						</AccordionContent>
					</AccordionItem>
				))}
			</Accordion>
		</div>
	),
};

// ── Multiple (allow multiple panels open) ───────────────

export const Multiple: Story = {
	name: 'Multiple Open',
	render: () => (
		<div className="mx-auto w-full max-w-md">
			<Accordion defaultValue={['item-1', 'item-3']}>
				{SAMPLE_ITEMS.map((item) => (
					<AccordionItem key={item.value} value={item.value}>
						<AccordionTrigger>{item.title}</AccordionTrigger>
						<AccordionContent>
							<p>{item.content}</p>
						</AccordionContent>
					</AccordionItem>
				))}
			</Accordion>
		</div>
	),
};

// ── Rich content ───────────────────────────────────────

export const RichContent: Story = {
	render: () => (
		<div className="mx-auto w-full max-w-md">
			<Accordion defaultValue={['code']}>
				<AccordionItem value="code">
					<AccordionTrigger>Installation command</AccordionTrigger>
					<AccordionContent>
						<pre className="overflow-x-auto rounded-md bg-muted p-3 text-sm">
							<code>pnpm add @mmbix/design-system</code>
						</pre>
					</AccordionContent>
				</AccordionItem>
				<AccordionItem value="features">
					<AccordionTrigger>Key features</AccordionTrigger>
					<AccordionContent>
						<ul className="list-disc space-y-1 pl-4">
							<li>Accessible by default (WAI-ARIA compliant)</li>
							<li>Light and dark mode support</li>
							<li>Customizable with Tailwind CSS</li>
							<li>TypeScript-first API</li>
						</ul>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</div>
	),
};

// ── Disabled items ─────────────────────────────────────

export const WithDisabledItem: Story = {
	render: () => (
		<div className="mx-auto w-full max-w-md">
			<Accordion>
				{SAMPLE_ITEMS.map((item, i) => (
					<AccordionItem key={item.value} value={item.value} disabled={i === 2}>
						<AccordionTrigger>{item.title}</AccordionTrigger>
						<AccordionContent>
							<p>{item.content}</p>
						</AccordionContent>
					</AccordionItem>
				))}
			</Accordion>
		</div>
	),
};

// ── FAQ card pattern ────────────────────────────────────

const FAQ_ITEMS = [
	{
		value: 'plans',
		trigger: 'What subscription plans do you offer?',
		content: (
			<>
				<p>
					<a href="#" className="text-primary hover:underline">
						Annual billing is available
					</a>{' '}
					with a 20% discount. All plans include a 14-day free trial with no credit card required.
				</p>
				<Button size="sm" className="mt-4">
					View plans
					<ArrowUpRightIcon className="size-4" />
				</Button>
			</>
		),
	},
	{
		value: 'billing',
		trigger: 'How does billing work?',
		content: (
			<>
				<p>
					Billing occurs automatically at the start of each billing cycle. We accept all major credit cards, PayPal, and ACH transfers for
					enterprise customers.
				</p>
			</>
		),
	},
	{
		value: 'security',
		trigger: 'Is my data secure?',
		content: (
			<>
				<p>
					We take security seriously. All data is encrypted at rest using AES-256 and in transit via TLS 1.3. We perform regular third-party
					security audits and maintain SOC 2 Type II compliance.
				</p>
				<p>You can also enable multi-factor authentication (MFA) and single sign-on (SSO) for additional security.</p>
			</>
		),
	},
];

export const FaqCard: Story = {
	name: 'FAQ Card',
	render: () => (
		<div className="mx-auto mb-auto w-full max-w-lg">
			<Card>
				<CardHeader>
					<CardTitle>Subscription & Billing</CardTitle>
					<CardDescription>Common questions about your account, plans, and payments</CardDescription>
				</CardHeader>
				<CardContent>
					<Accordion multiple defaultValue={['plans']}>
						{FAQ_ITEMS.map((item) => (
							<AccordionItem key={item.value} value={item.value}>
								<AccordionTrigger>{item.trigger}</AccordionTrigger>
								<AccordionContent>{item.content}</AccordionContent>
							</AccordionItem>
						))}
					</Accordion>
				</CardContent>
			</Card>
		</div>
	),
};

// ── Setup checklist pattern ─────────────────────────────

export const SetupChecklist: Story = {
	render: () => (
		<div className="mx-auto mb-auto w-full max-w-lg">
			<Accordion multiple={false} defaultValue={['pos-app']} className="overflow-hidden rounded-lg border border-border">
				{/* Step 1: Completed */}
				<AccordionItem value="add-products" className="px-4">
					<AccordionTrigger className="items-center py-4 font-semibold hover:no-underline">
						<div className="flex w-full items-center justify-between pr-4">
							<div className="flex items-center justify-center gap-3">
								<div className="flex size-5 items-center justify-center">
									<CircleCheckIcon className="size-5 fill-status-success text-background" />
								</div>
								<span className="text-sm font-medium">Add products</span>
							</div>
							<Badge className="bg-status-success/10 text-status-success">Ready</Badge>
						</div>
					</AccordionTrigger>
					<AccordionContent className="pr-0 pb-4 pl-8 leading-relaxed text-muted-foreground">
						Your products have been successfully added and are ready for sale.
					</AccordionContent>
				</AccordionItem>

				{/* Step 2: Expanded / in progress */}
				<AccordionItem value="pos-app" className="px-4">
					<AccordionTrigger className="items-center py-4 font-semibold hover:no-underline">
						<div className="flex w-full items-center justify-between pr-4">
							<div className="flex items-center gap-3">
								<div className="flex size-5 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-950">
									<div className="size-2 rounded-full bg-yellow-500" />
								</div>
								<span className="text-sm font-medium text-foreground">Get the point of sale application</span>
							</div>
						</div>
					</AccordionTrigger>
					<AccordionContent className="pt-2 pl-8">
						<div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
							<div className="flex-1 space-y-6">
								<p className="text-sm leading-relaxed text-muted-foreground">
									Scan the QR code or send yourself the link to get the app. The mobile app is where you&apos;ll manage orders, track
									inventory, and view analytics on the go.
								</p>
								<ButtonGroup>
									<Input placeholder="james@alignui.com" />
									<Button variant="outline" aria-label="Send link">
										Send link
									</Button>
								</ButtonGroup>
							</div>
							<div className="flex shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 p-3">
								<QrCodeIcon className="size-20" strokeWidth="1.5" />
							</div>
						</div>
					</AccordionContent>
				</AccordionItem>

				{/* Step 3: Pending */}
				<AccordionItem value="price-stock" className="px-4">
					<AccordionTrigger className="items-center py-4 font-semibold hover:no-underline">
						<div className="flex w-full items-center justify-between pr-4">
							<div className="flex items-center gap-3">
								<div className="flex size-5 items-center justify-center">
									<Spinner className="opacity-60" />
								</div>
								<span className="text-sm font-medium text-muted-foreground">Product price & stock</span>
							</div>
						</div>
					</AccordionTrigger>
					<AccordionContent className="pl-8 text-sm leading-relaxed text-muted-foreground">
						Configure your product pricing and manage stock levels across all locations.
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</div>
	),
};
