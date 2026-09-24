import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LoaderCircle, Search, SearchX, X } from 'lucide-react';

import { EmptyState } from '@/shared/components/empty-state';
import { KioskBrowseLink } from '@/shared/components/kiosk-browse-link';
import { ModuleShell } from '@/shared/components/module-shell';
import { ListSkeleton } from '@/shared/components/skeletons';
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_CHARS } from '@/shared/constants';
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value';
import { hapticSelection } from '@/shared/platform/haptics';

/** The combobox's dropdown size — enough to pick from, never a list. */
const SUGGESTION_COUNT = 6;

/**
 * Search-first kiosk — the ONE shared shape behind the app's look-up-by-term
 * screens (Daily ODO opened it; the fleet + employee directories now use it in
 * place of their open-as-a-register lists).
 *
 * Why: a master list pays ONE read of N rows the moment the screen opens, for a
 * screen most visits never need. The kiosk opens BLANK with a single centred
 * search — zero fetches while it sits idle — and runs only a debounced server
 * `?search=` read (one per settled term, cached per term) once the operator
 * types. The full register the old page showed is NOT gone: it stays one tap
 * away at the idle stage's "Browse all" link (a real route with its own back).
 *
 * Submit (or an exact single match, or a picked suggestion) hands the row to
 * `onPick` — the caller navigates (pass no `onPick` for look-up-only screens).
 * The state machine is deliberately the same as the ODO kiosk so every kiosk
 * screen behaves identically while a caller owns its own result card.
 */
export interface SearchKioskProps<T> {
	/** The shell title + the idle heading ("Find a vehicle"). */
	title: string;
	heading: string;
	/** The combobox placeholder (the field the operator recalls a term by). */
	placeholder: string;
	/** Screen-reader label for the search field. */
	inputLabel: string;
	/** Server `?search=` read — bounded, mapped to the SAME row shape the
	 *  module's own list renders. A pure client-side filter over an
	 *  already-cached board is fine too (resolve instantly). */
	search: (query: string) => Promise<T[]>;
	/** TanStack cache prefix — every term's answer is cached under it. */
	queryKeyPrefix: readonly unknown[];
	/** Cache window the module owns (its master/list tier). */
	staleTime: number;
	/** Per-row stable id. */
	keyOf: (row: T) => string;
	/** The row's primary text — prefix matches rank first (deterministic). */
	primaryText: (row: T) => string;
	/** The suggestion row's right-side label (type · unit badge…). */
	secondaryText?: (row: T) => string | null;
	/** Render one answered row (the module's own card). */
	renderResult: (row: T) => ReactNode;
	/** A single exact match (or a picked suggestion) opens its page directly —
	 *  omit for look-up screens whose rows carry no detail page. */
	onPick?: (row: T) => void;
	/** The viewing register's escape hatch (idle stage only). */
	browse?: { to: string; label: string };
	/** Optional content above the search — e.g. a module's scope-tab row. Stays
	 *  visible in BOTH the idle and results stages (the scope switch never hides). */
	subheader?: ReactNode;
	/** An external readiness gate: while false, suggestions wait and submit is a
	 *  no-op (e.g. the name masters a result's plate/model labels need). The
	 *  caller typically also reflects this in `search`. Defaults true. */
	enabled?: boolean;
	/** The "no match" hint (what to check / an example term). */
	notFoundHint?: string;
	/** The pending-results skeleton shape (the module's own row kind). */
	skeletonVariant?: Parameters<typeof ListSkeleton>[0]['variant'];
}

export function SearchKiosk<T>({
	title,
	heading,
	placeholder,
	inputLabel,
	search,
	queryKeyPrefix,
	staleTime,
	keyOf,
	primaryText,
	secondaryText,
	renderResult,
	onPick,
	browse,
	subheader,
	enabled = true,
	notFoundHint,
	skeletonVariant = 'category',
}: SearchKioskProps<T>) {
	// The lookup — a small state machine: idle (no query yet) → searching →
	// done (matches) / failed. Matches render ONLY the found rows.
	const [query, setQuery] = useState('');
	const [submitted, setSubmitted] = useState<string | null>(null);
	const [searching, setSearching] = useState(false);
	const [results, setResults] = useState<T[]>([]);
	const [failed, setFailed] = useState(false);

	// ── Combobox suggestions (idle stage only) ───────────────────────────────
	// The query settles through a trailing-edge debounce; ONE server `?search=`
	// read runs per settled fragment and is cached per term, so rapid typing
	// never piles up requests — and nothing fires while the box is empty.
	const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
	const suggestionsEnabled = enabled && submitted === null && debouncedQuery.length >= SEARCH_MIN_CHARS;
	const suggestionsQuery = useQuery({
		queryKey: [...queryKeyPrefix, 'search', debouncedQuery],
		queryFn: () => search(debouncedQuery),
		enabled: suggestionsEnabled,
		staleTime,
	});
	// The dropdown is busy from the FIRST keystroke of a new term — while the
	// trailing-edge debounce is still settling AND while the read is in flight —
	// so it never flashes "no matches" against a term the search hasn't seen yet.
	const suggestionsPending = query.trim() !== debouncedQuery || (suggestionsEnabled && suggestionsQuery.isPending);

	// Prefix-first ordering over the primary text, capped to a pick-from list.
	const rankByTerm = useCallback(
		(term: string, rows: T[]): T[] => {
			const lower = term.toLowerCase();
			return [...rows]
				.sort((a, b) => {
					const aPref = primaryText(a).toLowerCase().startsWith(lower) ? 0 : 1;
					const bPref = primaryText(b).toLowerCase().startsWith(lower) ? 0 : 1;
					return aPref - bPref || primaryText(a).localeCompare(primaryText(b));
				})
				.slice(0, SUGGESTION_COUNT);
		},
		[primaryText],
	);
	const suggestions: T[] = useMemo(
		() => (suggestionsEnabled ? rankByTerm(debouncedQuery, suggestionsQuery.data ?? []) : []),
		[suggestionsEnabled, rankByTerm, debouncedQuery, suggestionsQuery.data],
	);

	const runSearch = useCallback(
		async (raw: string) => {
			const term = raw.trim();
			if (!term || !enabled) return;
			setSearching(true);
			setFailed(false);
			setSubmitted(term);
			setResults([]);
			try {
				// The server `?search=` read — the SAME one the suggestions used, so an
				// exact term the dropdown already resolved never double-fetches.
				const cached = suggestionsQuery.data;
				const cachedReady = query.trim() === debouncedQuery && suggestionsQuery.isFetched && !suggestionsQuery.isPending;
				const found = cachedReady && cached ? cached : await search(term);
				const ranked = rankByTerm(term, found);
				setResults(ranked);
				// A single match IS the answer — open its page right away.
				if (ranked.length === 1 && onPick) {
					if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
					onPick(ranked[0]);
				}
			} catch {
				setFailed(true);
			} finally {
				setSearching(false);
			}
		},
		// `onPick` IS read (the single-match fast path) and `enabled` ITSELF is read
		// (the submit gate) — both belong in the deps.
		[
			rankByTerm,
			search,
			suggestionsQuery.data,
			suggestionsQuery.isFetched,
			suggestionsQuery.isPending,
			query,
			debouncedQuery,
			onPick,
			enabled,
		],
	);

	const handleSubmit = (event: FormEvent) => {
		event.preventDefault();
		if (searching) return;
		void runSearch(query);
	};

	const clearLookup = () => {
		setQuery('');
		setSubmitted(null);
		setResults([]);
		setFailed(false);
	};

	const chooseSuggestion = useCallback(
		(row: T) => {
			if (!onPick) {
				// No detail page — a suggestion fills the field so the operator can
				// press Search to see the row's details (the open-guard word carries).
				setQuery(primaryText(row));
				setSubmitted(primaryText(row));
				setResults([row]);
				return;
			}
			hapticSelection();
			if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
			// A suggestion is an EXACT server row, so its answer is immediate.
			onPick(row);
		},
		[onPick, primaryText],
	);

	// The rounded search pill — the visual every kiosk shares. Parent-state-driven
	// (never owns the query), so the input keeps its text across layout stages.
	const searchPill = (autoFocus: boolean) => (
		<div className="flex h-12 items-center gap-1 rounded-full border border-input bg-card py-1.5 pr-1.5 pl-4 shadow-card transition-colors focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/60">
			<Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
			<input
				autoFocus={autoFocus}
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder={placeholder}
				autoComplete="off"
				spellCheck={false}
				enterKeyHint="search"
				role="combobox"
				aria-expanded={suggestionsEnabled && query.trim().length > 0}
				aria-controls={`${title.toLowerCase().replace(/\s+/g, '-')}-suggestions`}
				aria-autocomplete="list"
				aria-label={inputLabel}
				className="h-full min-w-0 flex-1 bg-transparent px-2 text-key font-semibold tracking-tight text-foreground outline-none placeholder:font-medium placeholder:text-muted-foreground"
			/>
			{query ? (
				<button
					type="button"
					onClick={clearLookup}
					aria-label="Clear search"
					className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted/70 text-muted-foreground transition-transform duration-150 active:scale-90 focus-visible:ring-2 focus-visible:ring-ring"
				>
					<X className="size-3.5" aria-hidden />
				</button>
			) : null}
			<button
				type="submit"
				disabled={searching || !enabled || !query.trim()}
				className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold leading-none text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-50"
			>
				{searching || !enabled ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
				{!enabled ? 'Loading' : searching ? 'Searching' : 'Search'}
			</button>
		</div>
	);

	// The suggestion dropdown — a compact listbox under the idle pill (the
	// debounced server `?search=` read, cached per term).
	const listboxId = `${title.toLowerCase().replace(/\s+/g, '-')}-suggestions`;
	const suggestionPanel =
		submitted === null && query.trim().length > 0 ? (
			<div
				id={listboxId}
				role="listbox"
				aria-label={`${title} matches`}
				className="mt-2 w-full max-w-sm rounded-2xl border border-border bg-card p-1.5 shadow-lg"
			>
				{suggestionsPending ? (
					<div className="flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-muted-foreground">
						<LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Searching…
					</div>
				) : suggestionsQuery.isError ? (
					<p className="px-3 py-2.5 text-xs font-medium text-muted-foreground">Couldn’t load suggestions — press Search to try.</p>
				) : query.trim().length < SEARCH_MIN_CHARS ? (
					// The search GATE, stated as a gate. The old single branch said "no
					// match" BEFORE any search had run, so a 1–2 character term read as a
					// failed lookup instead of an unfinished one.
					<p className="px-3 py-2.5 text-xs font-medium text-muted-foreground">
						Type at least {SEARCH_MIN_CHARS} characters — or press Search.
					</p>
				) : suggestions.length === 0 ? (
					<p className="px-3 py-2.5 text-xs font-medium text-muted-foreground">
						No match for «{query.trim()}» — press Search to look it up.
					</p>
				) : (
					<ul className="flex flex-col">
						{suggestions.map((row) => (
							<li key={keyOf(row)}>
								<button
									type="button"
									role="option"
									aria-selected={false}
									onClick={() => chooseSuggestion(row)}
									className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left outline-none transition-colors focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring active:bg-muted/60"
								>
									<span className="min-w-0 flex-1 truncate text-sub font-semibold leading-myanmar text-foreground">{primaryText(row)}</span>
									{secondaryText ? (
										<span className="min-w-0 max-w-[50%] flex-none truncate text-right text-meta font-semibold uppercase tracking-wide text-muted-foreground">
											{secondaryText(row)}
										</span>
									) : null}
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		) : null;

	return (
		<ModuleShell title={title}>
			<div className="flex flex-1 flex-col gap-3">
				{subheader ? <div>{subheader}</div> : null}
				{submitted === null ? (
					/* ── Idle: ONE centred search, nothing else. No fetch happens until
					   the operator types; the register is a single muted link below. ── */
					<div className="flex flex-1 flex-col items-center justify-center px-1 pb-8">
						<p className="text-center text-[22px] font-light tracking-tight text-foreground">{heading}</p>
						<form onSubmit={handleSubmit} role="search" aria-label={`${title} search`} className="mt-6 w-full max-w-sm">
							{searchPill(true)}
						</form>
						{suggestionPanel}
					</div>
				) : (
					/* ── An active lookup: the search stays on top, the answers below. ── */
					<>
						<form onSubmit={handleSubmit} role="search" aria-label={`${title} search`} className="w-full">
							{searchPill(false)}
						</form>

						{searching ? (
							<ListSkeleton variant={skeletonVariant} count={3} />
						) : failed ? (
							<EmptyState title="Search failed" hint="Could not reach the server. Check the connection and search again." fill />
						) : results.length === 0 ? (
							<EmptyState title={`No match for “${submitted}”`} hint={notFoundHint ?? 'Check the term and try again.'} fill />
						) : (
							<>
								<p className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">
									{results.length} match{results.length === 1 ? '' : 'es'} · {submitted}
								</p>
								<ul className="flex flex-col gap-3">{results.map((row) => renderResult(row))}</ul>
							</>
						)}

						{results.length > 0 && submitted !== null && !searching ? (
							<button
								type="button"
								onClick={clearLookup}
								className="mx-auto mt-1 flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm transition-transform duration-150 active:scale-95"
							>
								<SearchX className="size-3.5" aria-hidden /> New search
							</button>
						) : null}
					</>
				)}
				{/* The full register — the kiosk's secondary action, pinned to the
				    bottom edge (idle stage only). */}
				{submitted === null && browse ? <KioskBrowseLink to={browse.to} label={browse.label} /> : null}
			</div>
		</ModuleShell>
	);
}
