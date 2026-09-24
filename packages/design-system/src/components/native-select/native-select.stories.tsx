import type { Meta, StoryObj } from '@storybook/react-vite';
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from './';

/**
 * A styled native HTML select element with consistent design system
 * integration. Use `NativeSelect` for native browser behavior, better
 * performance, or mobile-optimized dropdowns.
 *
 * For a styled select component, see the Select component.
 */
const meta: Meta<typeof NativeSelect> = {
	title: 'Components/NativeSelect',
	component: NativeSelect,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A styled native HTML select element. Supports `NativeSelectOption` for individual options and `NativeSelectOptGroup` for grouping options into categories.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Demo ─────────────────────────────────────────────────

export const Demo: Story = {
	render: () => (
		<NativeSelect>
			<NativeSelectOption value="">Select status</NativeSelectOption>
			<NativeSelectOption value="todo">Todo</NativeSelectOption>
			<NativeSelectOption value="in-progress">In Progress</NativeSelectOption>
			<NativeSelectOption value="done">Done</NativeSelectOption>
			<NativeSelectOption value="cancelled">Cancelled</NativeSelectOption>
		</NativeSelect>
	),
};

// ── Fruits (Basic usage) ─────────────────────────────────

export const Fruits: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A basic native select with simple options placed directly under `NativeSelect`.',
			},
		},
	},
	render: () => (
		<NativeSelect>
			<NativeSelectOption value="">Select a fruit</NativeSelectOption>
			<NativeSelectOption value="apple">Apple</NativeSelectOption>
			<NativeSelectOption value="banana">Banana</NativeSelectOption>
			<NativeSelectOption value="blueberry">Blueberry</NativeSelectOption>
			<NativeSelectOption value="pineapple">Pineapple</NativeSelectOption>
		</NativeSelect>
	),
};

// ── Groups ───────────────────────────────────────────────

export const Groups: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `NativeSelectOptGroup` to organize options into categories with labels.',
			},
		},
	},
	render: () => (
		<NativeSelect>
			<NativeSelectOption value="">Select department</NativeSelectOption>
			<NativeSelectOptGroup label="Engineering">
				<NativeSelectOption value="frontend">Frontend</NativeSelectOption>
				<NativeSelectOption value="backend">Backend</NativeSelectOption>
				<NativeSelectOption value="devops">DevOps</NativeSelectOption>
			</NativeSelectOptGroup>
			<NativeSelectOptGroup label="Sales">
				<NativeSelectOption value="sales-rep">Sales Rep</NativeSelectOption>
				<NativeSelectOption value="account-manager">Account Manager</NativeSelectOption>
				<NativeSelectOption value="sales-director">Sales Director</NativeSelectOption>
			</NativeSelectOptGroup>
			<NativeSelectOptGroup label="Support">
				<NativeSelectOption value="customer-support">Customer Support</NativeSelectOption>
			</NativeSelectOptGroup>
			<NativeSelectOptGroup label="Product">
				<NativeSelectOption value="product-manager">Product Manager</NativeSelectOption>
				<NativeSelectOption value="operations-manager">Operations Manager</NativeSelectOption>
			</NativeSelectOptGroup>
		</NativeSelect>
	),
};

// ── Disabled ─────────────────────────────────────────────

export const Disabled: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Add the `disabled` prop to the `NativeSelect` component to disable the select.',
			},
		},
	},
	render: () => (
		<NativeSelect disabled>
			<NativeSelectOption value="">Disabled</NativeSelectOption>
			<NativeSelectOption value="apple">Apple</NativeSelectOption>
			<NativeSelectOption value="banana">Banana</NativeSelectOption>
			<NativeSelectOption value="blueberry">Blueberry</NativeSelectOption>
		</NativeSelect>
	),
};

// ── Invalid ──────────────────────────────────────────────

export const Invalid: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `aria-invalid` to show validation errors. Pair with `data-invalid` on a `Field` wrapper for additional styling.',
			},
		},
	},
	render: () => (
		<NativeSelect aria-invalid>
			<NativeSelectOption value="">Error state</NativeSelectOption>
			<NativeSelectOption value="apple">Apple</NativeSelectOption>
			<NativeSelectOption value="banana">Banana</NativeSelectOption>
			<NativeSelectOption value="blueberry">Blueberry</NativeSelectOption>
		</NativeSelect>
	),
};
