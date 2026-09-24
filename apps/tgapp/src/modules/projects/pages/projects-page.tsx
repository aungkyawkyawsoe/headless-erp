import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';

import { ProjectCard } from '../components/project-card';
import { fetchProjectsPage, fetchProjectsSearch } from '../data/api';
import { PROJECTS_STALE_MS, qk } from '../data/query-keys';
import type { ProjectCardModel } from '../data/types';
import { GLASS_ICON_BUTTON, GLASS_ICON_BUTTON_IDLE } from '@/shared/components/bottom-action-bar';
import { ListPage } from '@/shared/components/list-page';
import { useCursorList } from '@/shared/hooks/use-cursor-list';
import { hapticImpact } from '@/shared/platform/haptics';

/**
 * Projects — the register (`/app/projects`): every `hrm_projects` row as a card,
 * with the shared toolbar search, a `+` to create one and a workload-dashboard
 * shortcut in the bottom bar. Tapping a card opens the project's task feed.
 */
export default function ProjectsPage() {
	const navigate = useNavigate();
	const list = useCursorList<ProjectCardModel>({
		queryKey: qk.projects(),
		fetcher: (cursor) => fetchProjectsPage(cursor),
		staleTime: PROJECTS_STALE_MS,
	});

	const openProject = useCallback(
		(id: string) => {
			hapticImpact('light');
			navigate(`/app/projects/${encodeURIComponent(id)}`);
		},
		[navigate],
	);

	return (
		<ListPage<ProjectCardModel>
			title="Projects"
			rows={list.rows}
			isPending={list.isPending}
			isError={list.isError}
			onRetry={() => void list.refetch()}
			skeletonVariant="category"
			renderItem={(project) => <ProjectCard key={project.id} project={project} onOpen={openProject} />}
			emptyState={{ title: 'No projects yet', hint: 'Projects you create appear here.' }}
			pagination={{
				hasNextPage: list.hasNextPage,
				isFetchingNextPage: list.isFetchingNextPage,
				onLoadMore: () => void list.fetchNextPage(),
				waitForScroll: true,
			}}
			searchPlaceholder="Search projects"
			fetchSearch={fetchProjectsSearch}
			create={{ to: '/app/projects/+', label: 'New project' }}
			density="compact"
			centerText="Projects"
			rightExtra={
				<button
					type="button"
					aria-label="Workload"
					onClick={() => {
						hapticImpact('light');
						navigate('/app/projects/workload');
					}}
					className={`${GLASS_ICON_BUTTON} ${GLASS_ICON_BUTTON_IDLE}`}
				>
					<BarChart3 className="size-5" aria-hidden />
				</button>
			}
		/>
	);
}
