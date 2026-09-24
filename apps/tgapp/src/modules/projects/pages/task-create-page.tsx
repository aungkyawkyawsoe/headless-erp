import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { TaskForm } from '../components/task-form';
import { createTask, fetchProject } from '../data/api';
import { PROJECTS_STALE_MS, qk } from '../data/query-keys';
import { ModuleShell } from '@/shared/components/module-shell';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';
import { URL_PARAM, stringOrEmptyParam, useViewState } from '@/shared/url-state';

/** The create screen's whole URL view state — the bound project id. */
const TASK_CREATE_VIEW = {
	[URL_PARAM.project]: stringOrEmptyParam,
} as const;

/**
 * New task (`/app/projects/task/+?project=<id>`) — the create form reached from
 * a project's `+`, bound to that project via the URL. Writes one `hrm_tasks` row.
 */
export default function TaskCreatePage() {
	const navigate = useNavigate();
	const [view] = useViewState(TASK_CREATE_VIEW);
	const projectId = view.project;

	const projectQuery = useQuery({
		queryKey: qk.project(projectId),
		queryFn: () => fetchProject(projectId),
		enabled: projectId !== '',
		staleTime: PROJECTS_STALE_MS,
	});

	if (projectId === '') {
		return (
			<ModuleShell title="New task" backTo="/app/projects">
				<p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm leading-myanmar text-muted-foreground">
					Open this screen from a project’s + button to add a task.
				</p>
			</ModuleShell>
		);
	}

	return (
		<TaskForm
			title="New task"
			backTo={`/app/projects/${projectId}`}
			projectName={projectQuery.data?.name ?? null}
			submitLabel="Create task"
			onSave={async (values) => {
				await createTask({ ...values, project: projectId });
				notifySaved('Task created');
				popBack(navigate, `/app/projects/${projectId}`);
			}}
		/>
	);
}
