import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import {
	Menubar,
	MenubarMenu,
	MenubarTrigger,
	MenubarContent,
	MenubarItem,
	MenubarCheckboxItem,
	MenubarRadioGroup,
	MenubarRadioItem,
	MenubarSeparator,
	MenubarShortcut,
	MenubarLabel,
	MenubarSub,
	MenubarSubTrigger,
	MenubarSubContent,
} from './';
import { FileIcon, EditIcon, FolderIcon, DownloadIcon, ShareIcon, PlusIcon, Trash2Icon } from 'lucide-react';

/**
 * A desktop-style menubar with dropdown menus.
 */
const meta: Meta<typeof Menubar> = {
	title: 'Components/Menubar',
	component: Menubar,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A visually persistent menu common in desktop applications that provides quick access to a consistent set of commands. Compose with `<MenubarMenu>`, `<MenubarTrigger>`, `<MenubarContent>`, `<MenubarItem>`, `<MenubarCheckboxItem>`, `<MenubarRadioGroup>`, and `<MenubarSub>`.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Default ────────────────────────────────────────────

export const Default: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A full menubar with File, Edit, View, and Profiles menus.',
			},
		},
	},
	render: () => (
		<Menubar>
			<MenubarMenu>
				<MenubarTrigger>File</MenubarTrigger>
				<MenubarContent>
					<MenubarItem>
						New Tab <MenubarShortcut>⌘T</MenubarShortcut>
					</MenubarItem>
					<MenubarItem>New Window</MenubarItem>
					<MenubarSeparator />
					<MenubarItem>Share</MenubarItem>
					<MenubarItem>Print</MenubarItem>
				</MenubarContent>
			</MenubarMenu>
			<MenubarMenu>
				<MenubarTrigger>Edit</MenubarTrigger>
				<MenubarContent>
					<MenubarItem>
						Undo <MenubarShortcut>⌘Z</MenubarShortcut>
					</MenubarItem>
					<MenubarItem>
						Redo <MenubarShortcut>⇧⌘Z</MenubarShortcut>
					</MenubarItem>
					<MenubarSeparator />
					<MenubarItem>
						Cut <MenubarShortcut>⌘X</MenubarShortcut>
					</MenubarItem>
					<MenubarItem>
						Copy <MenubarShortcut>⌘C</MenubarShortcut>
					</MenubarItem>
					<MenubarItem>
						Paste <MenubarShortcut>⌘V</MenubarShortcut>
					</MenubarItem>
					<MenubarSeparator />
					<MenubarItem>
						Delete <MenubarShortcut>⌘⌫</MenubarShortcut>
					</MenubarItem>
				</MenubarContent>
			</MenubarMenu>
			<MenubarMenu>
				<MenubarTrigger>View</MenubarTrigger>
				<MenubarContent>
					<MenubarCheckboxItem checked>Always Show Bookmarks Bar</MenubarCheckboxItem>
					<MenubarCheckboxItem>Always Show Full URLs</MenubarCheckboxItem>
				</MenubarContent>
			</MenubarMenu>
			<MenubarMenu>
				<MenubarTrigger>Profiles</MenubarTrigger>
				<MenubarContent>
					<MenubarRadioGroup value="default">
						<MenubarRadioItem value="default">Default</MenubarRadioItem>
						<MenubarRadioItem value="personal">Personal</MenubarRadioItem>
						<MenubarRadioItem value="work">Work</MenubarRadioItem>
					</MenubarRadioGroup>
				</MenubarContent>
			</MenubarMenu>
		</Menubar>
	),
};

// ── Checkbox ───────────────────────────────────────────

export const Checkbox: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `MenubarCheckboxItem` for toggleable options in the View and Format menus.',
			},
		},
	},
	render: function CheckboxStory() {
		const [bookmarksBar, setBookmarksBar] = useState(true);
		const [fullUrls, setFullUrls] = useState(false);
		const [statusBar, setStatusBar] = useState(true);

		return (
			<Menubar>
				<MenubarMenu>
					<MenubarTrigger>View</MenubarTrigger>
					<MenubarContent>
						<MenubarCheckboxItem checked={bookmarksBar} onCheckedChange={setBookmarksBar}>
							Show Bookmark Bar
						</MenubarCheckboxItem>
						<MenubarCheckboxItem checked={fullUrls} onCheckedChange={setFullUrls}>
							Show Full URLs
						</MenubarCheckboxItem>
						<MenubarCheckboxItem checked={statusBar} onCheckedChange={setStatusBar}>
							Show Status Bar
						</MenubarCheckboxItem>
					</MenubarContent>
				</MenubarMenu>
				<MenubarMenu>
					<MenubarTrigger>Format</MenubarTrigger>
					<MenubarContent>
						<MenubarCheckboxItem checked>Bold</MenubarCheckboxItem>
						<MenubarCheckboxItem>Italic</MenubarCheckboxItem>
						<MenubarCheckboxItem>Underline</MenubarCheckboxItem>
						<MenubarCheckboxItem>Strikethrough</MenubarCheckboxItem>
					</MenubarContent>
				</MenubarMenu>
			</Menubar>
		);
	},
};

// ── Radio ──────────────────────────────────────────────

export const Radio: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `MenubarRadioGroup` and `MenubarRadioItem` for single-select options such as user profiles and theme selection.',
			},
		},
	},
	render: function RadioStory() {
		const [profile, setProfile] = useState('default');
		const [theme, setTheme] = useState('system');

		return (
			<Menubar>
				<MenubarMenu>
					<MenubarTrigger>Profiles</MenubarTrigger>
					<MenubarContent>
						<MenubarRadioGroup value={profile} onValueChange={setProfile}>
							<MenubarLabel inset>User Profiles</MenubarLabel>
							<MenubarRadioItem value="default">Default</MenubarRadioItem>
							<MenubarRadioItem value="personal">Personal</MenubarRadioItem>
							<MenubarRadioItem value="work">Work</MenubarRadioItem>
						</MenubarRadioGroup>
					</MenubarContent>
				</MenubarMenu>
				<MenubarMenu>
					<MenubarTrigger>Theme</MenubarTrigger>
					<MenubarContent>
						<MenubarRadioGroup value={theme} onValueChange={setTheme}>
							<MenubarRadioItem value="light">Light</MenubarRadioItem>
							<MenubarRadioItem value="dark">Dark</MenubarRadioItem>
							<MenubarRadioItem value="system">System</MenubarRadioItem>
						</MenubarRadioGroup>
					</MenubarContent>
				</MenubarMenu>
			</Menubar>
		);
	},
};

// ── Submenu ────────────────────────────────────────────

export const Submenu: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `MenubarSub`, `MenubarSubTrigger`, and `MenubarSubContent` for nested menus.',
			},
		},
	},
	render: () => (
		<Menubar>
			<MenubarMenu>
				<MenubarTrigger>File</MenubarTrigger>
				<MenubarContent>
					<MenubarItem>New File</MenubarItem>
					<MenubarItem>Open…</MenubarItem>
					<MenubarSeparator />
					<MenubarSub>
						<MenubarSubTrigger>Share</MenubarSubTrigger>
						<MenubarSubContent>
							<MenubarItem>Email</MenubarItem>
							<MenubarItem>Copy Link</MenubarItem>
							<MenubarItem>Slack</MenubarItem>
						</MenubarSubContent>
					</MenubarSub>
					<MenubarSeparator />
					<MenubarItem>Print</MenubarItem>
				</MenubarContent>
			</MenubarMenu>
			<MenubarMenu>
				<MenubarTrigger>Edit</MenubarTrigger>
				<MenubarContent>
					<MenubarItem>Undo</MenubarItem>
					<MenubarItem>Redo</MenubarItem>
					<MenubarSeparator />
					<MenubarItem>Cut</MenubarItem>
					<MenubarItem>Copy</MenubarItem>
					<MenubarItem>Paste</MenubarItem>
				</MenubarContent>
			</MenubarMenu>
		</Menubar>
	),
};

// ── With Icons ─────────────────────────────────────────

export const WithIcons: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Add leading icons to menu items for visual clarity.',
			},
		},
	},
	render: () => (
		<Menubar>
			<MenubarMenu>
				<MenubarTrigger>
					<FileIcon className="size-3.5" />
					File
				</MenubarTrigger>
				<MenubarContent>
					<MenubarItem>
						<FolderIcon className="size-3.5" strokeWidth={1.6} />
						New File
					</MenubarItem>
					<MenubarItem>
						<DownloadIcon className="size-3.5" strokeWidth={1.6} />
						Open…
					</MenubarItem>
					<MenubarItem>
						<DownloadIcon className="size-3.5" strokeWidth={1.6} />
						Save
					</MenubarItem>
					<MenubarSeparator />
					<MenubarItem>
						<ShareIcon className="size-3.5" strokeWidth={1.6} />
						Share
					</MenubarItem>
					<MenubarItem>
						<PlusIcon className="size-3.5" strokeWidth={1.6} />
						Add to Favorites
					</MenubarItem>
					<MenubarSeparator />
					<MenubarItem>
						<Trash2Icon className="size-3.5" strokeWidth={1.6} />
						Move to Trash
					</MenubarItem>
				</MenubarContent>
			</MenubarMenu>
			<MenubarMenu>
				<MenubarTrigger>
					<EditIcon className="size-3.5" strokeWidth={1.6} />
					More
				</MenubarTrigger>
				<MenubarContent>
					<MenubarItem>Settings</MenubarItem>
					<MenubarItem>Help</MenubarItem>
					<MenubarSeparator />
					<MenubarItem>About</MenubarItem>
				</MenubarContent>
			</MenubarMenu>
		</Menubar>
	),
};
