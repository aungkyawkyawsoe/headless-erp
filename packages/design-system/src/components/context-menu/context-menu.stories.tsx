import type { Meta, StoryObj } from '@storybook/react-vite';
import {
	ContextMenu,
	ContextMenuTrigger,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuCheckboxItem,
	ContextMenuRadioItem,
	ContextMenuRadioGroup,
	ContextMenuGroup,
	ContextMenuLabel,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
} from './';
import { ClipboardIcon, EditIcon, Trash2Icon, ShareIcon, CopyIcon, EyeIcon, DownloadIcon } from 'lucide-react';
import { useState } from 'react';

/**
 * Context menu displays a list of actions on right-click.
 *
 * Handles positioning, portal rendering, keyboard navigation, and
 * focus management out of the box.
 */
const meta: Meta<typeof ContextMenu> = {
	title: 'Components/ContextMenu',
	component: ContextMenu,
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				component:
					'A right-click context menu. Supports items (default and destructive), checkbox items, radio items, submenus, labels, separators, and keyboard shortcuts. Positioned automatically via the floating UI primitives.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Basic ────────────────────────────────────────────────

export const Basic: Story = {
	render: () => (
		<ContextMenu>
			<ContextMenuTrigger>
				<div className="flex h-32 w-64 cursor-context-menu items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 text-sm text-muted-foreground select-none">
					Right-click here
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem>
					<EditIcon strokeWidth={1.8} className="size-3.5" />
					Edit
				</ContextMenuItem>
				<ContextMenuItem>
					<CopyIcon strokeWidth={1.8} className="size-3.5" />
					Copy
				</ContextMenuItem>
				<ContextMenuItem>
					<ClipboardIcon strokeWidth={1.8} className="size-3.5" />
					Paste
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem>
					<Trash2Icon strokeWidth={1.8} className="size-3.5" />
					Delete
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	),
};

// ── With Icons ───────────────────────────────────────────

export const WithIcons: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Menu items can include leading icons for visual context. Icons are automatically sized using `size-4` and inherit the text color on focus.',
			},
		},
	},
	render: () => (
		<ContextMenu>
			<ContextMenuTrigger>
				<div className="flex h-32 w-64 cursor-context-menu items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 text-sm text-muted-foreground select-none">
					Right-click here
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem>
					<EyeIcon strokeWidth={1.8} className="size-3.5" />
					View
				</ContextMenuItem>
				<ContextMenuItem>
					<EditIcon strokeWidth={1.8} className="size-3.5" />
					Edit
				</ContextMenuItem>
				<ContextMenuItem>
					<DownloadIcon strokeWidth={1.8} className="size-3.5" />
					Download
				</ContextMenuItem>
				<ContextMenuItem>
					<ShareIcon strokeWidth={1.8} className="size-3.5" />
					Share
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem>
					<CopyIcon strokeWidth={1.8} className="size-3.5" />
					Copy Link
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	),
};

// ── With Shortcuts ───────────────────────────────────────

export const WithShortcuts: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use `ContextMenuShortcut` to display keyboard shortcuts alongside menu items. Shortcuts are right-aligned and visually muted.',
			},
		},
	},
	render: () => (
		<ContextMenu>
			<ContextMenuTrigger>
				<div className="flex h-32 w-64 cursor-context-menu items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 text-sm text-muted-foreground select-none">
					Right-click here
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem>
					Undo
					<ContextMenuShortcut>⌘Z</ContextMenuShortcut>
				</ContextMenuItem>
				<ContextMenuItem>
					Redo
					<ContextMenuShortcut>⇧⌘Z</ContextMenuShortcut>
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem>
					Cut
					<ContextMenuShortcut>⌘X</ContextMenuShortcut>
				</ContextMenuItem>
				<ContextMenuItem>
					Copy
					<ContextMenuShortcut>⌘C</ContextMenuShortcut>
				</ContextMenuItem>
				<ContextMenuItem>
					Paste
					<ContextMenuShortcut>⌘V</ContextMenuShortcut>
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	),
};

// ── With Checkboxes ──────────────────────────────────────

export const WithCheckboxes: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'`ContextMenuCheckboxItem` renders a toggleable checkbox item. The `checked` prop controls the checked state and a `CheckIcon` indicator is shown on the right when checked.',
			},
		},
	},
	render: () => {
		const [showHidden, setShowHidden] = useState(false);

		const [wordWrap, setWordWrap] = useState(true);

		const [minimap, setMinimap] = useState(true);

		return (
			<ContextMenu>
				<ContextMenuTrigger>
					<div className="flex h-32 w-64 cursor-context-menu items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 text-sm text-muted-foreground select-none">
						Right-click here
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuGroup>
						<ContextMenuLabel>Editor Settings</ContextMenuLabel>
					</ContextMenuGroup>
					<ContextMenuSeparator />
					<ContextMenuCheckboxItem checked={showHidden} onCheckedChange={(v) => setShowHidden(v)}>
						Show Hidden Files
					</ContextMenuCheckboxItem>
					<ContextMenuCheckboxItem checked={wordWrap} onCheckedChange={(v) => setWordWrap(v)}>
						Word Wrap
					</ContextMenuCheckboxItem>
					<ContextMenuCheckboxItem checked={minimap} onCheckedChange={(v) => setMinimap(v)}>
						Show Minimap
					</ContextMenuCheckboxItem>
				</ContextMenuContent>
			</ContextMenu>
		);
	},
};

// ── With Radio Items ─────────────────────────────────────

export const WithRadioItems: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'`ContextMenuRadioGroup` and `ContextMenuRadioItem` implement single-selection radio items. Use the `value` prop on items and `defaultValue` on the group.',
			},
		},
	},
	render: () => {
		const [theme, setTheme] = useState('system');

		return (
			<ContextMenu>
				<ContextMenuTrigger>
					<div className="flex h-32 w-64 cursor-context-menu items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 text-sm text-muted-foreground select-none">
						Right-click here
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuGroup>
						<ContextMenuLabel>Theme</ContextMenuLabel>
					</ContextMenuGroup>
					<ContextMenuSeparator />
					<ContextMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v)}>
						<ContextMenuRadioItem value="light">Light</ContextMenuRadioItem>
						<ContextMenuRadioItem value="dark">Dark</ContextMenuRadioItem>
						<ContextMenuRadioItem value="system">System</ContextMenuRadioItem>
					</ContextMenuRadioGroup>
				</ContextMenuContent>
			</ContextMenu>
		);
	},
};

// ── With Submenu ─────────────────────────────────────────

export const WithSubmenu: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'`ContextMenuSub`, `ContextMenuSubTrigger`, and `ContextMenuSubContent` create nested submenus. Submenus open on hover and close on click outside.',
			},
		},
	},
	render: () => (
		<ContextMenu>
			<ContextMenuTrigger>
				<div className="flex h-32 w-64 cursor-context-menu items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 text-sm text-muted-foreground select-none">
					Right-click here
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem>
					<EyeIcon strokeWidth={1.8} className="size-3.5" />
					View
				</ContextMenuItem>
				<ContextMenuItem>
					<EditIcon strokeWidth={1.8} className="size-3.5" />
					Edit
				</ContextMenuItem>
				<ContextMenuSub>
					<ContextMenuSubTrigger>
						<ShareIcon strokeWidth={1.8} className="size-3.5" />
						Share
					</ContextMenuSubTrigger>
					<ContextMenuSubContent>
						<ContextMenuItem>Copy Link</ContextMenuItem>
						<ContextMenuItem>Email</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuSub>
							<ContextMenuSubTrigger>Share to…</ContextMenuSubTrigger>
							<ContextMenuSubContent>
								<ContextMenuItem>Slack</ContextMenuItem>
								<ContextMenuItem>Teams</ContextMenuItem>
								<ContextMenuItem>Discord</ContextMenuItem>
							</ContextMenuSubContent>
						</ContextMenuSub>
					</ContextMenuSubContent>
				</ContextMenuSub>
				<ContextMenuSeparator />
				<ContextMenuItem>
					<DownloadIcon strokeWidth={1.8} className="size-3.5" />
					Download
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	),
};

// ── Destructive Item ─────────────────────────────────────

export const DestructiveItem: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Set `variant="destructive"` on a `ContextMenuItem` to indicate a dangerous action. Destructive items are styled in red (using the `destructive` token) and highlight with a subtle red background on focus.',
			},
		},
	},
	render: () => (
		<ContextMenu>
			<ContextMenuTrigger>
				<div className="flex h-32 w-64 cursor-context-menu items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 text-sm text-muted-foreground select-none">
					Right-click here
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem>
					<EditIcon strokeWidth={1.8} className="size-3.5" />
					Rename
				</ContextMenuItem>
				<ContextMenuItem>
					<CopyIcon strokeWidth={1.8} className="size-3.5" />
					Duplicate
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem variant="destructive">
					<Trash2Icon strokeWidth={1.8} className="size-3.5" />
					Delete Permanently
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	),
};
