import type { ReactNode } from 'react';
import { SearchX } from 'lucide-react';

interface SearchResultsListProps<T> {
	/** The live (unsettled) query — shown in the empty state. */
	query: string;
	/** True while a request is in flight or still waiting out its debounce. */
	searching: boolean;
	/** Server-side rows for the settled query. */
	results: T[];
	/** True when the last settled query failed — shown as an error, never as "no results". */
	error?: boolean;
	/** Clear the query and close the search (the empty-state action). */
	onClear: () => void;
	/** The page's list card for one row — results match the list by design. */
	renderItem: (item: T) => ReactNode;
	/** Mirror a DENSE list: the results render in the same flat bordered frame
	 *  as `ListPage density="compact"` instead of gapped floating cards. */
	compact?: boolean;
	/**
	 * One line stating what the search actually covers, when it is NOT the whole
	 * collection — e.g. a per-truck file page whose toolbar search only narrows
	 * the rows already loaded. Without it a local narrow looks identical to the
	 * server-side search every other list runs, so a real match on a later page
	 * reads as a false "No results".
	 */
	scopeNote?: string;
}

/**
 * The bar search's result list — server-side rows (`?search=` on the page's
 * main collection) rendered with the page's OWN list card, so a search result
 * is indistinguishable from the list it replaces. Cards render their own `<li>`,
 * so this only owns the `<ul>` shell plus the loading / empty states.
 */
export function SearchResultsList<T>({
	query,
	searching,
	results,
	error = false,
	onClear,
	renderItem,
	compact = false,
	scopeNote,
}: SearchResultsListProps<T>) {
	if (searching && results.length === 0) {
		return (
			<ul className="flex flex-col gap-3" aria-label="Searching">
				{Array.from({ length: 3 }, (_, i) => (
					<li key={i} className="rounded-2xl border border-border bg-card p-3.5 shadow-card">
						<div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
						<div className="mt-2 h-3 w-full animate-pulse rounded bg-muted/70" />
					</li>
				))}
			</ul>
		);
	}

	// A failed search must never masquerade as "no results" — say so explicitly.
	if (error && results.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
				<SearchX className="size-6 text-muted-foreground" aria-hidden />
				<p className="text-sm font-medium leading-myanmar text-foreground">Search failed. Check your connection and try again.</p>
				<button
					type="button"
					onClick={onClear}
					className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
				>
					Clear Search
				</button>
			</div>
		);
	}

	if (results.length === 0) {
		return (
			<div
				role="status"
				aria-live="polite"
				className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center"
			>
				<SearchX className="size-6 text-muted-foreground" aria-hidden />
				<p className="text-sm font-medium leading-myanmar text-foreground">No results match «{query}»</p>
				<button
					type="button"
					onClick={onClear}
					className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
				>
					Clear Search
				</button>
			</div>
		);
	}

	return (
		<>
			{/* The result count — and the ONLY thing a screen reader hears when the
			    list swaps in (the rows themselves are not a live region, so announcing
			    them all would be noise). This was previously silent. */}
			<p role="status" aria-live="polite" className="mb-2 px-1 text-meta font-semibold uppercase tracking-wide text-muted-foreground">
				{results.length} {results.length === 1 ? 'result' : 'results'} for «{query}»
			</p>
			{scopeNote ? <p className="-mt-1 mb-2 px-1 text-meta leading-myanmar text-muted-foreground">{scopeNote}</p> : null}
			<ul
				className={`${compact ? 'list-window-compact' : 'list-window'} flex cursor-pointer flex-col ${
					compact ? 'divide-y divide-border overflow-hidden rounded-xl border border-border bg-card' : 'gap-3'
				}`}
			>
				{results.map((item) => renderItem(item))}
			</ul>
		</>
	);
}
