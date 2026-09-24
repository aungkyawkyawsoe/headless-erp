import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { MRO_ITEM_NAMES_QUERY_KEY, MRO_SUPPLIERS_QUERY_KEY, dropMasterFromDirectory, upsertMasterDirectory } from './use-mro-masters';

/**
 * The write-through contract for the whole-set master directories: a writer
 * folds the server's own answer into the cache — one network round trip per
 * save, never a refetch to "see" the change (staleTime keeps the entry fresh).
 */
describe('master directory write-through', () => {
	it('inserts a created row sorted by name and leaves the entry fresh', () => {
		const qc = new QueryClient();
		// A fetch that must NOT be triggered by the write-through itself.
		const fetcher = vi.fn(async () => {
			throw new Error('refetch should not happen after a write-through');
		});
		qc.setQueryData(MRO_SUPPLIERS_QUERY_KEY, [
			{ id: 'a', name: 'Global Tyre' },
			{ id: 'c', name: 'MM Auto Parts' },
		]);

		upsertMasterDirectory(qc, MRO_SUPPLIERS_QUERY_KEY, { id: 'b', name: 'Kyaw Motors' });

		const rows = qc.getQueryData<{ id: string; name: string | null }[]>(MRO_SUPPLIERS_QUERY_KEY);
		expect(rows?.map((r) => r.name)).toEqual(['Global Tyre', 'Kyaw Motors', 'MM Auto Parts']);
		// setQueryData stamps dataUpdatedAt=now → inside staleTime → no mount refetch.
		expect(qc.getQueryState(MRO_SUPPLIERS_QUERY_KEY)?.isInvalidated).toBe(false);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('replaces a renamed row in place (matched by id)', () => {
		const qc = new QueryClient();
		qc.setQueryData(MRO_SUPPLIERS_QUERY_KEY, [
			{ id: 'a', name: 'Global Tyre' },
			{ id: 'c', name: 'MM Auto Parts' },
		]);

		upsertMasterDirectory(qc, MRO_SUPPLIERS_QUERY_KEY, { id: 'a', name: 'Global Tyre Co.' });

		const rows = qc.getQueryData<{ id: string; name: string | null }[]>(MRO_SUPPLIERS_QUERY_KEY);
		expect(rows?.map((r) => r.id)).toEqual(['a', 'c']);
	});

	it('drops a deleted row and tolerates an unknown id', () => {
		const qc = new QueryClient();
		qc.setQueryData(MRO_ITEM_NAMES_QUERY_KEY, [
			{ id: 'a', name: 'Bulb' },
			{ id: 'b', name: 'Clutch' },
		]);

		dropMasterFromDirectory(qc, MRO_ITEM_NAMES_QUERY_KEY, 'a');
		dropMasterFromDirectory(qc, MRO_ITEM_NAMES_QUERY_KEY, 'unknown');

		expect(qc.getQueryData(MRO_ITEM_NAMES_QUERY_KEY)).toEqual([{ id: 'b', name: 'Clutch' }]);
	});

	it('falls back to invalidation when the directory is not cached yet', () => {
		const qc = new QueryClient();
		const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);

		upsertMasterDirectory(qc, MRO_SUPPLIERS_QUERY_KEY, { id: 'b', name: 'Kyaw Motors' });

		expect(qc.getQueryData(MRO_SUPPLIERS_QUERY_KEY)).toBeUndefined();
		expect(spy).toHaveBeenCalledWith({ queryKey: MRO_SUPPLIERS_QUERY_KEY, refetchType: 'active' });
		spy.mockRestore();
	});
});
