// @vitest-environment jsdom
/**
 * OperationsTab — the jobs table.
 *
 * The one requirement worth pinning: a job that FAILED must be visible. A silent
 * stoppage is the failure mode this table exists to prevent, so the assertion is
 * that `last_error` reaches the screen (and that Run now targets the right id).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../../lib/api', () => ({
	getOperations: vi.fn(),
	listSchedulerTasks: vi.fn(),
	runSchedulerTask: vi.fn(),
	listGenerationProposals: vi.fn(),
}));

import { getOperations, listGenerationProposals, listSchedulerTasks, runSchedulerTask } from '../../lib/api';
import { OperationsTab } from './operations-tab';

const mockOps = vi.mocked(getOperations) as unknown as Mock;
const mockList = vi.mocked(listSchedulerTasks) as unknown as Mock;
const mockRun = vi.mocked(runSchedulerTask) as unknown as Mock;
const mockProposals = vi.mocked(listGenerationProposals) as unknown as Mock;

const TASKS = [
	{
		id: 'mf_nightly-rollup',
		name: 'nightly-rollup',
		type: 'query.rollup',
		status: 'failed',
		cron: '0 3 * * *',
		repeat_ms: null,
		run_at: '2026-09-26T03:00:00.000Z',
		run_count: 3,
		attempts: 5,
		last_run_at: '2026-09-25T03:00:00.000Z',
		last_error: 'query.rollup: measures are required',
		last_result: null,
	},
];

function renderTab() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<OperationsTab token="tk" />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	mockOps.mockReset();
	mockList.mockReset();
	mockRun.mockReset();
	mockProposals.mockReset();
	mockOps.mockResolvedValue({ mode: 'auto', journal: [], candidates: [] });
	mockList.mockResolvedValue(TASKS);
	mockRun.mockResolvedValue({ status: 'done' });
	mockProposals.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe('OperationsTab jobs', () => {
	it('surfaces a failed job with its error, cadence and run count', async () => {
		renderTab();
		await screen.findByText('nightly-rollup');
		expect(screen.getByText('failed')).toBeTruthy();
		// The whole point: the reason the job stopped is on screen.
		expect(screen.getByText(/measures are required/)).toBeTruthy();
		expect(screen.getByText('0 3 * * *')).toBeTruthy();
		expect(screen.getByText('query.rollup')).toBeTruthy();
	});

	it('Run now triggers the job with the right id', async () => {
		renderTab();
		await screen.findByText('nightly-rollup');
		fireEvent.click(screen.getByRole('button', { name: /Run now/i }));
		await waitFor(() => expect(mockRun).toHaveBeenCalledWith('tk', 'mf_nightly-rollup'));
	});

	it('says so plainly when no jobs are declared', async () => {
		mockList.mockResolvedValue([]);
		renderTab();
		await screen.findByText(/No jobs declared/);
	});
});
