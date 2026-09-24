import type { Meta, StoryObj } from '@storybook/react-vite';
import { Toggle, toggleVariants } from './';
import { useState } from 'react';
import { BoldIcon, ItalicIcon, UnderlineIcon } from 'lucide-react';

/**
 * Toggle is a two-state button for turning options on and off.
 *
 * Handles accessibility and `aria-pressed` automatically. Supports
 * `default` and `outline` variants, and `default`, `sm`, and `lg` sizes.
 */
const meta: Meta<typeof Toggle> = {
	title: 'Components/Toggle',
	component: Toggle,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A two-state toggle button. Supports `default` and `outline` variants, and `default`/`sm`/`lg` sizes. Ideal for formatting toolbars, setting filters, or any on/off selection.',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		variant: {
			control: 'select',
			description: 'Visual style variant',
			options: ['default', 'outline'],
			table: {
				type: { summary: 'string' },
				defaultValue: { summary: 'default' },
			},
		},
		size: {
			control: 'select',
			description: 'Size preset',
			options: ['default', 'sm', 'lg'],
			table: {
				type: { summary: 'string' },
				defaultValue: { summary: 'default' },
			},
		},
		disabled: {
			control: 'boolean',
			description: 'Disables the toggle',
		},
		defaultPressed: {
			control: 'boolean',
			description: 'Initial pressed state (uncontrolled)',
			table: { category: 'State' },
		},
	},
	args: {
		'aria-label': 'Toggle bold',
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Gallery ─────────────────────────────────────────────

export const AllSizes: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="flex items-end gap-4">
			{(['sm', 'default', 'lg'] as const).map((s) => (
				<div key={s} className="flex flex-col items-center gap-2">
					<Toggle size={s} aria-label={`Toggle ${s}`}>
						<BoldIcon />
					</Toggle>
					<span className="text-xs text-muted-foreground">{s}</span>
				</div>
			))}
		</div>
	),
};

export const AllVariants: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="flex items-center gap-3">
			<Toggle variant="default" aria-label="Default toggle">
				<BoldIcon />
			</Toggle>
			<Toggle variant="outline" aria-label="Outline toggle">
				<BoldIcon />
			</Toggle>
		</div>
	),
};

// ── Variants ────────────────────────────────────────────

export const Default: Story = {
	args: { children: <BoldIcon />, 'aria-label': 'Toggle bold' },
};

export const DefaultPressed: Story = {
	name: 'Default (Pressed)',
	args: {
		children: <BoldIcon />,
		defaultPressed: true,
		'aria-label': 'Toggle bold',
	},
};

export const Outline: Story = {
	args: {
		variant: 'outline',
		children: <BoldIcon />,
		'aria-label': 'Toggle bold',
	},
};

export const OutlinePressed: Story = {
	name: 'Outline (Pressed)',
	args: {
		variant: 'outline',
		children: <BoldIcon />,
		defaultPressed: true,
		'aria-label': 'Toggle bold',
	},
};

export const Disabled: Story = {
	args: { children: <BoldIcon />, disabled: true, 'aria-label': 'Toggle bold' },
};

export const DisabledPressed: Story = {
	name: 'Disabled (Pressed)',
	args: {
		children: <BoldIcon />,
		disabled: true,
		defaultPressed: true,
		'aria-label': 'Toggle bold',
	},
};

// ── Size variants ───────────────────────────────────────

export const Small: Story = {
	args: { size: 'sm', children: <BoldIcon />, 'aria-label': 'Toggle bold' },
};

export const Large: Story = {
	args: { size: 'lg', children: <BoldIcon />, 'aria-label': 'Toggle bold' },
};

// ── Interactive ─────────────────────────────────────────

export const Interactive: Story = {
	name: 'Interactive (Formatting Toolbar)',
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'A controlled formatting toolbar example. Each toggle manages its own pressed state independently.',
			},
		},
	},
	render: () => {
		const [bold, setBold] = useState(false);

		const [italic, setItalic] = useState(false);

		const [underline, setUnderline] = useState(false);

		return (
			<div className="flex items-center gap-1 rounded-lg border border-input p-1">
				<Toggle pressed={bold} onPressedChange={setBold} aria-label="Toggle bold">
					<BoldIcon />
				</Toggle>
				<Toggle pressed={italic} onPressedChange={setItalic} aria-label="Toggle italic">
					<ItalicIcon />
				</Toggle>
				<Toggle pressed={underline} onPressedChange={setUnderline} aria-label="Toggle underline">
					<UnderlineIcon />
				</Toggle>
			</div>
		);
	},
};

// ── As Button (toggleVariants) ──────────────────────────

export const AsButton: Story = {
	name: 'As Button (toggleVariants)',
	parameters: {
		docs: {
			description: {
				story:
					"Use `toggleVariants` to style a plain `<button>` without Toggle's toggle behavior — useful for static toolbar items that trigger an action rather than toggling state.",
			},
		},
	},
	render: () => (
		<div className="flex items-center gap-1 rounded-lg border border-input p-1">
			<button className={toggleVariants({ variant: 'default' })} aria-label="Bold">
				<BoldIcon />
			</button>
			<button className={toggleVariants({ variant: 'default' })} aria-label="Italic">
				<ItalicIcon />
			</button>
			<button className={toggleVariants({ variant: 'outline' })} aria-label="Underline">
				<UnderlineIcon />
			</button>
		</div>
	),
};
