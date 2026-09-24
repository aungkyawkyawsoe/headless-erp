import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarInput,
	SidebarMenu,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	SidebarProvider,
	SidebarRail,
	SidebarSeparator,
	SidebarTrigger,
} from './';
import {
	CalendarIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	CreditCardIcon,
	HomeIcon,
	InboxIcon,
	SearchIcon,
	SettingsIcon,
	UserIcon,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/collapsible';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/avatar';
import { Button } from '@/button';
import { Separator } from '@/separator';

/**
 * A composable, themeable and customizable sidebar component.
 */
const meta: Meta<typeof Sidebar> = {
	title: 'Components/Sidebar',
	component: Sidebar,
	parameters: {
		layout: 'fullscreen',
		docs: {
			description: {
				component:
					'A composable, themeable and customizable sidebar component. Built on top of Sheet for mobile and a custom collapsible panel for desktop. Supports multiple variants, collapsible modes, and nested navigation.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Default ──────────────────────────────────────────────

export const Default: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'A sidebar with header, content groups, and footer. The sidebar uses the `sidebar` variant with `offcanvas` collapsible behavior by default. Use the trigger button to toggle the sidebar.',
			},
		},
	},
	render: function DefaultStory() {
		return (
			<SidebarProvider defaultOpen={true}>
				<AppSidebar />
				<SidebarInset>
					<header className="flex h-11 items-center gap-2 border-b px-4">
						<SidebarTrigger />
						<Separator orientation="vertical" className="h-5" />
						<span className="text-sm font-medium">Dashboard</span>
					</header>
					<div className="flex flex-1 flex-col gap-4 p-4">
						<div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
					</div>
				</SidebarInset>
			</SidebarProvider>
		);
	},
};

// ── Collapsed ────────────────────────────────────────────

export const Collapsed: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'The sidebar can be collapsed to icons using the `collapsible="icon"` prop. The trigger button toggles between expanded and collapsed states. When collapsed, only icons are shown with tooltips.',
			},
		},
	},
	render: function CollapsedStory() {
		return (
			<SidebarProvider defaultOpen={false}>
				<AppSidebar collapsible="icon" />
				<SidebarInset>
					<header className="flex h-11 items-center gap-2 border-b px-4">
						<SidebarTrigger />
						<Separator orientation="vertical" className="h-5" />
						<span className="text-sm font-medium">Dashboard</span>
					</header>
					<div className="flex flex-1 flex-col gap-4 p-4">
						<div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
					</div>
				</SidebarInset>
			</SidebarProvider>
		);
	},
};

// ── Inset Variant ────────────────────────────────────────

export const Inset: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'The `inset` variant wraps the main content in a `SidebarInset` component, creating an inset layout with the sidebar appearing inside the content area.',
			},
		},
	},
	render: function InsetStory() {
		return (
			<SidebarProvider defaultOpen={true}>
				<AppSidebar variant="inset" collapsible="icon" />
				<SidebarInset>
					<header className="flex h-11 items-center gap-2 border-b px-4">
						<SidebarTrigger />
						<Separator orientation="vertical" className="h-5" />
						<span className="text-sm font-medium">Inset Layout</span>
					</header>
					<div className="flex flex-1 flex-col gap-4 p-4">
						<div className="grid auto-rows-min gap-4 md:grid-cols-3">
							{Array.from({ length: 3 }).map((_, i) => (
								<div key={i} className="aspect-video rounded-xl bg-muted/50" />
							))}
						</div>
						<div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
					</div>
				</SidebarInset>
			</SidebarProvider>
		);
	},
};

// ── Floating Variant ─────────────────────────────────────

export const Floating: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'The `floating` variant displays the sidebar as a floating panel with a rounded border and shadow overlay. It does not push the main content.',
			},
		},
	},
	render: function FloatingStory() {
		return (
			<SidebarProvider defaultOpen={true}>
				<AppSidebar variant="floating" collapsible="icon" />
				<SidebarInset>
					<header className="flex h-11 items-center gap-2 border-b px-4">
						<SidebarTrigger />
						<Separator orientation="vertical" className="h-5" />
						<span className="text-sm font-medium">Floating Layout</span>
					</header>
					<div className="flex flex-1 flex-col gap-4 p-4">
						<div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
					</div>
				</SidebarInset>
			</SidebarProvider>
		);
	},
};

// ── Right Side ───────────────────────────────────────────

export const RightSide: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `side="right"` on the `Sidebar` component to display the sidebar on the right edge of the screen.',
			},
		},
	},
	render: function RightSideStory() {
		return (
			<SidebarProvider defaultOpen={true}>
				<AppSidebar side="right" />
				<SidebarInset>
					<header className="flex h-11 items-center gap-2 border-b px-4">
						<SidebarTrigger />
						<Separator orientation="vertical" className="h-5" />
						<span className="text-sm font-medium">Right Sidebar</span>
					</header>
					<div className="flex flex-1 flex-col gap-4 p-4">
						<div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
					</div>
				</SidebarInset>
			</SidebarProvider>
		);
	},
};

// ── With Submenu ─────────────────────────────────────────

export const WithSubmenu: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'A sidebar with collapsible groups and submenu items using `SidebarMenuSub`. Wrap `SidebarGroup` in a `Collapsible` to create expandable sections.',
			},
		},
	},
	render: function WithSubmenuStory() {
		return (
			<SidebarProvider defaultOpen={true}>
				<Sidebar collapsible="icon">
					<SidebarHeader>
						<SidebarMenu>
							<SidebarMenuItem>
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<SidebarMenuButton size="lg">
												<Avatar size="sm">
													<AvatarImage src="" alt="Avatar" />
													<AvatarFallback>CN</AvatarFallback>
												</Avatar>
												<span>MMBIX</span>
												<ChevronDownIcon className="ml-auto" />
											</SidebarMenuButton>
										}
									/>
									<DropdownMenuContent className="w-(--radix-popper-anchor-width)">
										<DropdownMenuGroup>
											<DropdownMenuLabel>Workspaces</DropdownMenuLabel>
										</DropdownMenuGroup>
										<DropdownMenuItem>MMBIX Inc</DropdownMenuItem>
										<DropdownMenuItem>Monsters Inc</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem>Create Workspace</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarHeader>
					<SidebarContent>
						<Collapsible defaultOpen className="group/collapsible">
							<SidebarGroup>
								<SidebarGroupLabel
									render={
										<CollapsibleTrigger className="flex w-full items-center gap-2">
											<span>Projects</span>
											<ChevronRightIcon className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
										</CollapsibleTrigger>
									}
								/>
								<CollapsibleContent>
									<SidebarGroupContent>
										<SidebarMenu>
											<SidebarMenuItem>
												<SidebarMenuButton>
													<span>Design System</span>
												</SidebarMenuButton>
											</SidebarMenuItem>
											<SidebarMenuItem>
												<SidebarMenuButton>
													<span>Mobile App</span>
												</SidebarMenuButton>
											</SidebarMenuItem>
											<SidebarMenuSub>
												<SidebarMenuSubItem>
													<SidebarMenuSubButton>
														<span>iOS</span>
													</SidebarMenuSubButton>
												</SidebarMenuSubItem>
												<SidebarMenuSubItem>
													<SidebarMenuSubButton>
														<span>Android</span>
													</SidebarMenuSubButton>
												</SidebarMenuSubItem>
											</SidebarMenuSub>
											<SidebarMenuItem>
												<SidebarMenuButton>
													<span>API Gateway</span>
													<SidebarMenuBadge>12</SidebarMenuBadge>
												</SidebarMenuButton>
											</SidebarMenuItem>
										</SidebarMenu>
									</SidebarGroupContent>
								</CollapsibleContent>
							</SidebarGroup>
						</Collapsible>
						<SidebarGroup>
							<SidebarGroupLabel>General</SidebarGroupLabel>
							<SidebarGroupContent>
								<SidebarMenu>
									<SidebarMenuItem>
										<SidebarMenuButton isActive>
											<HomeIcon />
											<span>Dashboard</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
									<SidebarMenuItem>
										<SidebarMenuButton>
											<InboxIcon />
											<span>Inbox</span>
											<SidebarMenuBadge>3</SidebarMenuBadge>
										</SidebarMenuButton>
									</SidebarMenuItem>
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>
					</SidebarContent>
					<SidebarFooter>
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton>
									<SettingsIcon />
									<span>Settings</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarFooter>
					<SidebarRail />
				</Sidebar>
				<SidebarInset>
					<header className="flex h-11 items-center gap-2 border-b px-4">
						<SidebarTrigger />
						<Separator orientation="vertical" className="h-5" />
						<span className="text-sm font-medium">With Submenu</span>
					</header>
					<div className="flex flex-1 flex-col gap-4 p-4">
						<div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
					</div>
				</SidebarInset>
			</SidebarProvider>
		);
	},
};

// ── Controlled ───────────────────────────────────────────

export const Controlled: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use the `open` and `onOpenChange` props on `SidebarProvider` to control the sidebar state externally.',
			},
		},
	},
	render: function ControlledStory() {
		const [open, setOpen] = useState(true);
		return (
			<SidebarProvider open={open} onOpenChange={setOpen}>
				<AppSidebar />
				<SidebarInset>
					<header className="flex h-11 items-center gap-2 border-b px-4">
						<SidebarTrigger />
						<Separator orientation="vertical" className="h-5" />
						<div className="ml-auto flex items-center gap-2">
							<Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
								{open ? 'Close' : 'Open'} Sidebar
							</Button>
						</div>
					</header>
					<div className="flex flex-1 flex-col gap-4 p-4">
						<div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
					</div>
				</SidebarInset>
			</SidebarProvider>
		);
	},
};

// ── With Search ──────────────────────────────────────────

export const WithSearch: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A sidebar with a search input in the header using the `SidebarInput` component.',
			},
		},
	},
	render: function WithSearchStory() {
		return (
			<SidebarProvider defaultOpen={true}>
				<Sidebar collapsible="icon">
					<SidebarHeader>
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton size="lg" render={<span />}>
									<Avatar size="sm">
										<AvatarFallback>DS</AvatarFallback>
									</Avatar>
									<span>Design System</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
						<SidebarInput placeholder="Search..." />
					</SidebarHeader>
					<SidebarContent>
						<SidebarGroup>
							<SidebarGroupLabel>Quick Access</SidebarGroupLabel>
							<SidebarGroupContent>
								<SidebarMenu>
									{[
										{ icon: HomeIcon, label: 'Dashboard' },
										{ icon: InboxIcon, label: 'Inbox', badge: '3' },
										{ icon: CalendarIcon, label: 'Calendar' },
										{ icon: UserIcon, label: 'Team' },
										{ icon: CreditCardIcon, label: 'Billing' },
										{ icon: SearchIcon, label: 'Discover' },
									].map((item) => (
										<SidebarMenuItem key={item.label}>
											<SidebarMenuButton>
												<item.icon />
												<span>{item.label}</span>
												{item.badge && <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>}
											</SidebarMenuButton>
										</SidebarMenuItem>
									))}
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>
					</SidebarContent>
					<SidebarFooter>
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton>
									<SettingsIcon />
									<span>Settings</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarFooter>
					<SidebarRail />
				</Sidebar>
				<SidebarInset>
					<header className="flex h-11 items-center gap-2 border-b px-4">
						<SidebarTrigger />
						<Separator orientation="vertical" className="h-5" />
						<span className="text-sm font-medium">Search</span>
					</header>
					<div className="flex flex-1 flex-col gap-4 p-4">
						<div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
					</div>
				</SidebarInset>
			</SidebarProvider>
		);
	},
};

// ── Shared AppSidebar component ───────────────────────────

function AppSidebar({
	side = 'left',
	variant = 'sidebar',
	collapsible = 'offcanvas',
}: {
	side?: 'left' | 'right';
	variant?: 'sidebar' | 'floating' | 'inset';
	collapsible?: 'offcanvas' | 'icon' | 'none';
}) {
	return (
		<Sidebar side={side} variant={variant} collapsible={collapsible}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<SidebarMenuButton size="lg">
										<Avatar size="sm">
											<AvatarImage src="" alt="Avatar" />
											<AvatarFallback>CN</AvatarFallback>
										</Avatar>
										<span>MMBIX Inc</span>
										<ChevronDownIcon className="ml-auto" />
									</SidebarMenuButton>
								}
							/>
							<DropdownMenuContent className="w-(--radix-popper-anchor-width)">
								<DropdownMenuGroup>
									<DropdownMenuLabel>Workspaces</DropdownMenuLabel>
								</DropdownMenuGroup>
								<DropdownMenuItem>MMBIX Inc</DropdownMenuItem>
								<DropdownMenuItem>Monsters Inc</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Platform</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton isActive>
									<HomeIcon />
									<span>Dashboard</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
							<SidebarMenuItem>
								<SidebarMenuButton>
									<InboxIcon />
									<span>Inbox</span>
									<SidebarMenuBadge>3</SidebarMenuBadge>
								</SidebarMenuButton>
							</SidebarMenuItem>
							<SidebarMenuItem>
								<SidebarMenuButton>
									<CalendarIcon />
									<span>Calendar</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
							<SidebarMenuItem>
								<SidebarMenuButton>
									<SearchIcon />
									<span>Discover</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
				<SidebarSeparator />
				<SidebarGroup>
					<SidebarGroupLabel>Workspace</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton>
									<UserIcon />
									<span>Team</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
							<SidebarMenuItem>
								<SidebarMenuButton>
									<CreditCardIcon />
									<span>Billing</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
							<SidebarMenuItem>
								<SidebarMenuButton>
									<SettingsIcon />
									<span>Settings</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton>
							<Avatar size="sm">
								<AvatarFallback>JD</AvatarFallback>
							</Avatar>
							<span>John Doe</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
