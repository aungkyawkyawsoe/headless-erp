'use client';

import * as React from 'react';
import { Table2Icon, SquareKanbanIcon } from 'lucide-react';
import { cn } from '@/utils';
import { ButtonGroup } from '@/button-group';
import { Button } from '@/button';
import type { ViewMode } from './types';

/**
 * Table ⇄ Kanban view-mode toggle.
 *
 * Shared by the DataTable (datatable.tsx) and KanbanBoard (kanban-board.tsx)
 * so the two components render one identical control — single source of truth.
 */
export interface ViewModeToggleProps {
	/** Active view mode. */
	viewMode: ViewMode;
	/** Called when the user switches mode. */
	onViewModeChange: (mode: ViewMode) => void;
	/** Extra classes for the ButtonGroup. */
	className?: string;
}

export function ViewModeToggle({ viewMode, onViewModeChange, className }: ViewModeToggleProps) {
	return (
		<ButtonGroup aria-label="View mode" className={cn('shrink-0', className)}>
			<Button
				variant="outline"
				size="icon-sm"
				data-slot="view-mode-toggle-table"
				aria-label="Table view"
				aria-pressed={viewMode === 'table'}
				className="data-active:bg-muted data-active:text-foreground"
				data-active={viewMode === 'table' ? '' : undefined}
				onClick={() => onViewModeChange('table')}
			>
				<Table2Icon />
			</Button>
			<Button
				variant="outline"
				size="icon-sm"
				data-slot="view-mode-toggle-kanban"
				aria-label="Kanban view"
				aria-pressed={viewMode === 'kanban'}
				className="data-active:bg-muted data-active:text-foreground"
				data-active={viewMode === 'kanban' ? '' : undefined}
				onClick={() => onViewModeChange('kanban')}
			>
				<SquareKanbanIcon />
			</Button>
		</ButtonGroup>
	);
}
