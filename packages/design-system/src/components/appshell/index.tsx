'use client';

import React, { useCallback, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';
import { AppSidebar, type AppSidebarData, type AppSidebarProps } from './app-sidebar';
import { type NavMainItem, type NavMainSubItem } from './nav-main';
import { type NavProject } from './nav-projects';
import { StatusBar } from './status-bar';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '../breadcrumb';
import { LinksCard, LinksCardItem } from '../links-card';
import { SidebarInset, SidebarProvider } from '../sidebar';

export { AppSidebar, type AppSidebarData, type AppSidebarProps, type NavModuleData } from './app-sidebar';
export { NavMain, type NavMainItem, type NavMainSubItem, type NavMainProps } from './nav-main';
export { NavProjects, type NavProject, type NavProjectAction, type NavProjectsProps } from './nav-projects';
export { NavUser, defaultUserMenuItems, type NavUserBrand, type NavUserData, type NavUserMenuItem, type NavUserProps } from './nav-user';
export { SidebarHeader, type SidebarHeaderProps } from './sidebar-header';
export { ModuleSwitcher, type ModuleSwitcherProps } from './module-switcher';
export {
	ModuleGrid,
	ModuleGridItem,
	ModuleGridPagination,
	type Module,
	type ModuleGridItemProps,
	type ModuleGridProps,
	type ModuleGridPaginationProps,
} from '../module-grid';
export { ThemeSwitcher, type ThemeSwitcherProps } from './theme-switcher';
export { ThemeMenuItem, type ThemeMenuItemProps } from './theme-switcher';
export { LocaleMenuItem, type LocaleMenuItemProps, type LocaleOption } from './locale-switcher';
export { StatusBar, StatusBarButton, type StatusBarProps } from './status-bar';

export interface AppShellBreadcrumb {
	label: string;
	href?: string;
}

/**
 * Stable string identity for a `breadcrumbs` prop (compared by value), so
 * inline arrays don't count as a change on every render.
 */
function breadcrumbsKey(crumbs: AppShellBreadcrumb[] | undefined): string {
	if (!crumbs) return '';
	return crumbs.map((c) => `${c.label}\u0000${c.href ?? ''}`).join('\u0001');
}

export interface AppShellProps {
	/** Navigation and sidebar data */
	data: AppSidebarData;
	/** Breadcrumb items for the header */
	breadcrumbs?: AppShellBreadcrumb[];
	/**
	 * Map navigation events to breadcrumbs.
	 * Receives the raw navigation event and should return breadcrumb items.
	 * If provided, dynamic breadcrumbs from sidebar navigation are enabled.
	 */
	onNavigate?: (event: NavMainNavigateEvent | NavMainItemNavigateEvent | NavProjectNavigateEvent) => AppShellBreadcrumb[];
	/** Content to render in the main area */
	children?: React.ReactNode;
	/** Props passed to the SidebarProvider */
	providerProps?: React.ComponentProps<typeof SidebarProvider>;
	/**
	 * Whether the sidebar width can be adjusted by dragging its edge (the
	 * grip appears on hover at the sidebar/content boundary; a plain click
	 * still collapses/expands). The chosen width persists across reloads.
	 * Defaults to `true`. Set `providerProps.resizable` to `false` to disable.
	 */
	resizableSidebar?: boolean;
	/** Whether to show the fullscreen toggle in the header. Defaults to `true`. */
	showFullscreenToggle?: boolean;
	/** Additional content to render in the header (e.g. custom buttons, search). */
	headerChildren?: React.ReactNode;
	/** CSS class for the content area wrapper. */
	contentClassName?: string;
	/**
	 * Footer node docked at the bottom of the content area (inside
	 * `SidebarInset`). Pass a `<StatusBar />` for a Zed-style status bar.
	 * Defaults to an empty `<StatusBar />`.
	 */
	statusBar?: React.ReactNode;
	/** Props forwarded to `AppSidebar`. */
	sidebarProps?: Omit<AppSidebarProps, 'data' | 'onNavMainNavigate' | 'onNavMainItemClick' | 'onNavProjectsNavigate'>;
	/**
	 * Custom renderer for the page shown when a nav item is selected.
	 * Defaults to a `LinksCard` group listing the item's sub-links.
	 */
	renderNavItemPage?: (item: NavMainItem) => React.ReactNode;
	/**
	 * Disable the built-in "links card" page shown when a sidebar nav item
	 * (not a sub-item) is clicked. Set this when the consumer owns the
	 * content — e.g. route-driven pages — so nav-item clicks only fire
	 * `onNavigate` and `children` stays mounted. Defaults to `false`.
	 */
	disableNavItemPages?: boolean;
	/**
	 * Template for the description on the default nav-item page.
	 * Receives the selected item. Defaults to
	 * `(item) => \`Shortcuts to ${item.title} pages.\``.
	 */
	navItemPageDescription?: (item: NavMainItem) => string;
	/** Message shown when a selected nav item has no sub-links. Defaults to `"No sub-links available."`. */
	noSubLinksMessage?: string;
	/** Tooltip for the fullscreen button when entering fullscreen. Defaults to `"Enter fullscreen"`. */
	fullscreenEnterLabel?: string;
	/** Tooltip for the fullscreen button when exiting fullscreen. Defaults to `"Exit fullscreen"`. */
	fullscreenExitLabel?: string;
}

export interface NavMainItemNavigateEvent {
	type: 'nav-main-item';
	item: NavMainItem;
}

export interface NavMainNavigateEvent {
	type: 'nav-main';
	item: NavMainItem;
	subItem: NavMainSubItem;
}

export interface NavProjectNavigateEvent {
	type: 'nav-projects';
	project: NavProject;
}

/**
 * Default page shown when a nav item is selected: a `LinksCard` group
 * listing the selected item's sub-links.
 */
function DefaultNavItemPage({
	item,
	description,
	noSubLinksMessage = 'No sub-links available.',
}: {
	item: NavMainItem;
	description: (item: NavMainItem) => string;
	noSubLinksMessage?: string;
}) {
	return (
		<div className="grid auto-rows-min gap-4 md:grid-cols-2 xl:grid-cols-3">
			<LinksCard title={item.title} description={description(item)}>
				{item.items && item.items.length > 0 ? (
					item.items.map((subItem) => (
						<LinksCardItem key={subItem.title} href={subItem.url}>
							{subItem.title}
						</LinksCardItem>
					))
				) : (
					<div className="py-1 text-sm text-muted-foreground">{noSubLinksMessage}</div>
				)}
			</LinksCard>
		</div>
	);
}

export function AppShell({
	data,
	breadcrumbs: breadcrumbsProp,
	onNavigate,
	children,
	providerProps,
	resizableSidebar = true,
	showFullscreenToggle = true,
	headerChildren,
	contentClassName,
	statusBar,
	sidebarProps,
	renderNavItemPage,
	disableNavItemPages = false,
	navItemPageDescription = (item) => `Shortcuts to ${item.title} pages.`,
	noSubLinksMessage,
	fullscreenEnterLabel = 'Enter fullscreen',
	fullscreenExitLabel = 'Exit fullscreen',
}: AppShellProps) {
	const [activeCrumbs, setActiveCrumbs] = React.useState<AppShellBreadcrumb[] | null>(null);
	const [activeNavMainItem, setActiveNavMainItem] = React.useState<NavMainItem | null>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);

	// When the consumer passes a new `breadcrumbs` value, it is authoritative
	// for the current view — e.g. passing `[]` hides the shell header while a
	// form renders its own breadcrumb trail. Without this, crumbs generated by
	// sidebar navigation would keep overriding the prop forever, causing
	// duplicate breadcrumb trails. A stable prop keeps nav-generated crumbs.
	const currentBreadcrumbsKey = breadcrumbsKey(breadcrumbsProp);
	const [prevBreadcrumbsKey, setPrevBreadcrumbsKey] = React.useState(currentBreadcrumbsKey);
	if (prevBreadcrumbsKey !== currentBreadcrumbsKey) {
		setPrevBreadcrumbsKey(currentBreadcrumbsKey);
		setActiveCrumbs(null);
	}

	const toggleFullscreen = useCallback(() => {
		if (!document.fullscreenElement) {
			document.documentElement.requestFullscreen();
			setIsFullscreen(true);
		} else {
			document.exitFullscreen();
			setIsFullscreen(false);
		}
	}, []);

	React.useEffect(() => {
		const handler = () => setIsFullscreen(!!document.fullscreenElement);
		document.addEventListener('fullscreenchange', handler);
		return () => document.removeEventListener('fullscreenchange', handler);
	}, []);

	const handleNavMainNavigate = useCallback(
		(item: NavMainItem, subItem: NavMainSubItem) => {
			// A sub-item click navigates to the real page, so go back to the
			// default content (e.g. a table) instead of the parent's links page.
			setActiveNavMainItem(null);
			if (onNavigate) {
				setActiveCrumbs(onNavigate({ type: 'nav-main', item, subItem }));
			} else {
				setActiveCrumbs([{ label: item.title }, { label: subItem.title }]);
			}
		},
		[onNavigate],
	);

	const handleNavMainItemNavigate = useCallback(
		(item: NavMainItem) => {
			if (!disableNavItemPages) {
				setActiveNavMainItem(item);
			}
			if (onNavigate) {
				setActiveCrumbs(onNavigate({ type: 'nav-main-item', item }));
			} else {
				setActiveCrumbs([{ label: item.title }]);
			}
		},
		[disableNavItemPages, onNavigate],
	);

	const handleNavProjectsNavigate = useCallback(
		(project: NavProject) => {
			if (onNavigate) {
				setActiveCrumbs(onNavigate({ type: 'nav-projects', project }));
			} else {
				setActiveCrumbs([{ label: project.name }]);
			}
		},
		[onNavigate],
	);

	const breadcrumbs = activeCrumbs ?? breadcrumbsProp ?? undefined;
	const hasHeader = (breadcrumbs && breadcrumbs.length > 0) || showFullscreenToggle || headerChildren;

	const pageContent = activeNavMainItem ? (
		renderNavItemPage ? (
			renderNavItemPage(activeNavMainItem)
		) : (
			<DefaultNavItemPage item={activeNavMainItem} description={navItemPageDescription} noSubLinksMessage={noSubLinksMessage} />
		)
	) : (
		children
	);

	return (
		<SidebarProvider {...providerProps} resizable={providerProps?.resizable ?? resizableSidebar}>
			<AppSidebar
				{...sidebarProps}
				data={data}
				onNavMainNavigate={handleNavMainNavigate}
				onNavMainItemClick={handleNavMainItemNavigate}
				onNavProjectsNavigate={handleNavProjectsNavigate}
			/>
			<SidebarInset>
				{hasHeader && (
					<header className="sticky top-0 z-10 mb-1 flex h-12 shrink-0 items-center gap-2 bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
						<div className="flex items-center gap-2 px-4">
							{breadcrumbs && breadcrumbs.length > 0 ? (
								<Breadcrumb>
									<BreadcrumbList>
										{breadcrumbs.map((crumb, index) => {
											const isLast = index === breadcrumbs.length - 1;
											return (
												<React.Fragment key={crumb.label}>
													<BreadcrumbItem className={isLast ? undefined : 'hidden md:block'}>
														{isLast ? (
															<BreadcrumbPage>{crumb.label}</BreadcrumbPage>
														) : (
															<BreadcrumbLink href={crumb.href ?? '#'}>{crumb.label}</BreadcrumbLink>
														)}
													</BreadcrumbItem>
													{!isLast && <BreadcrumbSeparator className="hidden md:block" />}
												</React.Fragment>
											);
										})}
									</BreadcrumbList>
								</Breadcrumb>
							) : null}
						</div>
						{headerChildren}
						{showFullscreenToggle && (
							<button
								onClick={toggleFullscreen}
								className="mr-4 ml-auto flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
								title={isFullscreen ? fullscreenExitLabel : fullscreenEnterLabel}
							>
								{isFullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
							</button>
						)}
					</header>
				)}
				<div className={contentClassName ?? (hasHeader ? 'flex flex-1 flex-col gap-4 p-4' : 'flex flex-1 flex-col gap-4 p-4 pt-0')}>
					{pageContent}
				</div>
				{statusBar ?? <StatusBar />}
			</SidebarInset>
		</SidebarProvider>
	);
}
