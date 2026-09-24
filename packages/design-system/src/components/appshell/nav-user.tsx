'use client';

import * as React from 'react';
import { BadgeCheck, Bell, CircleUserRound, CreditCard, LogOut, type LucideIcon } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '../avatar';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '../dropdown-menu';
import { useSidebar } from '../sidebar';
import { LocaleMenuItem, type LocaleMenuItemProps } from './locale-switcher';
import { ThemeMenuItem } from './theme-switcher';

/** Brand mark shown in the user bar. Both fields are optional; omit the whole prop to hide it. */
export interface NavUserBrand {
	/** Logo URL (data URI, asset path, or remote URL). */
	logo?: string;
	/** Brand name rendered next to the logo. */
	name?: string;
}

export interface NavUserMenuItem {
	/**
	 * Stable identifier for the item. `"logout"` is special-cased: it is
	 * rendered last, below the language and theme selectors, with a separator.
	 */
	kind?: string;
	label: string;
	icon: LucideIcon;
	onClick: () => void;
	/** Insert a separator before this item. */
	separatorBefore?: boolean;
}

export interface NavUserData {
	name: string;
	email: string;
	avatar: string;
}

export interface NavUserProps {
	user: NavUserData;
	/** Brand mark shown at the left of the user bar. Omit to hide it. */
	brand?: NavUserBrand;
	/**
	 * User menu items rendered in the dropdown.
	 * Defaults to `defaultUserMenuItems()` (Account, Billing, Notifications,
	 * and Log out).
	 */
	userMenuItems?: NavUserMenuItem[];
	/** Called when a default menu item is clicked (if `userMenuItems` is not provided). */
	onMenuAction?: (action: string) => void;
	/** Whether to render the language/locale selector in the menu. Defaults to `true`. */
	showLocaleSwitcher?: boolean;
	/** Whether to render the theme selector in the menu. Defaults to `true`. */
	showThemeSwitcher?: boolean;
	/** Props forwarded to the `LocaleMenuItem` (language/locale switcher). */
	localeMenuItemProps?: LocaleMenuItemProps;
}

/**
 * Default user menu items (Account, Billing, Notifications, Log out).
 * Pass the result to `userMenuItems`, or spread it and tweak individual items
 * (e.g. to localize the labels).
 */
export function defaultUserMenuItems(onMenuAction?: (action: string) => void): NavUserMenuItem[] {
	return [
		{
			kind: 'account',
			label: 'Account',
			icon: BadgeCheck,
			onClick: () => onMenuAction?.('account'),
		},
		{
			kind: 'billing',
			label: 'Billing',
			icon: CreditCard,
			onClick: () => onMenuAction?.('billing'),
		},
		{
			kind: 'notifications',
			label: 'Notifications',
			icon: Bell,
			onClick: () => onMenuAction?.('notifications'),
		},
		{
			kind: 'logout',
			label: 'Log out',
			icon: LogOut,
			onClick: () => onMenuAction?.('logout'),
			separatorBefore: true,
		},
	];
}

function getInitials(name: string): string {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.map((w) => w[0])
		.join('')
		.toUpperCase()
		.slice(0, 2);
}

export function NavUser({
	user,
	brand,
	userMenuItems,
	onMenuAction,
	showLocaleSwitcher = true,
	showThemeSwitcher = true,
	localeMenuItemProps,
}: NavUserProps) {
	const { isMobile } = useSidebar();

	const initials = getInitials(user.name);

	const menuItems: NavUserMenuItem[] = userMenuItems ?? defaultUserMenuItems(onMenuAction);

	// The language and theme selectors are fixed sections of the user menu,
	// rendered directly above the "Log out" item (or at the bottom for custom
	// menus that do not include a logout item).
	const isLogout = (item: NavUserMenuItem) => item.kind === 'logout' || item.label === 'Log out';
	const logoutItem = menuItems.find(isLogout);
	const menuItemsWithoutLogout = menuItems.filter((item) => !isLogout(item));

	return (
		<div
			data-slot="sidebar-menu"
			data-sidebar="menu"
			className="-mx-4 -mb-2 flex h-7 shrink-0 items-center gap-0.5 border-t border-border/45 px-4 text-2xs text-muted-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
		>
			{/* Brand mark + wordmark (omit `brand` to hide) */}
			<div className="flex min-w-0 flex-1 items-center gap-1.5 group-data-[collapsible=icon]:hidden">
				{brand?.logo && (
					<img
						src={brand.logo}
						alt={brand.name ?? ''}
						className="size-4 shrink-0 rounded-sm object-contain opacity-70 dark:brightness-0 dark:invert"
					/>
				)}
				{brand?.name && <span className="truncate text-2xs font-medium text-sidebar-foreground">{brand.name}</span>}
			</div>

			{/* Profile menu */}
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<button
							type="button"
							aria-label={user.name}
							className="flex size-5 items-center justify-center rounded text-muted-foreground outline-hidden transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
						>
							<CircleUserRound strokeWidth={1.5} className="size-3.5 group-data-[collapsible=icon]:size-4" />
						</button>
					}
				/>
				<DropdownMenuContent
					className="w-[--anchor-width] min-w-56 rounded-sm"
					side={isMobile ? 'bottom' : 'right'}
					align="end"
					sideOffset={4}
				>
					<DropdownMenuGroup>
						<DropdownMenuLabel className="p-0 font-normal">
							<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
								<Avatar className="h-8 w-8 rounded-sm">
									<AvatarImage src={user.avatar} alt={user.name} />
									<AvatarFallback className="rounded-full">{initials}</AvatarFallback>
								</Avatar>
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate leading-5.5 font-medium">{user.name}</span>
									<span className="truncate text-2xs">{user.email}</span>
								</div>
							</div>
						</DropdownMenuLabel>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					{menuItemsWithoutLogout.map((item) => (
						<React.Fragment key={item.label}>
							{item.separatorBefore && <DropdownMenuSeparator />}
							<DropdownMenuItem onClick={item.onClick}>
								<item.icon strokeWidth={1.7} />
								&nbsp;
								{item.label}
							</DropdownMenuItem>
						</React.Fragment>
					))}
					{menuItemsWithoutLogout.length > 0 && <DropdownMenuSeparator />}
					{showLocaleSwitcher && <LocaleMenuItem {...localeMenuItemProps} />}
					{showThemeSwitcher && <ThemeMenuItem />}
					{logoutItem && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={logoutItem.onClick}>
								<logoutItem.icon />
								{logoutItem.label}
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
