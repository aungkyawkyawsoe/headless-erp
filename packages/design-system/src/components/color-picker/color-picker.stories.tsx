import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { ColorPicker } from './';
import { Label } from '../label';

/**
 * ColorPicker lets users pick a color from the native OS color picker
 * or type a value directly, in HEX, RGB, HSL or OKLCH.
 *
 * The swatch shows the currently selected color and opens the browser's
 * native color picker on click. The text field accepts values in the active
 * format (`format` / `defaultFormat`), and the dropdown next to it switches
 * between the formats listed in `formats` (all four by default).
 * The component keeps its own internal state, so it reflects the picked
 * color even when used without a controlled `value`, while still notifying
 * parents via `onChange`.
 */
const meta: Meta<typeof ColorPicker> = {
	title: 'Components/ColorPicker',
	component: ColorPicker,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A color picker combining a swatch (opens the native color picker) with a text field that supports HEX, RGB, HSL and OKLCH. The format can be fixed via `format`, limited via `formats`, or left fully user-switchable. Supports controlled and uncontrolled usage, disabled state, and custom placeholder text.',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		value: {
			control: 'text',
			description:
				'Selected color as a CSS string in any supported format (`#rrggbb`, `#rrggbbaa`, `rgb()`, `hsl()`, `oklch()`). Falls back to `#000000` when invalid.',
			table: { type: { summary: 'string' }, category: 'State' },
		},
		format: {
			control: 'select',
			options: ['hex', 'rgb', 'hsl', 'oklch'],
			description: 'Format of the text field. Controlled version of `defaultFormat`.',
			table: { type: { summary: 'ColorFormat' }, category: 'State' },
		},
		defaultFormat: {
			control: 'select',
			options: ['hex', 'rgb', 'hsl', 'oklch'],
			description: 'Format of the text field when uncontrolled. Defaults to `"hex"`.',
			table: { type: { summary: 'ColorFormat' }, category: 'State' },
		},
		formats: {
			control: 'object',
			description: 'Formats offered in the format switcher dropdown. Defaults to all four. Pass a single entry to lock the format.',
			table: { type: { summary: 'ColorFormat[]' }, category: 'State' },
		},
		placeholder: {
			control: 'text',
			description: 'Placeholder text for the color input',
			table: { type: { summary: 'string' }, category: 'Content' },
		},
		disabled: {
			control: 'boolean',
			description: 'Disables the picker and applies reduced opacity',
			table: { type: { summary: 'boolean' } },
		},
		className: {
			control: 'text',
			description: 'Additional classes for the root wrapper',
			table: { type: { summary: 'string' }, category: 'Styling' },
		},
		onChange: {
			control: false,
			description:
				'Called with the new color whenever it changes — the raw text while typing, or the canonical value in the active format when picked from the swatch or switched format.',
			table: {
				type: { summary: '(value: string) => void' },
				category: 'Events',
			},
		},
		onFormatChange: {
			control: false,
			description: 'Called with the new format whenever the user switches it',
			table: {
				type: { summary: '(format: ColorFormat) => void' },
				category: 'Events',
			},
		},
	},
	args: {
		placeholder: 'Pick a color',
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Gallery ─────────────────────────────────────────────

export const AllStates: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="flex flex-col items-start gap-4">
			{[
				{ label: 'Primary blue', value: '#3b82f6' },
				{ label: 'RGB value', value: 'rgb(34 197 94)' },
				{ label: 'HSL value', value: 'hsl(16 100% 60%)' },
				{ label: 'OKLCH value', value: 'oklch(0.623 0.188 259.81)' },
				{ label: 'Custom placeholder', value: undefined },
				{ label: 'Disabled', value: '#ef4444', disabled: true },
			].map((item) => (
				<div key={item.label} className="flex items-center gap-3">
					<ColorPicker value={item.value} disabled={item.disabled} placeholder="Choose a color" />
					<span className="text-xs text-muted-foreground">{item.label}</span>
				</div>
			))}
		</div>
	),
};

// ── Formats ─────────────────────────────────────────────

export const Formats: Story = {
	name: 'Fixed Format',
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'Lock the text field to one format by passing `formats` with a single entry — the switcher disappears. `value` can still be supplied in any format.',
			},
		},
	},
	render: () => (
		<div className="flex flex-col items-start gap-4">
			{(
				[
					['HEX', 'hex', '#3b82f6'],
					['RGB', 'rgb', 'rgb(59 130 246)'],
					['HSL', 'hsl', 'hsl(217 91% 60%)'],
					['OKLCH', 'oklch', 'oklch(0.623 0.188 259.81)'],
				] as const
			).map(([label, format, value]) => (
				<div key={format} className="flex items-center gap-3">
					<ColorPicker
						value={value}
						formats={[format]}
						onChange={(v) => {
							console.log(`${label}:`, v);
						}}
					/>
					<span className="text-xs text-muted-foreground">{label}</span>
				</div>
			))}
		</div>
	),
};

export const LimitedFormats: Story = {
	name: 'Limited Format Options',
	args: { value: '#22c55e', formats: ['hex', 'hsl'] },
	parameters: {
		docs: {
			description: {
				story: 'Restrict the switcher to a subset of formats — here only HEX and HSL are offered.',
			},
		},
	},
};

// ── States ──────────────────────────────────────────────

export const Default: Story = {
	args: { value: '#3b82f6' },
};

export const Disabled: Story = {
	args: { value: '#ef4444', disabled: true },
	parameters: {
		docs: {
			description: {
				story: 'Set `disabled` to prevent picking, typing, or switching formats. The swatch keeps its color but interactions are blocked.',
			},
		},
	},
};

export const Empty: Story = {
	name: 'Empty / Custom Placeholder',
	args: { placeholder: 'Choose brand color' },
	parameters: {
		docs: {
			description: {
				story: 'When no `value` is provided the picker falls back to `#000000`, and the input shows the placeholder text.',
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
				story:
					'A controlled example using `useState`. Pick a color from the native picker, type a value, or switch formats — the swatch, input, and caption stay in sync.',
			},
		},
	},
	render: () => {
		const [color, setColor] = useState('#3b82f6');
		return (
			<div className="flex flex-col items-start gap-3">
				<ColorPicker value={color} onChange={setColor} />
				<span className="text-xs text-muted-foreground">
					Selected: <code className="font-mono text-foreground">{color}</code>
				</span>
			</div>
		);
	},
};

export const ControlledFormat: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Drive the format from outside with `format` and `onFormatChange`. `onChange` emits values in the active format.',
			},
		},
	},
	render: () => {
		const [format, setFormat] = useState<'hex' | 'rgb' | 'hsl' | 'oklch'>('hsl');
		const [color, setColor] = useState('hsl(217 91% 60%)');
		return (
			<div className="flex flex-col items-start gap-3">
				<ColorPicker value={color} onChange={setColor} format={format} onFormatChange={setFormat} />
				<span className="text-xs text-muted-foreground">
					{format.toUpperCase()}: <code className="font-mono text-foreground">{color}</code>
				</span>
			</div>
		);
	},
};

// ── With Label ──────────────────────────────────────────

export const WithLabel: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="flex w-96 flex-col gap-2">
			<Label>Brand color</Label>
			<ColorPicker value="#8b5cf6" />
		</div>
	),
};
