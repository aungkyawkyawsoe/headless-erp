import type { Meta, StoryObj } from '@storybook/react-vite';
import { RadioGroup, RadioGroupItem } from './';
import { Label } from '@/label';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldSet, FieldLegend } from '@/field';

/**
 * RadioGroup lets users select a single option from a set of choices.
 *
 * Handles accessibility, keyboard navigation, and single-selection
 * behavior out of the box. Renders a filled circle indicator when
 * selected.
 *
 * Compose with `Label` for basic labels, or use `Field` components
 * for richer layouts with descriptions, fieldset grouping, choice
 * cards, and validation states.
 */
const meta: Meta<typeof RadioGroup> = {
	title: 'Components/RadioGroup',
	component: RadioGroup,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A radio group. Supports controlled and uncontrolled state, disabled, and aria-invalid. Use `RadioGroup` as the wrapper and `RadioGroupItem` for each option. Compose with `Label` or `Field` components for labels and descriptions.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Default ──────────────────────────────────────────────

export const Default: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'A basic radio group with `Label` for each option. Use `defaultValue` to set the initially selected value (uncontrolled) or `value`/`onValueChange` for controlled state.',
			},
		},
	},
	render: () => (
		<RadioGroup defaultValue="comfortable">
			<div className="flex items-center gap-3">
				<RadioGroupItem value="default" id="r1" />
				<Label htmlFor="r1">Default</Label>
			</div>
			<div className="flex items-center gap-3">
				<RadioGroupItem value="comfortable" id="r2" />
				<Label htmlFor="r2">Comfortable</Label>
			</div>
			<div className="flex items-center gap-3">
				<RadioGroupItem value="compact" id="r3" />
				<Label htmlFor="r3">Compact</Label>
			</div>
		</RadioGroup>
	),
};

// ── Description ──────────────────────────────────────────

export const Description: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Radio items with descriptions using the `Field` component. Wrap each radio item in a `Field` with `FieldContent` and `FieldDescription` to provide additional context for each option.',
			},
		},
	},
	render: () => (
		<RadioGroup defaultValue="comfortable" className="w-72">
			<Field>
				<div className="flex items-center gap-3">
					<RadioGroupItem value="default" id="description-1" />
					<Label htmlFor="description-1">Default</Label>
				</div>
				<FieldContent>
					<FieldDescription>Standard spacing for most use cases.</FieldDescription>
				</FieldContent>
			</Field>
			<Field>
				<div className="flex items-center gap-3">
					<RadioGroupItem value="comfortable" id="description-2" />
					<Label htmlFor="description-2">Comfortable</Label>
				</div>
				<FieldContent>
					<FieldDescription>More space between elements.</FieldDescription>
				</FieldContent>
			</Field>
			<Field>
				<div className="flex items-center gap-3">
					<RadioGroupItem value="compact" id="description-3" />
					<Label htmlFor="description-3">Compact</Label>
				</div>
				<FieldContent>
					<FieldDescription>Minimal spacing for dense layouts.</FieldDescription>
				</FieldContent>
			</Field>
		</RadioGroup>
	),
};

// ── ChoiceCard ───────────────────────────────────────────

export const ChoiceCard: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use `FieldLabel` to wrap the entire option for a clickable card-style selection. Clicking anywhere on the card selects the radio option. The radio indicator is positioned at the **top-right**.',
			},
		},
	},
	render: () => (
		<RadioGroup defaultValue="pro" className="w-72">
			<FieldLabel className="flex w-full cursor-pointer items-start justify-between gap-4 rounded-xl border p-4 transition-colors has-data-checked:border-primary/30 has-data-checked:bg-primary/5 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10">
				<FieldContent className="min-w-0 flex-1">
					<span className="font-medium">Plus</span>
					<FieldDescription>For individuals and small teams.</FieldDescription>
				</FieldContent>
				<RadioGroupItem value="plus" id="choice-plus" />
			</FieldLabel>
			<FieldLabel className="flex w-full cursor-pointer items-start justify-between gap-4 rounded-xl border p-4 transition-colors has-data-checked:border-primary/30 has-data-checked:bg-primary/5 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10">
				<FieldContent className="min-w-0 flex-1">
					<span className="font-medium">Pro</span>
					<FieldDescription>For growing businesses.</FieldDescription>
				</FieldContent>
				<RadioGroupItem value="pro" id="choice-pro" />
			</FieldLabel>
			<FieldLabel className="flex w-full cursor-pointer items-start justify-between gap-4 rounded-xl border p-4 transition-colors has-data-checked:border-primary/30 has-data-checked:bg-primary/5 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10">
				<FieldContent className="min-w-0 flex-1">
					<span className="font-medium">Enterprise</span>
					<FieldDescription>For large teams and enterprises.</FieldDescription>
				</FieldContent>
				<RadioGroupItem value="enterprise" id="choice-enterprise" />
			</FieldLabel>
		</RadioGroup>
	),
};

// ── Fieldset ─────────────────────────────────────────────

export const Fieldset: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use `FieldSet` and `FieldLegend` to group radio items with a label and description. Matches the HTML `<fieldset>` / `<legend>` semantics for accessible form grouping.',
			},
		},
	},
	render: () => (
		<FieldSet className="w-72">
			<FieldLegend>Subscription Plan</FieldLegend>
			<FieldDescription className="mb-4">Yearly and lifetime plans offer significant savings.</FieldDescription>
			<RadioGroup defaultValue="yearly">
				<div className="flex items-center gap-3">
					<RadioGroupItem value="monthly" id="fs-monthly" />
					<Label htmlFor="fs-monthly">Monthly ($9.99/month)</Label>
				</div>
				<div className="flex items-center gap-3">
					<RadioGroupItem value="yearly" id="fs-yearly" />
					<Label htmlFor="fs-yearly">Yearly ($99.99/year)</Label>
				</div>
				<div className="flex items-center gap-3">
					<RadioGroupItem value="lifetime" id="fs-lifetime" />
					<Label htmlFor="fs-lifetime">Lifetime ($299.99)</Label>
				</div>
			</RadioGroup>
		</FieldSet>
	),
};

// ── Disabled ─────────────────────────────────────────────

export const Disabled: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use the `disabled` prop on `RadioGroup` to disable all radio items. Individual items can also be disabled by passing `disabled` directly on `RadioGroupItem`.',
			},
		},
	},
	render: () => (
		<RadioGroup defaultValue="option-2" disabled>
			<div className="flex items-center gap-3">
				<RadioGroupItem value="option-1" id="disabled-1" />
				<Label htmlFor="disabled-1">Disabled</Label>
			</div>
			<div className="flex items-center gap-3">
				<RadioGroupItem value="option-2" id="disabled-2" />
				<Label htmlFor="disabled-2">Option 2</Label>
			</div>
			<div className="flex items-center gap-3">
				<RadioGroupItem value="option-3" id="disabled-3" />
				<Label htmlFor="disabled-3">Option 3</Label>
			</div>
		</RadioGroup>
	),
};

// ── Invalid ──────────────────────────────────────────────

export const Invalid: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use `aria-invalid` on `RadioGroupItem` and `data-invalid` on `Field` to show validation errors. Combine with `FieldDescription` to display an error message.',
			},
		},
	},
	render: () => (
		<RadioGroup defaultValue="email" className="w-72">
			<p className="text-sm font-medium">Notification Preferences</p>
			<Field data-invalid>
				<div className="flex items-center gap-3">
					<RadioGroupItem value="email" id="invalid-1" aria-invalid />
					<Label htmlFor="invalid-1">Email only</Label>
				</div>
			</Field>
			<Field>
				<div className="flex items-center gap-3">
					<RadioGroupItem value="sms" id="invalid-2" />
					<Label htmlFor="invalid-2">SMS only</Label>
				</div>
			</Field>
			<Field>
				<div className="flex items-center gap-3">
					<RadioGroupItem value="both" id="invalid-3" />
					<Label htmlFor="invalid-3">Both Email &amp; SMS</Label>
				</div>
			</Field>
			<FieldDescription className="text-destructive">Please select a notification preference.</FieldDescription>
		</RadioGroup>
	),
};
