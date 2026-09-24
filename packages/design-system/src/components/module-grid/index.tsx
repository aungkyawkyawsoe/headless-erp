'use client';

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { SearchBox } from '../search-box';

export interface Module {
	name: string;
	icon: LucideIcon;
	/**
	 * Optional custom color for the module icon (any CSS color value).
	 * Falls back to the theme default when omitted.
	 */
	iconColor?: string;
	/**
	 * Optional custom background color for the module's icon box
	 * (any CSS color value). Falls back to the theme default when omitted.
	 */
	iconBackground?: string;
}

export interface ModuleGridItemProps {
	module: Module;
	isActive: boolean;
	onSelect: (module: Module) => void;
	onClose: () => void;
}

export function ModuleGridItem({ module, isActive, onSelect, onClose }: ModuleGridItemProps) {
	const [hovered, setHovered] = React.useState(false);

	return (
		<button
			onClick={() => {
				onSelect(module);
				onClose();
			}}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			className="flex flex-col items-center gap-2 rounded-xl p-3 transition-all duration-200 focus:outline-none focus-visible:outline-none active:outline-none"
		>
			<div
				className={`flex size-17.5 items-center justify-center rounded-sm transition-shadow duration-200 ${hovered ? 'shadow-sm' : ''} ${
					isActive ? 'bg-accent text-accent-foreground' : 'bg-muted text-foreground dark:bg-linear-to-br dark:from-card dark:to-muted'
				}`}
				style={module.iconBackground ? { backgroundColor: module.iconBackground } : undefined}
			>
				<module.icon
					className="size-10 text-foreground"
					strokeWidth={1.8}
					style={module.iconColor ? { color: module.iconColor } : undefined}
				/>
			</div>
			<div className="w-full text-center">
				<span className="line-clamp-2 text-xs leading-5.5 font-medium text-foreground select-none">{module.name}</span>
			</div>
		</button>
	);
}

export interface ModuleGridProps {
	modules: Module[];
	/** Name of the currently active module, used to highlight its tile. */
	activeModuleName?: string;
	/** Number of grid columns. Defaults to `6`. */
	columns?: number;
	/** Message shown when no modules match the search. Defaults to `"No apps found"`. */
	emptyMessage?: string;
	/**
	 * Whether to show the built-in search box above the grid. Defaults to
	 * `true`. Pass `false` when the parent provides its own search — the
	 * `ModuleSwitcher` does this.
	 */
	showSearch?: boolean;
	/** Placeholder text for the search box. Defaults to `"Search apps..."`. */
	searchPlaceholder?: string;
	/**
	 * Controlled search query. When provided, the search box is controlled and
	 * `onSearchChange` fires on every keystroke; otherwise the grid manages its
	 * own query.
	 */
	searchValue?: string;
	/** Called with the new query on every keystroke (controlled mode). */
	onSearchChange?: (value: string) => void;
	onSelect: (module: Module) => void;
	onClose: () => void;
}

export function ModuleGrid({
	modules,
	activeModuleName,
	columns = 6,
	emptyMessage = 'No apps found',
	showSearch = true,
	searchPlaceholder = 'Search apps...',
	searchValue: searchValueProp,
	onSearchChange,
	onSelect,
	onClose,
}: ModuleGridProps) {
	const [internalSearch, setInternalSearch] = React.useState('');
	const isSearchControlled = searchValueProp !== undefined;
	const search = isSearchControlled ? searchValueProp : internalSearch;

	const handleSearchChange = (value: string) => {
		if (!isSearchControlled) setInternalSearch(value);
		onSearchChange?.(value);
	};

	// Filter modules by the search query
	const filtered = React.useMemo(() => modules.filter((m) => m.name.toLowerCase().includes(search.toLowerCase())), [modules, search]);

	return (
		<div className="flex w-full flex-1 items-start justify-center overflow-y-auto p-8 pt-12">
			<div className="mx-auto w-full max-w-3xl">
				{showSearch && (
					<div className="mx-auto w-full max-w-md px-5 pb-2">
						<SearchBox aria-label="Search modules" placeholder={searchPlaceholder} value={search} onValueChange={handleSearchChange} />
					</div>
				)}
				<div
					className="grid gap-3 p-5 transition-all duration-300"
					style={{
						gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
					}}
				>
					{filtered.map((module) => (
						<ModuleGridItem
							key={module.name}
							module={module}
							isActive={module.name === activeModuleName}
							onSelect={onSelect}
							onClose={onClose}
						/>
					))}
					{filtered.length === 0 && (
						<div className="py-16 text-center text-sm text-muted-foreground" style={{ gridColumn: `span ${columns} / span ${columns}` }}>
							{emptyMessage}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

export interface ModuleGridPaginationProps {
	totalPages: number;
	currentPage: number;
	onPageChange: (page: number) => void;
}

export function ModuleGridPagination({ totalPages, currentPage, onPageChange }: ModuleGridPaginationProps) {
	if (totalPages <= 1) return null;

	return (
		<div className="z-20 flex gap-2 pb-4">
			{Array.from({ length: totalPages }).map((_, i) => (
				<button
					key={i}
					onClick={() => onPageChange(i)}
					className={`size-2.5 rounded-full transition-all duration-300 ${
						i === currentPage ? 'scale-110 bg-foreground' : 'bg-foreground/30 hover:bg-foreground/50'
					}`}
					aria-label={`Go to page ${i + 1}`}
				/>
			))}
		</div>
	);
}
