import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { SearchBox } from './';
import { Button } from '@/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/field';

/**
 * `SearchBox` is a self-contained search input with a trailing icon.
 *
 * - Empty: placeholder with a magnifier icon at the end of the field.
 * - Typed: the icon swaps to a circular clear (X) button that resets the
 *   value and returns focus to the input.
 *
 * Built on top of the `Input` primitive. Works controlled or uncontrolled.
 */
const meta: Meta<typeof SearchBox> = {
	title: 'Components/SearchBox',
	component: SearchBox,
	tags: ['autodocs'],
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A self-contained search input. Shows a placeholder with a magnifier icon while empty, and swaps to a clear (X) button once the user types. Supports controlled and uncontrolled usage.',
			},
		},
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Overview ─────────────────────────────────────────────

export const Overview: Story = {
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story: 'The default `SearchBox`. Type into the field to reveal the clear button. Works out of the box with no props required.',
			},
		},
	},
	render: () => (
		<div className="flex w-72 flex-col gap-4">
			<SearchBox />
			<SearchBox placeholder="Search users..." />
		</div>
	),
};

// ── Typing / Clear ───────────────────────────────────────

export const Typing: Story = {
	name: 'Typing & Clear',
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story:
					'While empty, a magnifier icon sits at the end of the field. Once the user types, the icon is replaced by a clear (X) button that resets the value and returns focus to the input.',
			},
		},
	},
	render: function TypingStory() {
		const [value, setValue] = useState('');
		const [cleared, setCleared] = useState(false);
		return (
			<div className="flex w-80 flex-col gap-3">
				<SearchBox
					value={value}
					onValueChange={(next) => {
						setValue(next);
						setCleared(false);
					}}
					onClear={() => setCleared(true)}
					placeholder="Typing something..."
				/>
				<div className="flex items-center justify-between text-sm text-muted-foreground">
					<span>
						Current value: <span className="font-medium text-foreground">"{value}"</span>
					</span>
					{cleared && <span className="text-muted-foreground">Cleared ✓</span>}
				</div>
			</div>
		);
	},
};

// ── Controlled ───────────────────────────────────────────

export const Controlled: Story = {
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story: 'Controlled mode via `value` and `onValueChange`. The button below pre-fills the field from outside.',
			},
		},
	},
	render: function ControlledStory() {
		const [value, setValue] = useState('');
		return (
			<div className="flex w-80 flex-col gap-3">
				<SearchBox value={value} onValueChange={setValue} placeholder="Controlled search..." />
				<Button variant="outline" size="sm" onClick={() => setValue('invoices')} className="self-start">
					Set value to &quot;invoices&quot;
				</Button>
			</div>
		);
	},
};

// ── Sizes ────────────────────────────────────────────────

export const Sizes: Story = {
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story:
					'The default height matches the `Input` primitive (h-7). Use `inputClassName` to override the height when a different size is needed.',
			},
		},
	},
	render: () => (
		<div className="flex w-72 flex-col gap-4">
			<SearchBox placeholder="Default (h-7)" />
			<SearchBox placeholder="Compact (h-6)" inputClassName="h-6" />
		</div>
	),
};

// ── With Field ───────────────────────────────────────────

export const WithField: Story = {
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story: 'Compose with `Field`, `FieldLabel`, and `FieldDescription` for labeled forms.',
			},
		},
	},
	render: () => (
		<FieldGroup className="w-80">
			<Field>
				<FieldLabel htmlFor="search-orders">Search orders</FieldLabel>
				<SearchBox id="search-orders" placeholder="Order #, customer..." />
				<FieldDescription>Matches order numbers and customer names.</FieldDescription>
			</Field>
		</FieldGroup>
	),
};
