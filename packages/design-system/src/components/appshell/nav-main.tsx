'use client';
import { type LucideIcon } from 'lucide-react';

import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from '../sidebar';

export interface NavMainSubItem {
	title: string;
	url: string;
	isActive?: boolean;
}

export interface NavMainItem {
	title: string;
	url: string;
	icon?: LucideIcon;
	isActive?: boolean;
	items?: NavMainSubItem[];
}

export interface NavMainProps {
	items: NavMainItem[];
	/** Label for the sidebar group. Defaults to "Quick Access". */
	groupLabel?: string;
	/**
	 * Called when a sub-item is clicked.
	 * Receives the parent item and the clicked sub-item for full flexibility.
	 */
	onNavigate?: (item: NavMainItem, subItem: NavMainSubItem) => void;
	/** Called when the item row itself is clicked (with or without sub-items). */
	onItemClick?: (item: NavMainItem) => void;
}

export function NavMain({ items, groupLabel = 'Quick Access', onNavigate, onItemClick }: NavMainProps) {
	const hasSubItems = (item: NavMainItem) => !!item.items && item.items.length > 0;

	return (
		<SidebarGroup>
			<SidebarGroupLabel>{groupLabel}</SidebarGroupLabel>
			<SidebarMenu>
				{items.map((item) => (
					<SidebarMenuItem key={item.title}>
						<SidebarMenuButton
							render={
								<a
									href={item.url}
									onClick={(e) => {
										e.preventDefault();
										onItemClick?.(item);
									}}
								/>
							}
							tooltip={item.title}
							isActive={item.isActive}
							className="h-8 leading-6"
						>
							{item.icon && <item.icon strokeWidth={1.5} />}
							<span>{item.title}</span>
						</SidebarMenuButton>
						{hasSubItems(item) && (
							<SidebarMenuSub>
								{item.items?.map((subItem) => (
									<SidebarMenuSubItem key={subItem.title}>
										<SidebarMenuSubButton
											render={
												<a
													href={subItem.url}
													onClick={(e) => {
														e.preventDefault();
														onNavigate?.(item, subItem);
													}}
												/>
											}
											isActive={subItem.isActive}
											className="h-7 leading-6"
										>
											<span>{subItem.title}</span>
										</SidebarMenuSubButton>
									</SidebarMenuSubItem>
								))}
							</SidebarMenuSub>
						)}
					</SidebarMenuItem>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
