import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { TaskForm } from '../components/task-form';
import { fetchTask, updateTask } from '../data/api';
import { PROJECTS_STALE_MS, qk } from '../data/query-keys';
import type { TaskState } from '../data/types';
import { EmptyState } from '@/shared/components/empty-state';
import { ModuleShell } from '@/shared/components/module-shell';
import { ListSkeleton } from '@/shared/components/skeletons';
import type { PersonnelOption } from '@/shared/components/personnel-picker-sheet';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';

/**
 * Edit task (`/app/projects/task/:id/edit`) — the same form as the create
 * screen, prefilled from `hrm_tasks` (assignees resolved to picker options) and
 * saving through `updateTask`. The owning project is fixed, never editable.
 */
export default function TaskEditPage() {
	const navigate = useNavigate();
	const { id = '' } = useParams();

	const taskQuery = useQuery({
		queryKey: qk.task(id),
		queryFn: () => fetchTask(id),
		enabled: id !== '',
		staleTime: PROJECTS_STALE_MS,
	});

	const task = taskQuery.data ?? null;
	const fallbackBack = task?.projectId ? `/app/projects/${task.projectId}` : '/app/projects';

	if (taskQuery.isPending) {
		return (
			<ModuleShell title="Edit task" backTo={fallbackBack}>
				<ListSkeleton variant="store-request" count={1} />
			</ModuleShell>
		);
	}

	if (!task) {
		return (
			<ModuleShell title="Edit task" backTo="/app/projects">
				<EmptyState title="Task not found" hint="It may have been removed — go back and pick another." />
			</ModuleShell>
		);
	}

	const initialAssignees: PersonnelOption[] = task.assignees.map((person) => ({
		id: person.id,
		name: person.name ?? '—',
		photo: person.photo,
	}));

	return (
		<TaskForm
			title="Edit task"
			backTo={fallbackBack}
			projectName={task.projectName}
			initial={{
				name: task.name,
				priority: task.priority,
				state: (task.state ?? 'todo') as TaskState,
				assignees: initialAssignees,
				dueDate: task.dueDate ?? '',
			}}
			submitLabel="Save changes"
			onSave={async (values) => {
				await updateTask(task.id, values);
				notifySaved('Task updated');
				popBack(navigate, fallbackBack);
			}}
		/>
	);
}
