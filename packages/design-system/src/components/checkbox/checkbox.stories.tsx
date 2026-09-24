import type { Meta, StoryObj } from '@storybook/react-vite';
import { Checkbox } from './';
import { Field, FieldLabel } from '../field';
import { useState } from 'react';

/**
 * Checkbox lets users select or deselect an option.
 *
 * Handles accessibility, keyboard interaction, and indeterminate
 * state out of the box. Renders a `CheckIcon` from lucide-react when
 * checked.
 */
const meta: Meta<typeof Checkbox> = {
	title: 'Components/Checkbox',
	component: Checkbox,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A single checkbox. Supports checked, indeterminate, disabled, and aria-invalid states. Renders a `CheckIcon` (lucide-react) when checked, and an optional `MinusIcon` for indeterminate.',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		defaultChecked: {
			control: 'boolean',
			description: 'Initial checked state (uncontrolled)',
			table: { type: { summary: 'boolean' }, category: 'State' },
		},
		checked: {
			control: 'boolean',
			description: 'Controlled checked state',
			table: { type: { summary: 'boolean' }, category: 'State' },
		},
		disabled: {
			control: 'boolean',
			description: 'Disables the checkbox',
		},
		'aria-invalid': {
			control: 'boolean',
			description: 'Marks the checkbox as invalid for error styling',
		},
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Gallery ─────────────────────────────────────────────

export const AllStates: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="flex items-center gap-6">
			<div className="flex flex-col items-center gap-2">
				<Checkbox />
				<span className="text-xs text-muted-foreground">Unchecked</span>
			</div>
			<div className="flex flex-col items-center gap-2">
				<Checkbox defaultChecked />
				<span className="text-xs text-muted-foreground">Checked</span>
			</div>
			<div className="flex flex-col items-center gap-2">
				<Checkbox disabled />
				<span className="text-xs text-muted-foreground">Disabled</span>
			</div>
			<div className="flex flex-col items-center gap-2">
				<Checkbox disabled defaultChecked />
				<span className="text-xs text-muted-foreground">Disabled + Checked</span>
			</div>
			<div className="flex flex-col items-center gap-2">
				<Checkbox aria-invalid="true" />
				<span className="text-xs text-muted-foreground">Invalid</span>
			</div>
		</div>
	),
};

// ── States ──────────────────────────────────────────────

export const Default: Story = {
	name: 'Unchecked',
	args: {},
};

export const Checked: Story = {
	args: { defaultChecked: true },
};

export const Disabled: Story = {
	args: { disabled: true },
};

export const DisabledChecked: Story = {
	args: { disabled: true, defaultChecked: true },
};

export const Invalid: Story = {
	args: { 'aria-invalid': true },
	parameters: {
		docs: {
			description: {
				story:
					'Set `aria-invalid="true"` to show the error state. Typically used when a required checkbox is unchecked in a form validation context.',
			},
		},
	},
};

// ── Interactive ─────────────────────────────────────────

export const Interactive: Story = {
	name: 'Interactive (Controlled)',
	parameters: {
		docs: {
			description: {
				story: 'A controlled checkbox example using `useState`. Toggle the checkbox to see the state change reflected in the label.',
			},
		},
	},
	render: () => {
		const [checked, setChecked] = useState(false);
		return (
			<Field orientation="horizontal">
				<Checkbox id="interactive-checkbox" checked={checked} onCheckedChange={(v) => setChecked(v === true)} />
				<FieldLabel htmlFor="interactive-checkbox">{checked ? 'Checked' : 'Unchecked'}</FieldLabel>
			</Field>
		);
	},
};

// ── With Label ──────────────────────────────────────────

export const WithLabel: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="flex flex-col gap-3">
			{[
				{ label: 'Accept terms and conditions', checked: false },
				{ label: 'Subscribe to newsletter', checked: true },
				{ label: 'Email me about updates', checked: false, disabled: true },
			].map((item, i) => (
				<Field orientation="horizontal" key={i}>
					<Checkbox id={`with-label-${i}`} defaultChecked={item.checked} disabled={item.disabled} />
					<FieldLabel htmlFor={`with-label-${i}`}>{item.label}</FieldLabel>
				</Field>
			))}
		</div>
	),
};
