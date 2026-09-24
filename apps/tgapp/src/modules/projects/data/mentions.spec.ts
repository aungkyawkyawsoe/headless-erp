import { describe, expect, it } from 'vitest';

import {
	activeMentionQuery,
	insertMention,
	mentionToken,
	pruneMentions,
	segmentMentions,
	survivingMentionIds,
	type Mention,
	type MentionCandidate,
} from './mentions';

const MA_EI_MON: MentionCandidate = { id: 'e1', name: 'Ma Ei Mon', nameMm: 'Ma Ei Mon', eid: 'MFF-007', photo: null };
const YE_NAING: MentionCandidate = { id: 'e2', name: 'U Ye Naing', nameMm: 'U Ye Naing', eid: 'MFF-008', photo: null };

describe('mentionToken', () => {
	it('prefixes @ and trims', () => {
		expect(mentionToken('  Ma Ei Mon ')).toBe('@Ma Ei Mon');
	});
});

describe('activeMentionQuery', () => {
	it('returns the fragment after the last @', () => {
		expect(activeMentionQuery('hey @ma', 7)).toEqual({ query: 'ma', start: 4 });
	});

	it('returns an empty query right after @', () => {
		expect(activeMentionQuery('hey @', 5)).toEqual({ query: '', start: 4 });
	});

	it('keeps a multi-word fragment open so a spaced name stays searchable', () => {
		expect(activeMentionQuery('hey @ma ei', 10)).toEqual({ query: 'ma ei', start: 4 });
	});

	it('anchors on the LAST @ and ignores the text before it', () => {
		expect(activeMentionQuery('ping @alex then @ma', 19)).toEqual({ query: 'ma', start: 16 });
	});

	it('is null when the caret is before the @', () => {
		expect(activeMentionQuery('hey @ma', 2)).toBeNull();
	});

	it('is null with no @ at all', () => {
		expect(activeMentionQuery('plain text', 10)).toBeNull();
	});

	it('closes when a newline lands inside the fragment', () => {
		expect(activeMentionQuery('hey @ma\nei', 10)).toBeNull();
	});

	it('closes once the fragment grows past the char cap', () => {
		expect(activeMentionQuery(`@${'a'.repeat(61)}`, 62)).toBeNull();
	});

	it('stays open exactly at the char cap', () => {
		expect(activeMentionQuery(`@${'a'.repeat(60)}`, 61)).toEqual({ query: 'a'.repeat(60), start: 0 });
	});

	it('closes once the fragment grows past the word cap', () => {
		expect(activeMentionQuery('@one two three four five', 24)).toBeNull();
	});

	it('closes on a completed token even as more text follows', () => {
		const text = 'thanks @Ma Ei Mon ok';
		expect(activeMentionQuery(text, text.length, ['@Ma Ei Mon'])).toBeNull();
	});

	it('closes on a completed token plus a trailing space', () => {
		const text = 'thanks @Ma Ei Mon ';
		expect(activeMentionQuery(text, text.length, ['@Ma Ei Mon'])).toBeNull();
	});

	it('stays open for a fresh @ after a completed token', () => {
		const text = 'thanks @Ma Ei Mon and @u';
		expect(activeMentionQuery(text, text.length, ['@Ma Ei Mon'])).toEqual({ query: 'u', start: 22 });
	});

	it('is not closed by an unrelated completed token', () => {
		expect(activeMentionQuery('hey @ma ei', 10, ['@Ma Ei Mon'])).toEqual({ query: 'ma ei', start: 4 });
	});
});

describe('insertMention', () => {
	it('replaces the in-progress @fragment and returns the new caret', () => {
		const text = 'hey @ma';
		const active = activeMentionQuery(text, text.length)!;
		const result = insertMention(text, text.length, MA_EI_MON, active.start);
		expect(result.text).toBe('hey @Ma Ei Mon ');
		expect(result.caret).toBe(result.text.length);
		expect(result.mention).toEqual({ id: 'e1', name: 'Ma Ei Mon', token: '@Ma Ei Mon' });
	});

	it('keeps the text after the caret', () => {
		const text = 'hey @ma thanks';
		const active = activeMentionQuery(text, 7)!;
		const result = insertMention(text, 7, MA_EI_MON, active.start);
		expect(result.text).toBe('hey @Ma Ei Mon  thanks');
		expect(result.caret).toBe('hey @Ma Ei Mon '.length);
	});

	it('splices at the caret when no run is active', () => {
		const result = insertMention('hi ', 3, YE_NAING, null);
		expect(result.text).toBe('hi @U Ye Naing ');
	});

	it('round-trips names with spaces through the highlight segmenter', () => {
		const text = 'hey @ma';
		const active = activeMentionQuery(text, text.length)!;
		const { text: next, mention } = insertMention(text, text.length, MA_EI_MON, active.start);
		expect(segmentMentions(next, [mention.token])).toEqual([
			{ kind: 'text', value: 'hey ' },
			{ kind: 'mention', value: '@Ma Ei Mon' },
			{ kind: 'text', value: ' ' },
		]);
	});
});

describe('pruneMentions', () => {
	const picked: Mention[] = [
		{ id: 'e1', name: 'Ma Ei Mon', token: '@Ma Ei Mon' },
		{ id: 'e2', name: 'U Ye Naing', token: '@U Ye Naing' },
	];

	it('drops a tag whose token was deleted from the body', () => {
		expect(pruneMentions('@Ma Ei Mon ok', picked)).toEqual([picked[0]]);
	});

	it('keeps every tag still named in the body', () => {
		expect(pruneMentions('@Ma Ei Mon @U Ye Naing done', picked)).toEqual(picked);
	});

	it('drops everything when the body is cleared', () => {
		expect(pruneMentions('', picked)).toEqual([]);
	});
});

describe('survivingMentionIds', () => {
	const picked: Mention[] = [
		{ id: 'e1', name: 'Ma Ei Mon', token: '@Ma Ei Mon' },
		{ id: 'e2', name: 'U Ye Naing', token: '@U Ye Naing' },
	];

	it('keeps the ids whose token is still in the edited text', () => {
		expect(survivingMentionIds('@Ma Ei Mon @U Ye Naing please review', picked)).toEqual(['e1', 'e2']);
	});

	it('drops the id whose token the edit removed', () => {
		expect(survivingMentionIds('@Ma Ei Mon please review', picked)).toEqual(['e1']);
	});

	it('drops every id when the edit clears the body', () => {
		expect(survivingMentionIds('', picked)).toEqual([]);
	});
});

describe('segmentMentions', () => {
	it('highlights only recorded tokens', () => {
		expect(segmentMentions('ping @Ma Ei Mon and @nobody', ['@Ma Ei Mon'])).toEqual([
			{ kind: 'text', value: 'ping ' },
			{ kind: 'mention', value: '@Ma Ei Mon' },
			{ kind: 'text', value: ' and @nobody' },
		]);
	});

	it('returns one text segment when nothing is recorded', () => {
		expect(segmentMentions('plain @word', [])).toEqual([{ kind: 'text', value: 'plain @word' }]);
	});

	it('handles a token at the very start', () => {
		expect(segmentMentions('@Ma Ei Mon hi', ['@Ma Ei Mon'])).toEqual([
			{ kind: 'mention', value: '@Ma Ei Mon' },
			{ kind: 'text', value: ' hi' },
		]);
	});

	it('highlights a repeated token twice', () => {
		expect(segmentMentions('@Ma Ei Mon and @Ma Ei Mon', ['@Ma Ei Mon'])).toEqual([
			{ kind: 'mention', value: '@Ma Ei Mon' },
			{ kind: 'text', value: ' and ' },
			{ kind: 'mention', value: '@Ma Ei Mon' },
		]);
	});

	it('prefers the longest token on an overlap', () => {
		expect(segmentMentions('@Ann Lee', ['@Ann', '@Ann Lee'])).toEqual([{ kind: 'mention', value: '@Ann Lee' }]);
	});

	it('returns no segments for empty text', () => {
		expect(segmentMentions('', ['@Ma Ei Mon'])).toEqual([]);
	});
});
