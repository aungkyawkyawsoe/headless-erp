// @vitest-environment jsdom
/**
 * useCollectionRecords — the shared row surface for the Studio's two data views.
 *
 * This pins the behaviour that made the two copies worth collapsing into one:
 * the write gate (a service/append-only collection is refused BEFORE any request)
 * and the frozen-row partition (a `freeze_when` row is skipped so one frozen row
 * cannot fail a whole batch). Both are correctness rules, not cosmetics — so they
 * get a test now that a single implementation serves both surfaces.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('./api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./api')>();
	return { ...actual, bulkDelete: vi.fn(), bulkRestore: vi.fn(), bulkErrorMessage: vi.fn(() => '') };
});
vi.mock('@mmbix/design-system', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@mmbix/design-system')>();
	return { ...actual, confirmDialog: vi.fn(async () => true) };
});

import { bulkDelete, bulkErrorMessage, bulkRestore, type EntitySchema } from './api';
import { confirmDialog } from '@mmbix/design-system';
import { useCollectionRecords } from './use-collection-records';
import { writeLockOf, type CollectionWriteLock } from './write-lock';

const mockDelete = vi.mocked(bulkDelete) as unknown as Mock;
const mockRestore = vi.mocked(bulkRestore) as unknown as Mock;
const mockBulkError = vi.mocked(bulkErrorMessage) as unknown as Mock;
const mockConfirm = vi.mocked(confirmDialog) as unknown as Mock;

afterEach(cleanup);
beforeEach(() => {
	vi.clearAllMocks();
	mockDelete.mockResolvedValue([] as never);
	mockRestore.mockResolvedValue([] as never);
	mockBulkError.mockReturnValue('' as never);
});

/** A schema carrying only the write policy under test. */
function schemaWith(writes: unknown): EntitySchema {
	return {
		id: '1',
		name: 'Orders',
		slug: 'orders',
		table_name: 'cms_orders',
		schema_json: { fields: [], policies: { writes } },
	} as unknown as EntitySchema;
}

const OPEN_LOCK = writeLockOf(schemaWith(undefined));
/** Generically writable, but a row whose doc_status is `confirmed` is frozen. */
const FREEZING_LOCK = writeLockOf(schemaWith({ freeze_when: { field: 'doc_status', values: ['confirmed'] } }));
const SERVICE_LOCK = writeLockOf(schemaWith({ mode: 'service' }));

const DRAFT = { id: 'a', doc_status: 'draft' };
const CONFIRMED = { id: 'b', doc_status: 'confirmed' };

function Probe({
	lock,
	selected = 'orders',
	rows,
	onError,
	refreshRows,
}: {
	lock: CollectionWriteLock;
	selected?: string | null;
	rows: Record<string, unknown>[];
	onError: (m: string | null) => void;
	refreshRows: (slug: string | null | undefined) => void | Promise<void>;
}) {
	const records = useCollectionRecords({
		token: 'tk',
		selected,
		fields: [],
		m2oSchemas: {},
		writeLock: lock,
		trashMode: false,
		refreshRows,
		onError,
	});
	return (
		<div>
			<span data-testid="selected">{records.selectedRows.length}</span>
			<button type="button" onClick={() => records.setSelectedRows(rows)}>
				select
			</button>
			<button type="button" onClick={() => void records.deleteRows(records.selectedRows)}>
				delete
			</button>
			<button type="button" onClick={() => void records.restoreRows(records.selectedRows)}>
				restore
			</button>
		</div>
	);
}

function renderProbe(over: Partial<Parameters<typeof Probe>[0]> = {}) {
	const onError = vi.fn();
	const refreshRows = vi.fn();
	const props = { lock: OPEN_LOCK, rows: [DRAFT], onError, refreshRows, ...over };
	render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<Probe {...props} />
		</QueryClientProvider>,
	);
	return { onError, refreshRows };
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('useCollectionRecords — selection', () => {
	it('round-trips the row selection the table reports', async () => {
		renderProbe({ rows: [DRAFT, CONFIRMED] });
		expect(screen.getByTestId('selected').textContent).toBe('0');
		click('select');
		await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('2'));
	});
});

describe('useCollectionRecords — delete', () => {
	it('deletes only the writable rows, skipping the frozen ones, then refreshes', async () => {
		const { onError, refreshRows } = renderProbe({ lock: FREEZING_LOCK, rows: [DRAFT, CONFIRMED] });
		click('select');
		click('delete');
		await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(1));
		// The frozen row never reaches the API — only the draft id does.
		expect(mockDelete).toHaveBeenCalledWith('tk', 'orders', ['a']);
		expect(refreshRows).toHaveBeenCalledWith('orders');
		// The skip is reported (not silently dropped).
		expect(onError).toHaveBeenCalledWith(expect.stringContaining('1 row skipped'));
	});

	it('refuses a service-owned collection before any request', async () => {
		const { onError, refreshRows } = renderProbe({ lock: SERVICE_LOCK });
		click('select');
		click('delete');
		await waitFor(() => expect(onError).toHaveBeenCalled());
		expect(mockConfirm).not.toHaveBeenCalled();
		expect(mockDelete).not.toHaveBeenCalled();
		expect(refreshRows).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledWith(expect.stringContaining('domain service'));
	});

	it('refuses when EVERY selected row is frozen', async () => {
		const { onError } = renderProbe({ lock: FREEZING_LOCK, rows: [CONFIRMED] });
		click('select');
		click('delete');
		await waitFor(() => expect(onError).toHaveBeenCalled());
		expect(mockDelete).not.toHaveBeenCalled();
	});

	it('does nothing when the operator declines the confirm', async () => {
		mockConfirm.mockResolvedValue(false as never);
		const { refreshRows } = renderProbe({ lock: OPEN_LOCK, rows: [DRAFT] });
		click('select');
		click('delete');
		await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
		expect(mockDelete).not.toHaveBeenCalled();
		expect(refreshRows).not.toHaveBeenCalled();
	});
});

describe('useCollectionRecords — restore', () => {
	it('restores only the writable rows', async () => {
		const { onError, refreshRows } = renderProbe({ lock: FREEZING_LOCK, rows: [DRAFT, CONFIRMED] });
		click('select');
		click('restore');
		await waitFor(() => expect(mockRestore).toHaveBeenCalledTimes(1));
		expect(mockRestore).toHaveBeenCalledWith('tk', 'orders', ['a']);
		expect(refreshRows).toHaveBeenCalledWith('orders');
		expect(onError).toHaveBeenCalledWith(expect.stringContaining('1 row skipped'));
	});

	it('refuses when the collection cannot be written', async () => {
		const { onError } = renderProbe({ lock: SERVICE_LOCK });
		click('select');
		click('restore');
		await waitFor(() => expect(onError).toHaveBeenCalled());
		expect(mockRestore).not.toHaveBeenCalled();
	});
});

describe('useCollectionRecords — fetch', () => {
	it('short-circuits with an empty page when no collection is focused', async () => {
		// Distinctive: with no selection there is no request at all — the fetch must
		// resolve to an empty page rather than reaching the API.
		let result: { rows: unknown[]; nextCursor: unknown } | null = null;
		function FetchProbe() {
			const records = useCollectionRecords({
				token: 'tk',
				selected: null,
				fields: [],
				m2oSchemas: {},
				writeLock: OPEN_LOCK,
				trashMode: false,
				refreshRows: vi.fn(),
				onError: vi.fn(),
			});
			return (
				<button
					type="button"
					onClick={() => {
						void records.fetchData({ pagination: { pageSize: 25, pageIndex: 0 } } as never).then((r) => (result = r as never));
					}}
				>
					fetch
				</button>
			);
		}
		render(
			<QueryClientProvider client={new QueryClient()}>
				<FetchProbe />
			</QueryClientProvider>,
		);
		fireEvent.click(screen.getByRole('button', { name: 'fetch' }));
		await waitFor(() => expect(result).not.toBeNull());
		expect(result!.rows).toEqual([]);
		expect(result!.nextCursor).toBeNull();
	});
});
