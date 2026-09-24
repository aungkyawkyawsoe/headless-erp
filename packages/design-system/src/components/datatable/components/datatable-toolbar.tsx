'use client';

import * as React from 'react';
import { PlusIcon } from 'lucide-react';
import { Button } from '@/button';
import { SearchBox } from '@/search-box';
import type { ActiveFilter, ColumnDef, DataTableLabels } from '../core/types';
import type { RowData } from '@tanstack/react-table';
import { DataTableFilterPopover } from './datatable-filter-popover';

interface DataTableToolbarProps<TData extends RowData> {
	columns: ColumnDef<TData>[];
	globalFilter: string;
	onGlobalFilterChange: (value: string) => void;
	filters: ActiveFilter[];
	onSetFilters: (filters: ActiveFilter[]) => void;
	onClearFilters: () => void;
	toolbarActions?: React.ReactNode;
	iconOnly?: boolean;
	labels?: DataTableLabels;
	/** When provided, renders a "Create" button on the right. */
	onCreate?: () => void;
	/** Label for the create button. Defaults to `"Create"`. */
	createLabel?: string;
	/** Cursor pagination rendered at the top-right corner, level with the search bar. */
	pagination?: React.ReactNode;
	/** Icon-only [Table | Kanban] view-mode toggle rendered at the far top-right. */
	viewModeToggle?: React.ReactNode;
}

export function DataTableToolbar<TData extends RowData>({
	columns,
	globalFilter,
	onGlobalFilterChange,
	filters,
	onSetFilters,
	onClearFilters,
	toolbarActions,
	iconOnly = false,
	labels,
	onCreate,
	createLabel,
	pagination,
	viewModeToggle,
}: DataTableToolbarProps<TData>) {
	const [inputValue, setInputValue] = React.useState(globalFilter);
	const debounceRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);

	// Sync the local input with external globalFilter changes (e.g. cleared
	// from outside). Adjusting state during render avoids cascading effects.
	const [prevGlobalFilter, setPrevGlobalFilter] = React.useState(globalFilter);
	if (globalFilter !== prevGlobalFilter) {
		setPrevGlobalFilter(globalFilter);
		setInputValue(globalFilter);
	}

	const handleSearchChange = (value: string) => {
		setInputValue(value);
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			onGlobalFilterChange(value);
		}, 300);
	};

	const handleSearchClear = () => {
		// Clear fires immediately (no debounce); the SearchBox already reported
		// the empty value via onValueChange, so just cancel the pending timer.
		if (debounceRef.current) clearTimeout(debounceRef.current);
		onGlobalFilterChange('');
	};

	return (
		<div data-slot="datatable-toolbar" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			{/* ── LEFT: Global search ──────────────────── */}
			<div className="w-full sm:max-w-sm">
				<SearchBox
					value={inputValue}
					onValueChange={handleSearchChange}
					onClear={handleSearchClear}
					placeholder={labels?.searchPlaceholder ?? 'Search...'}
					className="z-20 mt-1 w-50"
					inputClassName="h-7!"
				/>
			</div>

			{/* ── RIGHT: Pagination + create + filter + custom actions ──── */}
			<div className="flex items-center gap-1.5">
				{pagination && (
					<div data-slot="datatable-pagination" className="flex items-center">
						{pagination}
					</div>
				)}
				{onCreate && (
					<Button
						variant="default"
						size={iconOnly ? 'icon-sm' : 'sm'}
						onClick={onCreate}
						className="shrink-0"
						aria-label={iconOnly ? (createLabel ?? 'Create') : undefined}
					>
						<PlusIcon className="size-3.5" />
						{!iconOnly && <span>{createLabel ?? 'Create'}</span>}
					</Button>
				)}
				{/* ── Filter popover button ──────────────── */}
				<DataTableFilterPopover columns={columns} activeFilters={filters} labels={labels} onApply={onSetFilters} onClear={onClearFilters} />
				{/* ── View-mode toggle — right slot, beside the filter button ── */}
				{viewModeToggle}
				{toolbarActions}
			</div>
		</div>
	);
}
