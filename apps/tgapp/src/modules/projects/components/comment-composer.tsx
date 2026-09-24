import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AtSign, Send } from 'lucide-react';
import { Textarea } from '@mmbix/design-system/textarea';

import { activeMentionQuery, insertMention, pruneMentions, type Mention, type MentionCandidate } from '../data/mentions';
import { MAX_MENTION_ROWS, MentionSuggestions, toMentionCandidate } from './mention-suggestions';
import { STALE_MS } from '@/shared/api/invalidation';
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_CHARS } from '@/shared/constants';
import { FormError } from '@/shared/components/form-submit';
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value';
import { searchEmployees } from '@/shared/lookups/api';
import { masterQk } from '@/shared/lookups/query-keys';
import { hapticSelection } from '@/shared/platform/haptics';

interface CommentComposerProps {
	/** Posts the comment — the body plus the tagged `hrm_employees` ids. */
	onSubmit: (content: string, mentions: string[]) => Promise<void>;
	placeholder?: string;
}

/** The `@…` run the caret currently sits in — its query text and its `@` offset. */
type MentionRun = { query: string; start: number };

/**
 * The task screen's pinned comment composer with `@` mentions.
 *
 * Typing `@` (or tapping the `@` button) opens an INLINE suggestion strip above
 * the input, seeded with whatever follows the `@` and searched against the shared
 * personnel lookup. Picking a person — by tap or with ↑/↓ + Enter — splices
 * `@Name` into the body at the caret, restores the caret after it, and records
 * their id. The id list is pruned against the body on every change, so deleting
 * the token (or clearing the box) drops the tag instead of notifying someone the
 * comment no longer names. On submit the comment carries both the text and the
 * tagged ids.
 *
 * The strip is not a modal sheet on purpose: a sheet steals focus, so only the
 * first character after `@` would ever land. Here focus never leaves the
 * textarea, so a multi-word teammate name stays typeable in one pass.
 */
export function CommentComposer({ onSubmit, placeholder = 'Write a comment…' }: CommentComposerProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [draft, setDraft] = useState('');
	const [picked, setPicked] = useState<Mention[]>([]);
	const [run, setRun] = useState<MentionRun | null>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	const [posting, setPosting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const canPost = draft.trim() !== '' && !posting;

	// The `@…` fragment, debounced — the ONE term the directory is searched with.
	const term = run ? run.query.trim() : '';
	const debouncedTerm = useDebouncedValue(term, SEARCH_DEBOUNCE_MS);
	const ready = debouncedTerm.length >= SEARCH_MIN_CHARS;

	const results = useQuery({
		queryKey: masterQk.employeeSearch(debouncedTerm),
		queryFn: () => searchEmployees(debouncedTerm),
		enabled: run !== null && ready,
		staleTime: STALE_MS.list,
	});

	// Only the rows the keyboard can reach — the composer and the strip agree on
	// the same capped list, so Enter and a tap always resolve to the same person.
	const hits = run && ready ? (results.data ?? []).slice(0, MAX_MENTION_ROWS) : [];
	const stripOpen = run !== null;

	/** Re-derive the live `@…` run for a text + caret, closing it when the run
	 *  already resolves to a picked token (so choosing a name doesn't reopen the
	 *  list the instant you keep typing). */
	const syncRun = (text: string, caret: number, tokens: readonly string[]) => {
		setRun(activeMentionQuery(text, caret, tokens));
		setActiveIndex(0);
	};

	/** Put the caret back after an insertion once React has painted the new value. */
	const restoreCaret = (caret: number) => {
		requestAnimationFrame(() => {
			const node = textareaRef.current;
			if (!node) return;
			node.focus();
			node.setSelectionRange(caret, caret);
		});
	};

	const change = (event: ChangeEvent<HTMLTextAreaElement>) => {
		const next = event.target.value;
		// The caret MUST be read off the EVENT TARGET, synchronously: this textarea
		// is controlled, and by the time a later render reads
		// `textareaRef.current.selectionStart` the value has been replaced and the
		// caret sits at 0 — which would seed the strip with the wrong fragment.
		const caret = event.target.selectionStart ?? next.length;
		// Prune FIRST, then hand those exact tokens to the run detector: passing a
		// stale list is what used to reopen the strip right after a pick.
		const live = pruneMentions(next, picked);
		setDraft(next);
		setPicked(live);
		syncRun(
			next,
			caret,
			live.map((entry) => entry.token),
		);
	};

	const pick = (person: MentionCandidate) => {
		const caret = textareaRef.current?.selectionStart ?? draft.length;
		const { text, caret: nextCaret, mention } = insertMention(draft, caret, person, run?.start ?? null);
		const live = picked.some((entry) => entry.id === mention.id) ? picked : [...picked, mention];
		hapticSelection();
		setDraft(text);
		setPicked(live);
		// The inserted token ends in a space, so the caret lands after it and the
		// run closes (the token is now "completed").
		syncRun(
			text,
			nextCaret,
			live.map((entry) => entry.token),
		);
		restoreCaret(nextCaret);
	};

	/** The `@` button: splice a bare `@` at the caret and open the strip there. */
	const openMention = () => {
		const caret = textareaRef.current?.selectionStart ?? draft.length;
		const text = `${draft.slice(0, caret)}@${draft.slice(caret)}`;
		const nextCaret = caret + 1;
		setDraft(text);
		syncRun(
			text,
			nextCaret,
			picked.map((entry) => entry.token),
		);
		restoreCaret(nextCaret);
	};

	const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (!run) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			setRun(null);
			return;
		}
		if (hits.length === 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			setActiveIndex((index) => (index + 1) % hits.length);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			setActiveIndex((index) => (index - 1 + hits.length) % hits.length);
		} else if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			pick(toMentionCandidate(hits[activeIndex] ?? hits[0]));
		}
	};

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		const text = draft.trim();
		if (!text || posting) return;
		setPosting(true);
		setError(null);
		try {
			// Only tags whose token survived in the final text are sent.
			await onSubmit(
				text,
				pruneMentions(draft, picked).map((entry) => entry.id),
			);
			setDraft('');
			setPicked([]);
			setRun(null);
		} catch (err) {
			console.error('[projects] comment failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Couldn’t post this comment — try again.');
		} finally {
			setPosting(false);
		}
	};

	return (
		<form
			className="sticky bottom-0 z-10 -mx-4 -mb-[var(--shell-bottom)] border-t border-border/70 bg-card/98 px-4 pt-3 pb-safe"
			onSubmit={(event) => void submit(event)}
		>
			{/* Who can be tagged — an inline strip so the textarea keeps focus. */}
			{stripOpen && (
				<MentionSuggestions
					query={term}
					ready={ready}
					isPending={ready && results.isPending}
					isError={ready && results.isError}
					hits={hits}
					selectedIds={picked.map((entry) => entry.id)}
					activeIndex={activeIndex}
					onActiveIndexChange={setActiveIndex}
					onPick={pick}
				/>
			)}

			<div className="flex items-end gap-2 rounded-2xl border border-input bg-background p-2 transition-colors focus-within:border-ring/60">
				<Textarea
					ref={textareaRef}
					value={draft}
					onChange={change}
					onKeyDown={keyDown}
					rows={1}
					placeholder={placeholder}
					disabled={posting}
					aria-label="New comment"
					aria-expanded={stripOpen}
					aria-controls={stripOpen ? 'mention-suggestions' : undefined}
					className="max-h-28 min-h-0 w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-myanmar text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0"
				/>
				<button
					type="button"
					aria-label="Mention someone"
					disabled={posting}
					onClick={openMention}
					className="shrink-0 rounded-xl p-2 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
				>
					<AtSign className="size-4" aria-hidden />
				</button>
				<button
					type="submit"
					aria-label="Post comment"
					disabled={!canPost}
					className="shrink-0 rounded-xl bg-primary p-2 text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-40 disabled:active:scale-100"
				>
					<Send className="size-4" aria-hidden />
				</button>
			</div>

			{/* Who the comment will tag — the structural record behind the `@Name` runs. */}
			{picked.length > 0 && (
				<div className="mt-2 flex flex-wrap gap-1.5">
					{picked.map((entry) => (
						<span
							key={entry.id}
							className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-meta font-semibold text-primary"
						>
							@{entry.name}
						</span>
					))}
				</div>
			)}

			{error && <FormError error={error} className="mt-2" />}
		</form>
	);
}
