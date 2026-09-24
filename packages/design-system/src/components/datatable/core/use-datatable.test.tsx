/**
 * useDataTable — grouping + footer behavior.
 *
 * Grouping is driven by TanStack's row model (getGroupedRowModel). These specs
 * pin the DS contract: group rows appear when `enableGrouping` is set, group
 * values/counts are exposed, `aggregationFn` opts columns into subtotals, and
 * server-mode consumers receive the active `grouping` in FetchParams.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useDataTable } from './use-datatable';
import type { ColumnDef, FetchParams, FetchResult } from './types';

interface Sale {
	id: string;
	region: string;
	amount: number;
}

const columns: ColumnDef<Sale>[] = [
	{ id: 'id', accessorKey: 'id', header: 'ID', enableGrouping: false },
	{ id: 'region', accessorKey: 'region', header: 'Region' },
	{ id: 'amount', accessorKey: 'amount', header: 'Amount' },
];

const data: Sale[] = [
	{ id: '1', region: 'North', amount: 10 },
	{ id: '2', region: 'North', amount: 20 },
	{ id: '3', region: 'South', amount: 5 },
];

const baseProps = { columns, data, defaultPageSize: 10 } as const;

describe('useDataTable grouping', () => {
	it('exposes the uncontrolled grouping state', () => {
		const { result } = renderHook(() => useDataTable({ ...baseProps, enableGrouping: true, defaultGrouping: ['region'] }));
		expect(result.current.grouping).toEqual(['region']);
	});

	it('builds group rows with sub-rows when grouping is active', () => {
		const { result } = renderHook(() =>
			useDataTable({ ...baseProps, enableGrouping: true, defaultGrouping: ['region'], defaultExpandAll: true }),
		);

		const rows = result.current.table.getRowModel().rows;
		const groupRows = rows.filter((r) => r.getIsGrouped());
		expect(groupRows).toHaveLength(2);
		expect(groupRows[0].groupingColumnId).toBe('region');
		// Group value + child count
		expect(groupRows[0].getGroupingValue('region')).toBe('North');
		expect(groupRows[0].subRows).toHaveLength(2);
		expect(groupRows[1].getGroupingValue('region')).toBe('South');
		expect(groupRows[1].subRows).toHaveLength(1);

		// Leaves render below their group (expanded by defaultExpandAll)
		const leaves = rows.filter((r) => !r.getIsGrouped());
		expect(leaves).toHaveLength(3);
	});

	it('collapses children when groups are not expanded', () => {
		const { result } = renderHook(() => useDataTable({ ...baseProps, enableGrouping: true, defaultGrouping: ['region'] }));

		// No defaultExpandAll → only group rows visible
		const rows = result.current.table.getRowModel().rows;
		expect(rows.every((r) => r.getIsGrouped())).toBe(true);
	});

	it('aggregates opted-in columns on group rows (sum)', () => {
		const aggColumns = columns.map((c) => (c.id === 'amount' ? { ...c, aggregationFn: 'sum' as const } : c));
		const { result } = renderHook(() =>
			useDataTable({ ...baseProps, columns: aggColumns, enableGrouping: true, defaultGrouping: ['region'], defaultExpandAll: true }),
		);

		const [north] = result.current.table.getRowModel().rows.filter((r) => r.getIsGrouped());
		expect(north.getValue('amount')).toBe(30);
	});

	it('leaves non-aggregated columns blank on group rows', () => {
		const { result } = renderHook(() =>
			useDataTable({ ...baseProps, enableGrouping: true, defaultGrouping: ['region'], defaultExpandAll: true }),
		);

		const [north] = result.current.table.getRowModel().rows.filter((r) => r.getIsGrouped());
		// No aggregationFn → no implicit subtotal (TanStack 'auto' suppressed)
		expect(north.getValue('amount')).toBeUndefined();
	});

	it('honors ColumnDef.enableGrouping opt-out', () => {
		const { result } = renderHook(() => useDataTable({ ...baseProps, enableGrouping: true, defaultGrouping: ['region'] }));
		expect(result.current.table.getColumn('id')?.getCanGroup()).toBe(false);
		expect(result.current.table.getColumn('region')?.getCanGroup()).toBe(true);
	});

	it('passes the active grouping to server-mode fetchData', async () => {
		const fetchData = vi.fn(async (_params: FetchParams): Promise<FetchResult<Sale>> => ({ rows: [] }));
		renderHook(() => useDataTable({ ...baseProps, data: undefined, fetchData, enableGrouping: true, defaultGrouping: ['region'] }));

		await waitFor(() => {
			expect(fetchData).toHaveBeenCalled();
		});
		expect(fetchData.mock.calls[0][0].grouping).toEqual(['region']);
	});
});

describe('useDataTable toggleGrouping', () => {
	it('adds and removes columns from the grouping state', () => {
		const { result } = renderHook(() => useDataTable({ ...baseProps, enableGrouping: true }));
		act(() => result.current.toggleGrouping('region'));
		expect(result.current.grouping).toEqual(['region']);
		act(() => result.current.toggleGrouping('region'));
		expect(result.current.grouping).toEqual([]);
	});
});

describe('useDataTable cursor direction', () => {
	it('sends cursorDir "after" going forward and "before" going back', async () => {
		const fetchData = vi.fn(async (params: FetchParams): Promise<FetchResult<Sale>> =>
			params.cursor === 'n1' ? { rows: [...data], nextCursor: 'n2', prevCursor: 'p1' } : { rows: [...data], nextCursor: 'n1' },
		);
		const { result } = renderHook(() => useDataTable({ columns, data: undefined, defaultPageSize: 2, fetchData }));

		await waitFor(() => expect(fetchData).toHaveBeenCalledTimes(1));
		// First page carries no cursor and defaults to walking forward.
		expect(fetchData.mock.calls[0][0].cursor).toBeNull();
		expect(fetchData.mock.calls[0][0].cursorDir).toBe('after');

		await waitFor(() => expect(result.current.canGoNext).toBe(true));
		act(() => result.current.goToNextPage());
		await waitFor(() => expect(fetchData).toHaveBeenCalledTimes(2));
		expect(fetchData.mock.calls[1][0].cursor).toBe('n1');
		expect(fetchData.mock.calls[1][0].cursorDir).toBe('after');

		// The backward walk MUST tell the server to fetch the preceding page —
		// sending prevCursor with `after` would skip rows instead of paging back.
		await waitFor(() => expect(result.current.canGoPrevious).toBe(true));
		act(() => result.current.goToPrevPage());
		await waitFor(() => expect(fetchData).toHaveBeenCalledTimes(3));
		expect(fetchData.mock.calls[2][0].cursor).toBe('p1');
		expect(fetchData.mock.calls[2][0].cursorDir).toBe('before');
	});

	it('keeps Back/Next and the shown range on one committed snapshot, and blocks both mid-flight', async () => {
		// The offset is applied only when the fetch settles, so a page's range and
		// its cursors can never describe different pages (which read as "first AND
		// last" → both buttons disabled). While in flight neither button is
		// clickable, so a click can't use cursors from rows no longer on screen.
		const gates: Array<() => void> = [];
		const fetchData = vi.fn(async (params: FetchParams): Promise<FetchResult<Sale>> => {
			// Page 2 (forward from n1) — gated so we can observe the in-flight state.
			if (params.cursor === 'n1') {
				await new Promise<void>((r) => gates.push(r));
				return { rows: [...data], nextCursor: 'n2', prevCursor: 'p1' };
			}
			// Back to page 1 — the server confirms no previous page (the real API
			// withholds prev_cursor at the first page; see cursor-pagination.spec).
			if (params.cursor === 'p1') {
				return { rows: [...data], nextCursor: 'n1', prevCursor: null };
			}
			return { rows: [...data], nextCursor: 'n1' };
		});
		const { result } = renderHook(() => useDataTable({ columns, data: undefined, defaultPageSize: 2, fetchData }));

		await waitFor(() => expect(result.current.canGoNext).toBe(true));
		expect(result.current.canGoPrevious).toBe(false);
		expect(result.current.cursorFrom).toBe(0);

		act(() => result.current.goToNextPage());
		// In flight: both disabled, and the range has NOT advanced yet.
		await waitFor(() => expect(result.current.canGoNext).toBe(false));
		expect(result.current.canGoPrevious).toBe(false);
		expect(result.current.cursorFrom).toBe(0);

		await act(async () => {
			gates.shift()?.();
			await Promise.resolve();
		});

		// Settled on page 2 — range and cursors moved together.
		await waitFor(() => expect(result.current.cursorFrom).toBe(2));
		expect(result.current.canGoPrevious).toBe(true);
		expect(result.current.canGoNext).toBe(true);

		act(() => result.current.goToPrevPage());
		await waitFor(() => expect(result.current.cursorFrom).toBe(0));
		expect(result.current.canGoPrevious).toBe(false);
		expect(result.current.canGoNext).toBe(true);
	});
});

describe('useDataTable refreshKey', () => {
	it('reloads the CURRENT page without a remount (cursor/sort/filter preserved)', async () => {
		const fetchData = vi.fn(async (_params: FetchParams): Promise<FetchResult<Sale>> => ({ rows: [...data], nextCursor: 'n1' }));
		const { result, rerender } = renderHook(
			({ rk }: { rk: number }) => useDataTable({ columns, data: undefined, defaultPageSize: 2, fetchData, refreshKey: rk }),
			{
				initialProps: { rk: 0 },
			},
		);

		await waitFor(() => expect(fetchData).toHaveBeenCalledTimes(1));
		// The response must have been COMMITTED (nextCursor stored) before paging —
		// `toHaveBeenCalled` resolves on the mock call, not on the awaited result.
		await waitFor(() => expect(result.current.canGoNext).toBe(true));

		// Page forward — the fetch now carries the cursor.
		act(() => result.current.goToNextPage());
		await waitFor(() => expect(fetchData).toHaveBeenCalledTimes(2));
		expect(fetchData.mock.calls[1][0].cursor).toBe('n1');

		// A write bumps refreshKey: reload the SAME page. A remount would have
		// dropped the cursor and refetched page one instead.
		rerender({ rk: 1 });
		await waitFor(() => expect(fetchData).toHaveBeenCalledTimes(3));
		expect(fetchData.mock.calls[2][0].cursor).toBe('n1');
		expect(fetchData.mock.calls[2][0].pagination).toEqual(fetchData.mock.calls[1][0].pagination);
	});
});
