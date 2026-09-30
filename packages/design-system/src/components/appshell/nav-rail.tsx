'use client';

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/tooltip';

export interface NavRailItem {
	id: string;
	label: string;
	icon: LucideIcon;
}

export interface NavRailProps extends React.ComponentProps<'nav'> {
	items: NavRailItem[];
	/** The item rendered as active (accent bar + tinted background + `aria-current`). */
	activeId?: string;
	/** Called with the clicked item (named to avoid the DOM `onSelect` handler). */
	onSelectItem: (item: NavRailItem) => void;
	/** Pinned above the items (brand mark, module switcher, …). */
	top?: React.ReactNode;
	/** Pinned below the items — the rail's bottom cluster (theme, user, …). */
	footer?: React.ReactNode;
	/** Accessible name of the rail. Defaults to `"Sections"`. */
	label?: string;
}

/**
 * The activity bar: a persistent 3rem icon-only column to the left of the
 * collapsible sidebar. It is the FIRST tier of the two-tier shell — the rail
 * owns the domains, the sidebar owns the active domain's list, the content
 * area owns the record. Every button is a real `<button>` with an accessible
 * name; the tooltip appears on hover AND keyboard focus.
 */
export function NavRail({ items, activeId, onSelectItem, top, footer, label = 'Sections', className, ...props }: NavRailProps) {
	return (
		<nav
			data-slot="nav-rail"
			aria-label={label}
			className={cn(
				'sticky top-0 hidden h-svh w-12 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-2 text-sidebar-foreground md:flex',
				className,
			)}
			{...props}
		>
			{top ? <div className="flex w-full flex-col items-center gap-1 pb-2">{top}</div> : null}
			<ul className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto py-1">
				{items.map((item) => {
					const active = item.id === activeId;
					const Icon = item.icon;
					return (
						<li key={item.id} className="flex w-full justify-center">
							<Tooltip>
								<TooltipTrigger
									render={
										<button
											type="button"
											aria-label={item.label}
											aria-current={active ? 'page' : undefined}
											onClick={() => onSelectItem(item)}
											className={cn(
												'relative flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring',
												active && 'bg-sidebar-accent text-sidebar-accent-foreground',
											)}
										>
											<Icon className="size-5" aria-hidden />
											{active ? <span aria-hidden className="absolute start-0 inset-y-1.5 w-0.5 rounded-full bg-primary" /> : null}
										</button>
									}
								/>
								<TooltipContent side="right" align="center">
									{item.label}
								</TooltipContent>
							</Tooltip>
						</li>
					);
				})}
			</ul>
			{footer ? <div className="flex w-full flex-col items-center gap-1 pt-2">{footer}</div> : null}
		</nav>
	);
}
