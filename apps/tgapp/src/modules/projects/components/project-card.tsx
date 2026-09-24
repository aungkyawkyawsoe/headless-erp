import { memo } from 'react';
import { FolderKanban } from 'lucide-react';

import { ErpRow } from '@/shared/components/erp-row';
import type { ProjectCardModel } from '../data/types';

/**
 * ONE project row on the register, in the shared dense ERP shape: the folder
 * glyph, the project name as the L1 anchor, its `PRJ-####` number as the L2
 * identity line and the description as a single clamped L3 line — instead of a
 * ~90px floating card. Rendered inside the shared `ListPage`'s `<ul>`, so the
 * `key` is owned by the caller.
 */
export const ProjectCard = memo(function ProjectCard({
	project,
	onOpen,
}: {
	project: ProjectCardModel;
	/** Receives the row's id — a STABLE handler (the page passes one `useCallback`) so
	 *  `memo` actually skips the other rows when this list re-renders. */
	onOpen: (id: string) => void;
}) {
	return (
		<ErpRow
			anchor={project.name}
			secondary={project.number}
			tertiary={project.description}
			onOpen={() => onOpen(project.id)}
			leading={
				<span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<FolderKanban className="size-4" aria-hidden />
				</span>
			}
		/>
	);
});
