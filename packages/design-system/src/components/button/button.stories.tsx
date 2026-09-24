import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, buttonVariants } from './';
import { ArrowUpIcon, ArrowRightIcon, CircleFadingArrowUpIcon, ExternalLinkIcon } from 'lucide-react';

/**
 * Button is the most fundamental interactive element.
 *
 * Handles accessibility, keyboard navigation, and focus management
 * out of the box while providing 6 visual variants and 9 sizes.
 */
const meta: Meta<typeof Button> = {
	title: 'Components/Button',
	component: Button,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component: `A polymorphic button. Supports 6 visual variants, 9 sizes, and icons via \`data-icon\` slots.

### Usage

\`\`\`tsx
// CLI: pnpm dlx @mmbix/design-system-cli add button
import { Button } from "@/components/ui/button" // or "@mmbix/design-system"

<Button variant="outline" size="sm">Save</Button>
<Button variant="default" size="icon-lg" aria-label="Add"><PlusIcon /></Button>
\`\`\`
`,
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		variant: {
			control: 'select',
			description: 'Visual style variant',
			options: ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'],
			table: {
				type: { summary: 'string' },
				defaultValue: { summary: 'default' },
			},
		},
		size: {
			control: 'select',
			description: 'Size preset',
			options: ['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'],
			table: {
				type: { summary: 'string' },
				defaultValue: { summary: 'default' },
			},
		},
		disabled: {
			control: 'boolean',
			description: 'Disables interactions and applies reduced opacity',
		},
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Gallery stories ─────────────────────────────────────

export const AllSizes: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="flex flex-wrap items-center gap-3">
			{(['xs', 'sm', 'default', 'lg'] as const).map((s) => (
				<Button key={s} size={s}>
					{s}
				</Button>
			))}
		</div>
	),
};

export const AllVariants: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
			{(['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const).map((v) => (
				<Button key={v} variant={v}>
					{v}
				</Button>
			))}
		</div>
	),
};

// ── As Link (buttonVariants) ─────────────────────────────

export const AsLink: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use `buttonVariants` to style a plain `<a>` tag as a button. Do not use `Button render={<a />}` — it applies `role="button"` which overrides the semantic link role.',
			},
		},
	},
	render: () => (
		<div className="flex items-center gap-3">
			<a href="#" className={buttonVariants({ variant: 'default' })}>
				Login
			</a>
			<a href="#" className={buttonVariants({ variant: 'outline' })}>
				Sign Up
			</a>
			<a href="#" className={buttonVariants({ variant: 'link' })}>
				Cancel
			</a>
		</div>
	),
};

// ── Variant stories ─────────────────────────────────────

export const Default: Story = { args: { children: 'Button' } };

export const Destructive: Story = {
	args: { children: 'Destructive', variant: 'destructive' },
};

export const Disabled: Story = {
	args: { children: 'Disabled', disabled: true },
};

export const Ghost: Story = {
	args: { children: 'Ghost', variant: 'ghost' },
};

// ── Icon buttons ────────────────────────────────────────

export const IconButton: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Icon-only buttons using the `icon` size presets.',
			},
		},
	},
	render: () => (
		<div className="flex items-center gap-2">
			<Button size="icon-xs" aria-label="Arrow up">
				<ArrowUpIcon />
			</Button>
			<Button size="icon-sm" aria-label="Arrow up">
				<ArrowUpIcon />
			</Button>
			<Button size="icon" aria-label="Arrow up">
				<ArrowUpIcon />
			</Button>
			<Button size="icon-lg" aria-label="Arrow up">
				<ArrowUpIcon />
			</Button>
		</div>
	),
};

// ── Size stories ────────────────────────────────────────

export const Large: Story = {
	args: { children: 'Large', size: 'lg' },
};

export const Link: Story = {
	args: { children: 'Link Button', variant: 'link' },
};

// ── Loading / Spinner ───────────────────────────────────

export const Loading: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use an animated spinner with `data-icon="inline-start"` to indicate a loading state. Replace the icon with a spinner component in production.',
			},
		},
	},
	render: () => (
		<div className="flex flex-wrap items-center gap-3">
			<Button disabled>
				<span data-icon="inline-start" className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
				Generating
			</Button>
			<Button variant="outline" disabled>
				<span data-icon="inline-start" className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
				Downloading
			</Button>
		</div>
	),
};

export const Outline: Story = {
	args: { children: 'Outline', variant: 'outline' },
};

// ── Rounded ─────────────────────────────────────────────

export const Rounded: Story = {
	parameters: {
		docs: {
			description: { story: 'Use `rounded-full` for a pill-shaped button.' },
		},
	},
	render: () => (
		<div className="flex items-center gap-3">
			<Button className="rounded-full">
				Get Started
				<ArrowRightIcon data-icon="inline-end" />
			</Button>
			<Button variant="outline" className="rounded-full">
				<CircleFadingArrowUpIcon data-icon="inline-start" />
				Upgrade
			</Button>
			<Button size="icon" className="rounded-full" aria-label="Arrow up">
				<ArrowUpIcon />
			</Button>
		</div>
	),
};

export const Secondary: Story = {
	args: { children: 'Secondary', variant: 'secondary' },
};

export const Small: Story = {
	args: { children: 'Small', size: 'sm' },
};

// ── With icon ───────────────────────────────────────────

export const WithIcon: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Add `data-icon="inline-start"` or `data-icon="inline-end"` to the icon element for correct spacing.',
			},
		},
	},
	render: () => (
		<div className="flex flex-wrap items-center gap-3">
			<Button>
				<ArrowUpIcon data-icon="inline-start" />
				New Branch
			</Button>
			<Button variant="outline">
				Fork
				<ArrowRightIcon data-icon="inline-end" />
			</Button>
			<Button variant="secondary">
				<ExternalLinkIcon data-icon="inline-start" />
				Open
			</Button>
		</div>
	),
};
