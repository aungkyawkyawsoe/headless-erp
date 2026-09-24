import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import {
	BarChart3,
	Calculator,
	Car,
	Clock,
	DownloadIcon,
	FileText,
	Fuel,
	Map,
	MoreHorizontalIcon,
	Package,
	Receipt,
	Search,
	Settings,
	Shield,
	SquareKanbanIcon,
	Table2Icon,
	ArrowLeftIcon,
	BriefcaseIcon,
	SaveIcon,
	ShieldCheckIcon,
	StickyNoteIcon,
	Truck,
	UserRoundIcon,
	Users,
	Warehouse,
	Wrench,
	Zap,
} from 'lucide-react';

import {
	AppShell,
	StatusBar,
	StatusBarButton,
	type AppShellProps,
	type Module,
	type NavMainItem,
	type NavMainSubItem,
	type NavProject,
} from './';
import { ButtonGroup } from '../button-group';
import mmbixLogo from '../../assets/mmbix-logo.png';
import type { ViewMode } from '../kanban';
import { cn } from '@/utils';
import { ThemeProvider } from '../theme-provider';
import { LocaleProvider } from '../locale-provider';
import { DataTable } from '../datatable/datatable';
import type { ColumnDef } from '../datatable/core/types';
import { Badge } from '../badge';
import { Button } from '../button';
import { LinksCard, LinksCardItem } from '../links-card';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '../dropdown-menu';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '../breadcrumb';
import { DatePicker } from '../datepicker';
import { Field, FieldContent, FieldLabel } from '../field';
import { Form, FormActions, FormBreadcrumbs, FormContent, FormHeader, FormTabs, type FormTabConfig } from '../form';
import { Input } from '../input';
import { NativeSelect, NativeSelectOption } from '../native-select';
import { Textarea } from '../textarea';
import { toast } from '../toast';

const sharedNav = {
	navMain: [
		{
			title: 'Dashboard',
			url: '#',
			icon: BarChart3,
			isActive: true,
			items: [
				{ title: 'Overview', url: '#' },
				{ title: 'Analytics', url: '#' },
			],
		},
		{
			title: 'Settings',
			url: '#',
			icon: Shield,
			items: [
				{ title: 'General', url: '#' },
				{ title: 'Users', url: '#' },
				{ title: 'Permissions', url: '#' },
			],
		},
	],
	projects: [
		{ name: 'Reports', url: '#', icon: FileText },
		{ name: 'Help & Support', url: '#', icon: Clock },
	],
};

const data: AppShellProps['data'] = {
	user: {
		name: 'Aung Kyaw',
		email: 'devops@mmbix.com',
		avatar: 'https://mmbix.com/avatars/aung-kyaw.png',
	},
	brand: {
		logo: mmbixLogo,
		name: 'MMBIX',
	},
	modules: [
		{ name: 'Logistics', icon: Package },
		{ name: 'HRM', icon: Users },
		{ name: 'MRO', icon: Wrench },
		{ name: 'Vehicle', icon: Car },
		{ name: 'Fuel', icon: Fuel },
		{ name: 'Accounting', icon: Calculator },
		{ name: 'Finance', icon: Receipt },
		{ name: 'Warehouse', icon: Warehouse },
		{ name: 'Inventory', icon: Package },
		{ name: 'Procurement', icon: Truck },
		{ name: 'Sales', icon: BarChart3 },
		{ name: 'CRM', icon: Users },
		{ name: 'Compliance', icon: Shield },
		{ name: 'Documents', icon: FileText },
		{ name: 'Fleet', icon: Truck },
		{ name: 'Dispatch', icon: Clock },
		{ name: 'Route Planner', icon: Map },
	],
	navByModule: {
		Logistics: {
			navMain: [
				{
					title: 'Shipments',
					url: '#',
					icon: Package,
					isActive: true,
					items: [
						{ title: 'Active Shipments', url: '#' },
						{ title: 'Shipment History', url: '#' },
						{ title: 'Tracking', url: '#' },
					],
				},
				{
					title: 'Routes',
					url: '#',
					icon: Map,
					items: [
						{ title: 'Route Planning', url: '#' },
						{ title: 'Optimization', url: '#' },
					],
				},
				{
					title: 'Dispatch',
					url: '#',
					icon: Clock,
					items: [
						{ title: 'Dispatch Board', url: '#' },
						{ title: 'Driver Assignments', url: '#' },
					],
				},
			],
			projects: [
				{ name: "Today's Routes", url: '#', icon: Map },
				{ name: 'Pending Deliveries', url: '#', icon: Clock },
				{ name: 'Fleet Status', url: '#', icon: Truck },
			],
		},
		HRM: {
			navMain: [
				{
					title: 'Employees',
					url: '#',
					icon: Users,
					isActive: true,
					items: [
						{ title: 'Directory', url: '#' },
						{ title: 'Onboarding', url: '#' },
						{ title: 'Offboarding', url: '#' },
					],
				},
				{
					title: 'Attendance',
					url: '#',
					icon: Clock,
					items: [
						{ title: 'Timesheets', url: '#' },
						{ title: 'Leave Requests', url: '#' },
					],
				},
				{
					title: 'Payroll',
					url: '#',
					icon: Calculator,
					items: [
						{ title: 'Salary', url: '#' },
						{ title: 'Benefits', url: '#' },
						{ title: 'Tax Forms', url: '#' },
					],
				},
			],
			projects: [
				{ name: 'Open Positions', url: '#', icon: Users },
				{ name: 'Upcoming Reviews', url: '#', icon: Clock },
			],
		},
		MRO: {
			navMain: [
				{
					title: 'Work Orders',
					url: '#',
					icon: Wrench,
					isActive: true,
					items: [
						{ title: 'Open Orders', url: '#' },
						{ title: 'Scheduled', url: '#' },
						{ title: 'Completed', url: '#' },
					],
				},
				{
					title: 'Assets',
					url: '#',
					icon: Truck,
					items: [
						{ title: 'Equipment', url: '#' },
						{ title: 'Maintenance Schedule', url: '#' },
					],
				},
				{
					title: 'Inventory',
					url: '#',
					icon: Package,
					items: [
						{ title: 'Spare Parts', url: '#' },
						{ title: 'Supplies', url: '#' },
					],
				},
			],
			projects: [
				{ name: 'Overdue Maintenance', url: '#', icon: Clock },
				{ name: 'Parts Requisition', url: '#', icon: Package },
			],
		},
		Vehicle: {
			navMain: [
				{
					title: 'Fleet',
					url: '#',
					icon: Truck,
					isActive: true,
					items: [
						{ title: 'Vehicle List', url: '#' },
						{ title: 'Assignments', url: '#' },
					],
				},
				{
					title: 'Maintenance',
					url: '#',
					icon: Wrench,
					items: [
						{ title: 'Service Records', url: '#' },
						{ title: 'Inspections', url: '#' },
						{ title: 'Repairs', url: '#' },
					],
				},
				{
					title: 'Fuel',
					url: '#',
					icon: Fuel,
					items: [
						{ title: 'Fuel Log', url: '#' },
						{ title: 'Consumption', url: '#' },
					],
				},
			],
			projects: [
				{ name: 'Active Vehicles', url: '#', icon: Car },
				{ name: 'Service Due', url: '#', icon: Clock },
			],
		},
		Fuel: {
			navMain: [
				{
					title: 'Fuel Management',
					url: '#',
					icon: Fuel,
					isActive: true,
					items: [
						{ title: 'Inventory', url: '#' },
						{ title: 'Dispensers', url: '#' },
						{ title: 'Pricing', url: '#' },
					],
				},
				{
					title: 'Transactions',
					url: '#',
					icon: Receipt,
					items: [
						{ title: 'Sales Log', url: '#' },
						{ title: 'Purchases', url: '#' },
						{ title: 'Reconciliation', url: '#' },
					],
				},
				{
					title: 'Reports',
					url: '#',
					icon: BarChart3,
					items: [
						{ title: 'Consumption', url: '#' },
						{ title: 'Forecast', url: '#' },
					],
				},
			],
			projects: [
				{ name: 'Low Stock Alerts', url: '#', icon: Fuel },
				{ name: 'Delivery Schedule', url: '#', icon: Truck },
			],
		},
		Accounting: {
			navMain: [
				{
					title: 'Ledger',
					url: '#',
					icon: Calculator,
					isActive: true,
					items: [
						{ title: 'Chart of Accounts', url: '#' },
						{ title: 'Journal Entries', url: '#' },
					],
				},
				{
					title: 'Accounts Payable',
					url: '#',
					icon: Receipt,
					items: [
						{ title: 'Vendors', url: '#' },
						{ title: 'Invoices', url: '#' },
						{ title: 'Payments', url: '#' },
					],
				},
				{
					title: 'Accounts Receivable',
					url: '#',
					icon: Receipt,
					items: [
						{ title: 'Customers', url: '#' },
						{ title: 'Invoices', url: '#' },
						{ title: 'Collections', url: '#' },
					],
				},
			],
			projects: [
				{ name: 'Pending Approvals', url: '#', icon: Clock },
				{ name: 'Month End Closing', url: '#', icon: Calculator },
			],
		},
		default: sharedNav,
	},
};

const breadcrumbs: AppShellProps['breadcrumbs'] = [{ label: 'Build Your Application', href: '#' }, { label: 'Data Fetching' }];

/**
 * A responsive app shell layout with module-based navigation.
 * Each module shows its own set of nav menus and quick access links.
 */
const meta: Meta<typeof AppShell> = {
	title: 'Components/AppShell',
	component: AppShell,
	parameters: {
		layout: 'fullscreen',
		docs: {
			description: {
				component:
					'A responsive app shell layout with module-based sidebar navigation. Each module shows context-relevant nav menus and quick access links. Built on top of the Sidebar primitives. The sidebar is **resizable**: hover its right edge and drag the grip to change the width (a plain click still collapses/expands it); the width persists across reloads. Optionally accepts a `statusBar` node (e.g. a `<StatusBar />`) that docks full-width at the bottom of the layout. The user menu (bottom-right avatar) includes language/locale and light/dark theme switchers.',
			},
		},
	},
	tags: ['autodocs'],
	decorators: [
		(Story) => (
			<LocaleProvider>
				<ThemeProvider>
					<Story />
				</ThemeProvider>
			</LocaleProvider>
		),
	],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Default ──────────────────────────────────────────────

export const Default: Story = {
	parameters: {
		docs: {
			description: {
				story:
					"The full app shell with sidebar expanded, breadcrumb header, and quick-access link cards. Switch modules to see different navigation menus. Drag the sidebar's right edge (hover the boundary to reveal the grip) to resize it — the width persists across reloads.",
			},
		},
	},
	args: {
		data,
		breadcrumbs,
		statusBar: <StatusBar />,
	},
	render: function DefaultStory(args: AppShellProps) {
		return (
			<AppShell {...args}>
				<div className="grid auto-rows-min gap-4 md:grid-cols-3">
					<LinksCard title="Quick Access" description="Shortcuts to the pages you use most often.">
						<LinksCardItem href="#dashboard">Dashboard</LinksCardItem>
						<LinksCardItem href="#analytics">Analytics</LinksCardItem>
						<LinksCardItem href="#reports">Reports</LinksCardItem>
					</LinksCard>
					<LinksCard
						title="Reports"
						action={
							<Button variant="ghost" size="icon-xs" aria-label="More options">
								<MoreHorizontalIcon />
							</Button>
						}
					>
						<LinksCardItem href="#shipments">Shipments Overview</LinksCardItem>
						<LinksCardItem href="#route-planner">Route Planner</LinksCardItem>
						<LinksCardItem href="#fleet-status" disabled disabledReason="You need to create these first: Fleet">
							Fleet Status
						</LinksCardItem>
					</LinksCard>
					<LinksCard title="Documents" description="Recently opened documents.">
						<LinksCardItem href="#contracts">Contracts</LinksCardItem>
						<LinksCardItem href="#invoices">Invoices</LinksCardItem>
						<LinksCardItem href="#permits">Permits</LinksCardItem>
					</LinksCard>
				</div>
				<div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
			</AppShell>
		);
	},
};

// ── Custom Module Colors ────────────────────────────────

/**
 * Modules can carry their own brand colors via the optional `iconColor` and
 * `iconBackground` fields. They are applied to the sidebar's selected-module
 * chip and to each module's icon box in the module switcher grid.
 */
export const CustomModuleColors: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Each module accepts optional `iconColor` and `iconBackground` (any CSS color) to brand its icon chip in the sidebar and its icon box in the module switcher grid. Omit them to keep the theme defaults.',
			},
		},
	},
	render: () => {
		// Muted, earthy "vintage" palette — warm terracotta, olive, mustard,
		// faded teal, and dusty plum. White icons stay readable on all of them.
		const palette = [
			{ iconBackground: '#b0552e', iconColor: '#ffffff' },
			{ iconBackground: '#6e7450', iconColor: '#ffffff' },
			{ iconBackground: '#b08a2e', iconColor: '#ffffff' },
			{ iconBackground: '#47787a', iconColor: '#ffffff' },
			{ iconBackground: '#8b5e6f', iconColor: '#ffffff' },
		];
		return (
			<AppShell
				data={{
					...data,
					modules: data.modules.map((module, i) => ({
						...module,
						iconBackground: palette[i % palette.length].iconBackground,
						iconColor: palette[i % palette.length].iconColor,
					})),
				}}
				breadcrumbs={breadcrumbs}
			>
				<div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
			</AppShell>
		);
	},
};

// ── Footer Actions ────────────────────────────────────────

export const WithFooterActions: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'The sidebar footer items are hidden by default. Pass `onSettingsClick` to reveal the Settings item, and set `showThemeSwitcher` to reveal the light/dark mode toggle. Either can be enabled independently.',
			},
		},
	},
	args: {
		data,
		breadcrumbs,
		sidebarProps: {
			showThemeSwitcher: true,
			onSettingsClick: () => console.log('settings'),
		},
	},
	render: function WithFooterActionsStory(args: AppShellProps) {
		return (
			<AppShell {...args}>
				<div className="grid auto-rows-min gap-4 md:grid-cols-3">
					<div className="aspect-video rounded-xl bg-muted/50" />
					<div className="aspect-video rounded-xl bg-muted/50" />
					<div className="aspect-video rounded-xl bg-muted/50" />
				</div>
				<div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
			</AppShell>
		);
	},
};

// ── Collapsed ────────────────────────────────────────────

export const Collapsed: Story = {
	parameters: {
		docs: {
			description: {
				story:
					"The app shell starts with the sidebar collapsed to icon-only mode. The status bar's contextual buttons (recent, new) are hidden while the sidebar is closed and reappear when it is expanded.",
			},
		},
	},
	args: {
		data,
		breadcrumbs,
		providerProps: { defaultOpen: false },
		statusBar: <StatusBar />,
	},
	render: function CollapsedStory(args: AppShellProps) {
		return (
			<AppShell {...args}>
				<div className="grid auto-rows-min gap-4 md:grid-cols-3">
					<div className="aspect-video rounded-xl bg-muted/50" />
					<div className="aspect-video rounded-xl bg-muted/50" />
					<div className="aspect-video rounded-xl bg-muted/50" />
				</div>
				<div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
			</AppShell>
		);
	},
};

// ── Status Bar ────────────────────────────────────────────

export const WithStatusBar: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'The first section is fixed (sidebar toggle on the left, theme & fullscreen toggles on the right). Use `middle` and `right` slots with `<StatusBarButton />` helpers to compose the two flexible sections.',
			},
		},
	},
	args: {
		data,
		breadcrumbs,
		statusBar: (
			<StatusBar
				middle={
					<>
						<StatusBarButton icon={Search} label="Search commands" onClick={() => console.log('search')} />
						<StatusBarButton icon={Zap} label="Energy" onClick={() => console.log('energy')} />
					</>
				}
				right={
					<>
						<StatusBarButton icon={Settings} label="Settings" onClick={() => console.log('settings')} />
						<span className="px-1 text-2xs text-muted-foreground/70">UTF-8</span>
					</>
				}
			/>
		),
	},
	render: function WithStatusBarStory(args: AppShellProps) {
		return (
			<AppShell {...args}>
				<div className="grid auto-rows-min gap-4 md:grid-cols-3">
					<div className="aspect-video rounded-xl bg-muted/50" />
					<div className="aspect-video rounded-xl bg-muted/50" />
					<div className="aspect-video rounded-xl bg-muted/50" />
				</div>
				<div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
			</AppShell>
		);
	},
};

// ── Without Breadcrumbs ──────────────────────────────────

export const WithoutBreadcrumbs: Story = {
	parameters: {
		docs: {
			description: {
				story: 'The app shell without breadcrumbs. The header only shows the sidebar trigger and separator.',
			},
		},
	},
	args: {
		data,
	},
	render: function WithoutBreadcrumbsStory(args: AppShellProps) {
		return (
			<AppShell {...args}>
				<div className="grid auto-rows-min gap-4 md:grid-cols-3">
					<div className="aspect-video rounded-xl bg-muted/50" />
					<div className="aspect-video rounded-xl bg-muted/50" />
					<div className="aspect-video rounded-xl bg-muted/50" />
				</div>
				<div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
			</AppShell>
		);
	},
};

// ── Single Breadcrumb ────────────────────────────────────

export const SingleBreadcrumb: Story = {
	parameters: {
		docs: {
			description: {
				story: 'The app shell with a single breadcrumb item (the current page). No separator or link is rendered.',
			},
		},
	},
	args: {
		data,
		breadcrumbs: [{ label: 'Dashboard' }],
	},
	render: function SingleBreadcrumbStory(args: AppShellProps) {
		return (
			<AppShell {...args}>
				<div className="grid auto-rows-min gap-4 md:grid-cols-3">
					<div className="aspect-video rounded-xl bg-muted/50" />
					<div className="aspect-video rounded-xl bg-muted/50" />
					<div className="aspect-video rounded-xl bg-muted/50" />
				</div>
				<div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
			</AppShell>
		);
	},
};

// ═══════════════════════════════════════════════════════════
// ── DataTable Integration Demo ────────────────────────────
// ═══════════════════════════════════════════════════════════

interface User {
	id: string;
	name: string;
	email: string;
	role: string;
	status: string;
	department: string;
	joinedAt: string;
	lastActive: string;
}

const demoDepartments = ['Engineering', 'Product', 'Design', 'Marketing', 'Sales', 'HR', 'Finance'];

const demoUsers: User[] = Array.from({ length: 87 }, (_, i) => ({
	id: `USR-${String(i + 1).padStart(4, '0')}`,
	name: [
		'Alice Johnson',
		'Bob Smith',
		'Carol Williams',
		'David Brown',
		'Eva Martinez',
		'Frank Garcia',
		'Grace Lee',
		'Henry Wilson',
		'Iris Taylor',
		'Jack Anderson',
		'Karen Thomas',
		'Leo Jackson',
	][i % 12],
	email: `user${i + 1}@company.com`,
	role: (['Admin', 'Editor', 'Viewer'] as const)[i % 3],
	status: (['Active', 'Active', 'Active', 'Inactive', 'Suspended'] as const)[i % 5],
	department: demoDepartments[i % demoDepartments.length],
	joinedAt: `202${(i % 5) + 1}-${String((i % 12) + 1).padStart(2, '0')}-15`,
	lastActive: `2026-07-${String(30 - (i % 30)).padStart(2, '0')}`,
}));

const userColumns: ColumnDef<User>[] = [
	{
		id: 'name',
		accessorKey: 'name',
		header: 'Name',
		sortable: true,
		filter: {
			id: 'name',
			label: 'Name',
			type: 'text',
			operator: 'contains',
		},
		width: '200px',
	},
	{
		id: 'email',
		accessorKey: 'email',
		header: 'Email',
		sortable: true,
		filter: {
			id: 'email',
			label: 'Email',
			type: 'text',
			operator: 'contains',
		},
		width: '220px',
	},
	{
		id: 'role',
		accessorKey: 'role',
		header: 'Role',
		sortable: true,
		filter: {
			id: 'role',
			label: 'Role',
			type: 'select',
			operator: 'equals',
			options: [
				{ label: 'Admin', value: 'Admin' },
				{ label: 'Editor', value: 'Editor' },
				{ label: 'Viewer', value: 'Viewer' },
			],
		},
		cell: ({ value }) => {
			const variant = value === 'Admin' ? 'default' : value === 'Editor' ? 'secondary' : 'outline';
			return <Badge variant={variant}>{String(value)}</Badge>;
		},
	},
	{
		id: 'status',
		accessorKey: 'status',
		header: 'Status',
		sortable: true,
		filter: {
			id: 'status',
			label: 'Status',
			type: 'select',
			operator: 'equals',
			options: [
				{ label: 'Active', value: 'Active' },
				{ label: 'Inactive', value: 'Inactive' },
				{ label: 'Suspended', value: 'Suspended' },
			],
		},
		cell: ({ value }) => {
			const colorMap: Record<string, string> = {
				Active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
				Inactive: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
				Suspended: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
			};
			return (
				<span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorMap[String(value)] ?? ''}`}>
					{String(value)}
				</span>
			);
		},
	},
	{
		id: 'department',
		accessorKey: 'department',
		header: 'Department',
		sortable: true,
		filter: {
			id: 'department',
			label: 'Department',
			type: 'select',
			operator: 'equals',
			options: demoDepartments.map((d) => ({ label: d, value: d })),
		},
	},
	{
		id: 'joinedAt',
		accessorKey: 'joinedAt',
		header: 'Joined',
		sortable: true,
		filter: {
			id: 'joinedAt',
			label: 'Joined',
			type: 'date',
			operator: 'equals',
		},
	},
	{
		id: 'lastActive',
		accessorKey: 'lastActive',
		header: 'Last Active',
		sortable: true,
		filter: {
			id: 'lastActive',
			label: 'Last Active',
			type: 'date',
			operator: 'equals',
		},
	},
	{
		id: 'actions',
		header: '',
		enableSorting: false,
		width: '60px',
		cell: () => (
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button variant="ghost" size="icon-sm">
							<MoreHorizontalIcon className="size-4" />
							<span className="sr-only">Open menu</span>
						</Button>
					}
				/>
				<DropdownMenuContent align="end" className="w-40">
					<DropdownMenuGroup>
						<DropdownMenuLabel>Actions</DropdownMenuLabel>
					</DropdownMenuGroup>
					<DropdownMenuItem>View profile</DropdownMenuItem>
					<DropdownMenuItem>Edit</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		),
	},
];

// ── Burmese locale (မြန်မာ) ────────────────────────────────
// Shared data used by the ERP dashboard stories below.

const burmeseSharedNav = {
	navMain: [
		{
			title: 'ဒက်ရှ်ဘုတ်',
			url: '#',
			icon: BarChart3,
			isActive: true,
			items: [
				{ title: 'ခြုံငုံသုံးသပ်ချက်', url: '#' },
				{ title: 'ခွဲခြမ်းစိတ်ဖြာချက်များ', url: '#' },
			],
		},
		{
			title: 'ဆက်တင်များ',
			url: '#',
			icon: Shield,
			items: [
				{ title: 'အထွေထွေ', url: '#' },
				{ title: 'အသုံးပြုသူများ', url: '#' },
				{ title: 'ခွင့်ပြုချက်များ', url: '#' },
			],
		},
	],
	projects: [
		{ name: 'အစီရင်ခံစာများ', url: '#', icon: FileText },
		{ name: 'အကူအညီနှင့် ပံ့ပိုးမှု', url: '#', icon: Clock },
	],
};

const burmeseData: AppShellProps['data'] = {
	user: {
		name: 'အောင်ကျော်',
		email: 'devops@mmbix.com',
		avatar: 'https://mmbix.com/avatars/aung-kyaw.png',
	},
	brand: {
		logo: mmbixLogo,
		name: 'MMBIX',
	},
	modules: [
		{ name: 'ထောက်ပံ့', icon: Package },
		{ name: 'လူ့စွမ်းအား', icon: Users },
		{ name: 'ပြုပြင်ရေး', icon: Wrench },
		{ name: 'ယာဉ်များ', icon: Car },
		{ name: 'လောင်စာဆီ', icon: Fuel },
		{ name: 'စာရင်း', icon: Calculator },
		{ name: 'ဘဏ္ဍာ', icon: Receipt },
		{ name: 'ဂိုဒေါင်', icon: Warehouse },
		{ name: 'ကုန်စာရင်း', icon: Package },
		{ name: 'ဝယ်ယူရေး', icon: Truck },
		{ name: 'အရောင်း', icon: BarChart3 },
		{ name: 'ဖောက်သည်', icon: Users },
		{ name: 'လိုက်နာမှု', icon: Shield },
		{ name: 'စာတမ်းများ', icon: FileText },
		{ name: 'ယာဉ်တန်း', icon: Truck },
		{ name: 'စေလွှတ်မှု', icon: Clock },
		{ name: 'လမ်းကြောင်း', icon: Map },
	],
	navByModule: {
		ထောက်ပံ့: {
			navMain: [
				{
					title: 'ကုန်တင်ပို့မှုများ',
					url: '#',
					icon: Package,
					isActive: true,
					items: [
						{ title: 'တင်ပို့ဆဲကုန်များ', url: '#' },
						{ title: 'တင်ပို့မှုမှတ်တမ်း', url: '#' },
						{ title: 'ခြေရာခံခြင်း', url: '#' },
					],
				},
				{
					title: 'လမ်းကြောင်းများ',
					url: '#',
					icon: Map,
					items: [
						{ title: 'လမ်းကြောင်းစီစဉ်ခြင်း', url: '#' },
						{ title: 'ပိုမိုကောင်းမွန်အောင် ပြုပြင်ခြင်း', url: '#' },
					],
				},
				{
					title: 'စေလွှတ်ခြင်း',
					url: '#',
					icon: Clock,
					items: [
						{ title: 'စေလွှတ်မှုဘုတ်', url: '#' },
						{ title: 'ယာဉ်မောင်းတာဝန်များ', url: '#' },
					],
				},
			],
			projects: [
				{ name: 'ယနေ့လမ်းကြောင်းများ', url: '#', icon: Map },
				{ name: 'ဆောင်ရွက်စရာ ပို့ဆောင်မှုများ', url: '#', icon: Clock },
				{ name: 'ယာဉ်တန်းအခြေအနေ', url: '#', icon: Truck },
			],
		},
		default: burmeseSharedNav,
	},
};

const burmeseDepartments = ['အင်ဂျင်နီယာ', 'ထုတ်ကုန်', 'ဒီဇိုင်း', 'ဈေးကွက်', 'အရောင်း', 'လူ့စွမ်းအား', 'ဘဏ္ဍာရေး'];

const burmeseUserNames = [
	'အောင်ကျော်',
	'မေသဉ္ဇာ',
	'စိုင်းထွန်းလင်း',
	'သန့်ဇင်မောင်',
	'ခင်ဝါဆွေ',
	'နန္ဒာလင်း',
	'ဇော်မင်းထက်',
	'စုစုလေး',
	'ဖြိုးသန့်',
	'ရဲထွဋ်ခိုင်',
	'ဝင်းဝင်းနိုင်',
	'မြင့်ဆန်းအောင်',
];

const burmeseUsers: User[] = Array.from({ length: 87 }, (_, i) => ({
	id: `USR-${String(i + 1).padStart(4, '0')}`,
	name: burmeseUserNames[i % burmeseUserNames.length],
	email: `user${i + 1}@mmbix.com`,
	role: (['စီမံသူ', 'တည်းဖြတ်သူ', 'ကြည့်ရှုသူ'] as const)[i % 3],
	status: (['လှုပ်ရှားနေ', 'လှုပ်ရှားနေ', 'လှုပ်ရှားနေ', 'မလှုပ်ရှား', 'ရပ်ဆိုင်းထား'] as const)[i % 5],
	department: burmeseDepartments[i % burmeseDepartments.length],
	joinedAt: `202${(i % 5) + 1}-${String((i % 12) + 1).padStart(2, '0')}-15`,
	lastActive: `2026-07-${String(30 - (i % 30)).padStart(2, '0')}`,
}));

const burmeseColumns: ColumnDef<User>[] = [
	{
		id: 'name',
		accessorKey: 'name',
		header: 'အမည်',
		sortable: true,
		filter: {
			id: 'name',
			label: 'အမည်',
			type: 'text',
			operator: 'contains',
		},
		width: '200px',
	},
	{
		id: 'email',
		accessorKey: 'email',
		header: 'အီးမေးလ်',
		sortable: true,
		filter: {
			id: 'email',
			label: 'အီးမေးလ်',
			type: 'text',
			operator: 'contains',
		},
		width: '220px',
	},
	{
		id: 'role',
		accessorKey: 'role',
		header: 'အခန်းကဏ္ဍ',
		sortable: true,
		filter: {
			id: 'role',
			label: 'အခန်းကဏ္ဍ',
			type: 'select',
			operator: 'equals',
			options: [
				{ label: 'စီမံသူ', value: 'စီမံသူ' },
				{ label: 'တည်းဖြတ်သူ', value: 'တည်းဖြတ်သူ' },
				{ label: 'ကြည့်ရှုသူ', value: 'ကြည့်ရှုသူ' },
			],
		},
		cell: ({ value }) => {
			const variant = value === 'စီမံသူ' ? 'default' : value === 'တည်းဖြတ်သူ' ? 'secondary' : 'outline';
			return <Badge variant={variant}>{String(value)}</Badge>;
		},
	},
	{
		id: 'status',
		accessorKey: 'status',
		header: 'အခြေအနေ',
		sortable: true,
		filter: {
			id: 'status',
			label: 'အခြေအနေ',
			type: 'select',
			operator: 'equals',
			options: [
				{ label: 'လှုပ်ရှားနေ', value: 'လှုပ်ရှားနေ' },
				{ label: 'မလှုပ်ရှား', value: 'မလှုပ်ရှား' },
				{ label: 'ရပ်ဆိုင်းထား', value: 'ရပ်ဆိုင်းထား' },
			],
		},
		cell: ({ value }) => {
			const colorMap: Record<string, string> = {
				လှုပ်ရှားနေ: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
				မလှုပ်ရှား: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
				ရပ်ဆိုင်းထား: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
			};
			return (
				<span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorMap[String(value)] ?? ''}`}>
					{String(value)}
				</span>
			);
		},
	},
	{
		id: 'department',
		accessorKey: 'department',
		header: 'ဌာန',
		sortable: true,
		filter: {
			id: 'department',
			label: 'ဌာန',
			type: 'select',
			operator: 'equals',
			options: burmeseDepartments.map((d) => ({ label: d, value: d })),
		},
	},
	{
		id: 'joinedAt',
		accessorKey: 'joinedAt',
		header: 'ပူးပေါင်းသည့်ရက်',
		sortable: true,
		filter: {
			id: 'joinedAt',
			label: 'ပူးပေါင်းသည့်ရက်',
			type: 'date',
			operator: 'equals',
		},
	},
	{
		id: 'lastActive',
		accessorKey: 'lastActive',
		header: 'နောက်ဆုံးလှုပ်ရှားမှု',
		sortable: true,
		filter: {
			id: 'lastActive',
			label: 'နောက်ဆုံးလှုပ်ရှားမှု',
			type: 'date',
			operator: 'equals',
		},
	},
	{
		id: 'actions',
		header: '',
		enableSorting: false,
		width: '60px',
		cell: () => (
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button variant="ghost" size="icon-sm">
							<MoreHorizontalIcon className="size-4" />
							<span className="sr-only">မီနူးဖွင့်ရန်</span>
						</Button>
					}
				/>
				<DropdownMenuContent align="end" className="w-40">
					<DropdownMenuGroup>
						<DropdownMenuLabel>လုပ်ဆောင်ချက်များ</DropdownMenuLabel>
					</DropdownMenuGroup>
					<DropdownMenuItem>ပရိုဖိုင်ကြည့်ရန်</DropdownMenuItem>
					<DropdownMenuItem>တည်းဖြတ်ရန်</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive">ဖျက်ရန်</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		),
	},
];

const burmeseLabels: React.ComponentProps<typeof DataTable>['labels'] = {
	searchPlaceholder: 'ရှာရန်...',
	filters: 'စစ်ထုတ်ရန်',
	clearFilters: 'ရှင်းရန်',
	empty: 'ရလဒ်များ မတွေ့ရှိပါ။',
	loading: 'ဝန်ဆွဲနေသည်...',
	create: 'အသစ်ဖန်တီးရန်',
};

// ── Reusable ERP dashboard view ────────────────────────────

/** Option values used by the create/edit form's selects. */
const userRoles = ['Admin', 'Editor', 'Viewer'];
const userStatuses = ['Active', 'Inactive', 'Suspended'];

/**
 * UI labels for the tabbed create/edit form view (see
 * `ErpDashboardStrings.form`). When these are provided, clicking a table row
 * opens the edit form and the toolbar's create button opens the empty create
 * form — otherwise those interactions fall back to `createMessage`.
 */
interface ErpDashboardFormStrings {
	createTitle: string;
	editTitle: string;
	cancel: string;
	save: string;
	saving: string;
	createdToast: string;
	savedToast: string;
	tabProfile: string;
	tabEmployment: string;
	tabAccount: string;
	tabNotes: string;
	fieldName: string;
	fieldEmail: string;
	fieldRole: string;
	fieldDepartment: string;
	fieldJoined: string;
	fieldStatus: string;
	fieldLastActive: string;
	fieldNotes: string;
	namePlaceholder: string;
	emailPlaceholder: string;
	notesPlaceholder: string;
}

/** Which view the ERP dashboard is showing: the table or the create/edit form. */
type DashboardView = { mode: 'list' } | { mode: 'create' } | { mode: 'edit'; user: User };

/** `User` without a required id — create mode assigns the id on save. */
type UserDraft = Omit<User, 'id'> & { id?: string };

/** Local-midnight date helpers so ISO strings round-trip without TZ drift. */
function parseIsoDate(iso?: string): Date | undefined {
	if (!iso) return undefined;
	const [year, month, day] = iso.split('-').map(Number);
	return new Date(year, month - 1, day);
}

function isoFromDate(date?: Date): string {
	if (!date) return '';
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/** Next `USR-####` id above the highest one already in the table. */
function nextUserId(users: User[]): string {
	const max = users.reduce((acc, user) => {
		const n = Number(user.id.replace(/\D/g, ''));
		return Number.isFinite(n) && n > acc ? n : acc;
	}, 0);
	return `USR-${String(max + 1).padStart(4, '0')}`;
}

/** Compact breadcrumb trail for the form header. */
function CrumbTrail({ items }: { items: Array<{ label: string; href?: string }> }) {
	return (
		<Breadcrumb>
			<BreadcrumbList>
				{items.map((item, index) => {
					const isLast = index === items.length - 1;
					return (
						<React.Fragment key={item.label}>
							<BreadcrumbItem className={isLast ? undefined : 'hidden md:block'}>
								{isLast ? (
									<BreadcrumbPage>{item.label}</BreadcrumbPage>
								) : (
									<BreadcrumbLink href={item.href ?? '#'}>{item.label}</BreadcrumbLink>
								)}
							</BreadcrumbItem>
							{!isLast && <BreadcrumbSeparator className="hidden md:block" />}
						</React.Fragment>
					);
				})}
			</BreadcrumbList>
		</Breadcrumb>
	);
}

interface ErpDashboardStrings {
	selectedRows: (count: number) => string;
	exportSelected: string;
	deleteSelected: string;
	deleting: string;
	exportAll: string;
	exportAllMessage: string;
	refreshing: string;
	createMessage: string;
	deleteMessage: (count: number) => string;
	csvHeaders: string[];
	fileName: string;
	/**
	 * Optional tabbed create/edit form view. When provided, clicking a table
	 * row opens the edit form and the toolbar's create button opens the empty
	 * create form; when omitted those interactions fall back to `createMessage`
	 * (and rows aren't clickable).
	 */
	form?: ErpDashboardFormStrings;
}

interface ErpDashboardProps {
	data: AppShellProps['data'];
	breadcrumbs: AppShellProps['breadcrumbs'];
	users: User[];
	columns: ColumnDef<User>[];
	labels?: React.ComponentProps<typeof DataTable>['labels'];
	strings: ErpDashboardStrings;
	providerProps?: React.ComponentProps<typeof AppShell>['providerProps'];
	sidebarProps?: AppShellProps['sidebarProps'];
	/**
	 * Drive the demo with the History API (hash routes) instead of local
	 * state. When enabled the URL reflects the current view — the users
	 * table, create/edit forms, and every sidebar nav item — and the
	 * browser's back/forward buttons work. Defaults to `false`.
	 */
	routed?: boolean;
	/** Base hash route for the users list, e.g. `/logistics/users`. */
	basePath?: string;
}

/**
 * Tabbed user create/edit form built from `Form` + `FormTabs`. The body is a
 * data-driven `FormTabConfig[]` (Profile, Employment, Account, Notes); the
 * header carries a breadcrumb trail and Cancel/Save actions. Rendered with
 * `embedded` so the header strips fit the `AppShell` content area (the shell
 * header is hidden while it is open, so there is exactly one breadcrumb
 * trail). The form is a pure input component — `ErpDashboard` owns the list
 * state and receives the collected values through `onSave`.
 */
function UserFormView({
	mode,
	user,
	strings,
	breadcrumbs,
	onCancel,
	onSave,
}: {
	mode: 'create' | 'edit';
	user?: User;
	strings: ErpDashboardFormStrings;
	breadcrumbs: AppShellProps['breadcrumbs'];
	onCancel: () => void;
	onSave: (draft: UserDraft) => void;
}) {
	const isEdit = mode === 'edit';
	const [name, setName] = React.useState(user?.name ?? '');
	const [email, setEmail] = React.useState(user?.email ?? '');
	const [role, setRole] = React.useState(user?.role ?? 'Viewer');
	const [department, setDepartment] = React.useState(user?.department ?? demoDepartments[0]);
	const [status, setStatus] = React.useState(user?.status ?? 'Active');
	const [joinedAt, setJoinedAt] = React.useState<Date | undefined>(parseIsoDate(user?.joinedAt));
	const [lastActive, setLastActive] = React.useState<Date | undefined>(parseIsoDate(user?.lastActive));
	const [notes, setNotes] = React.useState('');
	const [saving, setSaving] = React.useState(false);

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (saving) return;
		setSaving(true);
		// Simulate a save round-trip so the header shows the pending state.
		window.setTimeout(() => {
			onSave({
				id: user?.id,
				name: name.trim(),
				email: email.trim(),
				role,
				department,
				status,
				joinedAt: isoFromDate(joinedAt),
				lastActive: isoFromDate(lastActive),
			});
			setSaving(false);
		}, 600);
	};

	const tabs: FormTabConfig[] = [
		{
			value: 'profile',
			label: strings.tabProfile,
			icon: <UserRoundIcon />,
			content: (
				<FormContent>
					<Field>
						<FieldLabel htmlFor="uf-name">{strings.fieldName}</FieldLabel>
						<FieldContent>
							<Input id="uf-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={strings.namePlaceholder} />
						</FieldContent>
					</Field>
					<Field>
						<FieldLabel htmlFor="uf-email">{strings.fieldEmail}</FieldLabel>
						<FieldContent>
							<Input
								id="uf-email"
								type="email"
								value={email}
								onChange={(event) => setEmail(event.target.value)}
								placeholder={strings.emailPlaceholder}
							/>
						</FieldContent>
					</Field>
				</FormContent>
			),
		},
		{
			value: 'employment',
			label: strings.tabEmployment,
			icon: <BriefcaseIcon />,
			content: (
				<FormContent>
					<Field>
						<FieldLabel htmlFor="uf-role">{strings.fieldRole}</FieldLabel>
						<FieldContent>
							<NativeSelect id="uf-role" className="w-full" value={role} onChange={(event) => setRole(event.target.value)}>
								{userRoles.map((option) => (
									<NativeSelectOption key={option} value={option}>
										{option}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</FieldContent>
					</Field>
					<Field>
						<FieldLabel htmlFor="uf-department">{strings.fieldDepartment}</FieldLabel>
						<FieldContent>
							<NativeSelect
								id="uf-department"
								className="w-full"
								value={department}
								onChange={(event) => setDepartment(event.target.value)}
							>
								{demoDepartments.map((option) => (
									<NativeSelectOption key={option} value={option}>
										{option}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</FieldContent>
					</Field>
					<Field>
						<FieldLabel htmlFor="uf-joined">{strings.fieldJoined}</FieldLabel>
						<FieldContent>
							<DatePicker className="w-full" value={joinedAt} onValueChange={setJoinedAt} placeholder="Select a date" />
						</FieldContent>
					</Field>
				</FormContent>
			),
		},
		{
			value: 'account',
			label: strings.tabAccount,
			icon: <ShieldCheckIcon />,
			content: (
				<FormContent>
					<Field>
						<FieldLabel htmlFor="uf-status">{strings.fieldStatus}</FieldLabel>
						<FieldContent>
							<NativeSelect id="uf-status" className="w-full" value={status} onChange={(event) => setStatus(event.target.value)}>
								{userStatuses.map((option) => (
									<NativeSelectOption key={option} value={option}>
										{option}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</FieldContent>
					</Field>
					<Field>
						<FieldLabel htmlFor="uf-last-active">{strings.fieldLastActive}</FieldLabel>
						<FieldContent>
							<DatePicker className="w-full" value={lastActive} onValueChange={setLastActive} placeholder="Select a date" />
						</FieldContent>
					</Field>
				</FormContent>
			),
		},
		{
			value: 'notes',
			label: strings.tabNotes,
			icon: <StickyNoteIcon />,
			content: (
				<FormContent>
					<Field className="md:col-span-2">
						<FieldLabel htmlFor="uf-notes">{strings.fieldNotes}</FieldLabel>
						<FieldContent>
							<Textarea
								id="uf-notes"
								value={notes}
								onChange={(event) => setNotes(event.target.value)}
								placeholder={strings.notesPlaceholder}
							/>
						</FieldContent>
					</Field>
				</FormContent>
			),
		},
	];

	const trail = [...(breadcrumbs ?? []), { label: isEdit && user ? user.name : strings.createTitle }];

	return (
		<Form embedded onSubmit={handleSubmit}>
			<FormHeader>
				<FormBreadcrumbs>
					<CrumbTrail items={trail} />
				</FormBreadcrumbs>
				<FormActions>
					<Button variant="outline" type="button" onClick={onCancel}>
						<ArrowLeftIcon />
						{strings.cancel}
					</Button>
					<Button type="submit" disabled={saving}>
						<SaveIcon />
						{saving ? strings.saving : strings.save}
					</Button>
				</FormActions>
			</FormHeader>
			<FormTabs defaultValue="profile" tabs={tabs} />
		</Form>
	);
}

// ── Minimal hash router (dependency-free) ─────────────────

/** URL-safe slug for a nav label ("User Management" → "user-management"). */
function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** Current hash route as segments, e.g. `#/logistics/users/edit/USR-0001`. */
function readHashSegments(): string[] {
	const raw = window.location.hash.replace(/^#\/?/, '');
	return raw ? raw.split('/').filter(Boolean) : [];
}

/** Subscribe to `hashchange`; expose `navigate` (push) and `replace`. */
function useHashRoute() {
	const [segments, setSegments] = React.useState<string[]>(() => readHashSegments());
	React.useEffect(() => {
		const onHash = () => setSegments(readHashSegments());
		window.addEventListener('hashchange', onHash);
		return () => window.removeEventListener('hashchange', onHash);
	}, []);
	const navigate = React.useCallback((path: string) => {
		window.location.hash = path.startsWith('/') ? path : `/${path}`;
	}, []);
	const replace = React.useCallback((path: string) => {
		const next = path.startsWith('/') ? path : `/${path}`;
		window.history.replaceState(null, '', `#${next}`);
		setSegments(readHashSegments());
	}, []);
	return { segments, navigate, replace };
}

type ErpRoute =
	| { kind: 'erp-list' }
	| { kind: 'erp-create' }
	| { kind: 'erp-edit'; id: string }
	| { kind: 'nav-item'; moduleName: string; item: NavMainItem }
	| {
			kind: 'nav-sub';
			moduleName: string;
			item: NavMainItem;
			sub: NavMainSubItem;
	  }
	| { kind: 'project'; moduleName: string; project: NavProject }
	| { kind: 'unknown' };

/**
 * Index every sidebar nav item / sub-item / project by its URL path so a
 * hash route can be resolved back to the item it represents. The module
 * root (`/:module`) maps to the module's first nav item.
 */
function buildNavRoutes(data: AppShellProps['data']): Record<string, ErpRoute> {
	const map: Record<string, ErpRoute> = {};
	for (const [moduleName, moduleData] of Object.entries(data.navByModule)) {
		if (moduleName === 'default') continue;
		const moduleSlug = slugify(moduleName);
		for (const item of moduleData.navMain) {
			const itemSlug = slugify(item.title);
			map[`${moduleSlug}/${itemSlug}`] = {
				kind: 'nav-item',
				moduleName,
				item,
			};
			for (const sub of item.items ?? []) {
				map[`${moduleSlug}/${itemSlug}/${slugify(sub.title)}`] = {
					kind: 'nav-sub',
					moduleName,
					item,
					sub,
				};
			}
		}
		for (const project of moduleData.projects) {
			map[`${moduleSlug}/projects/${slugify(project.name)}`] = {
				kind: 'project',
				moduleName,
				project,
			};
		}
		const firstItem = moduleData.navMain[0];
		if (firstItem) {
			map[moduleSlug] = { kind: 'nav-item', moduleName, item: firstItem };
		}
	}
	return map;
}

/** Resolve hash segments to a route descriptor. */
function resolveRoute(segments: string[], navRoutes: Record<string, ErpRoute>, basePath: string): ErpRoute {
	const path = segments.join('/');
	const base = basePath.replace(/^\//, '');
	if (path === base) return { kind: 'erp-list' };
	if (path === `${base}/new`) return { kind: 'erp-create' };
	const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const editMatch = path.match(new RegExp(`^${escaped}/edit/(.+)$`));
	if (editMatch) {
		return { kind: 'erp-edit', id: decodeURIComponent(editMatch[1]) };
	}
	return navRoutes[path] ?? { kind: 'unknown' };
}

/** Breadcrumbs for the shell header from a route (forms return `[]`). */
function routeCrumbs(route: ErpRoute, listBreadcrumbs: AppShellProps['breadcrumbs']): AppShellProps['breadcrumbs'] {
	switch (route.kind) {
		case 'erp-list':
			return listBreadcrumbs;
		case 'nav-item':
			return [{ label: route.moduleName, href: `#/${slugify(route.moduleName)}` }, { label: route.item.title }];
		case 'nav-sub':
			return [
				{ label: route.moduleName, href: `#/${slugify(route.moduleName)}` },
				{
					label: route.item.title,
					href: `#/${slugify(route.moduleName)}/${slugify(route.item.title)}`,
				},
				{ label: route.sub.title },
			];
		case 'project':
			return [{ label: route.moduleName, href: `#/${slugify(route.moduleName)}` }, { label: route.project.name }];
		default:
			return [];
	}
}

/** Landing page for a sidebar nav item: its sub-links as real hash routes. */
function NavItemLandingPage({ moduleName, item }: { moduleName: string; item: NavMainItem }) {
	const moduleSlug = slugify(moduleName);
	const itemSlug = slugify(item.title);
	return (
		<div className="grid auto-rows-min gap-4 md:grid-cols-2 xl:grid-cols-3">
			<LinksCard title={item.title} description={`Shortcuts to ${item.title} pages.`}>
				{item.items && item.items.length > 0 ? (
					item.items.map((sub) => (
						<LinksCardItem key={sub.title} href={`#/${moduleSlug}/${itemSlug}/${slugify(sub.title)}`}>
							{sub.title}
						</LinksCardItem>
					))
				) : (
					<div className="py-1 text-sm text-muted-foreground">No sub-links available.</div>
				)}
			</LinksCard>
		</div>
	);
}

/** Placeholder for routes without a dedicated page (sub-items, projects). */
function PlaceholderPage({ title, description }: { title: string; description?: string }) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/30 p-10 text-center">
			<h2 className="text-base font-semibold">{title}</h2>
			{description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
			<p className="mt-4 text-xs text-muted-foreground">Demo route — wire this to your real page.</p>
		</div>
	);
}

/**
 * The ERP dashboard scenario. When `routed` is enabled the demo is driven by
 * the URL (hash routes): the users table lives at `basePath`, the create form
 * at `basePath/new`, the edit form at `basePath/edit/:id`, and every sidebar
 * nav item / sub-item / project has its own route. The shell header's
 * breadcrumbs are hidden while a form is open — the form renders its own
 * trail (see `UserFormView`).
 */
function ErpDashboard({
	data,
	breadcrumbs,
	users: initialUsers,
	columns,
	labels,
	strings,
	providerProps,
	sidebarProps,
	routed = false,
	basePath = '/logistics/users',
}: ErpDashboardProps) {
	const { segments, navigate, replace } = useHashRoute();
	const navRoutes = React.useMemo(() => buildNavRoutes(data), [data]);

	// In routed mode the active module follows the URL; legacy mode keeps the
	// first module (Logistics) selected as before.
	const activeModule = React.useMemo(() => {
		if (!routed) return data.modules[0];
		return data.modules.find((m) => slugify(m.name) === segments[0]) ?? data.modules[0];
	}, [routed, segments, data]);

	const route = React.useMemo(() => resolveRoute(segments, navRoutes, basePath), [segments, navRoutes, basePath]);

	const [selected, setSelected] = React.useState<User[]>([]);
	const [deleting, setDeleting] = React.useState(false);
	const [pageSize, setPageSize] = React.useState(10);
	// Local copy of the table data so the create/edit form can add and update
	// rows; bumping `tableKey` remounts the table to refetch after a save.
	const [users, setUsers] = React.useState<User[]>(initialUsers);
	const [view, setView] = React.useState<DashboardView>({ mode: 'list' });
	const [tableKey, setTableKey] = React.useState(0);
	const formStrings = strings.form;

	// Normalize the initial URL to the users table without adding history.
	React.useEffect(() => {
		if (routed && segments.length === 0) {
			replace(basePath);
		}
	}, [routed, segments.length, basePath, replace]);

	const editingUser = route.kind === 'erp-edit' ? users.find((u) => u.id === route.id) : undefined;

	const creating = routed ? route.kind === 'erp-create' : view.mode === 'create';

	// The shell header (breadcrumbs + fullscreen toggle) is hidden only while a
	// form is open — the form carries its own breadcrumb trail. Nav pages and
	// the users list keep the shell header with route-derived breadcrumbs.
	const showShellHeader = routed ? route.kind !== 'erp-create' && route.kind !== 'erp-edit' : view.mode === 'list';
	const shellBreadcrumbs = routed ? routeCrumbs(route, breadcrumbs) : showShellHeader ? breadcrumbs : [];

	const handleCreate = () => {
		if (!formStrings) {
			alert(strings.createMessage);
			return;
		}
		if (routed) navigate(`${basePath}/new`);
		else setView({ mode: 'create' });
	};

	const handleRowClick = (row: User) => {
		if (!formStrings) return;
		if (routed) navigate(`${basePath}/edit/${row.id}`);
		else setView({ mode: 'edit', user: row });
	};

	const handleCancel = () => {
		if (routed) navigate(basePath);
		else setView({ mode: 'list' });
	};

	const handleSave = (draft: UserDraft) => {
		if (!formStrings) return;
		const saved: User = {
			...draft,
			id: draft.id ?? nextUserId(users),
		};
		setUsers((prev) => (prev.some((u) => u.id === saved.id) ? prev.map((u) => (u.id === saved.id ? saved : u)) : [saved, ...prev]));
		setSelected([]);
		// Remount the table so it refetches with the saved row.
		setTableKey((key) => key + 1);
		if (routed) navigate(basePath);
		else setView({ mode: 'list' });
		toast.add({
			title: creating ? formStrings.createdToast : formStrings.savedToast,
			type: 'success',
		});
	};

	// Sidebar navigation → push the target route and return the breadcrumbs
	// for it. `disableNavItemPages` stops the shell from rendering its own
	// links-card page in routed mode.
	const handleNavNavigate: NonNullable<AppShellProps['onNavigate']> = (event) => {
		const moduleSlug = slugify(activeModule.name);
		switch (event.type) {
			case 'nav-main-item': {
				const itemSlug = slugify(event.item.title);
				navigate(`/${moduleSlug}/${itemSlug}`);
				return [{ label: activeModule.name, href: `#/${moduleSlug}` }, { label: event.item.title }];
			}
			case 'nav-main': {
				const itemSlug = slugify(event.item.title);
				const subSlug = slugify(event.subItem.title);
				navigate(`/${moduleSlug}/${itemSlug}/${subSlug}`);
				return [
					{ label: activeModule.name, href: `#/${moduleSlug}` },
					{ label: event.item.title, href: `#/${moduleSlug}/${itemSlug}` },
					{ label: event.subItem.title },
				];
			}
			case 'nav-projects': {
				const projectSlug = slugify(event.project.name);
				navigate(`/${moduleSlug}/projects/${projectSlug}`);
				return [{ label: activeModule.name, href: `#/${moduleSlug}` }, { label: event.project.name }];
			}
		}
	};

	const handleBulkDelete = async () => {
		if (selected.length === 0) return;
		setDeleting(true);
		await new Promise((r) => setTimeout(r, 800));
		alert(strings.deleteMessage(selected.length));
		setSelected([]);
		setDeleting(false);
	};

	const handleExportSelected = () => {
		if (selected.length === 0) return;
		const rows = selected.map((u) => [u.id, u.name, u.email, u.role, u.status, u.department].join(','));
		const csv = [strings.csvHeaders.join(','), ...rows].join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = strings.fileName;
		link.click();
		URL.revokeObjectURL(url);
	};

	// Route-driven (`routed`) vs state-driven (legacy) view selection. The
	// AppShell header (breadcrumbs + fullscreen toggle) is hidden while a form
	// is open so the Form header — which carries its own breadcrumb trail and
	// actions — is the single page header.
	const table = (
		<div className="space-y-4">
			{selected.length > 0 && (
				<div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5">
					<span className="text-sm font-medium">{strings.selectedRows(selected.length)}</span>
					<Button size="icon-sm" variant="outline" onClick={handleExportSelected} aria-label={strings.exportSelected}>
						<DownloadIcon />
					</Button>
					<Button size="sm" variant="destructive" onClick={handleBulkDelete} disabled={deleting}>
						{deleting ? strings.deleting : strings.deleteSelected}
					</Button>
				</div>
			)}
			<DataTable
				key={tableKey}
				columns={columns}
				fetchData={async (params) => {
					await new Promise((r) => setTimeout(r, 600));
					let result = [...users];

					// Apply column filters
					for (const f of params.filters) {
						result = result.filter((row) => {
							const val = String(row[f.id as keyof User] ?? '');
							return val.toLowerCase().includes(String(f.value).toLowerCase());
						});
					}

					// Global search
					if (params.globalFilter) {
						const q = params.globalFilter.toLowerCase();
						result = result.filter((row) => Object.values(row).some((v) => String(v).toLowerCase().includes(q)));
					}

					// Sorting
					if (params.sorting) {
						const { id, direction } = params.sorting;
						result.sort((a, b) => {
							const aVal = String(a[id as keyof User] ?? '');
							const bVal = String(b[id as keyof User] ?? '');
							return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
						});
					}

					const pageSize = params.pagination.pageSize;
					const cursor = params.cursor as string | null | undefined;
					const pageIdx = cursor ? Number(cursor) : 0;
					const rows = result.slice(pageIdx * pageSize, (pageIdx + 1) * pageSize);
					const totalPages = Math.ceil(result.length / pageSize);
					return {
						rows,
						nextCursor: pageIdx < totalPages - 1 ? String(pageIdx + 1) : null,
						prevCursor: pageIdx > 0 ? String(pageIdx - 1) : null,
					};
				}}
				enableRowSelection
				onSelectionChange={setSelected}
				pageSize={pageSize}
				onPageSizeChange={setPageSize}
				toolbarSticky
				labels={labels}
				onCreate={handleCreate}
				onRowClick={formStrings ? handleRowClick : undefined}
				toolbarActions={
					<Button variant="outline" size="icon-sm" onClick={() => alert(strings.exportAllMessage)} aria-label={strings.exportAll}>
						<DownloadIcon />
					</Button>
				}
			/>
		</div>
	);

	let content: React.ReactNode;
	if (!routed) {
		content =
			view.mode !== 'list' && formStrings ? (
				<UserFormView
					key={view.mode === 'edit' ? view.user.id : 'new-user'}
					mode={view.mode}
					user={view.mode === 'edit' ? view.user : undefined}
					strings={formStrings}
					breadcrumbs={breadcrumbs}
					onCancel={handleCancel}
					onSave={handleSave}
				/>
			) : (
				table
			);
	} else {
		switch (route.kind) {
			case 'erp-create':
				content = formStrings ? (
					<UserFormView
						key="new-user"
						mode="create"
						strings={formStrings}
						breadcrumbs={breadcrumbs}
						onCancel={handleCancel}
						onSave={handleSave}
					/>
				) : (
					table
				);
				break;
			case 'erp-edit':
				content =
					formStrings && editingUser ? (
						<UserFormView
							key={editingUser.id}
							mode="edit"
							user={editingUser}
							strings={formStrings}
							breadcrumbs={breadcrumbs}
							onCancel={handleCancel}
							onSave={handleSave}
						/>
					) : (
						<PlaceholderPage title="User not found" description={`No user matches id “${route.id}”.`} />
					);
				break;
			case 'erp-list':
				content = table;
				break;
			case 'nav-item':
				content = <NavItemLandingPage moduleName={route.moduleName} item={route.item} />;
				break;
			case 'nav-sub':
				content = <PlaceholderPage title={route.sub.title} description={`${route.item.title} · ${route.moduleName}`} />;
				break;
			case 'project':
				content = <PlaceholderPage title={route.project.name} description={`${route.moduleName} project`} />;
				break;
			default:
				content = <PlaceholderPage title="Page not found" description="This route is not registered in the demo." />;
		}
	}

	return (
		<AppShell
			data={data}
			breadcrumbs={showShellHeader ? shellBreadcrumbs : []}
			showFullscreenToggle={showShellHeader}
			disableNavItemPages={routed}
			onNavigate={routed ? handleNavNavigate : undefined}
			providerProps={providerProps}
			sidebarProps={{
				...sidebarProps,
				...(routed
					? {
							activeModule,
							onActiveModuleChange: (module: Module) => navigate(`/${slugify(module.name)}`),
						}
					: {}),
			}}
			statusBar={
				<StatusBar
					left={
						<div className="flex items-center gap-px">
							{[25, 50, 100].map((size) => (
								<Button
									key={size}
									variant={pageSize === size ? 'secondary' : 'ghost'}
									size="icon-xs"
									onClick={() => setPageSize(size)}
									className={cn('h-5 min-w-6 px-1 font-mono text-2xs', pageSize === size && 'text-foreground')}
								>
									{size}
								</Button>
							))}
						</div>
					}
				/>
			}
		>
			{content}
		</AppShell>
	);
}

/**
 * A full ERP dashboard scenario with real URL navigation: AppShell with the
 * Logistics module selected, showing a user management DataTable with
 * server-side fetching, row selection, bulk actions, CSV export, and refresh.
 *
 * The demo is driven by hash routes (no router dependency):
 *
 * - `#/logistics/users` — the users table, breadcrumbs `Logistics › User Management`
 * - `#/logistics/users/new` — the empty create form
 * - `#/logistics/users/edit/USR-0001` — the pre-filled edit form
 * - every sidebar nav item / sub-item / project maps to its own route
 *
 * Clicking a table row (or Create New) pushes the route and opens the tabbed
 * form; saving updates the table and returns to the list. The browser's
 * back/forward buttons and the breadcrumb links navigate like a real app.
 */
export const DataTableIntegration: Story = {
	name: 'ERP Dashboard (DataTable)',
	parameters: {
		docs: {
			description: {
				story:
					'AppShell wraps a fully-featured DataTable with server-side fetching, row selection, bulk actions, CSV export, and refresh — a typical ERP module view. The demo is **URL-driven** (hash routes, no router dependency): the users table lives at `#/logistics/users`, Create New at `#/logistics/users/new`, and each row at `#/logistics/users/edit/:id`; sidebar navigation pushes its own routes too, so the breadcrumbs, the back/forward buttons, and the form breadcrumb links all behave like a real app.',
			},
		},
	},
	render: () => (
		<ErpDashboard
			routed
			basePath="/logistics/users"
			data={data}
			breadcrumbs={[
				{ label: 'Logistics', href: '#/logistics' },
				{ label: 'User Management', href: '#/logistics/users' },
			]}
			users={demoUsers}
			columns={userColumns}
			strings={{
				selectedRows: (count) => `${count} row(s) selected`,
				exportSelected: 'Export Selected',
				deleteSelected: 'Delete Selected',
				deleting: 'Deleting...',
				exportAll: 'Export All',
				exportAllMessage: 'Exporting all filtered data as Excel...',
				refreshing: 'Refreshing...',
				createMessage: 'Opening create user form...',
				deleteMessage: (count) => `Deleted ${count} user(s)`,
				csvHeaders: ['ID', 'Name', 'Email', 'Role', 'Status', 'Department'],
				fileName: 'selected-users.csv',
				form: {
					createTitle: 'New User',
					editTitle: 'Edit User',
					cancel: 'Cancel',
					save: 'Save',
					saving: 'Saving…',
					createdToast: 'User created',
					savedToast: 'User saved',
					tabProfile: 'Profile',
					tabEmployment: 'Employment',
					tabAccount: 'Account',
					tabNotes: 'Notes',
					fieldName: 'Full name',
					fieldEmail: 'Email',
					fieldRole: 'Role',
					fieldDepartment: 'Department',
					fieldJoined: 'Joined',
					fieldStatus: 'Status',
					fieldLastActive: 'Last active',
					fieldNotes: 'Internal notes',
					namePlaceholder: 'e.g. Alice Johnson',
					emailPlaceholder: 'alice@company.com',
					notesPlaceholder: 'Optional notes about this user…',
				},
			}}
		/>
	),
};

// ── ERP Dashboard (Burmese) ────────────────────────────────

/**
 * The full ERP dashboard localized to Burmese (မြန်မာ): module
 * navigation, breadcrumbs, DataTable headers, filters, statuses,
 * and bulk actions.
 */
export const ErpDashboardBurmese: Story = {
	name: 'ERP Dashboard (Burmese)',
	parameters: {
		docs: {
			description: {
				story:
					'The ERP dashboard with all UI text localized to Burmese (မြန်မာ) — module navigation, breadcrumbs, DataTable headers, filters, statuses, and bulk actions. The Logistics (ထောက်ပံ့) module is selected. Useful for verifying how the sidebar handles a tall-script locale.',
			},
		},
	},
	render: () => (
		<ErpDashboard
			data={burmeseData}
			breadcrumbs={[{ label: 'ထောက်ပံ့', href: '#' }, { label: 'အသုံးပြုသူစီမံခန့်ခွဲမှု' }]}
			users={burmeseUsers}
			columns={burmeseColumns}
			labels={burmeseLabels}
			sidebarProps={{
				navMainGroupLabel: 'အမြန်ဝင်ရောက်ရန်',
				navProjectsGroupLabel: 'အမြန်ဝင်ရောက်ရန်',
			}}
			strings={{
				selectedRows: (count) => `ရွေးချယ်ထားသော အတန်း ${count} ခု`,
				exportSelected: 'ရွေးချယ်ထားသည်များ ထုတ်ယူရန်',
				deleteSelected: 'ရွေးချယ်ထားသည်များ ဖျက်ရန်',
				deleting: 'ဖျက်နေသည်...',
				exportAll: 'အားလုံး ထုတ်ယူရန်',
				exportAllMessage: 'စစ်ထုတ်ထားသော ဒေတာအားလုံးကို Excel အဖြစ် ထုတ်ယူနေသည်...',
				refreshing: 'ပြန်လည်စတင်နေသည်...',
				createMessage: 'အသုံးပြုသူ ဖန်တီးမှုပုံစံ ဖွင့်နေသည်...',
				deleteMessage: (count) => `အသုံးပြုသူ ${count} ဦးကို ဖျက်လိုက်ပါပြီ`,
				csvHeaders: ['ID', 'အမည်', 'အီးမေးလ်', 'အခန်းကဏ္ဍ', 'အခြေအနေ', 'ဌာန'],
				fileName: 'selected-users.csv',
			}}
		/>
	),
};

/**
 * The Burmese ERP dashboard with the sidebar collapsed to the
 * icon rail, verifying tooltips and icon-only mode with the
 * localized module switcher.
 */
export const ErpDashboardBurmeseCollapsed: Story = {
	name: 'ERP Dashboard (Burmese, Collapsed)',
	parameters: {
		docs: {
			description: {
				story:
					'The Burmese (မြန်မာ) ERP dashboard starting with the sidebar collapsed to icon-only mode. Hover the rail to preview the localized tooltips, then expand to browse the Burmese module navigation.',
			},
		},
	},
	render: () => (
		<ErpDashboard
			data={burmeseData}
			breadcrumbs={[{ label: 'ထောက်ပံ့', href: '#' }, { label: 'အသုံးပြုသူစီမံခန့်ခွဲမှု' }]}
			users={burmeseUsers}
			columns={burmeseColumns}
			labels={burmeseLabels}
			providerProps={{ defaultOpen: false }}
			sidebarProps={{
				navMainGroupLabel: 'အမြန်ဝင်ရောက်ရန်',
				navProjectsGroupLabel: 'အမြန်ဝင်ရောက်ရန်',
			}}
			strings={{
				selectedRows: (count) => `ရွေးချယ်ထားသော အတန်း ${count} ခု`,
				exportSelected: 'ရွေးချယ်ထားသည်များ ထုတ်ယူရန်',
				deleteSelected: 'ရွေးချယ်ထားသည်များ ဖျက်ရန်',
				deleting: 'ဖျက်နေသည်...',
				exportAll: 'အားလုံး ထုတ်ယူရန်',
				exportAllMessage: 'စစ်ထုတ်ထားသော ဒေတာအားလုံးကို Excel အဖြစ် ထုတ်ယူနေသည်...',
				refreshing: 'ပြန်လည်စတင်နေသည်...',
				createMessage: 'အသုံးပြုသူ ဖန်တီးမှုပုံစံ ဖွင့်နေသည်...',
				deleteMessage: (count) => `အသုံးပြုသူ ${count} ဦးကို ဖျက်လိုက်ပါပြီ`,
				csvHeaders: ['ID', 'အမည်', 'အီးမေးလ်', 'အခန်းကဏ္ဍ', 'အခြေအနေ', 'ဌာန'],
				fileName: 'selected-users.csv',
			}}
		/>
	),
};

/**
 * AppShell hosting a DataTable with the built-in Table ↔ Kanban view
 * toggle and resizable columns. The toggle also appears in the shell header
 * via `headerChildren`, demonstrating the shared Table/Kanban toggle in both
 * placements.
 */
export const TableKanbanView: Story = {
	name: 'Table ↔ Kanban View',
	parameters: {
		docs: {
			description: {
				story:
					"The DataTable's icon-only [Table | Kanban] toggle renders at the toolbar's top-right; the same toggle can be placed in the AppShell header via `headerChildren`. Switching to Kanban groups the user rows by status; dragging a card updates the row's status so the table stays in sync. Columns are resizable via their header handles (hover a header edge to reveal the grip).",
			},
		},
	},
	render: () => {
		const [mode, setMode] = React.useState<ViewMode>('table');
		const [rows, setRows] = React.useState<User[]>(demoUsers);
		return (
			<AppShell
				data={data}
				breadcrumbs={[{ label: 'Logistics', href: '#' }, { label: 'User Management' }]}
				headerChildren={
					<div className="ml-auto flex items-center gap-2">
						<ButtonGroup aria-label="View mode" className="shrink-0">
							<Button
								variant="outline"
								size="icon-sm"
								aria-label="Table view"
								aria-pressed={mode === 'table'}
								className="data-active:bg-muted data-active:text-foreground"
								data-active={mode === 'table' ? '' : undefined}
								onClick={() => setMode('table')}
							>
								<Table2Icon />
							</Button>
							<Button
								variant="outline"
								size="icon-sm"
								aria-label="Kanban view"
								aria-pressed={mode === 'kanban'}
								className="data-active:bg-muted data-active:text-foreground"
								data-active={mode === 'kanban' ? '' : undefined}
								onClick={() => setMode('kanban')}
							>
								<SquareKanbanIcon />
							</Button>
						</ButtonGroup>
					</div>
				}
			>
				<DataTable
					columns={userColumns}
					data={rows}
					defaultPageSize={8}
					viewMode={mode}
					onViewModeChange={setMode}
					enableColumnResizing
					kanban={{
						groupByColumnId: 'status',
						titleColumnId: 'name',
						summaryColumnIds: ['role', 'department'],
						reorderItems: true,
						onItemMove: ({ item, targetColumnId }) => {
							setRows((prev) => prev.map((row) => (row.id === item.id ? { ...row, status: targetColumnId as User['status'] } : row)));
						},
					}}
				/>
			</AppShell>
		);
	},
};
