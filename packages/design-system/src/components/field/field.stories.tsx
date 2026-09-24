import type { Meta, StoryObj } from '@storybook/react-vite';
import {
	Field,
	FieldLabel,
	FieldContent,
	FieldTitle,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldSet,
	FieldLegend,
	FieldSeparator,
} from './';
import { Input } from '../input';
import { Textarea } from '../textarea';
import { Checkbox } from '../checkbox';
import { Toggle } from '../toggle';
import {
	MailIcon,
	UserIcon,
	LockIcon,
	FileTextIcon,
	MapPinIcon,
	BuildingIcon,
	GlobeIcon,
	BellIcon,
	CheckCheckIcon,
	ListTodoIcon,
} from 'lucide-react';

/**
 * Field provides a structured layout for form controls with
 * label, description, error, and grouping support.
 *
 * Compose with `FieldLabel`, `FieldContent`, `FieldTitle`,
 * `FieldDescription`, `FieldError`, `FieldGroup`, `FieldSet`,
 * `FieldLegend`, and `FieldSeparator` to build accessible forms.
 */
const meta: Meta<typeof Field> = {
	title: 'Components/Field',
	component: Field,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A form field system. `Field` wraps a control with label, description, and error slots. Supports vertical, horizontal, and responsive orientations. `FieldSet`/`FieldLegend` provide fieldset grouping. `FieldGroup`/`FieldSeparator` enable sections inside a group.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Input / Username ─────────────────────────────────────

export const InputUsernamePassword: Story = {
	name: 'Input',
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'A basic form with Username and Password fields. Each `Field` uses a `FieldLabel` and `Input`, with `FieldDescription` providing helper text.',
			},
		},
	},
	render: () => (
		<div className="flex w-80 flex-col gap-6">
			<Field>
				<FieldLabel htmlFor="username">
					<UserIcon className="size-4" />
					Username
				</FieldLabel>
				<FieldContent>
					<Input id="username" placeholder="Enter your username" />
					<FieldDescription>Your unique account identifier.</FieldDescription>
				</FieldContent>
			</Field>

			<Field>
				<FieldLabel htmlFor="password">
					<LockIcon className="size-4" />
					Password
				</FieldLabel>
				<FieldContent>
					<Input id="password" type="password" placeholder="Enter your password" />
					<FieldDescription>Must be at least 8 characters.</FieldDescription>
				</FieldContent>
			</Field>
		</div>
	),
};

// ── Textarea / Feedback ──────────────────────────────────

export const TextareaFeedback: Story = {
	name: 'Textarea',
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'A `Field` with a `Textarea` for multi-line input. Use `FieldContent` to stack the textarea and description vertically.',
			},
		},
	},
	render: () => (
		<div className="flex w-80 flex-col gap-6">
			<Field>
				<FieldLabel htmlFor="feedback">
					<FileTextIcon className="size-4" />
					Feedback
				</FieldLabel>
				<FieldContent>
					<Textarea id="feedback" placeholder="Tell us what you think…" rows={4} />
					<FieldDescription>Your feedback helps us improve the product.</FieldDescription>
				</FieldContent>
			</Field>
		</div>
	),
};

// ── Checkbox / Notifications ─────────────────────────────

export const CheckboxNotifications: Story = {
	name: 'Checkbox',
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'Use `orientation="horizontal"` on `Field` to place the label and control side-by-side. Works well with checkboxes and toggles.',
			},
		},
	},
	render: () => (
		<div className="flex w-80 flex-col gap-4">
			<Field orientation="horizontal">
				<Checkbox id="notifications" />
				<FieldLabel htmlFor="notifications">
					<BellIcon className="size-4" />
					Enable notifications
				</FieldLabel>
			</Field>
			<Field orientation="horizontal">
				<Checkbox id="marketing" />
				<FieldLabel htmlFor="marketing">
					<MailIcon className="size-4" />
					Marketing emails
				</FieldLabel>
			</Field>
		</div>
	),
};

// ── Fieldset / Address ───────────────────────────────────

export const FieldsetAddress: Story = {
	name: 'Fieldset',
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'Use `FieldSet` with `FieldLegend` to group related fields together. `FieldGroup` wraps multiple fields for consistent layout. This pattern matches the HTML `<fieldset>` / `<legend>` semantics.',
			},
		},
	},
	render: () => (
		<div className="flex w-80 flex-col">
			<FieldSet>
				<FieldLegend>Address Information</FieldLegend>
				<FieldGroup>
					<Field>
						<FieldLabel htmlFor="street">
							<MapPinIcon className="size-4" />
							Street Address
						</FieldLabel>
						<FieldContent>
							<Input id="street" placeholder="123 Main St" />
						</FieldContent>
					</Field>

					<Field>
						<FieldLabel htmlFor="city">
							<BuildingIcon className="size-4" />
							City
						</FieldLabel>
						<FieldContent>
							<Input id="city" placeholder="San Francisco" />
						</FieldContent>
					</Field>

					<Field>
						<FieldLabel htmlFor="postal">
							<GlobeIcon className="size-4" />
							Postal Code
						</FieldLabel>
						<FieldContent>
							<Input id="postal" placeholder="94105" />
						</FieldContent>
					</Field>
				</FieldGroup>
			</FieldSet>
		</div>
	),
};

// ── Validation / Error ───────────────────────────────────

export const Validation: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'Set `data-invalid` on the `Field` and `aria-invalid` on the `Input` to show error styling. Pass an error message to `FieldError` to display validation feedback.',
			},
		},
	},
	render: () => (
		<div className="flex w-80 flex-col gap-6">
			<Field data-invalid>
				<FieldLabel htmlFor="email">
					<MailIcon className="size-4" />
					Email
				</FieldLabel>
				<FieldContent>
					<Input id="email" type="email" placeholder="Enter your email" defaultValue="invalid-email" aria-invalid />
					<FieldError>Please enter a valid email address.</FieldError>
				</FieldContent>
			</Field>
		</div>
	),
};

// ── Choice Card ──────────────────────────────────────────

export const ChoiceCard: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'Wrap `Field` components inside a `FieldLabel` to create selectable card-style options. The label acts as the click target, so clicking anywhere on the card toggles the radio or checkbox inside.\n\nThe input is positioned at the **top-right** so the content (title + description) sits on the left, making the card feel more natural to read.',
			},
		},
	},
	render: () => (
		<div className="flex w-80 flex-col gap-4">
			<p className="text-sm font-medium">Compute Environment</p>
			<FieldLabel className="flex w-full cursor-pointer items-start justify-between gap-4 rounded-xl border p-4 transition-colors has-data-checked:border-primary/30 has-data-checked:bg-primary/5 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10">
				<FieldContent className="min-w-0 flex-1">
					<FieldTitle>Kubernetes</FieldTitle>
					<FieldDescription>Managed Kubernetes cluster with auto-scaling.</FieldDescription>
				</FieldContent>
				<Checkbox id="kubernetes" />
			</FieldLabel>
			<FieldLabel className="flex w-full cursor-pointer items-start justify-between gap-4 rounded-xl border p-4 transition-colors has-data-checked:border-primary/30 has-data-checked:bg-primary/5 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10">
				<FieldContent className="min-w-0 flex-1">
					<FieldTitle>Virtual Machine</FieldTitle>
					<FieldDescription>Dedicated virtual machine with root access.</FieldDescription>
				</FieldContent>
				<Checkbox id="vm" />
			</FieldLabel>
		</div>
	),
};

// ── Field Group ──────────────────────────────────────────

export const FieldGroupStory: Story = {
	name: 'Field Group',
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'Use `FieldGroup` with `FieldSeparator` to divide a group into labeled sections. Each section can contain its own set of fields with toggles, inputs, or other controls.',
			},
		},
	},
	render: () => (
		<div className="flex w-80 flex-col">
			<FieldGroup>
				{/* Responses section */}
				<Field orientation="horizontal">
					<Toggle aria-label="Auto-reply" />
					<FieldLabel htmlFor="auto-reply">
						<CheckCheckIcon className="size-4" />
						Auto-reply
					</FieldLabel>
				</Field>
				<Field orientation="horizontal">
					<Toggle aria-label="Out of office" />
					<FieldLabel htmlFor="out-of-office">
						<BellIcon className="size-4" />
						Out of office
					</FieldLabel>
				</Field>

				<FieldSeparator>Responses</FieldSeparator>

				{/* Tasks section */}
				<Field orientation="horizontal">
					<Toggle aria-label="Email notifications" />
					<FieldLabel htmlFor="email-notifications">
						<MailIcon className="size-4" />
						Email notifications
					</FieldLabel>
				</Field>
				<Field orientation="horizontal">
					<Toggle aria-label="Slack integration" />
					<FieldLabel htmlFor="slack-integration">
						<ListTodoIcon className="size-4" />
						Slack integration
					</FieldLabel>
				</Field>

				<FieldSeparator>Tasks</FieldSeparator>
			</FieldGroup>
		</div>
	),
};
