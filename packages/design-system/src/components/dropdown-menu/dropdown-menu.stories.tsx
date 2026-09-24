import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuCheckboxItem,
	DropdownMenuRadioItem,
	DropdownMenuRadioGroup,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from './';
import { Button } from '../button';
import {
	UserIcon,
	SettingsIcon,
	CreditCardIcon,
	LogOutIcon,
	MailIcon,
	LinkIcon,
	Trash2Icon,
	EyeIcon,
	EyeOffIcon,
	BellIcon,
	BellOffIcon,
} from 'lucide-react';

/**
 * A dropdown menu displaying a list of actions or options. Supports items,
 * checkbox items, radio items, submenus, labels, separators, and keyboard
 * shortcuts.
 */
const meta: Meta<typeof DropdownMenu> = {
	title: 'Components/DropdownMenu',
	component: DropdownMenu,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A dropdown menu. Displays a list of actions triggered by clicking a button. Supports default and destructive items, checkboxes, radio groups, submenus, labels, separators, and keyboard shortcuts. Automatically handles positioning, portal rendering, and keyboard navigation.',
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
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="outline">Open Menu</Button>} />
			<DropdownMenuContent>
				<DropdownMenuItem>Profile</DropdownMenuItem>
				<DropdownMenuItem>Settings</DropdownMenuItem>
				<DropdownMenuItem>Billing</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem>Logout</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	),
};

// ── With Icons ───────────────────────────────────────────

export const WithIcons: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Menu items can include leading icons from lucide-react for visual context. Icons are automatically sized and inherit text color on focus.',
			},
		},
	},
	render: () => (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="outline">Open Menu</Button>} />
			<DropdownMenuContent>
				<DropdownMenuItem>
					<UserIcon />
					Profile
				</DropdownMenuItem>
				<DropdownMenuItem>
					<SettingsIcon />
					Settings
				</DropdownMenuItem>
				<DropdownMenuItem>
					<CreditCardIcon />
					Billing
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem>
					<LogOutIcon />
					Logout
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	),
};

// ── With Shortcuts ───────────────────────────────────────

export const WithShortcuts: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use `DropdownMenuShortcut` to display keyboard shortcuts alongside menu items. Shortcuts are right-aligned and visually muted.',
			},
		},
	},
	render: () => (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="outline">Open Menu</Button>} />
			<DropdownMenuContent>
				<DropdownMenuItem>
					Profile
					<DropdownMenuShortcut>⌘P</DropdownMenuShortcut>
				</DropdownMenuItem>
				<DropdownMenuItem>
					Settings
					<DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
				</DropdownMenuItem>
				<DropdownMenuItem>
					Billing
					<DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem>
					Logout
					<DropdownMenuShortcut>⇧⌘L</DropdownMenuShortcut>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	),
};

// ── With Checkboxes ──────────────────────────────────────

export const WithCheckboxes: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'`DropdownMenuCheckboxItem` renders a toggleable checkbox item. The `checked` prop controls state and a check indicator is shown on the right when checked. Use `onCheckedChange` to respond to toggles.',
			},
		},
	},
	render: function WithCheckboxesStory() {
		const [showNotifications, setShowNotifications] = useState(true);

		const [showBadges, setShowBadges] = useState(false);

		return (
			<DropdownMenu>
				<DropdownMenuTrigger render={<Button variant="outline">View Options</Button>} />
				<DropdownMenuContent>
					<DropdownMenuGroup>
						<DropdownMenuLabel>Display Settings</DropdownMenuLabel>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuCheckboxItem checked={showNotifications} onCheckedChange={(v) => setShowNotifications(v)}>
						{showNotifications ? <BellIcon /> : <BellOffIcon />}
						Show Notifications
					</DropdownMenuCheckboxItem>
					<DropdownMenuCheckboxItem checked={showBadges} onCheckedChange={(v) => setShowBadges(v)}>
						{showBadges ? <EyeIcon /> : <EyeOffIcon />}
						Show Badges
					</DropdownMenuCheckboxItem>
				</DropdownMenuContent>
			</DropdownMenu>
		);
	},
};

// ── With Radio Items ─────────────────────────────────────

export const WithRadioItems: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'`DropdownMenuRadioGroup` and `DropdownMenuRadioItem` implement single-selection radio items. Use `value` on items and `onValueChange` on the group to manage selection.',
			},
		},
	},
	render: function WithRadioItemsStory() {
		const [theme, setTheme] = useState('system');

		return (
			<DropdownMenu>
				<DropdownMenuTrigger render={<Button variant="outline">Theme: {theme}</Button>} />
				<DropdownMenuContent>
					<DropdownMenuGroup>
						<DropdownMenuLabel>Theme</DropdownMenuLabel>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v)}>
						<DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
						<DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
						<DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
					</DropdownMenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		);
	},
};

// ── With Submenu ─────────────────────────────────────────

export const WithSubmenu: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'`DropdownMenuSub`, `DropdownMenuSubTrigger`, and `DropdownMenuSubContent` create nested submenus. Submenus open on hover and close on click outside.',
			},
		},
	},
	render: () => (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="outline">Open Menu</Button>} />
			<DropdownMenuContent>
				<DropdownMenuItem>
					<UserIcon />
					Profile
				</DropdownMenuItem>
				<DropdownMenuItem>
					<SettingsIcon />
					Settings
				</DropdownMenuItem>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>Share</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						<DropdownMenuItem>
							<MailIcon />
							Email
						</DropdownMenuItem>
						<DropdownMenuItem>
							<LinkIcon />
							Copy Link
						</DropdownMenuItem>
						<DropdownMenuItem>Slack</DropdownMenuItem>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSeparator />
				<DropdownMenuItem>
					<LogOutIcon />
					Logout
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	),
};

// ── Destructive Item ─────────────────────────────────────

export const DestructiveItem: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Set `variant="destructive"` on a `DropdownMenuItem` to indicate a dangerous action. Destructive items are styled in red and highlight with a subtle red background on focus.',
			},
		},
	},
	render: () => (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="outline">Open Menu</Button>} />
			<DropdownMenuContent>
				<DropdownMenuItem>
					<UserIcon />
					Profile
				</DropdownMenuItem>
				<DropdownMenuItem>
					<SettingsIcon />
					Settings
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem variant="destructive">
					<Trash2Icon />
					Delete Account
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	),
};
