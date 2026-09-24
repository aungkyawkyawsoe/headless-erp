'use client';

import { Monitor, Moon, Palette, Sun } from 'lucide-react';
import { useTheme } from '../theme-provider';
import { Button } from '../button';
import { DropdownMenuItem } from '../dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '../sidebar';
import { cn } from '@/utils';

const THEME_OPTIONS = [
	{ value: 'light', label: 'Light', icon: Sun },
	{ value: 'dark', label: 'Dark', icon: Moon },
	{ value: 'system', label: 'System', icon: Monitor },
] as const;

export interface ThemeSwitcherProps {
	/** Label shown when in light mode. Defaults to `"Light Mode"`. */
	lightLabel?: string;
	/** Label shown when in dark mode. Defaults to `"Dark Mode"`. */
	darkLabel?: string;
	/** Tooltip shown when in light mode. Defaults to `"Switch to dark mode"`. */
	lightTooltip?: string;
	/** Tooltip shown when in dark mode. Defaults to `"Switch to light mode"`. */
	darkTooltip?: string;
	/** Called after the theme is toggled. Receives the new theme value. */
	onThemeChange?: (theme: 'light' | 'dark') => void;
}

export interface ThemeMenuItemProps {
	/** Label shown next to the palette icon. Defaults to `"Theme"`. */
	label?: string;
}

/**
 * A theme selector rendered as a dropdown menu item, with a segmented
 * Light / Dark / System control. Intended for user menus and similar
 * dropdowns. Requires a `ThemeProvider` ancestor.
 */
export function ThemeMenuItem({ label = 'Theme' }: ThemeMenuItemProps) {
	const { theme, setTheme } = useTheme();

	return (
		<DropdownMenuItem className="cursor-default focus:bg-transparent!">
			<Palette />
			<span>{label}</span>
			<div className="ml-auto">
				<div role="radiogroup" aria-label={label} className="inline-flex items-center gap-0.5 rounded-full bg-muted/60 p-0.5">
					{THEME_OPTIONS.map((option) => {
						const isActive = theme === option.value;
						return (
							<Button
								key={option.value}
								type="button"
								role="radio"
								aria-checked={isActive}
								aria-label={option.label}
								variant="ghost"
								size="icon-xs"
								onClick={() => setTheme(option.value)}
								className={cn(
									'rounded-full',
									isActive ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
								)}
							>
								<option.icon className="size-3.5" />
							</Button>
						);
					})}
				</div>
			</div>
		</DropdownMenuItem>
	);
}

export function ThemeSwitcher({
	lightLabel = 'Light Mode',
	darkLabel = 'Dark Mode',
	lightTooltip = 'Switch to dark mode',
	darkTooltip = 'Switch to light mode',
	onThemeChange,
}: ThemeSwitcherProps) {
	const { theme, setTheme } = useTheme();

	const toggle = () => {
		const next = theme === 'dark' ? 'light' : 'dark';
		setTheme(next);
		onThemeChange?.(next);
	};

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<SidebarMenuButton
					size="sm"
					tooltip={theme === 'dark' ? darkTooltip : lightTooltip}
					onClick={toggle}
					className="h-8 leading-5 group-data-[collapsible=icon]:justify-center"
				>
					<Sun strokeWidth={1.5} className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
					<Moon strokeWidth={1.5} className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
					<span className="group-data-[collapsible=icon]:hidden">{theme === 'dark' ? darkLabel : lightLabel}</span>
				</SidebarMenuButton>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
