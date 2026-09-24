import type { Meta, StoryObj } from '@storybook/react-vite';
import { Label } from './';
import { Input } from '../input';

/**
 * Label renders a `<label>` element for form field association.
 *
 * Pass `htmlFor` to associate it with an input's `id`. The component
 * includes disabled styling via the `group-data-[disabled=true]` and
 * `peer-disabled` selectors when composed with other form controls.
 */
const meta: Meta<typeof Label> = {
	title: 'Components/Label',
	component: Label,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A styled `<label>` element. Accepts all native `<label>` props including `htmlFor`. Disabled styling works automatically when the label or its peer input is inside a `group` with `data-disabled=true`.',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		htmlFor: {
			control: 'text',
			description: 'Associates the label with a form control by its `id`',
			table: { category: 'Association' },
		},
		children: {
			control: 'text',
			description: 'Label text content',
			table: { category: 'Content' },
		},
	},
	args: {
		children: 'Label',
		htmlFor: '',
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Default ─────────────────────────────────────────────

export const Default: Story = {
	args: {
		children: 'Email',
		htmlFor: 'email',
	},
};

// ── With Input ──────────────────────────────────────────

export const WithInput: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `htmlFor` on the label and `id` on the input to associate them. Clicking the label will focus the input.',
			},
		},
	},
	render: (args) => (
		<div className="flex w-64 flex-col gap-1.5">
			<Label htmlFor="with-input-example">{args.children ?? 'Name'}</Label>
			<Input id="with-input-example" placeholder="Enter your name…" />
		</div>
	),
};

// ── Disabled ────────────────────────────────────────────

export const Disabled: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Wrap the label and input in a container with `data-disabled=true` to apply disabled opacity to the label.',
			},
		},
	},
	render: (args) => (
		<div className="group flex w-64 flex-col gap-1.5" data-disabled={true}>
			<Label htmlFor="disabled-example">{args.children ?? 'Disabled'}</Label>
			<Input id="disabled-example" placeholder="Disabled input…" disabled />
		</div>
	),
};
