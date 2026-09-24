import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from './';
import { MailIcon, SearchIcon, EyeIcon, EyeOffIcon } from 'lucide-react';
import { useState } from 'react';

/**
 * Input collects text, numbers, emails, passwords, and other
 * short-form data from the user.
 *
 * Handles accessibility, focus management, and form integration
 * while providing consistent styling with border, focus ring, disabled,
 * and `aria-invalid` error states.
 */
const meta: Meta<typeof Input> = {
	title: 'Components/Input',
	component: Input,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A thin wrapper around an input primitive. Accepts all native `<input>` props and applies consistent design-system styling including focus ring, disabled opacity, and aria-invalid error highlighting.',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		type: {
			control: 'select',
			description: 'HTML input type',
			options: ['text', 'email', 'password', 'number', 'search', 'url', 'tel'],
			table: { type: { summary: 'string' }, defaultValue: { summary: 'text' } },
		},
		placeholder: {
			control: 'text',
			description: 'Placeholder text',
			table: { category: 'Content' },
		},
		disabled: {
			control: 'boolean',
			description: 'Disables interactions and applies reduced opacity',
		},
		'aria-invalid': {
			control: 'boolean',
			description: 'Marks the input as invalid for error styling',
		},
		defaultValue: {
			control: 'text',
			description: 'Default value',
			table: { category: 'Content' },
		},
	},
	args: {
		type: 'text',
		placeholder: 'Enter text…',
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Gallery ─────────────────────────────────────────────

export const AllTypes: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="flex w-80 flex-col gap-3">
			{(['text', 'email', 'password', 'search', 'number', 'url'] as const).map((t) => (
				<div key={t} className="flex flex-col gap-1">
					<label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t}</label>
					<Input type={t} placeholder={`Enter ${t}…`} />
				</div>
			))}
		</div>
	),
};

// ── States ──────────────────────────────────────────────

export const Default: Story = {
	args: { placeholder: 'Enter text…' },
};

export const Disabled: Story = {
	args: {
		placeholder: 'Disabled input',
		disabled: true,
		defaultValue: 'Cannot edit',
	},
};

export const Invalid: Story = {
	args: {
		placeholder: 'Enter email…',
		type: 'email',
		defaultValue: 'invalid-email',
		'aria-invalid': true,
	},
	parameters: {
		docs: {
			description: {
				story: 'Use `aria-invalid="true"` to apply error styling. Typically set in response to validation logic.',
			},
		},
	},
};

export const Password: Story = {
	name: 'Password with Show/Hide',
	parameters: {
		docs: {
			description: {
				story: 'Password inputs often need a visibility toggle. Combine Input with a button and `useState`.',
			},
		},
	},
	render: () => {
		const [show, setShow] = useState(false);
		return (
			<div className="relative w-72">
				<Input type={show ? 'text' : 'password'} placeholder="Enter password…" className="pr-9" />
				<button
					type="button"
					onClick={() => setShow(!show)}
					aria-label={show ? 'Hide password' : 'Show password'}
					className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
				>
					{show ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
				</button>
			</div>
		);
	},
};

export const WithIcon: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Position an icon inside the input using absolute positioning and padding.',
			},
		},
	},
	render: () => (
		<div className="flex w-72 flex-col gap-4">
			<div className="relative">
				<SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input placeholder="Search…" className="pl-8" />
			</div>
			<div className="relative">
				<MailIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input type="email" placeholder="Email…" className="pl-8" />
			</div>
		</div>
	),
};

export const Readonly: Story = {
	name: 'Read Only',
	args: { defaultValue: 'Read-only value', readOnly: true },
	parameters: {
		docs: {
			description: {
				story: 'Use `readOnly` for values that should not be edited but remain selectable.',
			},
		},
	},
};
