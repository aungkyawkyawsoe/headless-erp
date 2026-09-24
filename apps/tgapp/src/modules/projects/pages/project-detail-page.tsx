import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@mmbix/design-system/dropdown-menu';

import { ConfirmDeleteSheet } from '../components/confirm-delete-sheet';
import { TaskCard } from '../components/task-card';
import { deleteProject, fetchProject, fetchProjectTasksPage, fetchProjectTasksSearch } from '../data/api';
import { TASK_STATE_PARAM, TASK_STATE_TABS } from '../data/meta';
import { PROJECTS_STALE_MS, qk } from '../data/query-keys';
import type { TaskCardModel } from '../data/types';
import { GLASS_ICON_BUTTON, GLASS_ICON_BUTTON_IDLE } from '@/shared/components/bottom-action-bar';
import { ListPage } from '@/shared/components/list-page';
import { SegmentedTabs } from '@/shared/components/segmented-tabs';
import { useCursorList } from '@/shared/hooks/use-cursor-list';
import { hapticImpact } from '@/shared/platform/haptics';
import { popBack } from '@/shared/platform/history';
import { URL_PARAM, useViewState } from '@/shared/url-state';

/** The project screen's whole URL view state — the active state pill. */
const PROJECT_DETAIL_VIEW = {
	[URL_PARAM.status]: TASK_STATE_PARAM,
} as const;

/**
 * Projects — ONE project (`/app/projects/:id`): its task feed with the state
 * pill row (All / To Do / In Progress / Done) on top, a `+` to add a task and
 * the edit / delete controls in the bottom bar. The state pill is server-scoped
 * (`?status=`, in the query key), so each pill caches its own page set. Tapping
 * a task opens the task screen.
 */
export default function ProjectDetailPage() {
	const navigate = useNavigate();
	const { id = '' } = useParams();
	const [view, setView] = useViewState(PROJECT_DETAIL_VIEW);
	const state = view.status;
	const [deleteOpen, setDeleteOpen] = useState(false);

	// The project header (name + description) — a lean by-id read.
	const projectQuery = useQuery({
		queryKey: qk.project(id),
		queryFn: () => fetchProject(id),
		enabled: id !== '',
		staleTime: PROJECTS_STALE_MS,
	});

	// The project's task feed, narrowed by the active state pill (server-side).
	const list = useCursorList<TaskCardModel>({
		queryKey: qk.projectTasks(id, state),
		fetcher: (cursor) => fetchProjectTasksPage(id, state, cursor),
		enabled: id !== '',
		staleTime: PROJECTS_STALE_MS,
	});

	const project = projectQuery.data ?? null;
	const count = list.rows.length;

	const openTask = useCallback(
		(task: TaskCardModel) => {
			hapticImpact('light');
			navigate(`/app/projects/task/${encodeURIComponent(task.id)}`);
		},
		[navigate],
	);

	return (
		<>
			<ListPage<TaskCardModel>
				title={project?.name ?? 'Project'}
				backTo="/app/projects"
				subheader={
					<div className="flex flex-col gap-2.5">
						{project?.description && <p className="text-xs leading-myanmar text-muted-foreground">{project.description}</p>}
						<SegmentedTabs options={TASK_STATE_TABS} value={state} onChange={(next) => setView({ status: next })} ariaLabel="Task state" />
					</div>
				}
				rows={list.rows}
				isPending={list.isPending}
				isError={list.isError}
				onRetry={() => void list.refetch()}
				skeletonVariant="store-request"
				renderItem={(task) => <TaskCard key={task.id} task={task} onOpen={openTask} />}
				emptyState={{
					title: state === 'all' ? 'No tasks yet' : 'No tasks in this state',
					hint: state === 'all' ? 'Tap + to add the first task to this project.' : 'Switch to another state pill, or add a new task.',
				}}
				pagination={{
					hasNextPage: list.hasNextPage,
					isFetchingNextPage: list.isFetchingNextPage,
					onLoadMore: () => void list.fetchNextPage(),
					waitForScroll: true,
				}}
				searchPlaceholder="Search tasks"
				fetchSearch={(query) => fetchProjectTasksSearch(id, query)}
				create={{ to: `/app/projects/task/+?${URL_PARAM.project}=${encodeURIComponent(id)}`, label: 'New task' }}
				centerText={count === 1 ? '1 task' : `${count} tasks`}
				rightExtra={
					/* The project's secondary actions behind ONE ⋮ menu (the comment-card /
					 *  task-toolbar convention) instead of two glass glyphs side by side —
					 *  the bar keeps its search + create rhythm and delete stays deliberate. */
					<DropdownMenu>
						<DropdownMenuTrigger aria-label="Project actions" className={`${GLASS_ICON_BUTTON} ${GLASS_ICON_BUTTON_IDLE}`}>
							<MoreVertical className="size-5" aria-hidden />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" sideOffset={4} className="min-w-36">
							<DropdownMenuItem
								onClick={() => {
									hapticImpact('light');
									navigate(`/app/projects/${encodeURIComponent(id)}/edit`);
								}}
								className="cursor-pointer text-xs leading-myanmar"
							>
								<Pencil className="size-3.5" aria-hidden />
								Edit project
							</DropdownMenuItem>
							<DropdownMenuItem
								variant="destructive"
								onClick={() => {
									hapticImpact('light');
									setDeleteOpen(true);
								}}
								className="cursor-pointer text-xs leading-myanmar"
							>
								<Trash2 className="size-3.5" aria-hidden />
								Delete project
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				}
			/>

			<ConfirmDeleteSheet
				open={deleteOpen}
				onOpenChange={setDeleteOpen}
				title="Delete this project?"
				description={`“${project?.name ?? 'This project'}” and its tasks will be removed from the board. This can be undone by an administrator.`}
				confirmLabel="Delete project"
				onConfirm={async () => {
					await deleteProject(id);
					setDeleteOpen(false);
					popBack(navigate, '/app/projects');
				}}
			/>
		</>
	);
}
