import type { Meta, StoryObj } from '@storybook/react-vite';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator, BreadcrumbEllipsis } from './';
import { SlashIcon } from 'lucide-react';

/**
 * Breadcrumb tracks the user's location within a hierarchy of pages.
 *
 * Composed of `Breadcrumb` (nav), `BreadcrumbList` (ol), `BreadcrumbItem` (li),
 * `BreadcrumbLink`, `BreadcrumbPage` (current page), `BreadcrumbSeparator`,
 * and `BreadcrumbEllipsis`. The default separator is a `ChevronRightIcon`.
 */
const meta: Meta<typeof Breadcrumb> = {
	title: 'Components/Breadcrumb',
	component: Breadcrumb,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A navigation breadcrumb built from semantic HTML (`nav`, `ol`, `li`). Supports custom separators, links, and a collapsed ellipsis state for deeply nested routes.',
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
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Default</h3>
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink href="/">Home</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink href="/docs">Docs</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>Components</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			</section>

			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">With Ellipsis</h3>
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink href="/">Home</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbEllipsis />
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink href="/docs/components">Components</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>Breadcrumb</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			</section>

			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Custom Separator</h3>
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink href="/">Home</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator>
							<SlashIcon className="cn-rtl-flip size-3.5" />
						</BreadcrumbSeparator>
						<BreadcrumbItem>
							<BreadcrumbLink href="/projects">Projects</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator>
							<SlashIcon className="cn-rtl-flip size-3.5" />
						</BreadcrumbSeparator>
						<BreadcrumbItem>
							<BreadcrumbPage>Design System</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			</section>
		</div>
	),
};

// ── Default ─────────────────────────────────────────────

export const Default: Story = {
	render: () => (
		<Breadcrumb>
			<BreadcrumbList>
				<BreadcrumbItem>
					<BreadcrumbLink href="/">Home</BreadcrumbLink>
				</BreadcrumbItem>
				<BreadcrumbSeparator />
				<BreadcrumbItem>
					<BreadcrumbLink href="/docs">Docs</BreadcrumbLink>
				</BreadcrumbItem>
				<BreadcrumbSeparator />
				<BreadcrumbItem>
					<BreadcrumbPage>Breadcrumb</BreadcrumbPage>
				</BreadcrumbItem>
			</BreadcrumbList>
		</Breadcrumb>
	),
};

// ── With Links ──────────────────────────────────────────

export const WithLinks: Story = {
	parameters: {
		docs: {
			description: {
				story: 'All items are clickable links—none are marked as the current page.',
			},
		},
	},
	render: () => (
		<Breadcrumb>
			<BreadcrumbList>
				<BreadcrumbItem>
					<BreadcrumbLink href="/">Home</BreadcrumbLink>
				</BreadcrumbItem>
				<BreadcrumbSeparator />
				<BreadcrumbItem>
					<BreadcrumbLink href="/blog">Blog</BreadcrumbLink>
				</BreadcrumbItem>
				<BreadcrumbSeparator />
				<BreadcrumbItem>
					<BreadcrumbLink href="/blog/announcements">Announcements</BreadcrumbLink>
				</BreadcrumbItem>
				<BreadcrumbSeparator />
				<BreadcrumbItem>
					<BreadcrumbLink href="/blog/announcements/v2">v2 Release</BreadcrumbLink>
				</BreadcrumbItem>
			</BreadcrumbList>
		</Breadcrumb>
	),
};

// ── With Ellipsis ────────────────────────────────────────

export const WithEllipsis: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `BreadcrumbEllipsis` to collapse intermediate items in deeply nested paths.',
			},
		},
	},
	render: () => (
		<Breadcrumb>
			<BreadcrumbList>
				<BreadcrumbItem>
					<BreadcrumbLink href="/">Home</BreadcrumbLink>
				</BreadcrumbItem>
				<BreadcrumbSeparator />
				<BreadcrumbItem>
					<BreadcrumbEllipsis />
				</BreadcrumbItem>
				<BreadcrumbSeparator />
				<BreadcrumbItem>
					<BreadcrumbLink href="/settings/account">Account</BreadcrumbLink>
				</BreadcrumbItem>
				<BreadcrumbSeparator />
				<BreadcrumbItem>
					<BreadcrumbPage>Security</BreadcrumbPage>
				</BreadcrumbItem>
			</BreadcrumbList>
		</Breadcrumb>
	),
};

// ── Custom Separator ────────────────────────────────────

export const CustomSeparator: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Replace the default `ChevronRightIcon` by passing children to `BreadcrumbSeparator`.',
			},
		},
	},
	render: () => (
		<Breadcrumb>
			<BreadcrumbList>
				<BreadcrumbItem>
					<BreadcrumbLink href="/">Home</BreadcrumbLink>
				</BreadcrumbItem>
				<BreadcrumbSeparator>
					<SlashIcon className="cn-rtl-flip size-3.5" />
				</BreadcrumbSeparator>
				<BreadcrumbItem>
					<BreadcrumbLink href="/products">Products</BreadcrumbLink>
				</BreadcrumbItem>
				<BreadcrumbSeparator>
					<SlashIcon className="cn-rtl-flip size-3.5" />
				</BreadcrumbSeparator>
				<BreadcrumbItem>
					<BreadcrumbPage>Details</BreadcrumbPage>
				</BreadcrumbItem>
			</BreadcrumbList>
		</Breadcrumb>
	),
};
