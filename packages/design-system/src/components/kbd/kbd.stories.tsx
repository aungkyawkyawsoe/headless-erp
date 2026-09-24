import type { Meta, StoryObj } from '@storybook/react-vite';
import { SearchIcon } from 'lucide-react';
import { Kbd, KbdGroup } from './';
import { Separator } from '@/separator';

/**
 * Keyboard shortcut indicator. Use `Kbd` for individual keycaps and
 * `KbdGroup` for multi-key combinations. Renders a semantic `<kbd>`
 * element with muted styling and auto-sized SVG children.
 */
const meta: Meta<typeof Kbd> = {
	title: 'Components/Kbd',
	component: Kbd,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A keycap badge for keyboard shortcuts. Single keys render as a compact `<kbd>`, and `KbdGroup` lets you compose multi-key sequences with consistent gap and alignment.',
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
				story: 'A single keyboard shortcut, e.g. ⌘K. Use `Kbd` for individual keycaps.',
			},
		},
	},
	render: () => <Kbd>⌘K</Kbd>,
};

// ── With Group ───────────────────────────────────────────

export const WithGroup: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Group multiple keys together with `KbdGroup`. The group renders as a `<kbd>` element with an inline-flex layout and consistent gap between children.',
			},
		},
	},
	render: () => (
		<KbdGroup>
			<Kbd>⌘</Kbd>
			<Kbd>⇧</Kbd>
			<Kbd>K</Kbd>
		</KbdGroup>
	),
};

// ── In Text ──────────────────────────────────────────────

export const InText: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Inline `Kbd` rendered inside a paragraph. Useful for documenting shortcuts in instructional text.',
			},
		},
	},
	render: () => (
		<p className="text-sm text-muted-foreground">
			Press <Kbd>⌘K</Kbd> to open the command palette, or{' '}
			<KbdGroup>
				<Kbd>⌘</Kbd>
				<Kbd>⇧</Kbd>
				<Kbd>P</Kbd>
			</KbdGroup>{' '}
			to open the settings.
		</p>
	),
};

// ── Shortcuts List ──────────────────────────────────────────

const shortcuts = [
	{ label: 'Search', keys: ['⌘', 'K'] },
	{ label: 'New File', keys: ['⌘', 'N'] },
	{ label: 'Save', keys: ['⌘', 'S'] },
	{ label: 'Undo', keys: ['⌘', 'Z'] },
	{ label: 'Redo', keys: ['⌘', '⇧', 'Z'] },
];

export const ShortcutsList: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'A common settings-style pattern: a list of shortcut descriptions with their key combinations aligned on the right. Pairs `KbdGroup` with `Separator` for a clean, scannable layout.',
			},
		},
	},
	render: () => (
		<div className="mx-auto flex w-full flex-col">
			<p className="mb-3 text-sm font-medium">Keyboard Shortcuts</p>
			<Separator />
			<div className="flex flex-col">
				{shortcuts.map((shortcut) => (
					<div key={shortcut.label} className="flex items-center justify-between border-b py-2.5 last:border-b-0">
						<span className="text-sm text-muted-foreground">{shortcut.label}</span>
						<KbdGroup>
							{shortcut.keys.map((key) => (
								<Kbd key={key}>{key}</Kbd>
							))}
						</KbdGroup>
					</div>
				))}
			</div>
		</div>
	),
};

// ── With Icon ───────────────────────────────────────────────

export const WithIcon: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'`Kbd` auto-sizes SVG children to match the keycap. Useful for action hints, e.g. a search shortcut in a command palette trigger.',
			},
		},
	},
	render: () => (
		<Kbd>
			<SearchIcon />K
		</Kbd>
	),
};
