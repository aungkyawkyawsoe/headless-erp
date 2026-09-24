'use client';

import * as React from 'react';
import { Settings } from 'lucide-react';

import { NavMain, type NavMainItem, type NavMainSubItem } from './nav-main';
import { NavProjects, type NavProject, type NavProjectsProps } from './nav-projects';
import { NavUser, type NavUserBrand, type NavUserData, type NavUserProps } from './nav-user';
import { SidebarHeader, type Module, type SidebarHeaderProps } from './sidebar-header';
import { ThemeSwitcher, type ThemeSwitcherProps } from './theme-switcher';
import { SearchBox } from '../search-box';
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader as SidebarHeaderContainer,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
} from '../sidebar';

export interface NavModuleData {
	navMain: NavMainItem[];
	projects: NavProject[];
}

export interface AppSidebarData {
	user: NavUserData;
	/** Brand mark shown in the bottom user bar. Omit to hide it. */
	brand?: NavUserBrand;
	modules: Module[];
	navByModule: Record<string, NavModuleData>;
}

export interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
	data: AppSidebarData;
	/** Called when a NavMain sub-item is clicked. */
	onNavMainNavigate?: (item: NavMainItem, subItem: NavMainSubItem) => void;
	/** Called when a NavMain item row (not a sub-item) is clicked. */
	onNavMainItemClick?: (item: NavMainItem) => void;
	/** Called when a NavProjects item is clicked. */
	onNavProjectsNavigate?: (project: NavProject) => void;
	/**
	 * Controlled active module. Use with `onActiveModuleChange`.
	 * If not provided, the first module in `data.modules` is used.
	 */
	activeModule?: Module;
	/** Called when the active module changes. Use with `activeModule` for controlled mode. */
	onActiveModuleChange?: (module: Module) => void;
	/** Default active module name. Only used in uncontrolled mode. */
	defaultActiveModule?: string;
	/** Props forwarded to `NavUser`. */
	navUserProps?: Omit<NavUserProps, 'user'>;
	/** Props forwarded to `NavProjects`. */
	navProjectsProps?: Omit<NavProjectsProps, 'projects' | 'onNavigate'>;
	/** Label for the nav group in `NavMain`. Defaults to `"Quick Access"`. */
	navMainGroupLabel?: string;
	/** Label for the projects group in `NavProjects`. Defaults to `"Quick Access"`. */
	navProjectsGroupLabel?: string;
	/** Props forwarded to `SidebarHeader`. */
	sidebarHeaderProps?: Omit<SidebarHeaderProps, 'modules' | 'activeModule' | 'onModuleChange'>;
	/** Props forwarded to `ThemeSwitcher`. Ignored unless `showThemeSwitcher` is set. */
	themeSwitcherProps?: ThemeSwitcherProps;
	/**
	 * Whether to show the theme switcher (light/dark mode) in the sidebar
	 * footer. Defaults to `false`. Theme switching is still available from
	 * the user menu.
	 */
	showThemeSwitcher?: boolean;
	/** Label for the settings item in the sidebar footer. Defaults to `"Settings"`. */
	settingsLabel?: string;
	/**
	 * Called when the settings item in the sidebar footer is clicked.
	 * The settings item is only rendered when this handler is provided
	 * (hidden by default).
	 */
	onSettingsClick?: () => void;
	/** Placeholder for the sidebar search box. Defaults to `"Search..."`. */
	searchPlaceholder?: string;
	/** Accessible label for the sidebar search box. Defaults to `"Search navigation"`. */
	searchAriaLabel?: string;
	/** Message shown when the search has no matches. Defaults to `"No results found"`. */
	noResultsMessage?: string;
	/** Whether to show the sidebar search box. Defaults to `true`. */
	showSearch?: boolean;
}

export function AppSidebar({
	data,
	onNavMainNavigate,
	onNavMainItemClick,
	onNavProjectsNavigate,
	activeModule: controlledActiveModule,
	onActiveModuleChange,
	defaultActiveModule,
	navUserProps,
	navProjectsProps,
	navMainGroupLabel,
	navProjectsGroupLabel,
	sidebarHeaderProps,
	themeSwitcherProps,
	showThemeSwitcher = false,
	settingsLabel = 'Settings',
	onSettingsClick,
	searchPlaceholder = 'Search...',
	searchAriaLabel = 'Search navigation',
	noResultsMessage = 'No results found',
	showSearch = true,
	...props
}: AppSidebarProps) {
	const isControlled = controlledActiveModule !== undefined;
	const [internalActiveModule, setInternalActiveModule] = React.useState<Module>(() => {
		if (defaultActiveModule) {
			return data.modules.find((m) => m.name === defaultActiveModule) ?? data.modules[0];
		}
		return data.modules[0];
	});

	const activeModule = isControlled ? controlledActiveModule : internalActiveModule;

	const handleModuleChange = React.useCallback(
		(module: Module) => {
			if (!isControlled) {
				setInternalActiveModule(module);
			}
			onActiveModuleChange?.(module);
		},
		[isControlled, onActiveModuleChange],
	);

	const moduleData = data.navByModule[activeModule?.name] ?? data.navByModule['default'] ?? { navMain: [], projects: [] };

	const [searchQuery, setSearchQuery] = React.useState('');
	const normalizedQuery = searchQuery.trim().toLowerCase();
	const hasQuery = normalizedQuery.length > 0;

	const filteredNavMain = hasQuery
		? moduleData.navMain
				.map((item) => {
					if (item.title.toLowerCase().includes(normalizedQuery)) return item;
					const matchingSubItems = item.items?.filter((sub) => sub.title.toLowerCase().includes(normalizedQuery));
					return matchingSubItems && matchingSubItems.length > 0 ? { ...item, items: matchingSubItems } : null;
				})
				.filter((item): item is NavMainItem => item !== null)
		: moduleData.navMain;

	const filteredProjects = hasQuery
		? moduleData.projects.filter((project) => project.name.toLowerCase().includes(normalizedQuery))
		: moduleData.projects;

	const hasResults = filteredNavMain.length > 0 || filteredProjects.length > 0;

	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeaderContainer>
				<SidebarHeader {...sidebarHeaderProps} modules={data.modules} activeModule={activeModule} onModuleChange={handleModuleChange} />
			</SidebarHeaderContainer>
			<SidebarContent>
				{/* Search box for the nav items — hidden in icon-only rail mode */}
				{showSearch && (
					<div className="mx-1 p-2 pb-0 group-data-[collapsible=icon]:hidden">
						<SearchBox
							value={searchQuery}
							onValueChange={setSearchQuery}
							placeholder={searchPlaceholder}
							aria-label={searchAriaLabel}
							inputClassName="h-7 pr-5"
						/>
					</div>
				)}
				{hasResults ? (
					<>
						{filteredNavMain.length > 0 && (
							<NavMain
								items={filteredNavMain}
								groupLabel={navMainGroupLabel}
								onNavigate={onNavMainNavigate}
								onItemClick={onNavMainItemClick}
							/>
						)}
						{filteredProjects.length > 0 && (
							<NavProjects
								{...navProjectsProps}
								projects={filteredProjects}
								groupLabel={navProjectsGroupLabel}
								onNavigate={onNavProjectsNavigate}
							/>
						)}
					</>
				) : (
					<div className="px-4 py-6 text-center text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">{noResultsMessage}</div>
				)}
			</SidebarContent>
			<SidebarFooter>
				{/* Settings and the theme switcher are hidden by default: wire
            `onSettingsClick` or set `showThemeSwitcher` to reveal them.
            When present, they are stacked flush with a larger gap before
            the user card. */}
				{(onSettingsClick || showThemeSwitcher) && (
					<div className="flex flex-col gap-0">
						{onSettingsClick && (
							<SidebarMenu>
								<SidebarMenuItem>
									<SidebarMenuButton
										size="sm"
										tooltip={settingsLabel}
										onClick={onSettingsClick}
										className="h-8 leading-5 group-data-[collapsible=icon]:justify-center"
									>
										<Settings strokeWidth={1.5} />
										<span className="group-data-[collapsible=icon]:hidden">{settingsLabel}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							</SidebarMenu>
						)}
						{showThemeSwitcher && <ThemeSwitcher {...themeSwitcherProps} />}
					</div>
				)}
				<NavUser {...navUserProps} user={data.user} brand={data.brand} />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
