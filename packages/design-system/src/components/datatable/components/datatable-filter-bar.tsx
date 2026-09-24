'use client';

import { XIcon } from 'lucide-react';
import { Badge } from '@/badge';
import { Button } from '@/button';
import type { ActiveFilter, ColumnDef, DataTableLabels } from '../core/types';
import type { RowData } from '@tanstack/react-table';

interface DataTableFilterBarProps<TData extends RowData> {
	filters: ActiveFilter[];
	columns: ColumnDef<TData>[];
	onRemoveFilter: (id: string) => void;
	onClearFilters: () => void;
	labels?: DataTableLabels;
}

export function DataTableFilterBar<TData extends RowData>({
	filters,
	columns,
	onRemoveFilter,
	onClearFilters,
	labels,
}: DataTableFilterBarProps<TData>) {
	const columnMap = new Map(columns.map((c) => [c.id, c]));

	const formatValue = (filter: ActiveFilter): string => {
		if (filter.value == null || filter.value === '') return '(empty)';
		if (Array.isArray(filter.value)) return filter.value.join(', ');
		if (filter.valueTo != null && filter.valueTo !== '') {
			return `${String(filter.value)} – ${String(filter.valueTo)}`;
		}
		return String(filter.value);
	};

	return (
		<div data-slot="datatable-filter-bar" className="flex flex-wrap items-center gap-2">
			{filters.map((filter) => {
				const column = columnMap.get(filter.id);
				const label = column?.filter?.label ?? column?.header ?? filter.id;
				return (
					<Badge key={filter.id} variant="secondary" className="flex items-center gap-1 py-1 pr-0.75 pl-2 text-xs font-normal">
						<span className="font-medium">{typeof label === 'string' ? label : filter.id}</span>
						<span className="text-muted-foreground">{formatValue(filter)}</span>
						<button
							onClick={() => onRemoveFilter(filter.id)}
							className="rounded-full p-0.5 hover:bg-muted-foreground/20"
							aria-label={`Remove ${typeof label === 'string' ? label : filter.id} filter`}
						>
							<XIcon className="size-3" />
						</button>
					</Badge>
				);
			})}
			{filters.length > 1 && (
				<Button variant="ghost" size="sm" onClick={onClearFilters} className="h-6 text-xs text-muted-foreground">
					{labels?.clearFilters ?? 'Clear all'}
				</Button>
			)}
		</div>
	);
}
