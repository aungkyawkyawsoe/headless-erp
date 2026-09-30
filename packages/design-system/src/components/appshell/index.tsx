'use client';

import React, { useCallback, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';
import { AppSidebar, type AppSidebarData, type AppSidebarProps } from './app-sidebar';
import { type NavMainItem, type NavMainSubItem } from './nav-main';
import { type NavProject } from './nav-projects';
import { StatusBar } from './status-bar';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '../breadcrumb';
import { LinksCard, LinksCardItem } from '../links-card';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '../sidebar';

export { AppSidebar, type AppSidebarData, type AppSidebarProps, type NavModuleData } from './app-sidebar';
export { NavRail, type NavRailItem, type NavRailProps } from './nav-rail';
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

/** The width the shell reserves for a `rail` (the icon activity bar). */
const RAIL_WIDTH = '3rem';

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
	/**
	 * The activity bar (e.g. a `<NavRail />`) rendered as a persistent column to
	 * the left of the collapsible sidebar. The shell reserves `3rem` for it and
	 * offsets the fixed sidebar container accordingly; omit it for the plain
	 * one-tier shell.
	 */
	rail?: React.ReactNode;
	/**
	 * The sidebar's body. When provided it REPLACES the nav lists (and the nav
	 * search box) — use it for a contextual panel whose content follows the
	 * active section.
	 *
	 * Pass `null` to drop the sidebar ENTIRELY (no column, no mobile Sheet): the
	 * shape for a destination that has no tier-2 list of its own, where a panel
	 * would only repeat the rail. `undefined` keeps the default nav lists.
	 */
	panel?: React.ReactNode;
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
	/**
	 * Whether to render the header row at all — its breadcrumbs, `headerChildren`
	 * and the fullscreen toggle. Defaults to `true`. Set to `false` for a
	 * destination that owns the whole canvas: the header disappears even when
	 * `breadcrumbs`/`headerChildren` are passed (`breadcrumbs={[]}` alone only
	 * clears the crumbs — the toggle keeps the row).
	 */
	showHeader?: boolean;
	/** Additional content to render in the header (e.g. custom buttons, search). */
	headerChildren?: React.ReactNode;
	/** CSS class for the content area wrapper. */
	contentClassName?: string;
	/**
	 * Footer node docked at the bottom of the content area (inside
	 * `SidebarInset`). Pass a `<StatusBar />` for a Zed-style status bar.
	 * Defaults to an empty `<StatusBar />`; pass `null` to drop the footer
	 * entirely (the same null-drops-it shape as `panel`).
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
	rail,
	panel,
	breadcrumbs: breadcrumbsProp,
	onNavigate,
	children,
	providerProps,
	resizableSidebar = true,
	showFullscreenToggle = true,
	showHeader = true,
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
	// for the current view — e.g. passing `[]` clears the crumbs for a page that
	// renders its own trail (the header's row survives that, because the
	// fullscreen toggle still claims it — `showHeader={false}` drops the row).
	// Without this, crumbs generated by sidebar navigation would keep overriding
	// the prop forever, causing duplicate breadcrumb trails. A stable prop keeps
	// nav-generated crumbs.
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
	const hasHeader = showHeader && ((breadcrumbs && breadcrumbs.length > 0) || showFullscreenToggle || headerChildren);
	// `panel: null` = a destination with no tier-2 list, so there is no sidebar
	// column and no mobile Sheet to open (see the prop docs).
	const hasSidebar = panel !== null;

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
		<SidebarProvider {...providerProps} railWidth={rail ? RAIL_WIDTH : providerProps?.railWidth} resizable={providerProps?.resizable ?? resizableSidebar}>
			{rail}
			{hasSidebar && (
				<AppSidebar
					{...sidebarProps}
					data={data}
					panel={panel}
					onNavMainNavigate={handleNavMainNavigate}
					onNavMainItemClick={handleNavMainItemNavigate}
					onNavProjectsNavigate={handleNavProjectsNavigate}
				/>
			)}
			<SidebarInset>
				{hasHeader && (
					<header
						data-slot="app-shell-header"
						className="sticky top-0 z-10 mb-1 flex h-12 shrink-0 items-center gap-2 bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
					>
						<div className="flex items-center gap-2 px-4">
							{/* Below `md` the rail is hidden, so this is the ONLY way to reach
							    the side panel (it opens the mobile Sheet). */}
							{rail && hasSidebar && <SidebarTrigger className="md:hidden" />}
							{breadcrumbs && breadcrumbs.length > 0 ? (
								<Breadcrumb>
									<BreadcrumbList>
										{breadcrumbs.map((crumb, index) => {
											const isLast = index === breadcrumbs.length - 1;
											return (
												<React.Fragment key={crumb.label}>
													{/* Without a sidebar there is neither a rail (below `md`) nor a
													    Sheet, so the parent crumbs stay visible on small screens —
													    they are the only way back out. */}
													<BreadcrumbItem className={isLast || !hasSidebar ? undefined : 'hidden md:block'}>
														{isLast ? (
															<BreadcrumbPage>{crumb.label}</BreadcrumbPage>
														) : (
															<BreadcrumbLink href={crumb.href ?? '#'}>{crumb.label}</BreadcrumbLink>
														)}
													</BreadcrumbItem>
													{!isLast && <BreadcrumbSeparator className={hasSidebar ? 'hidden md:block' : undefined} />}
												</React.Fragment>
											);
										})}
									</BreadcrumbList>
								</Breadcrumb>
							) : null}
						</div>
						<div className="ml-auto flex items-center gap-2">
							{headerChildren}
							{showFullscreenToggle && (
								<button
									onClick={toggleFullscreen}
									className="flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
									title={isFullscreen ? fullscreenExitLabel : fullscreenEnterLabel}
								>
									{isFullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
								</button>
							)}
						</div>
					</header>
				)}
				<div className={contentClassName ?? (hasHeader ? 'flex flex-1 flex-col gap-4 p-4' : 'flex flex-1 flex-col gap-4 p-4 pt-0')}>
					{pageContent}
				</div>
				{statusBar === undefined ? <StatusBar /> : statusBar}
			</SidebarInset>
		</SidebarProvider>
	);
}
