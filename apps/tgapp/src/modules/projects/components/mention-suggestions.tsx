import { User } from 'lucide-react';

import type { MentionCandidate } from '../data/mentions';
import { SEARCH_MIN_CHARS } from '@/shared/constants';
import type { EmployeeSearchHit } from '@/shared/lookups/api';

/** Rows the strip shows at once — a mention list is a hint, not a directory. */
export const MAX_MENTION_ROWS = 5;

/** A directory hit → the composer's stable mention identity. */
export function toMentionCandidate(hit: EmployeeSearchHit): MentionCandidate {
	return { id: hit.id, name: hit.name, nameMm: hit.name_mm, eid: hit.eid, photo: hit.photo };
}

interface MentionSuggestionsProps {
	/** The trimmed `@…` fragment being searched (rendered in the empty copy). */
	query: string;
	/** Whether the fragment is long enough to run a search. */
	ready: boolean;
	isPending: boolean;
	isError: boolean;
	/** Already capped by the caller — the strip renders exactly these rows. */
	hits: EmployeeSearchHit[];
	/** The already-mentioned ids — their rows read "Added". */
	selectedIds: readonly string[];
	/** The keyboard-highlighted row. */
	activeIndex: number;
	onActiveIndexChange: (index: number) => void;
	/** Fired on a row tap/hover-select; the caller splices in the token. */
	onPick: (person: MentionCandidate) => void;
}

/**
 * The comment composer's INLINE `@` suggestion strip — the shared search-first
 * personnel lookup rendered as a short list directly above the input.
 *
 * It is deliberately NOT a modal sheet: a sheet steals focus, so you could only
 * ever type one character after the `@` before the search box swallowed the
 * rest. Anchored to the composer instead, the textarea keeps focus and typing
 * continuously filters the list. Rows cancel `mousedown` so a tap never blurs
 * the input, and the caret is restored by the caller after a pick — the
 * keyboard (↑/↓/Enter/Esc, handled by the composer) and touch paths stay in
 * lockstep.
 */
export function MentionSuggestions({
	query,
	ready,
	isPending,
	isError,
	hits,
	selectedIds,
	activeIndex,
	onActiveIndexChange,
	onPick,
}: MentionSuggestionsProps) {
	const added = new Set(selectedIds);

	return (
		<div
			id="mention-suggestions"
			role="listbox"
			aria-label="People to mention"
			className="mb-2 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-lg"
		>
			{!ready ? (
				<p className="px-3 py-3 text-center text-meta leading-myanmar text-muted-foreground">
					Type at least {SEARCH_MIN_CHARS} characters to find who to mention.
				</p>
			) : isPending ? (
				<p className="px-3 py-3 text-center text-meta leading-myanmar text-muted-foreground">Searching…</p>
			) : isError ? (
				<p className="px-3 py-3 text-center text-meta leading-myanmar text-muted-foreground">Couldn’t search the directory — try again.</p>
			) : hits.length === 0 ? (
				<p className="px-3 py-3 text-center text-meta leading-myanmar text-muted-foreground">No one matches “{query}”.</p>
			) : (
				<ul className="flex flex-col">
					{hits.map((hit, index) => {
						const isAdded = added.has(hit.id);
						const isActive = index === activeIndex;
						return (
							<li key={hit.id} role="option" aria-selected={isActive}>
								<button
									type="button"
									// Keep the textarea focused: a tap must not blur it, so the
									// caller can restore the caret and typing continues.
									onMouseDown={(event) => event.preventDefault()}
									onMouseEnter={() => onActiveIndexChange(index)}
									onClick={() => onPick(toMentionCandidate(hit))}
									ref={(node) => {
										if (isActive && node) node.scrollIntoView({ block: 'nearest' });
									}}
									className={`flex w-full items-center gap-2.5 px-3 py-2 text-left outline-none transition-colors ${isActive ? 'bg-muted/70' : ''}`}
								>
									<span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground">
										{hit.photo ? (
											<img src={hit.photo} alt="" className="size-full object-cover" />
										) : (
											<User className="size-3.5" strokeWidth={2} aria-hidden />
										)}
									</span>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-xs font-semibold leading-myanmar text-foreground">{hit.name}</span>
										{hit.eid && <span className="block truncate text-[10px] leading-myanmar text-muted-foreground">{hit.eid}</span>}
									</span>
									<span
										className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${isAdded ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}
									>
										{isAdded ? 'Added' : 'Insert'}
									</span>
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
