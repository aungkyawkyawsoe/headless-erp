'use client';

import * as React from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../dropdown-menu';
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from '../sidebar';

export interface NavProjectAction {
	label: string;
	icon: LucideIcon;
	onClick: (project: NavProject) => void;
	/** Insert a separator before this action. */
	separatorBefore?: boolean;
}

export interface NavProject {
	name: string;
	url: string;
	icon: LucideIcon;
}

export interface NavProjectsProps {
	projects: NavProject[];
	/** Label for the sidebar group. Defaults to "Quick Access". */
	groupLabel?: string;
	/**
	 * Called when a project link is clicked.
	 * Receives the clicked project for full flexibility.
	 */
	onNavigate?: (project: NavProject) => void;
	/**
	 * Dropdown actions that appear when hovering a project.
	 * If omitted, the action button is hidden for that project.
	 */
	itemActions?: NavProjectAction[];
	/** Whether to show a "More" button at the bottom. Defaults to `false`. */
	showMoreButton?: boolean;
	/** Label for the "More" button. Defaults to `"More"`. */
	moreLabel?: string;
	/** Called when the "More" button is clicked. */
	onMoreClick?: () => void;
}

export function NavProjects({
	projects,
	groupLabel = 'Quick Access',
	onNavigate,
	itemActions,
	showMoreButton = false,
	moreLabel = 'More',
	onMoreClick,
}: NavProjectsProps) {
	const { isMobile } = useSidebar();

	return (
		<SidebarGroup className="group-data-[collapsible=icon]:hidden">
			<SidebarGroupLabel>{groupLabel}</SidebarGroupLabel>
			<SidebarMenu>
				{projects.map((project) => (
					<SidebarMenuItem key={project.name}>
						<SidebarMenuButton
							render={
								<a
									href={project.url}
									onClick={(e) => {
										e.preventDefault();
										onNavigate?.(project);
									}}
								>
									<project.icon strokeWidth={1.5} />
									<span>{project.name}</span>
								</a>
							}
							className="h-8 leading-6"
						/>
						{itemActions && itemActions.length > 0 && (
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<SidebarMenuAction showOnHover>
											<MoreHorizontal strokeWidth={1.5} />
											<span className="sr-only">{moreLabel}</span>
										</SidebarMenuAction>
									}
								/>
								<DropdownMenuContent className="w-48 rounded-sm" side={isMobile ? 'bottom' : 'right'} align={isMobile ? 'end' : 'start'}>
									{itemActions.map((action) => (
										<React.Fragment key={action.label}>
											{action.separatorBefore && <DropdownMenuSeparator />}
											<DropdownMenuItem onClick={() => action.onClick(project)}>
												<action.icon className="text-muted-foreground" />
												<span>{action.label}</span>
											</DropdownMenuItem>
										</React.Fragment>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						)}
					</SidebarMenuItem>
				))}
				{showMoreButton && (
					<SidebarMenuItem>
						<SidebarMenuButton className="h-8 leading-6 text-sidebar-foreground/70" onClick={onMoreClick}>
							<MoreHorizontal strokeWidth={1.5} className="text-sidebar-foreground/70" />
							<span>{moreLabel}</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				)}
			</SidebarMenu>
		</SidebarGroup>
	);
}
