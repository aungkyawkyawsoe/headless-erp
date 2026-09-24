/**
 * Column-layout persistence — localStorage roundtrip + sanitization.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { loadPersistedColumnState, savePersistedColumnState } from './persist';

const KEY = 'test:grid';

beforeEach(() => {
	localStorage.clear();
});

describe('persisted column state', () => {
	it('returns null when nothing is persisted', () => {
		expect(loadPersistedColumnState(KEY, ['a', 'b'])).toBeNull();
	});

	it('roundtrips visibility / order / pinning', () => {
		savePersistedColumnState(KEY, {
			visibility: { a: false, b: true },
			order: ['b', 'a'],
			pinning: { start: ['b'], end: [] },
		});
		expect(loadPersistedColumnState(KEY, ['a', 'b'])).toEqual({
			visibility: { a: false, b: true },
			order: ['b', 'a'],
			pinning: { start: ['b'], end: [] },
		});
	});

	it('drops the order when the saved layout is a stale schema (unknown columns)', () => {
		savePersistedColumnState(KEY, {
			visibility: { a: false, z: false },
			order: ['z', 'b', 'a'],
			pinning: { start: ['z'], end: ['b'] },
		});
		// Order is only honored as an EXACT permutation of the current column
		// set — stale layouts fall back to canonical definition order.
		expect(loadPersistedColumnState(KEY, ['a', 'b'])).toEqual({
			visibility: { a: false },
			order: [],
			pinning: { start: [], end: ['b'] },
		});
	});

	it('drops legacy payloads without the ids fingerprint (pre-fingerprint order ignored)', () => {
		localStorage.setItem('mmbix:datatable:' + KEY, JSON.stringify({ visibility: {}, order: ['b', 'a'], pinning: { start: [], end: [] } }));
		expect(loadPersistedColumnState(KEY, ['a', 'b'])?.order).toEqual([]);
	});

	it('keeps a dragged order only when it is an exact permutation of the current columns', () => {
		savePersistedColumnState(KEY, {
			visibility: {},
			order: ['b', 'a'],
			pinning: { start: [], end: [] },
		});
		expect(loadPersistedColumnState(KEY, ['a', 'b'])?.order).toEqual(['b', 'a']);
		// Column added since the layout was saved → no longer a permutation →
		// canonical order wins.
		expect(loadPersistedColumnState(KEY, ['a', 'b', 'c'])?.order).toEqual([]);
	});

	it('returns null for malformed payloads', () => {
		localStorage.setItem('mmbix:datatable:' + KEY, 'not json{');
		expect(loadPersistedColumnState(KEY, ['a'])).toBeNull();
		localStorage.setItem('mmbix:datatable:' + KEY, JSON.stringify({ visibility: 'nope' }));
		expect(loadPersistedColumnState(KEY, ['a'])).toEqual({ visibility: {}, order: [], pinning: { start: [], end: [] } });
	});

	it('migrates pre-v9 payloads that stored left/right pinning', () => {
		localStorage.setItem(
			'mmbix:datatable:' + KEY,
			JSON.stringify({ visibility: {}, order: ['a', 'b'], ids: ['a', 'b'], pinning: { left: ['a'], right: ['b'] } }),
		);
		expect(loadPersistedColumnState(KEY, ['a', 'b'])).toEqual({
			visibility: {},
			order: ['a', 'b'],
			pinning: { start: ['a'], end: ['b'] },
		});
	});
});
