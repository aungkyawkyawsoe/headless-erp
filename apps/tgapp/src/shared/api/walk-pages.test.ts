import { describe, expect, it, vi } from 'vitest';

import { WALK_PAGE_CAP, WALK_PAGE_SIZE, walkPages } from './walk-pages';

interface Row {
	vehicle: string;
	odo: number;
}

/** A scripted walk source — pages served in order; records the cursor each
 *  fetch was called with so the walk's continuation is asserted. */
function scriptedSource(pages: Array<Row[] | undefined>, hasMore = true) {
	const cursors: Array<string | undefined> = [];
	let call = 0;
	return {
		cursors,
		fetchPage: vi.fn((cursor?: string) => {
			cursors.push(cursor);
			const data = pages[call++] ?? [];
			return Promise.resolve({
				data,
				meta: { has_more: hasMore && call < pages.length, next_cursor: call < pages.length ? `c${call}` : null },
			});
		}),
	};
}

describe('walkPages', () => {
	it('resolves everything on page one and never fetches a second page', async () => {
		const src = scriptedSource([[{ vehicle: 'a', odo: 1 }], [{ vehicle: 'b', odo: 2 }]]);
		let calls = 0;
		await walkPages<Row>(src.fetchPage, () => {
			calls += 1;
			return calls >= 1;
		});
		expect(src.fetchPage).toHaveBeenCalledTimes(1);
		expect(src.cursors).toEqual([undefined]);
	});

	it('continues with meta.next_cursor until the resolver reports done', async () => {
		const src = scriptedSource([[{ vehicle: 'a', odo: 1 }], [{ vehicle: 'b', odo: 2 }], [{ vehicle: 'c', odo: 3 }]]);
		const seen: string[] = [];
		await walkPages<Row>(src.fetchPage, (rows) => {
			seen.push(...rows.map((r) => r.vehicle));
			return seen.includes('c');
		});
		expect(src.fetchPage).toHaveBeenCalledTimes(3);
		expect(src.cursors).toEqual([undefined, 'c1', 'c2']);
		expect(seen).toEqual(['a', 'b', 'c']);
	});

	it('stops when a page comes back empty', async () => {
		const src = scriptedSource([[{ vehicle: 'a', odo: 1 }], []]);
		await walkPages<Row>(src.fetchPage, () => false);
		expect(src.fetchPage).toHaveBeenCalledTimes(2);
	});

	it('stops when has_more is false even if nothing resolved', async () => {
		const src = scriptedSource([[{ vehicle: 'a', odo: 1 }], [{ vehicle: 'b', odo: 2 }]], false);
		await walkPages<Row>(src.fetchPage, () => false);
		expect(src.fetchPage).toHaveBeenCalledTimes(1);
	});

	it('caps the walk at WALK_PAGE_CAP pages', async () => {
		const src = scriptedSource(Array.from({ length: WALK_PAGE_CAP + 3 }, () => [{ vehicle: 'a', odo: 1 }]));
		await walkPages<Row>(src.fetchPage, () => false);
		expect(src.fetchPage).toHaveBeenCalledTimes(WALK_PAGE_CAP);
	});

	it('forwards the requested page size and passes undefined cursor on the first page', async () => {
		const src = scriptedSource([[{ vehicle: 'a', odo: 1 }]]);
		let capturedLimit: number | undefined;
		const fetchPage = vi.fn((cursor?: string) => {
			capturedLimit = WALK_PAGE_SIZE;
			void cursor;
			return Promise.resolve({ data: [{ vehicle: 'a', odo: 1 }], meta: { has_more: false } });
		});
		await walkPages<Row>(fetchPage, () => true);
		expect(capturedLimit).toBe(WALK_PAGE_SIZE);
		expect(src.fetchPage).not.toHaveBeenCalled();
	});
});
