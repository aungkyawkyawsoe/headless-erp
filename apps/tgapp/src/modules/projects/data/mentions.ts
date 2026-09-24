/**
 * Comment mentions — the pure helpers behind the composer's `@` picker and the
 * rendered comment body.
 *
 * A mention is a `@Display Name` run in the comment TEXT that the client also
 * records structurally: the picked person's id is stored on the comment's
 * `mentions` m2m, and the exact substring they inserted is remembered in the
 * composer's state so rendering can highlight precisely that run. Matching by
 * SUBSTRING (rather than re-splitting the text on `@`) is what lets a name with
 * spaces work ("@Ma Ei Mon") and stops a URL/email `@` from highlighting.
 *
 * Nothing here touches the network or React — the composer and the card stay
 * dumb, and this logic is testable on its own.
 */

/** A person the composer can mention — the resolved display identity. */
export interface MentionCandidate {
	id: string;
	/** Display name — `name_en` preferred, Burmese fallback; never empty. */
	name: string;
	/** The Burmese name, when the row carries one (the row's secondary line). */
	nameMm: string | null;
	/** The staff id (EID), when set. */
	eid: string | null;
	/** `/api/media/…` avatar, or null. */
	photo: string | null;
}

/** ONE picked mention — the person plus the text run inserted for them. */
export interface Mention {
	id: string;
	name: string;
	/** The EXACT substring inserted into the body at pick time. */
	token: string;
}

/** The mention token for a name — `Ma Ei Mon` → `@Ma Ei Mon`. */
export function mentionToken(name: string): string {
	return `@${name.trim()}`;
}

/** Cap the run so a stray `@` in prose never keeps the picker open forever. */
const MENTION_QUERY_MAX_CHARS = 60;
/** A person's name is at most a few words — past this the `@` was prose. */
const MENTION_QUERY_MAX_WORDS = 4;

/**
 * The active mention query — the `@…` run the caret currently sits in, or null
 * when the caret is not inside one.
 *
 * WHITESPACE IS ALLOWED inside the run: people's names have spaces
 * ("Ma Ei Mon"), so a rule that stopped at the first space would make a
 * multi-word teammate unsearchable by typing. The run closes instead when:
 *
 *  - a newline lands inside it;
 *  - it grows past the char/word caps (a stray `@` in prose);
 *  - it has already RESOLVED to a picked mention — the run BEGINS with a token
 *    that is already `completedTokens`, which is what stops the picker
 *    reopening the moment you pick someone and keep typing after them (the
 *    token is a full name, so a fresh run starting with it means that person,
 *    not a new search).
 */
export function activeMentionQuery(
	text: string,
	caret: number,
	completedTokens: readonly string[] = [],
): { query: string; start: number } | null {
	const before = text.slice(0, caret);
	const at = before.lastIndexOf('@');
	if (at === -1) return null;
	const query = before.slice(at + 1);
	if (query.includes('\n')) return null;
	if (query.length > MENTION_QUERY_MAX_CHARS) return null;
	if (query.split(/\s+/).filter(Boolean).length > MENTION_QUERY_MAX_WORDS) return null;
	const candidate = `@${query}`;
	const completed = completedTokens.some((token) => candidate.startsWith(token));
	if (completed) return null;
	return { query, start: at };
}

/**
 * Insert a mention at the caret, replacing the in-progress `@query` run and
 * adding a trailing space — the caret/offset contract the composer needs to
 * restore focus and place the caret after the token.
 *
 * `start` is `activeMentionQuery().start`; when no run is active the token is
 * spliced in at the caret as plain text.
 */
export function insertMention(
	text: string,
	caret: number,
	person: MentionCandidate,
	start: number | null,
): { text: string; caret: number; mention: Mention } {
	const token = `${mentionToken(person.name)} `;
	const from = start ?? caret;
	const next = `${text.slice(0, from)}${token}${text.slice(caret)}`;
	return { text: next, caret: from + token.length, mention: { id: person.id, name: person.name, token: token.trimEnd() } };
}

/**
 * Drop the mentions whose token no longer appears in the text — deleting the
 * `@Name` run (or clearing the composer) must remove the person from the
 * comment's `mentions`, so an untagged name is never silently notified.
 */
export function pruneMentions(text: string, mentions: Mention[]): Mention[] {
	return mentions.filter((mention) => text.includes(mention.token));
}

/**
 * The ids of the mentions whose token still appears in `text` — what an EDIT
 * persists. Deleting an `@Name` run while editing must drop that tag, so nobody
 * is notified for a name the comment no longer writes; the surviving tags are
 * sent back as the comment's `mentions` set.
 */
export function survivingMentionIds(text: string, mentions: Mention[]): string[] {
	return pruneMentions(text, mentions).map((mention) => mention.id);
}

/** ONE rendered segment of a comment body — a plain run or a highlighted mention. */
export interface MentionSegment {
	kind: 'text' | 'mention';
	value: string;
}

/**
 * Split a comment body into render segments, highlighting the tokens that are
 * actually on the comment's `mentions` record — a bare `@word` that was never
 * picked stays plain text (the client highlights what was really recorded, not
 * everything that looks like a handle).
 *
 * Overlapping tokens resolve first-match-wins by scanning left to right, so
 * "@Ann @Ann Lee" highlights "@Ann" and leaves the rest as text.
 */
export function segmentMentions(text: string, tokens: string[]): MentionSegment[] {
	const live = [...new Set(tokens.filter(Boolean))].sort((a, b) => b.length - a.length);
	if (live.length === 0) return text ? [{ kind: 'text', value: text }] : [];

	const segments: MentionSegment[] = [];
	let cursor = 0;
	while (cursor < text.length) {
		let hit: { token: string; at: number } | null = null;
		for (const token of live) {
			const at = text.indexOf(token, cursor);
			if (at !== -1 && (!hit || at < hit.at || (at === hit.at && token.length > hit.token.length))) hit = { token, at };
		}
		if (!hit) break;
		if (hit.at > cursor) segments.push({ kind: 'text', value: text.slice(cursor, hit.at) });
		segments.push({ kind: 'mention', value: hit.token });
		cursor = hit.at + hit.token.length;
	}
	if (cursor < text.length) segments.push({ kind: 'text', value: text.slice(cursor) });
	return segments;
}
