import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';
import { Check, LoaderCircle, Search, User, X } from 'lucide-react';

import { searchEmployees } from '@/shared/lookups/api';
import { masterQk } from '@/shared/lookups/query-keys';
import { STALE_MS } from '@/shared/api/invalidation';
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_CHARS } from '@/shared/constants';
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value';
import { PickerSearchHint } from '@/shared/components/picker-search-hint';
import { hapticSelection } from '@/shared/platform/haptics';

/** The person a picker row / chip renders — identity only, display name resolved. */
export interface PersonnelOption {
	id: string;
	/** Display name — `name_en` preferred, Burmese fallback; never empty. */
	name: string;
	/** `/api/media/…` avatar, or null (the caller renders an icon fallback). */
	photo: string | null;
	/** The staff id (EID), when set. */
	eid?: string | null;
}

interface PersonnelPickerSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The currently selected people — their rows render a check mark. */
	value: PersonnelOption[];
	/** Fired on a row tap — the caller owns the selection (and its order). */
	onToggle: (person: PersonnelOption) => void;
	title?: string;
	/** SINGLE-select mode — a driver / one-person field, not a crew: a row tap
	 *  takes that person and closes the sheet, and no running count is shown. */
	singleSelect?: boolean;
	/** Narrow the directory to a designation — a case-insensitive `designation.name`
	 *  fragment (e.g. `driver` matches “Driver” and “Ferry Driver”). Omit to search
	 *  the whole directory (a crew / holder field). */
	designationFilter?: string;
}

/**
 * The shared "Select personnel" bottom sheet — a MULTI-select picker for the crew
 * carried on a record, used by every incident form so the anatomy can never drift.
 *
 * It is SEARCH-FIRST and LAZY on purpose: the `hrm_employees` directory has 200+
 * rows, so opening the sheet issues NOTHING and walking it whole (≈10 paginated
 * requests) is deliberately avoided. Typing runs ONE server-side lookup per
 * settled term (`searchEmployees` → `?search=`) — but only once the term reaches
 * `SEARCH_MIN_CHARS`, so a one-character term never costs a round trip;
 * below that the sheet stays on its blank prompt. Tapping a row toggles it and
 * keeps the sheet open (several people are usually involved); the header carries
 * the running count and `Done` closes it.
 *
 * A person already selected stays checked even when a new term no longer matches
 * them — the caller owns the selection, so nothing is lost while searching.
 *
 * `singleSelect` reuses the SAME search-first anatomy for a ONE-person relation
 * (a maintenance log's driver): a row tap takes that person and closes the sheet.
 *
 * `designationFilter` narrows the search server-side to one designation (a
 * `driver` field offers drivers only) — same one-request-per-term shape.
 */
export function PersonnelPickerSheet({
	open,
	onOpenChange,
	value,
	onToggle,
	title = 'Select personnel',
	singleSelect = false,
	designationFilter,
}: PersonnelPickerSheetProps) {
	const [term, setTerm] = useState('');
	// Re-opening starts a fresh search, not the previous session's term.
	useEffect(() => {
		if (!open) setTerm('');
	}, [open]);

	const trimmed = term.trim();
	const debounced = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
	// The gate: nothing fires until the settled term is long enough to search.
	const ready = debounced.length >= SEARCH_MIN_CHARS;

	const results = useQuery({
		queryKey: masterQk.employeeSearch(debounced, designationFilter ?? ''),
		queryFn: () => searchEmployees(debounced, { designationContains: designationFilter }),
		enabled: open && ready,
		staleTime: STALE_MS.list,
	});

	const selectedIds = new Set(value.map((person) => person.id));
	const hits = results.data ?? [];

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="bottom" className="max-h-[70dvh] gap-0 overflow-hidden p-0">
				<SheetHeader className="px-5 pb-3 pr-12 pt-4">
					<SheetTitle className="flex items-center justify-between gap-3">
						<span>{title}</span>
						{!singleSelect && value.length > 0 && (
							<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-meta font-semibold tabular-nums text-muted-foreground">
								{value.length} selected
							</span>
						)}
					</SheetTitle>
				</SheetHeader>

				{/* Search — the lazy server-side lookup; nothing loads until a term lands. */}
				<div className="px-5 pb-3">
					<div className="relative">
						<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
						<input
							value={term}
							onChange={(e) => setTerm(e.target.value)}
							placeholder="Search name or staff ID…"
							aria-label="Search personnel"
							autoComplete="off"
							className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-9 text-sm leading-myanmar text-foreground outline-none placeholder:text-muted-foreground focus:border-ring/60"
						/>
						{term && (
							<button
								type="button"
								aria-label="Clear search"
								onClick={() => setTerm('')}
								className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
							>
								<X className="size-4" aria-hidden />
							</button>
						)}
					</div>
				</div>

				{/* Content-height when the list is short, scrolls once it outgrows the
				 *  sheet's cap — never an empty flex gap. */}
				<div className="min-h-0 overflow-y-auto px-5 pb-4 pt-1">
					{!ready ? (
						<PickerSearchHint noun={singleSelect ? 'find the person' : 'find who was involved'} />
					) : results.isPending ? (
						<p className="flex items-center justify-center gap-2 px-2 py-6 text-sm leading-myanmar text-muted-foreground">
							<LoaderCircle className="size-4 animate-spin" aria-hidden /> Searching…
						</p>
					) : results.isError ? (
						<p className="px-2 py-6 text-center text-sm leading-myanmar text-muted-foreground">
							Couldn’t search the directory — try again.
						</p>
					) : hits.length === 0 ? (
						<p className="px-2 py-6 text-center text-sm leading-myanmar text-muted-foreground">No one matches “{trimmed}”.</p>
					) : (
						<ul className="flex flex-col">
							{hits.map((hit) => {
								const selected = selectedIds.has(hit.id);
								return (
									<li key={hit.id}>
										<button
											type="button"
											aria-pressed={selected}
											onClick={() => {
												hapticSelection();
												onToggle({ id: hit.id, name: hit.name, photo: hit.photo, eid: hit.eid });
												if (singleSelect) onOpenChange(false);
											}}
											className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring active:bg-muted/60"
										>
											<span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground">
												{hit.photo ? (
													<img src={hit.photo} alt="" className="size-full object-cover" />
												) : (
													<User className="size-4" strokeWidth={2} aria-hidden />
												)}
											</span>
											<span className="min-w-0 flex-1">
												<span className="block truncate text-sm font-semibold leading-myanmar text-foreground">{hit.name}</span>
												{hit.eid && <span className="block truncate text-meta leading-myanmar text-muted-foreground">{hit.eid}</span>}
											</span>
											{selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</div>

				<div className="border-t border-border/60 px-5 py-3 pb-safe">
					<button
						type="button"
						onClick={() => onOpenChange(false)}
						className="w-full rounded-2xl bg-foreground px-4 py-3 text-sm font-semibold leading-myanmar text-background transition-transform duration-150 active:scale-[0.98]"
					>
						Done{!singleSelect && value.length > 0 ? ` · ${value.length}` : ''}
					</button>
				</div>
			</SheetContent>
		</Sheet>
	);
}
