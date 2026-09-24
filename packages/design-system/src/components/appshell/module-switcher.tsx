'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';

import { ModuleGrid, ModuleGridPagination, type Module } from '../module-grid';

export type { Module } from '../module-grid';
export {
	ModuleGrid,
	ModuleGridItem,
	ModuleGridPagination,
	type ModuleGridItemProps,
	type ModuleGridProps,
	type ModuleGridPaginationProps,
} from '../module-grid';

export interface ModuleSwitcherProps {
	modules?: Module[];
	activeModule: Module;
	onSelect: (module: Module) => void;
	open: boolean;
	onClose: () => void;
	/** Placeholder text for the search input. Defaults to `"Search apps..."`. */
	searchPlaceholder?: string;
	/** Message shown when no modules match the search. Defaults to `"No apps found"`. */
	emptyMessage?: string;
	/** Keyboard shortcut hint displayed in the search bar. Defaults to `"⌘K"`. Pass `null` to hide. */
	shortcutHint?: string | null;
	/** Number of grid columns. Defaults to `6`. */
	columns?: number;
	/** Number of modules per page. Defaults to `18` (6x3 grid). */
	itemsPerPage?: number;
}

export function ModuleSwitcher({
	modules = [],
	activeModule,
	onSelect,
	open,
	onClose,
	searchPlaceholder = 'Search apps...',
	emptyMessage = 'No apps found',
	shortcutHint = '⌘K',
	columns = 6,
	itemsPerPage = 18,
}: ModuleSwitcherProps) {
	const [search, setSearch] = React.useState('');
	const [page, setPage] = React.useState(0);
	const inputRef = React.useRef<HTMLInputElement>(null);

	// Reset the search and page whenever the switcher opens, no matter how it
	// was closed (close button, Escape, or the global shortcut). Adjusting state
	// during render is the recommended way to reset state when a prop changes:
	// https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
	const [prevOpen, setPrevOpen] = React.useState(open);
	if (prevOpen !== open) {
		setPrevOpen(open);
		if (open) {
			setSearch('');
			setPage(0);
		}
	}

	// Filter modules by search
	const filtered = React.useMemo(() => modules.filter((m) => m.name.toLowerCase().includes(search.toLowerCase())), [modules, search]);

	const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
	// Clamp the current page so it stays valid if the module list shrinks.
	const safePage = Math.min(page, totalPages - 1);
	const currentModules = filtered.slice(safePage * itemsPerPage, (safePage + 1) * itemsPerPage);

	// Focus input when opened
	React.useEffect(() => {
		if (open) {
			setTimeout(() => inputRef.current?.focus(), 80);
		}
	}, [open]);

	// Close on Escape
	React.useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [open, onClose]);

	if (!open) return null;

	return createPortal(
		<div className="fixed inset-0 z-9999 flex animate-in flex-col items-center bg-background/95 backdrop-blur-md duration-200 fade-in">
			{/* Search bar */}
			<div className="z-20 w-full max-w-md px-4 pt-16">
				<div className="flex h-8 w-full items-center rounded-sm border border-border bg-muted px-3 text-sm transition-all duration-200 focus-within:border-ring/50">
					<Search className="mr-2 size-4 shrink-0 text-muted-foreground/60" />
					<input
						ref={inputRef}
						placeholder={searchPlaceholder}
						autoComplete="off"
						value={search}
						onChange={(e) => {
							setSearch(e.target.value);
							setPage(0);
						}}
						className="h-full w-full border-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
					/>
					{shortcutHint != null && (
						<kbd className="ml-2 inline-flex shrink-0 items-center gap-0.5 rounded border border-border/20 bg-background/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/50">
							<span className="text-2xs">{shortcutHint}</span>
						</kbd>
					)}
					<button
						onClick={onClose}
						className="ml-1 flex size-5 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground"
					>
						<X className="size-3.5" />
					</button>
				</div>
			</div>

			{/* Module grid — the switcher renders its own search bar above, so
          disable the grid's built-in search box to avoid a duplicate. */}
			<ModuleGrid
				modules={currentModules}
				activeModuleName={activeModule?.name}
				columns={columns}
				emptyMessage={emptyMessage}
				showSearch={false}
				onSelect={onSelect}
				onClose={onClose}
			/>

			{/* Pagination dots */}
			<ModuleGridPagination totalPages={totalPages} currentPage={safePage} onPageChange={setPage} />
		</div>,
		document.body,
	);
}
