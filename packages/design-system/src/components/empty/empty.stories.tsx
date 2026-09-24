import type { Meta, StoryObj } from '@storybook/react-vite';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia } from './';
import { Button } from '../button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../input-group';
import { FolderKanbanIcon, InboxIcon, BellIcon, RefreshCcwIcon, SearchIcon, PlusIcon, ArrowUpRightIcon } from 'lucide-react';

/**
 * Use the Empty component to display an empty state.
 */
const meta: Meta<typeof Empty> = {
	title: 'Components/Empty',
	component: Empty,
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				component:
					'A composable empty-state component. Combine `<Empty>` with `<EmptyHeader>`, `<EmptyMedia>`, `<EmptyTitle>`, `<EmptyDescription>`, and `<EmptyContent>` to build contextual empty, error, and onboarding screens.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Default ────────────────────────────────────────────

export const Default: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A basic empty state with icon, title, description, and multiple action buttons.',
			},
		},
	},
	render: () => (
		<Empty>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<FolderKanbanIcon />
				</EmptyMedia>
				<EmptyTitle>No Projects Yet</EmptyTitle>
				<EmptyDescription>You haven&apos;t created any projects yet. Get started by creating your first project.</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<div className="flex items-center gap-2">
					<Button size="sm">Create Project</Button>
					<Button variant="outline" size="sm">
						Import Project
					</Button>
					<Button variant="ghost" size="sm">
						Learn More
						<ArrowUpRightIcon />
					</Button>
				</div>
			</EmptyContent>
		</Empty>
	),
};

// ── Outline ────────────────────────────────────────────

export const Outline: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use the `border` utility class to create an outline empty state.',
			},
		},
	},
	render: () => (
		<Empty className="border-2 border-dashed">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<InboxIcon />
				</EmptyMedia>
				<EmptyTitle>Cloud Storage Empty</EmptyTitle>
				<EmptyDescription>Upload files to your cloud storage to access them anywhere.</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button size="sm">Upload Files</Button>
			</EmptyContent>
		</Empty>
	),
};

// ── Background ─────────────────────────────────────────

export const Background: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `bg-*` and `bg-gradient-*` utilities to add a background to the empty state.',
			},
		},
	},
	render: () => (
		<Empty className="rounded-xl bg-linear-to-b from-muted/50 to-background">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<BellIcon />
				</EmptyMedia>
				<EmptyTitle>No Notifications</EmptyTitle>
				<EmptyDescription>You&apos;re all caught up. New notifications will appear here.</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button variant="outline" size="sm">
					<RefreshCcwIcon />
					Refresh
				</Button>
			</EmptyContent>
		</Empty>
	),
};

// ── Avatar ─────────────────────────────────────────────

export const Avatar: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `EmptyMedia` to display an avatar in the empty state.',
			},
		},
	},
	render: () => (
		<Empty>
			<EmptyHeader>
				<EmptyMedia>
					<div className="flex size-12 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground ring-2 ring-border">
						LR
					</div>
				</EmptyMedia>
				<EmptyTitle>User Offline</EmptyTitle>
				<EmptyDescription>This user is currently offline. You can leave a message to notify them or try again later.</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button size="sm">Leave Message</Button>
			</EmptyContent>
		</Empty>
	),
};

// ── Avatar Group ───────────────────────────────────────

export const AvatarGroup: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `EmptyMedia` to display an avatar group in the empty state.',
			},
		},
	},
	render: () => (
		<Empty>
			<EmptyHeader>
				<EmptyMedia>
					<div className="flex -space-x-2">
						<div className="flex size-10 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground ring-2 ring-background">
							CN
						</div>
						<div className="flex size-10 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground ring-2 ring-background">
							LR
						</div>
						<div className="flex size-10 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground ring-2 ring-background">
							ER
						</div>
					</div>
				</EmptyMedia>
				<EmptyTitle>No Team Members</EmptyTitle>
				<EmptyDescription>Invite your team to collaborate on this project.</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button size="sm">
					<PlusIcon />
					Invite Members
				</Button>
			</EmptyContent>
		</Empty>
	),
};

// ── InputGroup (404 page) ──────────────────────────────

export const InputGroupDemo: Story = {
	name: 'InputGroup',
	parameters: {
		docs: {
			description: {
				story: 'Add an `InputGroup` inside `EmptyContent` — useful for 404 pages or search prompts.',
			},
		},
	},
	render: () => (
		<Empty>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<SearchIcon />
				</EmptyMedia>
				<EmptyTitle>404 - Not Found</EmptyTitle>
				<EmptyDescription>The page you&apos;re looking for doesn&apos;t exist. Try searching for what you need below.</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<InputGroup className="w-full max-w-sm">
					<InputGroupAddon align="inline-start">
						<SearchIcon className="size-4 shrink-0 opacity-50" />
					</InputGroupAddon>
					<InputGroupInput placeholder="Search..." />
				</InputGroup>
				<p className="text-xs text-muted-foreground">
					Need help?{' '}
					<a href="#" className="underline underline-offset-4 hover:text-primary">
						Contact support
					</a>
				</p>
			</EmptyContent>
		</Empty>
	),
};

// ── All Variants Gallery ──────────────────────────────

export const AllVariants: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'A gallery showing all empty state variants side by side.',
			},
		},
	},
	render: () => (
		<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<FolderKanbanIcon />
					</EmptyMedia>
					<EmptyTitle>No projects</EmptyTitle>
					<EmptyDescription>Create your first project.</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button size="sm">Create Project</Button>
				</EmptyContent>
			</Empty>

			<Empty className="border-2 border-dashed">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<InboxIcon />
					</EmptyMedia>
					<EmptyTitle>Storage empty</EmptyTitle>
					<EmptyDescription>Upload files to get started.</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button size="sm">Upload Files</Button>
				</EmptyContent>
			</Empty>

			<Empty className="rounded-xl bg-linear-to-b from-muted/50 to-background">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<BellIcon />
					</EmptyMedia>
					<EmptyTitle>No notifications</EmptyTitle>
					<EmptyDescription>You&apos;re all caught up.</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button variant="outline" size="sm">
						<RefreshCcwIcon />
						Refresh
					</Button>
				</EmptyContent>
			</Empty>

			<Empty>
				<EmptyHeader>
					<EmptyMedia>
						<div className="flex -space-x-2">
							<div className="flex size-10 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground ring-2 ring-background">
								CN
							</div>
							<div className="flex size-10 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground ring-2 ring-background">
								LR
							</div>
						</div>
					</EmptyMedia>
					<EmptyTitle>No team members</EmptyTitle>
					<EmptyDescription>Invite your team.</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button size="sm">
						<PlusIcon />
						Invite
					</Button>
				</EmptyContent>
			</Empty>
		</div>
	),
};
