import type { Meta, StoryObj } from '@storybook/react-vite';
import {
	Command,
	CommandInput,
	CommandList,
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandShortcut,
	CommandSeparator,
	CommandDialog,
} from './';
import {
	BellIcon,
	CalculatorIcon,
	CalendarIcon,
	ClipboardPasteIcon,
	CodeIcon,
	CopyIcon,
	CreditCardIcon,
	FileTextIcon,
	FolderIcon,
	FolderPlusIcon,
	HelpCircleIcon,
	HomeIcon,
	ImageIcon,
	InboxIcon,
	LayoutGridIcon,
	ListIcon,
	PlusIcon,
	ScissorsIcon,
	SettingsIcon,
	SmileIcon,
	TrashIcon,
	UserIcon,
	ZoomInIcon,
	ZoomOutIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Kbd } from '@/kbd';

/**
 * Command palette provides a fast, keyboard-driven way to search and
 * execute commands, navigate the app, or filter through options.
 *
 * Built on [cmdk](https://cmdk.paco.me), it supports groups, items,
 * shortcuts, empty states, separators, and a dialog mode.
 */
const meta: Meta<typeof Command> = {
	title: 'Components/Command',
	component: Command,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A composable command palette built on cmdk. Use `Command` for an inline palette or `CommandDialog` for a modal overlay. Supports search filtering, keyboard navigation, groups with headings, items with shortcuts, and a custom empty state.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Demo (Inline) ────────────────────────────────────────

export const Demo: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="w-80">
			<Command className="rounded-lg border">
				<CommandInput placeholder="Type a command or search..." />
				<CommandList>
					<CommandEmpty>No results found.</CommandEmpty>
					<CommandGroup heading="Suggestions">
						<CommandItem>
							<CalendarIcon />
							<span>Calendar</span>
						</CommandItem>
						<CommandItem>
							<SmileIcon />
							<span>Search Emoji</span>
						</CommandItem>
						<CommandItem disabled>
							<CalculatorIcon />
							<span>Calculator</span>
						</CommandItem>
					</CommandGroup>
					<CommandSeparator />
					<CommandGroup heading="Settings">
						<CommandItem>
							<UserIcon />
							<span>Profile</span>
							<CommandShortcut>
								<Kbd>⌘P</Kbd>
							</CommandShortcut>
						</CommandItem>
						<CommandItem>
							<CreditCardIcon />
							<span>Billing</span>
							<CommandShortcut>
								<Kbd>⌘B</Kbd>
							</CommandShortcut>
						</CommandItem>
						<CommandItem>
							<SettingsIcon />
							<span>Settings</span>
							<CommandShortcut>
								<Kbd>⌘S</Kbd>
							</CommandShortcut>
						</CommandItem>
					</CommandGroup>
				</CommandList>
			</Command>
		</div>
	),
};

// ── Basic — Dialog ───────────────────────────────────────

export const Basic: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'A simple command menu in a dialog. `CommandDialog` wraps `Command` with a modal overlay. Click the button to open it.',
			},
		},
	},
	render: () => {
		const [open, setOpen] = useState(false);

		return (
			<div className="flex flex-col items-center gap-4">
				<button
					onClick={() => setOpen(true)}
					className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs"
				>
					Open Menu
				</button>
				<CommandDialog open={open} onOpenChange={setOpen}>
					<Command>
						<CommandInput placeholder="Type a command or search..." />
						<CommandList>
							<CommandEmpty>No results found.</CommandEmpty>
							<CommandGroup heading="Suggestions">
								<CommandItem onSelect={() => setOpen(false)}>
									<CalendarIcon />
									<span>Calendar</span>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<SmileIcon />
									<span>Search Emoji</span>
								</CommandItem>
								<CommandItem disabled>
									<CalculatorIcon />
									<span>Calculator</span>
								</CommandItem>
							</CommandGroup>
						</CommandList>
					</Command>
				</CommandDialog>
			</div>
		);
	},
};

// ── Shortcuts ────────────────────────────────────────────

export const Shortcuts: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'Items can include keyboard shortcut hints using `CommandShortcut`. Pair it with `Kbd` to render the keys as keycap badges, right-aligned in the item.',
			},
		},
	},
	render: () => {
		const [open, setOpen] = useState(false);

		return (
			<div className="flex flex-col items-center gap-4">
				<button
					onClick={() => setOpen(true)}
					className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs"
				>
					Open Menu
				</button>
				<CommandDialog open={open} onOpenChange={setOpen}>
					<Command>
						<CommandInput placeholder="Type a command or search..." />
						<CommandList>
							<CommandEmpty>No results found.</CommandEmpty>
							<CommandGroup heading="Settings">
								<CommandItem onSelect={() => setOpen(false)}>
									<UserIcon />
									<span>Profile</span>
									<CommandShortcut>
										<Kbd>⌘P</Kbd>
									</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<CreditCardIcon />
									<span>Billing</span>
									<CommandShortcut>
										<Kbd>⌘B</Kbd>
									</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<SettingsIcon />
									<span>Settings</span>
									<CommandShortcut>
										<Kbd>⌘S</Kbd>
									</CommandShortcut>
								</CommandItem>
							</CommandGroup>
						</CommandList>
					</Command>
				</CommandDialog>
			</div>
		);
	},
};

// ── Groups ────────────────────────────────────────────────

export const Groups: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'A command menu with groups, icons, and separators. Use `CommandGroup` to organize items and `CommandSeparator` between groups.',
			},
		},
	},
	render: () => {
		const [open, setOpen] = useState(false);

		return (
			<div className="flex flex-col items-center gap-4">
				<button
					onClick={() => setOpen(true)}
					className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs"
				>
					Open Menu
				</button>
				<CommandDialog open={open} onOpenChange={setOpen}>
					<Command>
						<CommandInput placeholder="Type a command or search..." />
						<CommandList>
							<CommandEmpty>No results found.</CommandEmpty>
							<CommandGroup heading="Suggestions">
								<CommandItem onSelect={() => setOpen(false)}>
									<CalendarIcon />
									<span>Calendar</span>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<SmileIcon />
									<span>Search Emoji</span>
								</CommandItem>
								<CommandItem disabled>
									<CalculatorIcon />
									<span>Calculator</span>
								</CommandItem>
							</CommandGroup>
							<CommandSeparator />
							<CommandGroup heading="Settings">
								<CommandItem onSelect={() => setOpen(false)}>
									<UserIcon />
									<span>Profile</span>
									<CommandShortcut>
										<Kbd>⌘P</Kbd>
									</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<CreditCardIcon />
									<span>Billing</span>
									<CommandShortcut>
										<Kbd>⌘B</Kbd>
									</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<SettingsIcon />
									<span>Settings</span>
									<CommandShortcut>
										<Kbd>⌘S</Kbd>
									</CommandShortcut>
								</CommandItem>
							</CommandGroup>
						</CommandList>
					</Command>
				</CommandDialog>
			</div>
		);
	},
};

// ── Scrollable ────────────────────────────────────────────

export const Scrollable: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'A scrollable command menu with many items across multiple groups. The `CommandList` has a max height and scrolls when content overflows.',
			},
		},
	},
	render: () => {
		const [open, setOpen] = useState(false);

		return (
			<div className="flex flex-col items-center gap-4">
				<button
					onClick={() => setOpen(true)}
					className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs"
				>
					Open Menu
				</button>
				<CommandDialog open={open} onOpenChange={setOpen}>
					<Command>
						<CommandInput placeholder="Type a command or search..." />
						<CommandList>
							<CommandEmpty>No results found.</CommandEmpty>
							<CommandGroup heading="Navigation">
								<CommandItem onSelect={() => setOpen(false)}>
									<HomeIcon />
									<span>Home</span>
									<CommandShortcut>
										<Kbd>⌘H</Kbd>
									</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<InboxIcon />
									<span>Inbox</span>
									<CommandShortcut>
										<Kbd>⌘I</Kbd>
									</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<FileTextIcon />
									<span>Documents</span>
									<CommandShortcut>
										<Kbd>⌘D</Kbd>
									</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<FolderIcon />
									<span>Folders</span>
									<CommandShortcut>
										<Kbd>⌘F</Kbd>
									</CommandShortcut>
								</CommandItem>
							</CommandGroup>
							<CommandSeparator />
							<CommandGroup heading="Actions">
								<CommandItem onSelect={() => setOpen(false)}>
									<PlusIcon />
									<span>New File</span>
									<CommandShortcut>
										<Kbd>⌘N</Kbd>
									</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<FolderPlusIcon />
									<span>New Folder</span>
									<CommandShortcut>
										<Kbd>⇧⌘N</Kbd>
									</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<CopyIcon />
									<span>Copy</span>
									<CommandShortcut>
										<Kbd>⌘C</Kbd>
									</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<ScissorsIcon />
									<span>Cut</span>
									<CommandShortcut>
										<Kbd>⌘X</Kbd>
									</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<ClipboardPasteIcon />
									<span>Paste</span>
									<CommandShortcut>
										<Kbd>⌘V</Kbd>
									</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<TrashIcon />
									<span>Delete</span>
									<CommandShortcut>
										<Kbd>⌫</Kbd>
									</CommandShortcut>
								</CommandItem>
							</CommandGroup>
							<CommandSeparator />
							<CommandGroup heading="View">
								<CommandItem onSelect={() => setOpen(false)}>
									<LayoutGridIcon />
									<span>Grid View</span>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<ListIcon />
									<span>List View</span>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<ZoomInIcon />
									<span>Zoom In</span>
									<CommandShortcut>
										<Kbd>⌘+</Kbd>
									</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<ZoomOutIcon />
									<span>Zoom Out</span>
									<CommandShortcut>
										<Kbd>⌘-</Kbd>
									</CommandShortcut>
								</CommandItem>
							</CommandGroup>
							<CommandSeparator />
							<CommandGroup heading="Account">
								<CommandItem onSelect={() => setOpen(false)}>
									<UserIcon />
									<span>Profile</span>
									<CommandShortcut>
										<Kbd>⌘P</Kbd>
									</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<CreditCardIcon />
									<span>Billing</span>
									<CommandShortcut>
										<Kbd>⌘B</Kbd>
									</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<SettingsIcon />
									<span>Settings</span>
									<CommandShortcut>
										<Kbd>⌘S</Kbd>
									</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<BellIcon />
									<span>Notifications</span>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<HelpCircleIcon />
									<span>Help & Support</span>
								</CommandItem>
							</CommandGroup>
							<CommandSeparator />
							<CommandGroup heading="Tools">
								<CommandItem onSelect={() => setOpen(false)}>
									<CalculatorIcon />
									<span>Calculator</span>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<CalendarIcon />
									<span>Calendar</span>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<ImageIcon />
									<span>Image Editor</span>
								</CommandItem>
								<CommandItem onSelect={() => setOpen(false)}>
									<CodeIcon />
									<span>Code Editor</span>
								</CommandItem>
							</CommandGroup>
						</CommandList>
					</Command>
				</CommandDialog>
			</div>
		);
	},
};

// ── Search Filtering ─────────────────────────────────────

export const SearchFiltering: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Typing in the search input filters items automatically. The empty state is shown when nothing matches.',
			},
		},
	},
	render: () => (
		<div className="w-80">
			<Command shouldFilter className="rounded-lg border">
				<CommandInput placeholder="Search files…" />
				<CommandList>
					<CommandEmpty>No results found.</CommandEmpty>
					<CommandGroup heading="Recent">
						<CommandItem>
							<FileTextIcon />
							<span>README.md</span>
						</CommandItem>
						<CommandItem>
							<FileTextIcon />
							<span>package.json</span>
						</CommandItem>
						<CommandItem>
							<FileTextIcon />
							<span>tsconfig.json</span>
						</CommandItem>
						<CommandItem>
							<FileTextIcon />
							<span>.gitignore</span>
						</CommandItem>
					</CommandGroup>
					<CommandSeparator />
					<CommandGroup heading="Documents">
						<CommandItem>
							<FileTextIcon />
							<span>design-specs.pdf</span>
						</CommandItem>
						<CommandItem>
							<FileTextIcon />
							<span>architecture.md</span>
						</CommandItem>
						<CommandItem>
							<FileTextIcon />
							<span>api-docs.md</span>
						</CommandItem>
					</CommandGroup>
				</CommandList>
			</Command>
		</div>
	),
};

// ── Empty State ──────────────────────────────────────────

export const EmptyState: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'The `CommandEmpty` component is shown when no items match the current search query. Customize the message to guide users.',
			},
		},
	},
	render: () => (
		<div className="w-80">
			<Command className="rounded-lg border">
				<CommandInput placeholder="Type something…" defaultValue="zzzz" />
				<CommandList>
					<CommandEmpty>No results found.</CommandEmpty>
					<CommandGroup heading="Anything">
						<CommandItem>
							<FileTextIcon />
							<span>This won't match</span>
						</CommandItem>
					</CommandGroup>
				</CommandList>
			</Command>
		</div>
	),
};
