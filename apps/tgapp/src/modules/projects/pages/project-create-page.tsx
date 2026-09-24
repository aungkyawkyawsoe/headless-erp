import { useNavigate } from 'react-router-dom';

import { ProjectForm } from '../components/project-form';
import { createProject } from '../data/api';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';

/**
 * New project (`/app/projects/+`) — the create form behind the register's `+`.
 * Writes one `hrm_projects` row (the engine assigns its `PRJ-####` number).
 */
export default function ProjectCreatePage() {
	const navigate = useNavigate();

	return (
		<ProjectForm
			title="New project"
			backTo="/app/projects"
			submitLabel="Create project"
			onSave={async (values) => {
				await createProject(values);
				notifySaved('Project created');
				popBack(navigate, '/app/projects');
			}}
		/>
	);
}
