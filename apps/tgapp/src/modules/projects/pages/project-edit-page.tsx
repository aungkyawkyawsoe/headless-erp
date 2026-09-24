import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { ProjectForm } from '../components/project-form';
import { fetchProject, updateProject } from '../data/api';
import { PROJECTS_STALE_MS, qk } from '../data/query-keys';
import { EmptyState } from '@/shared/components/empty-state';
import { ModuleShell } from '@/shared/components/module-shell';
import { ListSkeleton } from '@/shared/components/skeletons';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';

/**
 * Edit project (`/app/projects/:id/edit`) — the same form as the create screen,
 * prefilled from `hrm_projects` and saving through `updateProject`.
 */
export default function ProjectEditPage() {
	const navigate = useNavigate();
	const { id = '' } = useParams();

	const projectQuery = useQuery({
		queryKey: qk.project(id),
		queryFn: () => fetchProject(id),
		enabled: id !== '',
		staleTime: PROJECTS_STALE_MS,
	});

	const project = projectQuery.data ?? null;

	if (projectQuery.isPending) {
		return (
			<ModuleShell title="Edit project" backTo={id ? `/app/projects/${id}` : '/app/projects'}>
				<ListSkeleton variant="store-request" count={1} />
			</ModuleShell>
		);
	}

	if (!project) {
		return (
			<ModuleShell title="Edit project" backTo="/app/projects">
				<EmptyState title="Project not found" hint="It may have been removed — go back and pick another." />
			</ModuleShell>
		);
	}

	return (
		<ProjectForm
			title="Edit project"
			backTo={`/app/projects/${project.id}`}
			initial={{ name: project.name, description: project.description }}
			submitLabel="Save changes"
			onSave={async (values) => {
				await updateProject(project.id, values);
				notifySaved('Project updated');
				popBack(navigate, `/app/projects/${project.id}`);
			}}
		/>
	);
}
