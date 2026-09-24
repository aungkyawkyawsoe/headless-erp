import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarDays, Download } from 'lucide-react';

import { KanbanBoard } from './kanban-board';
import { KanbanTaskCard } from './kanban-task-card';
import { KanbanProgressRing } from './kanban-progress-ring';
import { Avatar, AvatarImage, AvatarFallback } from '../avatar';
import { DataTable } from '../datatable/datatable';
import type { ColumnDef } from '../datatable/core/types';
import type { KanbanItem, KanbanColumnDef, KanbanCardRenderProps } from './core/types';
import { cn } from '@/utils';

// ─────────────────────────────────────────────────────────────
// Domain Model — Consumer-defined (fully custom)
// ─────────────────────────────────────────────────────────────

type Priority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
type StatusRisk = 'queued' | 'blocked' | 'at-risk' | 'on-track';
type Category = 'Access' | 'Auth' | 'API' | 'Forms' | 'Mobile' | 'Data' | 'UI';

interface TaskItem extends KanbanItem {
	title: string;
	code: string;
	category: Category;
	priority: Priority;
	statusRisk: StatusRisk;
	assignee: {
		name: string;
		avatarUrl?: string;
	};
	dueDate: string;
	progressPercentage?: number;
}

// ── Color maps (consumer-defined) ────────────────────────────
const priorityColors: Record<Priority, string> = {
	P0: 'text-red-600 dark:text-red-400 font-semibold',
	P1: 'text-amber-600 dark:text-amber-400 font-semibold',
	P2: 'text-muted-foreground',
	P3: 'text-muted-foreground/70',
	P4: 'text-muted-foreground/50',
};

const statusRiskConfig: Record<StatusRisk, { label: string; dotClass: string; badgeClass: string }> = {
	queued: {
		label: 'Queued',
		dotClass: 'bg-zinc-400',
		badgeClass: 'bg-muted text-muted-foreground',
	},
	blocked: {
		label: 'Blocked',
		dotClass: 'bg-destructive',
		badgeClass: 'bg-destructive/10 text-destructive',
	},
	'at-risk': {
		label: 'At risk',
		dotClass: 'bg-amber-500',
		badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
	},
	'on-track': {
		label: 'On track',
		dotClass: 'bg-emerald-500',
		badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
	},
};

const categoryColors: Record<Category, string> = {
	Access: 'border-blue-500/10 bg-blue-500/10 text-blue-600 dark:text-blue-400',
	Auth: 'border-purple-500/10 bg-purple-500/10 text-purple-600 dark:text-purple-400',
	API: 'border-amber-500/10 bg-amber-500/10 text-amber-600 dark:text-amber-400',
	Forms: 'border-emerald-500/10 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
	Mobile: 'border-pink-500/10 bg-pink-500/10 text-pink-600 dark:text-pink-400',
	Data: 'border-cyan-500/10 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
	UI: 'border-indigo-500/10 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
};

// ── Mock Data ────────────────────────────────────────────────

const mockTasks: TaskItem[] = [
	{
		id: '1',
		title: 'Fix login redirect loop on SSO callback',
		code: 'BUG-421',
		category: 'Auth',
		priority: 'P0',
		statusRisk: 'blocked',
		assignee: {
			name: 'Alice Chen',
			avatarUrl: 'https://i.pravatar.cc/80?img=47',
		},
		dueDate: 'Today',
		progressPercentage: 12,
	},
	{
		id: '2',
		title: 'Implement rate limiting for public API endpoints',
		code: 'FEAT-188',
		category: 'API',
		priority: 'P1',
		statusRisk: 'at-risk',
		assignee: { name: 'Bob Kim', avatarUrl: 'https://i.pravatar.cc/80?img=12' },
		dueDate: 'Apr 26',
		progressPercentage: 45,
	},
	{
		id: '3',
		title: 'Add role-based access to admin dashboard',
		code: 'FEAT-201',
		category: 'Access',
		priority: 'P1',
		statusRisk: 'on-track',
		assignee: {
			name: 'Carol Martinez',
			avatarUrl: 'https://i.pravatar.cc/80?img=45',
		},
		dueDate: 'Apr 28',
		progressPercentage: 80,
	},
	{
		id: '4',
		title: 'Fix form validation on mobile checkout',
		code: 'BUG-389',
		category: 'Forms',
		priority: 'P2',
		statusRisk: 'queued',
		assignee: {
			name: 'Dave Nguyen',
			avatarUrl: 'https://i.pravatar.cc/80?img=53',
		},
		dueDate: 'May 2',
	},
	{
		id: '5',
		title: 'Update mobile navigation drawer animation',
		code: 'TASK-112',
		category: 'Mobile',
		priority: 'P2',
		statusRisk: 'on-track',
		assignee: {
			name: 'Eve Johnson',
			avatarUrl: 'https://i.pravatar.cc/80?img=44',
		},
		dueDate: 'May 5',
		progressPercentage: 60,
	},
	{
		id: '6',
		title: 'Migrate legacy dashboard widgets to new data layer',
		code: 'FEAT-220',
		category: 'Data',
		priority: 'P3',
		statusRisk: 'on-track',
		assignee: {
			name: 'Frank Wu',
			avatarUrl: 'https://i.pravatar.cc/80?img=68',
		},
		dueDate: 'May 10',
		progressPercentage: 30,
	},
	{
		id: '7',
		title: 'Design system component audit and cleanup',
		code: 'TASK-099',
		category: 'UI',
		priority: 'P3',
		statusRisk: 'queued',
		assignee: {
			name: 'Grace Park',
			avatarUrl: 'https://i.pravatar.cc/80?img=32',
		},
		dueDate: 'May 15',
	},
	{
		id: '8',
		title: 'Add dark mode support to email templates',
		code: 'FEAT-234',
		category: 'UI',
		priority: 'P2',
		statusRisk: 'at-risk',
		assignee: {
			name: 'Henry Liu',
			avatarUrl: 'https://i.pravatar.cc/80?img=11',
		},
		dueDate: 'Apr 30',
		progressPercentage: 20,
	},
];

const mockColumns: KanbanColumnDef<TaskItem>[] = [
	{
		id: 'open',
		title: 'Open',
		variant: 'default',
		items: [mockTasks[3], mockTasks[6]],
	},
	{
		id: 'triage',
		title: 'Triage',
		variant: 'warning',
		className: 'border-warning/20 bg-warning/[0.045] dark:bg-warning/10',
		items: [mockTasks[4], mockTasks[7]],
	},
	{
		id: 'in-progress',
		title: 'In Progress',
		variant: 'default',
		items: [mockTasks[1], mockTasks[2], mockTasks[5]],
	},
	{
		id: 'need-info',
		title: 'Need Info',
		variant: 'danger',
		className: 'border-rose-500/20 bg-rose-500/[0.045] dark:bg-rose-500/10',
		items: [mockTasks[0]],
	},
];

// ─────────────────────────────────────────────────────────────
// Card Render — Issue Tracker style (consumer-defined)
// ─────────────────────────────────────────────────────────────

function IssueCard({ item, isDragging, isOverlay }: KanbanCardRenderProps<TaskItem>) {
	const status = statusRiskConfig[item.statusRisk];

	return (
		<KanbanTaskCard<TaskItem>
			item={item}
			isDragging={isDragging}
			isOverlay={isOverlay}
			// ── Top Left: Category badge + code ──
			renderTopLeft={(task) => (
				<>
					<span className={cn('inline-flex h-5 items-center rounded-sm border px-1.5 text-2xs font-medium', categoryColors[task.category])}>
						{task.category}
					</span>
					<span className="text-xs text-muted-foreground tabular-nums">{task.code}</span>
				</>
			)}
			// ── Top Right: Priority + Status pill ──
			renderTopRight={(task) => (
				<>
					<span className={cn('text-xs tabular-nums', priorityColors[task.priority])}>{task.priority}</span>
					<span className={cn('inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-2xs font-medium', status.badgeClass)}>
						<span className={cn('size-1.5 rounded-full', status.dotClass)} />
						{status.label}
					</span>
				</>
			)}
			// ── Content: Title ──
			renderContent={(task) => (
				<span className="line-clamp-2 cursor-pointer text-sm font-medium transition-colors group-hover/kanban-card-title:text-primary">
					{task.title}
				</span>
			)}
			// ── Bottom Left: Assignee ──
			renderBottomLeft={(task) => (
				<>
					<Avatar size="sm">
						{task.assignee.avatarUrl && <AvatarImage src={task.assignee.avatarUrl} alt={task.assignee.name} />}
						<AvatarFallback>
							{task.assignee.name
								.split(' ')
								.map((n) => n[0])
								.join('')
								.slice(0, 2)}
						</AvatarFallback>
					</Avatar>
					<span className="truncate text-xs font-medium text-muted-foreground">{task.assignee.name}</span>
				</>
			)}
			// ── Bottom Right: Due date + Progress ──
			renderBottomRight={(task) => (
				<>
					<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
						<CalendarDays className="size-3" />
						{task.dueDate}
					</span>
					{task.progressPercentage !== undefined && (
						<div className="flex items-center gap-1">
							<KanbanProgressRing percentage={task.progressPercentage} size={18} strokeWidth={2} />
							<span className="text-xs text-muted-foreground tabular-nums">{task.progressPercentage}%</span>
						</div>
					)}
				</>
			)}
		/>
	);
}

// ─────────────────────────────────────────────────────────────
// Story Meta
// ─────────────────────────────────────────────────────────────

/**
 * A fully generic, drag-and-drop Kanban board.
 *
 * The board knows **only about columns and items with an ID**.
 * Everything else — card appearance, column styling, drag previews —
 * is injected via render props. Ship your own domain model.
 */
const meta: Meta<typeof KanbanBoard> = {
	title: 'Components/Kanban',
	component: KanbanBoard,
	parameters: {
		layout: 'fullscreen',
		docs: {
			description: {
				component:
					'An enterprise-grade, fully generic Kanban board with drag-and-drop support. Zero domain coupling — every visual element is injected via render props. Supports column reordering, cross-column item moves, keyboard navigation, and complete customization through slot-based rendering.',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		reorderColumns: { control: 'boolean' },
		reorderItems: { control: 'boolean' },
		columnWidth: { control: 'text' },
		columnGap: { control: 'text' },
		title: { control: 'text' },
		subtitle: { control: 'text' },
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ─────────────────────────────────────────────────────────────
// Stories
// ─────────────────────────────────────────────────────────────

/**
 * Static board — no drag-and-drop. Useful for dashboards and
 * read-only views. Columns and cards render in their provided order.
 */
export const StaticBoard: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A static Kanban board with no drag-and-drop. Use when you need a read-only pipeline view or dashboard widget.',
			},
		},
	},
	render: () => (
		<div className="h-screen p-6">
			<KanbanBoard<TaskItem> columns={mockColumns} renderCard={(props) => <IssueCard {...props} />} columnWidth="320px" columnGap="1rem" />
		</div>
	),
};

/**
 * Drag-and-drop board. Columns can be reordered, items can be moved
 * within and across columns. A grip handle appears on hover.
 */
export const DraggableBoard: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'A fully interactive drag-and-drop Kanban board. Drag columns to reorder them. Drag cards within and across columns. While hovering over another column, the cards smoothly part (animated via dnd-kit sortable transforms) to reveal exactly where the card will land. The board manages its own state internally.',
			},
		},
	},
	render: () => (
		<div className="h-screen p-6">
			<KanbanBoard<TaskItem>
				columns={mockColumns}
				renderCard={(props) => <IssueCard {...props} />}
				reorderColumns
				reorderItems
				columnWidth="320px"
				columnGap="1rem"
				onItemMove={(event) => {
					console.log('Item moved:', event);
				}}
				onColumnMove={(event) => {
					console.log('Column moved:', event);
				}}
			/>
		</div>
	),
};

/**
 * Board with custom header actions (consumer-provided buttons).
 */
export const WithCustomHeaderActions: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Pass custom header actions via the `headerActions` prop — e.g. an export button, view switcher, or any custom toolbar. The default header renders only these actions (plus the optional Table/Kanban toggle).',
			},
		},
	},
	render: () => (
		<div className="h-screen p-6">
			<KanbanBoard<TaskItem>
				columns={mockColumns}
				renderCard={(props) => <IssueCard {...props} />}
				columnWidth="320px"
				headerActions={
					<button className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition-all hover:bg-muted">
						<Download className="size-4" />
						Export
					</button>
				}
			/>
		</div>
	),
};

// ─────────────────────────────────────────────────────────────
// Minimal custom data — different domain entirely
// ─────────────────────────────────────────────────────────────

interface DealItem extends KanbanItem {
	company: string;
	amount: string;
	stage: string;
	contactName: string;
}

const dealColumns: KanbanColumnDef<DealItem>[] = [
	{
		id: 'lead',
		title: 'Lead',
		items: [
			{
				id: 'd1',
				company: 'Acme Corp',
				amount: '$12,000',
				stage: 'lead',
				contactName: 'John Doe',
			},
			{
				id: 'd2',
				company: 'Globex',
				amount: '$45,000',
				stage: 'lead',
				contactName: 'Jane Smith',
			},
		],
	},
	{
		id: 'negotiation',
		title: 'Negotiation',
		items: [
			{
				id: 'd3',
				company: 'Initech',
				amount: '$80,000',
				stage: 'negotiation',
				contactName: 'Mike Wilson',
			},
		],
		className: 'border-warning/20 bg-warning/[0.045] dark:bg-warning/10',
	},
	{
		id: 'closed-won',
		title: 'Closed Won',
		items: [
			{
				id: 'd4',
				company: 'Umbrella Corp',
				amount: '$200,000',
				stage: 'closed-won',
				contactName: 'Sarah Connor',
			},
		],
		className: 'border-emerald-500/20 bg-emerald-500/[0.045] dark:bg-emerald-500/10',
	},
];

function DealCard({ item, isDragging }: KanbanCardRenderProps<DealItem>) {
	return (
		<KanbanTaskCard<DealItem>
			item={item}
			isDragging={isDragging}
			renderTopLeft={(deal) => <span className="text-xs font-semibold">{deal.company}</span>}
			renderTopRight={(deal) => (
				<span className="text-xs font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">{deal.amount}</span>
			)}
			renderContent={(deal) => <span className="line-clamp-2 text-xs text-muted-foreground">Contact: {deal.contactName}</span>}
		/>
	);
}

/**
 * The same KanbanBoard with a completely different domain model —
 * a sales CRM pipeline. Demonstrates zero domain coupling.
 */
export const DifferentDomainCRMPipeline: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'The KanbanBoard is fully generic. Here it renders a CRM sales pipeline with a completely different data model (deals instead of tasks). The card component is custom-built with KanbanTaskCard slots.',
			},
		},
	},
	render: () => (
		<div className="h-screen p-6">
			<KanbanBoard<DealItem> columns={dealColumns} renderCard={(props) => <DealCard {...props} />} columnWidth="300px" reorderItems />
		</div>
	),
};

// ─────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────

const emptyColumns: KanbanColumnDef<TaskItem>[] = [
	{
		id: 'backlog',
		title: 'Backlog',
		items: [],
	},
	{
		id: 'todo',
		title: 'To Do',
		items: [],
	},
	{
		id: 'done',
		title: 'Done',
		items: [
			{
				id: 'done-1',
				title: 'Completed migration',
				code: 'DONE-001',
				category: 'Data',
				priority: 'P2',
				statusRisk: 'on-track',
				assignee: { name: 'Frank Wu' },
				dueDate: 'Apr 20',
				progressPercentage: 100,
			},
		],
	},
];

/**
 * Board with empty columns. Shows the default empty state placeholder.
 */
export const WithEmptyColumns: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Empty columns display a dashed placeholder area. When dragging over an empty column during DnD, the placeholder changes to indicate it can accept items.',
			},
		},
	},
	render: () => (
		<div className="h-screen p-6">
			<KanbanBoard<TaskItem> columns={emptyColumns} renderCard={(props) => <IssueCard {...props} />} columnWidth="320px" reorderItems />
		</div>
	),
};

// ─────────────────────────────────────────────────────────────
// Nested boards — parent board whose cards contain child boards
// ─────────────────────────────────────────────────────────────

interface NestedGroupItem extends KanbanItem {
	title: string;
	childColumns: KanbanColumnDef<TaskItem>[];
}

const nestedGroupColumns: KanbanColumnDef<NestedGroupItem>[] = [
	{
		id: 'sprint-1',
		title: 'Sprint 1',
		items: [
			{
				id: 'g1',
				title: 'Frontend squad',
				childColumns: [
					{
						id: 'todo',
						title: 'To Do',
						items: [mockTasks[1], mockTasks[3]],
					},
					{
						id: 'done',
						title: 'Done',
						items: [mockTasks[6]],
					},
				],
			},
			{
				id: 'g2',
				title: 'Backend squad',
				childColumns: [
					{
						id: 'todo',
						title: 'To Do',
						items: [mockTasks[4]],
					},
					{
						id: 'in-progress',
						title: 'In Progress',
						items: [mockTasks[2]],
					},
				],
			},
		],
	},
	{
		id: 'sprint-2',
		title: 'Sprint 2',
		items: [
			{
				id: 'g3',
				title: 'Platform squad',
				childColumns: [
					{
						id: 'todo',
						title: 'To Do',
						items: [mockTasks[7]],
					},
					{
						id: 'done',
						title: 'Done',
						items: [mockTasks[5]],
					},
				],
			},
		],
	},
];

/**
 * Renders a parent group card: a title row with a drag grip handle,
 * followed by a fully interactive nested child board.
 */
function NestedGroupCard({ item, isDragging, isOverlay }: KanbanCardRenderProps<NestedGroupItem>) {
	return (
		<div
			className={cn(
				'flex flex-col gap-2 rounded-sm border border-border bg-card p-3',
				'transition-all duration-150 select-none',
				!isDragging && !isOverlay && 'hover:border-foreground/20 hover:shadow-sm',
				isOverlay && 'rotate-2 opacity-95 shadow-xl',
			)}
		>
			{/* Group header */}
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-semibold">{item.title}</span>
				<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
					{item.childColumns.length} columns
				</span>
			</div>

			{/* Nested child board — a read-only view inside the draggable
          parent card. Rendered as plain columns WITHOUT ScrollArea:
          nested ScrollAreas virtualize content (content-visibility),
          which makes dnd-kit's rect measuring oscillate and crash. */}
			<div className="flex items-start gap-2">
				{item.childColumns.map((child) => (
					<div key={child.id} className="flex w-45 shrink-0 flex-col gap-1.5 rounded-sm border border-border bg-muted/25 p-2">
						<span className="truncate px-1 text-2xs font-semibold">{child.title}</span>
						<div className="flex flex-col gap-1.5">
							{child.items.map((task) => (
								<IssueCard key={task.id} item={task} columnId={child.id} index={0} totalInColumn={child.items.length} isDragging={false} />
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

/**
 * Parent board with nested child boards. Cards drag via their grip handle
 * (`cardDragActivation="handle"`), so the child boards inside remain fully
 * interactive — drag their cards, reorder within, and move across columns.
 * The nested content never collapses while dragging a parent group.
 */
export const NestedBoards: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Nested kanban boards: each parent card contains a child board rendered as read-only columns. The whole parent card is draggable (`reorderItems`), and the nested content stays fully visible while dragging — no collapse. IMPORTANT: do not mount a nested KanbanBoard with DnD props inside a draggable parent card — dnd-kit does not support nested DndContexts (the sensors fight, breaking the drag and triggering a measuring loop). Render child content statically instead.',
			},
		},
	},
	render: () => (
		<div className="h-screen p-6">
			<KanbanBoard<NestedGroupItem>
				columns={nestedGroupColumns}
				renderCard={(props) => <NestedGroupCard {...props} />}
				reorderColumns
				reorderItems
				columnWidth="320px"
				onItemMove={(event) => {
					console.log('Group moved:', event);
				}}
			/>
		</div>
	),
};

// ─────────────────────────────────────────────────────────────
// Table view adapter — renders the same items as a DataTable
// ─────────────────────────────────────────────────────────────

const taskTableColumns: ColumnDef<TaskItem>[] = [
	{
		id: 'code',
		accessorKey: 'code',
		header: 'Code',
		width: '90px',
	},
	{
		id: 'title',
		accessorKey: 'title',
		header: 'Title',
		width: '280px',
	},
	{
		id: 'category',
		accessorKey: 'category',
		header: 'Category',
		cell: ({ value }) => (
			<span className={cn('inline-flex h-5 items-center rounded-sm border px-1.5 text-2xs font-medium', categoryColors[value as Category])}>
				{String(value)}
			</span>
		),
	},
	{
		id: 'priority',
		accessorKey: 'priority',
		header: 'Priority',
		width: '90px',
	},
	{
		id: 'statusRisk',
		accessorKey: 'statusRisk',
		header: 'Status',
		cell: ({ value }) => {
			const status = statusRiskConfig[value as StatusRisk];
			return (
				<span className={cn('inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-2xs font-medium', status.badgeClass)}>
					<span className={cn('size-1.5 rounded-full', status.dotClass)} />
					{status.label}
				</span>
			);
		},
	},
	{
		id: 'assignee',
		accessorKey: 'assignee',
		header: 'Assignee',
		cell: ({ row }) => row.original.assignee.name,
	},
	{
		id: 'dueDate',
		accessorKey: 'dueDate',
		header: 'Due',
		width: '90px',
	},
];

/**
 * Board with the Table/Kanban view toggle in the header. Pass
 * `renderTableView` (here: a DataTable built from the same items) and the
 * header shows an icon-only toggle to switch between the kanban columns
 * and a flat table of every item.
 */
export const WithTableView: Story = {
	name: 'Table ↔ Kanban View',
	parameters: {
		docs: {
			description: {
				story:
					'The same items presented as a kanban board or a flat table. The icon-only [Table | Kanban] toggle appears in the board header when `renderTableView` is provided. The table view is fully consumer-defined — here it reuses a DataTable with column defs for the task shape.',
			},
		},
	},
	render: () => (
		<div className="h-screen p-6">
			<KanbanBoard<TaskItem>
				columns={mockColumns}
				renderCard={(props) => <IssueCard {...props} />}
				reorderColumns
				reorderItems
				columnWidth="320px"
				renderTableView={({ items }) => (
					<DataTable<TaskItem> columns={taskTableColumns} data={items} defaultPageSize={20} showViewModeToggle={false} />
				)}
			/>
		</div>
	),
};
