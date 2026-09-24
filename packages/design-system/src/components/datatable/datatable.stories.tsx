import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { DataTable } from './datatable';
import type { ColumnDef } from './core/types';
import { Badge } from '../badge';
import { Button } from '../button';
import { MoreHorizontalIcon, DownloadIcon, RefreshCwIcon, ChevronsDownUpIcon, ChevronsUpDownIcon } from 'lucide-react';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '../dropdown-menu';

/**
 * Enterprise-grade DataTable with advanced filtering, sorting, search, and
 * pagination. Designed for business and ERP applications.
 *
 * Supports both **client-side** (pass `data`) and **server-side** (pass
 * `fetchData`) modes.
 */
const meta: Meta<typeof DataTable> = {
	title: 'Components/DataTable',
	component: DataTable,
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				component: `
An enterprise-grade datatable component for business and ERP applications.

## Core Features (Phase 1)
- **Global search** across all columns (debounced)
- **Column sorting** — click headers to toggle asc/desc/none
- **Advanced filtering** — text, select, and multi-select filters out of the box
- **Pagination** — page navigation, size selector, summary row
- **Row selection** — checkboxes with select-all
- **Column pinning** — pin columns left/right from the header menu; pinned columns stay fixed while scrolling horizontally and get a vertical boundary border
- **Density presets** — compact, comfortable, spacious
- **Loading / empty / error states**
- **Server-side mode** — pass fetchData for async data fetching
- **Toolbar actions slot** — inject CSV export, refresh, column visibility, etc.

## Architecture (SOLID)
- **S**ingle Responsibility — each hook handles one concern
- **O**pen/Closed — extend via custom cell renderers, filterFn, toolbarActions
- **L**iskov — filter components share a common FilterDef interface
- **I**nterface Segregation — focused types: ColumnDef, FilterDef, SortState, etc.
- **D**ependency Inversion — pipeline depends on abstractions, not concrete data sources
        `.trim(),
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Sample data ───────────────────────────────────────────

interface User {
	id: string;
	name: string;
	email: string;
	role: 'Admin' | 'Editor' | 'Viewer';
	status: 'Active' | 'Inactive' | 'Suspended';
	department: string;
	joinedAt: string;
	lastActive: string;
	employeeId: string;
	phone: string;
	location: string;
	team: string;
	manager: string;
	office: string;
	salary: string;
	timezone: string;
}

const departments = ['Engineering', 'Product', 'Design', 'Marketing', 'Sales', 'HR', 'Finance'];

const names = [
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
];

const locations = ['New York', 'London', 'Singapore', 'Tokyo', 'Berlin', 'Sydney', 'Toronto', 'Paris'];

const teams = ['Platform', 'Growth', 'Core', 'Mobile', 'Data', 'Security', 'Infra', 'QA'];

const offices = ['NYC HQ', 'LDN', 'SIN', 'TYO', 'BER', 'SYD', 'TOR', 'PAR'];

const timezones = ['UTC-5', 'UTC+0', 'UTC+8', 'UTC+9', 'UTC+1', 'UTC+10', 'UTC-4', 'UTC+2'];

const users: User[] = Array.from({ length: 87 }, (_, i) => ({
	id: `USR-${String(i + 1).padStart(4, '0')}`,
	name: names[i % 12],
	email: `user${i + 1}@company.com`,
	role: (['Admin', 'Editor', 'Viewer'] as const)[i % 3],
	status: (['Active', 'Active', 'Active', 'Inactive', 'Suspended'] as const)[i % 5],
	department: departments[i % departments.length],
	joinedAt: `202${(i % 5) + 1}-${String((i % 12) + 1).padStart(2, '0')}-15`,
	lastActive: `2026-07-${String(30 - (i % 30)).padStart(2, '0')}`,
	employeeId: `EMP-${String(1000 + i)}`,
	phone: `+1 (555) ${String(100 + i).padStart(3, '0')}-${String(1000 + i).slice(-4)}`,
	location: locations[i % locations.length],
	team: teams[i % teams.length],
	manager: names[(i + 5) % 12],
	office: offices[i % offices.length],
	salary: `$${85 + (i % 20) * 3}k`,
	timezone: timezones[i % timezones.length],
}));

// ── Column definitions ────────────────────────────────────

const columns: ColumnDef<User>[] = [
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
			const variant: 'default' | 'secondary' | 'outline' = value === 'Admin' ? 'default' : value === 'Editor' ? 'secondary' : 'outline';
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
			options: departments.map((d) => ({ label: d, value: d })),
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

// ── Wide column set (for horizontal-scroll / pinning stories) ────────────

const wideColumns: ColumnDef<User>[] = [
	{
		id: 'id',
		accessorKey: 'id',
		header: 'ID',
		sortable: true,
		width: '110px',
	},
	...columns.slice(0, 7),
	{
		id: 'employeeId',
		accessorKey: 'employeeId',
		header: 'Employee ID',
		sortable: true,
		width: '140px',
	},
	{
		id: 'phone',
		accessorKey: 'phone',
		header: 'Phone',
		sortable: true,
		width: '150px',
	},
	{
		id: 'location',
		accessorKey: 'location',
		header: 'Location',
		sortable: true,
		width: '130px',
	},
	{
		id: 'team',
		accessorKey: 'team',
		header: 'Team',
		sortable: true,
		width: '130px',
	},
	{
		id: 'manager',
		accessorKey: 'manager',
		header: 'Manager',
		sortable: true,
		width: '160px',
	},
	{
		id: 'office',
		accessorKey: 'office',
		header: 'Office',
		sortable: true,
		width: '130px',
	},
	{
		id: 'salary',
		accessorKey: 'salary',
		header: 'Salary',
		sortable: true,
		width: '120px',
	},
	{
		id: 'timezone',
		accessorKey: 'timezone',
		header: 'Timezone',
		sortable: true,
		width: '120px',
	},
	columns[columns.length - 1], // actions
];

// ── Stories ───────────────────────────────────────────────

export const Default: Story = {
	render: () => <DataTable columns={columns} data={users} defaultPageSize={10} />,
};

export const Compact: Story = {
	name: 'Compact Density',
	render: () => <DataTable columns={columns} data={users} density="compact" defaultPageSize={15} />,
};

export const Spacious: Story = {
	name: 'Spacious Density',
	render: () => <DataTable columns={columns} data={users} density="spacious" defaultPageSize={5} />,
};

export const RowSelection: Story = {
	render: () => {
		const [selected, setSelected] = React.useState<User[]>([]);
		return (
			<div className="space-y-4">
				<DataTable columns={columns} data={users} enableRowSelection onSelectionChange={setSelected} defaultPageSize={5} />
				{selected.length > 0 && (
					<div className="rounded-lg border bg-muted/30 p-3 text-sm">
						<span className="font-medium">{selected.length} row(s) selected:</span> {selected.map((u) => u.name).join(', ')}
					</div>
				)}
			</div>
		);
	},
};

export const LoadingStateStory: Story = {
	name: 'Loading State',
	render: () => <DataTable columns={columns} data={[]} isLoading />,
};

export const EmptyStateStory: Story = {
	name: 'Empty State',
	render: () => (
		<DataTable
			columns={columns}
			data={[]}
			labels={{
				empty: 'No users found. Try adjusting your search or filters.',
			}}
		/>
	),
};

export const ErrorStateStory: Story = {
	name: 'Error State',
	render: () => <DataTable columns={columns} data={[]} error="Failed to load users: Network error (500)" />,
};

export const ServerSide: Story = {
	name: 'Server-side Mode',
	render: () => (
		<DataTable
			columns={columns}
			fetchData={async (params) => {
				await new Promise((r) => setTimeout(r, 600));
				let result = [...users];
				for (const f of params.filters) {
					result = result.filter((row) => {
						const val = String(row[f.id as keyof User] ?? '');
						return val.toLowerCase().includes(String(f.value).toLowerCase());
					});
				}
				if (params.globalFilter) {
					const q = params.globalFilter.toLowerCase();
					result = result.filter((row) => Object.values(row).some((v) => String(v).toLowerCase().includes(q)));
				}
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
			defaultPageSize={10}
		/>
	),
};

export const Internationalization: Story = {
	name: 'Custom Labels (i18n)',
	render: () => (
		<DataTable
			columns={columns}
			data={users.slice(0, 15)}
			labels={{
				searchPlaceholder: 'Buscar en todas las columnas...',
				filters: 'Filtros',
				clearFilters: 'Limpiar filtros',
				empty: 'No se encontraron resultados.',
				loading: 'Cargando...',
			}}
			defaultPageSize={5}
		/>
	),
};

export const Minimal: Story = {
	name: 'Minimal (No Toolbar)',
	render: () => (
		<DataTable
			columns={columns.filter((c) => c.id !== 'actions')}
			data={users.slice(0, 5)}
			showToolbar={false}
			showFilterBar={false}
			defaultPageSize={5}
		/>
	),
};

export const ClickableRows: Story = {
	render: () => (
		<DataTable
			columns={columns}
			data={users.slice(0, 10)}
			onRowClick={(row) => alert(`Clicked: ${row.name} (${row.email})`)}
			defaultPageSize={5}
		/>
	),
};

// ── Toolbar Actions Stories ──────────────────────────────

/**
 * Custom toolbar actions for CSV export and data refresh.
 * Inject any React nodes into the right side of the toolbar via
 * the `toolbarActions` prop.
 *
 * **Note:** Column visibility toggle is now built-in and appears
 * automatically when columns have `enableHiding` enabled.
 *
 * Use the render-prop form `toolbarActions={(table) => ...}` to
 * access the TanStack table instance for export logic.
 */
export const ToolbarActions: Story = {
	name: 'Toolbar Actions (CSV / Refresh)',
	render: () => {
		const handleExportCSV = (data: User[]) => {
			const headers = ['ID', 'Name', 'Email', 'Role', 'Status', 'Department'];
			const rows = data.map((u) => [u.id, u.name, u.email, u.role, u.status, u.department].join(','));
			const csv = [headers.join(','), ...rows].join('\n');
			const blob = new Blob([csv], { type: 'text/csv' });
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = 'users.csv';
			link.click();
			URL.revokeObjectURL(url);
		};

		return (
			<DataTable
				columns={columns}
				data={users}
				defaultPageSize={10}
				toolbarActions={(table) => (
					<>
						<Button
							variant="outline"
							size="sm"
							onClick={() => handleExportCSV(table.table.getFilteredRowModel().rows.map((r) => r.original))}
						>
							<DownloadIcon />
							CSV
						</Button>
						<Button variant="ghost" size="icon-sm" onClick={() => alert('Refreshing...')}>
							<RefreshCwIcon />
						</Button>
					</>
				)}
			/>
		);
	},
};

/**
 * Full ERP-style dashboard table combining every feature:
 * row selection, custom toolbar actions, filters, sorting,
 * and bulk operations bar.
 */
export const ERPDashboard: Story = {
	name: 'ERP Dashboard (Full Example)',
	render: () => {
		const [selected, setSelected] = React.useState<User[]>([]);
		const [deleting, setDeleting] = React.useState(false);

		const handleBulkDelete = async () => {
			if (selected.length === 0) return;
			setDeleting(true);
			await new Promise((r) => setTimeout(r, 800));
			alert(`Deleted ${selected.length} user(s)`);
			setSelected([]);
			setDeleting(false);
		};

		const handleExportSelected = () => {
			if (selected.length === 0) return;
			const headers = ['ID', 'Name', 'Email', 'Role', 'Status', 'Department'];
			const rows = selected.map((u) => [u.id, u.name, u.email, u.role, u.status, u.department].join(','));
			const csv = [headers.join(','), ...rows].join('\n');
			const blob = new Blob([csv], { type: 'text/csv' });
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = 'selected-users.csv';
			link.click();
			URL.revokeObjectURL(url);
		};

		return (
			<div className="space-y-4">
				{selected.length > 0 && (
					<div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5">
						<span className="text-sm font-medium">{selected.length} row(s) selected</span>
						<Button size="sm" variant="outline" onClick={handleExportSelected}>
							<DownloadIcon />
							Export Selected
						</Button>
						<Button size="sm" variant="destructive" onClick={handleBulkDelete} disabled={deleting}>
							{deleting ? 'Deleting...' : 'Delete Selected'}
						</Button>
					</div>
				)}
				<DataTable
					columns={columns}
					data={users}
					enableRowSelection
					onSelectionChange={setSelected}
					defaultPageSize={10}
					toolbarActions={
						<>
							<Button variant="outline" size="sm" onClick={() => alert('Exporting all filtered data as Excel...')}>
								<DownloadIcon />
								Export All
							</Button>
							<Button variant="ghost" size="icon-sm" onClick={() => alert('Refreshing...')}>
								<RefreshCwIcon />
							</Button>
						</>
					}
				/>
			</div>
		);
	},
};

/**
 * Column visibility — a **Columns** dropdown is automatically rendered
 * in the toolbar when columns have `enableHiding` enabled (default: true).
 *
 * Set `enableHiding: false` on a column to prevent it from being hidden.
 * Set `defaultVisible: false` to hide it by default.
 */
export const ColumnVisibility: Story = {
	render: () => {
		const colsWithHiding: ColumnDef<User>[] = columns.map((col) => ({
			...col,
			enableHiding: col.id !== 'actions',
			defaultVisible: col.id !== 'lastActive',
		}));

		return <DataTable columns={colsWithHiding} data={users} defaultPageSize={10} labels={{ columns: 'Columns' }} />;
	},
};

/**
 * Cursor-based pagination — the DataTable always navigates with a range
 * summary (`0–10`, `10–20`, …) and Prev/Next arrows. For APIs that don't
 * expose total counts (GraphQL connections, DynamoDB, etc.) simply return
 * `nextCursor`/`prevCursor` from `fetchData`.
 *
 * - No page numbers, no total count, no rows-per-page selector
 * - Filters/sort/search reset the cursor to the beginning
 */
export const CursorPagination: Story = {
	name: 'Cursor-based Pagination',
	render: () => {
		// Build fake cursor-based "pages"
		const pageSize = 10;
		const allPages = React.useMemo(() => {
			const pages: User[][] = [];
			for (let i = 0; i < users.length; i += pageSize) {
				pages.push(users.slice(i, i + pageSize));
			}
			return pages;
		}, []);

		return (
			<DataTable
				columns={columns}
				defaultPageSize={pageSize}
				fetchData={async (params) => {
					await new Promise((r) => setTimeout(r, 400));

					const cursor = params.cursor as string | null | undefined;
					let pageIdx: number;

					if (!cursor) {
						pageIdx = 0; // first page
					} else {
						pageIdx = Number(cursor);
					}

					const rows = allPages[pageIdx] || [];
					const totalPages = allPages.length;

					return {
						rows,
						nextCursor: pageIdx < totalPages - 1 ? String(pageIdx + 1) : null,
						prevCursor: pageIdx > 0 ? String(pageIdx - 1) : null,
					};
				}}
			/>
		);
	},
};

/**
 * Icon-only toolbar — Filters and Columns buttons show only icons,
 * no text labels. Useful for narrow containers or compact UIs.
 *
 * Enable via the `toolbarIconOnly` prop.
 */
export const IconOnlyToolbar: Story = {
	name: 'Toolbar Icon-Only',
	render: () => <DataTable columns={columns} data={users} toolbarIconOnly defaultPageSize={10} />,
};

/**
 * Zebra striping — alternating row background colors for better
 * readability in dense datasets.
 */
export const ZebraStriped: Story = {
	render: () => <DataTable columns={columns} data={users} striped defaultPageSize={10} />,
};

/**
 * Grid border style — full borders on every cell (all sides).
 * Ideal for data-heavy spreadsheets and financial tables.
 */
export const BorderAll: Story = {
	name: 'Grid Borders (All)',
	render: () => <DataTable columns={columns} data={users.slice(0, 10)} borderStyle="all" defaultPageSize={10} />,
};

/**
 * Column border style — vertical borders between columns only.
 */
export const BorderColumn: Story = {
	name: 'Column Borders',
	render: () => <DataTable columns={columns} data={users.slice(0, 10)} borderStyle="column" defaultPageSize={10} />,
};

/**
 * No internal borders — clean, borderless rows.
 */
export const BorderNone: Story = {
	name: 'No Borders',
	render: () => <DataTable columns={columns} data={users.slice(0, 10)} borderStyle="none" defaultPageSize={10} />,
};

/**
 * Sticky header — the header row stays fixed at the top when
 * scrolling vertically within a constrained-height container.
 */
export const StickyHeader: Story = {
	render: () => <DataTable columns={columns} data={users} stickyHeader striped defaultPageSize={25} showFilterBar={false} />,
};

/**
 * Resizable columns — drag the handle on a column's right edge to change its
 * width. Double-click a handle to reset the column to its default width.
 * Works with `enableColumnResizing` as an opt-in, just like `stickyHeader`.
 */
export const ResizableColumns: Story = {
	render: () => <DataTable columns={columns} data={users.slice(0, 10)} defaultPageSize={10} enableColumnResizing />,
};

/**
 * Resizable columns combined with pinned columns and the all-border grid,
 * using the wide column set so horizontal scroll is available.
 */
export const ResizableColumnsPinned: Story = {
	name: 'Resizable + Pinned Columns',
	render: () => (
		<DataTable
			columns={wideColumns}
			data={users}
			defaultPageSize={10}
			enableColumnResizing
			borderStyle="all"
			defaultColumnPinning={{ start: ['id'], end: ['actions'] }}
			showFilterBar={false}
		/>
	),
};

/**
 * Column header context menu — shows on each column header on hover.
 * Provides: Asc/Desc sort, Pin Left/Right, Move Left/Right, Hide, Columns.
 * Uses a wide column set so pinned columns can be tested with horizontal scroll.
 */
export const ColumnContextMenu: Story = {
	name: 'Column Header Menu',
	render: () => (
		<DataTable
			columns={wideColumns.map((col) => ({
				...col,
				enablePinning: col.id !== 'actions',
			}))}
			data={users}
			defaultPageSize={10}
		/>
	),
};

/**
 * Pinned columns — pin any column left/right from its header menu.
 * The table is wider than its container, so scrolling horizontally keeps the
 * pinned columns fixed; the boundary column shows a vertical separator border.
 * `ID` is pre-pinned left and `Actions` pre-pinned right via `defaultColumnPinning`.
 */
export const PinnedColumns: Story = {
	render: () => (
		<DataTable
			columns={wideColumns}
			data={users}
			defaultPageSize={10}
			defaultColumnPinning={{ start: ['id'], end: ['actions'] }}
			showFilterBar={false}
		/>
	),
};

/**
 * All border + zebra + sticky header combined — enterprise spreadsheet feel.
 * Uses the wide column set so pinned columns can also be tested.
 */
export const EnterpriseGrid: Story = {
	name: 'Enterprise Grid (All Features)',
	render: () => (
		<DataTable
			columns={wideColumns.map((col) => ({
				...col,
				enablePinning: col.id !== 'actions',
			}))}
			data={users}
			borderStyle="all"
			striped
			stickyHeader
			defaultPageSize={25}
			showFilterBar={false}
			toolbarIconOnly
		/>
	),
};

/**
 * Built-in "Create" button — when `onCreate` is provided, a primary
 * "+ Create" button appears at the top right of the toolbar.
 * Combine with `toolbarActions` for additional buttons.
 *
 * Customize the label via `labels.create` for i18n.
 */
export const CreateButton: Story = {
	render: () => (
		<DataTable
			columns={columns}
			data={users}
			defaultPageSize={10}
			onCreate={() => alert('Opening create form...')}
			toolbarActions={
				<>
					<Button variant="outline" size="sm" onClick={() => alert('Exporting...')}>
						<DownloadIcon />
						Export
					</Button>
				</>
			}
		/>
	),
};

/**
 * Create button with custom i18n label — use `labels.create` to
 * localize the button text.
 */
export const CreateButtonI18n: Story = {
	name: 'Create Button (i18n)',
	render: () => (
		<DataTable
			columns={columns}
			data={users.slice(0, 10)}
			defaultPageSize={10}
			onCreate={() => alert('Creating new user...')}
			labels={{
				create: 'Add User',
			}}
		/>
	),
};

/**
 * Master–detail layout — clicking the chevron reveals a full-width detail row.
 * `renderSubComponent` receives the row's original data and its index.
 */
export const ExpandableRows: Story = {
	name: 'Expandable Rows (Master–Detail)',
	render: () => (
		<DataTable
			columns={columns}
			data={users}
			defaultPageSize={8}
			renderSubComponent={({ row }) => (
				<div className="grid grid-cols-1 gap-x-8 gap-y-3 p-2 sm:grid-cols-2 lg:grid-cols-4">
					<div>
						<p className="text-xs font-medium text-muted-foreground uppercase">Email</p>
						<p className="mt-0.5 text-sm">{row.email}</p>
					</div>
					<div>
						<p className="text-xs font-medium text-muted-foreground uppercase">Department</p>
						<p className="mt-0.5 text-sm">{row.department}</p>
					</div>
					<div>
						<p className="text-xs font-medium text-muted-foreground uppercase">Joined</p>
						<p className="mt-0.5 text-sm">{row.joinedAt}</p>
					</div>
					<div>
						<p className="text-xs font-medium text-muted-foreground uppercase">Last active</p>
						<p className="mt-0.5 text-sm">{row.lastActive}</p>
					</div>
				</div>
			)}
		/>
	),
};

/**
 * Expandable rows combined with row selection — the checkbox column anchors
 * the left edge and the chevron sits next to it.
 */
export const ExpandableRowsWithSelection: Story = {
	name: 'Expandable Rows + Selection',
	render: () => (
		<DataTable
			columns={columns}
			data={users}
			defaultPageSize={8}
			enableRowSelection
			onSelectionChange={(rows) => console.log('Selected:', rows)}
			renderSubComponent={({ row }) => (
				<div className="p-2 text-sm text-muted-foreground">
					{row.name} — {row.email} · {row.department}
				</div>
			)}
		/>
	),
};

/**
 * Default-expanded rows plus programmatic expand/collapse-all via the
 * `DataTableInstance` helpers exposed to `toolbarActions`.
 */
export const ExpandableRowsDefaultExpanded: Story = {
	name: 'Expandable Rows (Default Expanded + Controls)',
	render: () => (
		<DataTable
			columns={columns}
			data={users.slice(0, 10)}
			defaultPageSize={10}
			defaultExpandedRowIds={['USR-0001', 'USR-0002']}
			renderSubComponent={({ row }) => (
				<div className="p-2 text-sm text-muted-foreground">
					{row.name} — {row.email}
				</div>
			)}
			toolbarActions={({ expandAll, collapseAll }) => (
				<>
					<Button variant="outline" size="sm" onClick={expandAll}>
						<ChevronsDownUpIcon />
						Expand all
					</Button>
					<Button variant="outline" size="sm" onClick={collapseAll}>
						<ChevronsUpDownIcon />
						Collapse all
					</Button>
				</>
			)}
		/>
	),
};

// ── Nested (tree) rows ─────────────────────────────────────

interface OrgNode {
	id: string;
	name: string;
	role: string;
	status: 'Active' | 'Inactive';
	children?: OrgNode[];
}

const orgTree: OrgNode[] = [
	{
		id: 'dept-engineering',
		name: 'Engineering',
		role: 'Department',
		status: 'Active',
		children: [
			{
				id: 'lead-alice',
				name: 'Alice Johnson',
				role: 'Engineering Lead',
				status: 'Active',
				children: [
					{
						id: 'dev-bob',
						name: 'Bob Smith',
						role: 'Engineer',
						status: 'Active',
					},
					{
						id: 'dev-carol',
						name: 'Carol Williams',
						role: 'Engineer',
						status: 'Inactive',
					},
				],
			},
			{
				id: 'dev-david',
				name: 'David Brown',
				role: 'Engineer',
				status: 'Active',
			},
		],
	},
	{
		id: 'dept-product',
		name: 'Product',
		role: 'Department',
		status: 'Active',
		children: [
			{
				id: 'pm-eva',
				name: 'Eva Martinez',
				role: 'Product Manager',
				status: 'Active',
			},
			{
				id: 'des-frank',
				name: 'Frank Garcia',
				role: 'Designer',
				status: 'Active',
				children: [
					{
						id: 'des-grace',
						name: 'Grace Lee',
						role: 'Designer',
						status: 'Active',
					},
				],
			},
		],
	},
	{ id: 'dept-sales', name: 'Sales', role: 'Department', status: 'Inactive' },
];

const orgColumns: ColumnDef<OrgNode>[] = [
	{
		id: 'name',
		accessorKey: 'name',
		header: 'Name',
		sortable: true,
		width: '240px',
	},
	{
		id: 'role',
		accessorKey: 'role',
		header: 'Role',
		sortable: true,
	},
	{
		id: 'status',
		accessorKey: 'status',
		header: 'Status',
		sortable: true,
		cell: ({ value }) => (
			<span
				className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
					value === 'Active'
						? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
						: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
				}`}
			>
				{String(value)}
			</span>
		),
	},
];

/**
 * Nested (tree) rows — `getSubRows` returns child rows that render indented
 * below their parent. Child ids use the composite form `parentId.index`.
 */
export const NestedRows: Story = {
	name: 'Nested Rows (Tree)',
	render: () => (
		<DataTable
			columns={orgColumns}
			data={orgTree}
			defaultPageSize={20}
			getSubRows={(row) => row.children ?? []}
			defaultExpandedRowIds={['dept-engineering', 'dept-engineering.lead-alice']}
		/>
	),
};

/**
 * Table ↔ Kanban view. The icon-only [Table | Kanban] toggle lives at the
 * toolbar's top-right. In Kanban mode, rows are grouped by the `status`
 * column; card content reuses the table's `cell` renderers. Dragging a card
 * to another column updates the underlying row's status via `onItemMove`,
 * so the two views stay in sync.
 */
export const TableKanbanView: Story = {
	name: 'Table ↔ Kanban View',
	render: () => {
		const [rows, setRows] = React.useState<User[]>(users);
		return (
			<DataTable
				columns={columns}
				data={rows}
				defaultPageSize={10}
				kanban={{
					groupByColumnId: 'status',
					titleColumnId: 'name',
					summaryColumnIds: ['role', 'department', 'location'],
					reorderItems: true,
					onItemMove: ({ item, targetColumnId }) => {
						// Kanban column ids are the status values — write the move back
						// into the row so the table view reflects the new grouping.
						setRows((prev) => prev.map((row) => (row.id === item.id ? { ...row, status: targetColumnId as User['status'] } : row)));
					},
				}}
			/>
		);
	},
};

// ── Row grouping & footer stories ─────────────────────────

interface Sale {
	id: string;
	region: 'North' | 'South' | 'East' | 'West';
	product: string;
	amount: number;
	qty: number;
}

const sales: Sale[] = [
	{ id: 'S1', region: 'North', product: 'Widget', amount: 120, qty: 12 },
	{ id: 'S2', region: 'North', product: 'Gadget', amount: 80, qty: 8 },
	{ id: 'S3', region: 'North', product: 'Widget', amount: 200, qty: 20 },
	{ id: 'S4', region: 'South', product: 'Gadget', amount: 60, qty: 6 },
	{ id: 'S5', region: 'South', product: 'Widget', amount: 150, qty: 15 },
	{ id: 'S6', region: 'East', product: 'Gadget', amount: 90, qty: 9 },
	{ id: 'S7', region: 'West', product: 'Widget', amount: 300, qty: 30 },
];

const saleColumns: ColumnDef<Sale>[] = [
	{
		id: 'id',
		accessorKey: 'id',
		header: 'ID',
		width: '90px',
		enableGrouping: false,
	},
	{ id: 'region', accessorKey: 'region', header: 'Region', width: '140px' },
	{ id: 'product', accessorKey: 'product', header: 'Product', width: '140px' },
	{ id: 'amount', accessorKey: 'amount', header: 'Amount', align: 'right', width: '120px' },
	{ id: 'qty', accessorKey: 'qty', header: 'Qty', align: 'right', width: '100px' },
];

/**
 * Native row grouping — `enableGrouping` + `defaultGrouping` collapse rows into
 * group rows on the grouping column. The chevron toggles each group; group
 * rows show the group value + child count, other columns stay blank unless
 * they opt into aggregation (`aggregationFn`).
 */
export const GroupedRows: Story = {
	name: 'Grouped Rows (Native)',
	render: () => (
		<DataTable columns={saleColumns} data={sales} enableGrouping defaultGrouping={['region']} defaultExpandAll defaultPageSize={20} />
	),
};

/**
 * Grouping + aggregation — columns with `aggregationFn` show a subtotal on
 * their group rows (here: `sum` on Amount and Qty per region).
 */
export const GroupedWithAggregates: Story = {
	name: 'Grouped Rows with Aggregates',
	render: () => (
		<DataTable
			columns={saleColumns.map((c) => (c.id === 'amount' || c.id === 'qty' ? { ...c, aggregationFn: 'sum' } : c))}
			data={sales}
			enableGrouping
			defaultGrouping={['region']}
			defaultExpandAll
			defaultPageSize={20}
		/>
	),
};

/** Multi-level grouping — group by Region, then Product. */
export const MultiLevelGrouping: Story = {
	name: 'Multi-Level Grouping',
	render: () => (
		<DataTable
			columns={saleColumns}
			data={sales}
			enableGrouping
			defaultGrouping={['region', 'product']}
			defaultExpandAll
			defaultPageSize={20}
		/>
	),
};

/** Grouping combined with column pinning — group rows honor pinned offsets. */
export const GroupedAndPinned: Story = {
	name: 'Grouped + Pinned',
	render: () => (
		<DataTable
			columns={saleColumns}
			data={sales}
			enableGrouping
			defaultGrouping={['region']}
			defaultColumnPinning={{ start: ['id'], end: [] }}
			defaultPageSize={20}
		/>
	),
};

/**
 * Footer row — `showFooter` renders a `<tfoot>` from each column's `footer`.
 * The render prop receives `{ table, column }` so totals can be computed from
 * the (filtered) row model — this is the presentational DS pattern: the app
 * decides what the footer should show.
 */
export const SummaryFooter: Story = {
	name: 'Footer / Summary Row',
	render: () => (
		<DataTable
			columns={saleColumns.map((c): ColumnDef<Sale> =>
				c.id === 'id'
					? { ...c, footer: ({ table }) => `${table.getFilteredRowModel().rows.length} records` }
					: c.id === 'amount' || c.id === 'qty'
						? {
								...c,
								footer: ({ table, column }) =>
									table.getFilteredRowModel().rows.reduce((sum, row) => sum + (Number(row.getValue(column.id)) || 0), 0),
							}
						: c,
			)}
			data={sales}
			showFooter
			defaultPageSize={20}
		/>
	),
};

/** Grouping + aggregation + footer — group subtotals and a grand total. */
export const GroupedWithFooter: Story = {
	name: 'Grouped + Aggregates + Footer',
	render: () => (
		<DataTable
			columns={saleColumns.map((c): ColumnDef<Sale> =>
				c.id === 'id'
					? { ...c, footer: () => 'Total' }
					: c.id === 'amount' || c.id === 'qty'
						? {
								...c,
								aggregationFn: 'sum',
								footer: ({ table, column }) =>
									table.getFilteredRowModel().rows.reduce((sum, row) => sum + (Number(row.getValue(column.id)) || 0), 0),
							}
						: c,
			)}
			data={sales}
			enableGrouping
			defaultGrouping={['region']}
			defaultExpandAll
			showFooter
			defaultPageSize={20}
		/>
	),
};

/**
 * Column layout persistence — visibility / order / pinning are saved to
 * localStorage under `persistStateKey` and restored on the next visit.
 * Toggle a column off in the header menu, reload the story, and it stays hidden.
 */
export const PersistedLayout: Story = {
	name: 'Persisted Column Layout',
	render: () => <DataTable columns={columns} data={users} defaultPageSize={10} persistStateKey="storybook:datatable-persisted" />,
};
