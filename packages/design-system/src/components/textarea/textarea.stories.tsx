import type { Meta, StoryObj } from '@storybook/react-vite';
import { Textarea } from './';

/**
 * Textarea collects multi-line text from the user.
 *
 * A native `<textarea>` enhanced with design-system styling.
 * Uses `field-sizing-content` for automatic height adjustment
 * as the user types. Supports all native `<textarea>` props.
 */
const meta: Meta<typeof Textarea> = {
	title: 'Components/Textarea',
	component: Textarea,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A styled native `<textarea>` with `field-sizing-content` for auto-sizing height. Supports disabled, aria-invalid error states, and all standard textarea attributes like `rows`, `placeholder`, and `maxLength`.',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		placeholder: {
			control: 'text',
			description: 'Placeholder text',
			table: { category: 'Content' },
		},
		rows: {
			control: 'number',
			description: 'Number of visible text rows (min-height via field-sizing)',
			table: {
				type: { summary: 'number' },
				defaultValue: { summary: 'undefined' },
			},
		},
		disabled: {
			control: 'boolean',
			description: 'Disables interactions and applies reduced opacity',
		},
		'aria-invalid': {
			control: 'boolean',
			description: 'Marks the textarea as invalid for error styling',
		},
		defaultValue: {
			control: 'text',
			description: 'Default value',
			table: { category: 'Content' },
		},
		maxLength: {
			control: 'number',
			description: 'Maximum character length',
			table: { category: 'Validation' },
		},
	},
	args: {
		placeholder: 'Enter text…',
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Gallery ─────────────────────────────────────────────

export const AllVariants: Story = {
	name: 'All States',
	parameters: { layout: 'padded' },
	render: () => (
		<div className="flex w-80 flex-col gap-4">
			<section>
				<h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Default</h3>
				<Textarea placeholder="Write something…" />
			</section>
			<section>
				<h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">With Value</h3>
				<Textarea defaultValue="This is pre-filled text content that demonstrates how the textarea looks with content inside it." />
			</section>
			<section>
				<h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Disabled</h3>
				<Textarea placeholder="Disabled…" disabled defaultValue="Cannot edit this text." />
			</section>
			<section>
				<h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Invalid</h3>
				<Textarea placeholder="Required field…" aria-invalid="true" defaultValue="" />
			</section>
		</div>
	),
};

// ── States ──────────────────────────────────────────────

export const Default: Story = {
	args: { placeholder: 'Write something…' },
};

export const Disabled: Story = {
	args: {
		placeholder: 'Disabled…',
		disabled: true,
		defaultValue: 'Read-only content',
	},
};

export const Invalid: Story = {
	args: { placeholder: 'Required…', 'aria-invalid': true },
	parameters: {
		docs: {
			description: {
				story: 'Set `aria-invalid="true"` to show the error state. Combine with client-side validation for best UX.',
			},
		},
	},
};

export const WithRows: Story = {
	name: 'Custom Rows',
	args: { rows: 2, placeholder: 'Only 2 rows visible initially…' },
	parameters: {
		docs: {
			description: {
				story:
					'The `rows` attribute controls the initial visible height. With `field-sizing-content`, the textarea grows as you type additional lines.',
			},
		},
	},
};

export const WithMaxLength: Story = {
	args: { maxLength: 100, placeholder: 'Max 100 characters…' },
	parameters: {
		docs: {
			description: {
				story: 'Use `maxLength` to enforce a character limit. Combine with a character counter for production use.',
			},
		},
	},
};

export const LongContent: Story = {
	args: {
		defaultValue:
			'This textarea demonstrates auto-sizing with a larger block of content.\n\nPaste or type multiple paragraphs to see how field-sizing-content adjusts the height automatically.\n\nThe component grows smoothly as content is added, making it ideal for comment forms, descriptions, and free-text input fields.',
		readOnly: true,
	},
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Long content demonstrates `field-sizing-content` auto-sizing. The textarea expands to fit the content without scrolling.',
			},
		},
	},
};
