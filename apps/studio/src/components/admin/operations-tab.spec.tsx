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
	listCollections: vi.fn(),
	runIntegrity: vi.fn(),
}));

import { getOperations, listCollections, listGenerationProposals, listSchedulerTasks, runIntegrity, runSchedulerTask } from '../../lib/api';
import { OperationsTab } from './operations-tab';

const mockOps = vi.mocked(getOperations) as unknown as Mock;
const mockList = vi.mocked(listSchedulerTasks) as unknown as Mock;
const mockRun = vi.mocked(runSchedulerTask) as unknown as Mock;
const mockProposals = vi.mocked(listGenerationProposals) as unknown as Mock;
const mockCollections = vi.mocked(listCollections) as unknown as Mock;
const mockIntegrity = vi.mocked(runIntegrity) as unknown as Mock;

const COLLECTIONS = [
	{ id: 'c1', name: 'Invoices', slug: 'invoices' },
	{ id: 'c2', name: 'Suppliers', slug: 'suppliers' },
];

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
	mockCollections.mockReset();
	mockIntegrity.mockReset();
	mockOps.mockResolvedValue({ mode: 'auto', journal: [], candidates: [] });
	mockList.mockResolvedValue(TASKS);
	mockRun.mockResolvedValue({ status: 'done' });
	mockProposals.mockResolvedValue([]);
	mockCollections.mockResolvedValue(COLLECTIONS);
	mockIntegrity.mockResolvedValue({ enabled: false, checked: 0, violations: 0, results: [], errors: [] });
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

describe('OperationsTab integrity', () => {
	/** Click the section's Run button (there is no `Run now` — no jobs declared). */
	async function runIntegrityOnFirstCollection() {
		renderTab();
		// The picker defaults to the first collection ONCE the list loads; the Run
		// button is disabled until then, so wait for the option to appear.
		await screen.findByRole('option', { name: 'Invoices' });
		fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
	}

	it('treats an undeclared policy as a plain empty state, not an error', async () => {
		mockList.mockResolvedValue([]);
		mockIntegrity.mockResolvedValue({ enabled: false, checked: 0, violations: 0, results: [], errors: [] });
		await runIntegrityOnFirstCollection();
		await waitFor(() => expect(mockIntegrity).toHaveBeenCalledWith('tk', 'invoices'));
		expect(screen.getByText(/No integrity rules declared for this collection/)).toBeTruthy();
		// Deny-by-default is not a failure — no alarm role/colour is rendered.
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('renders a non-zero violation count from the declared rules', async () => {
		mockList.mockResolvedValue([]);
		mockIntegrity.mockResolvedValue({
			enabled: true,
			checked: 2,
			violations: 3,
			results: [
				{ rule: { type: 'duplicate', fields: ['code'] }, count: 3, truncated: true, rows: [{ code: 'A' }, { code: 'B' }, { code: 'C' }] },
				{ rule: { type: 'stale', field: 'updated_at', max_age_days: 30 }, count: 0, truncated: false, rows: [] },
			],
			errors: [],
		});
		await runIntegrityOnFirstCollection();
		// The headline: the violation total reaches the screen, with the rule labels.
		await screen.findByText('3 violations');
		expect(screen.getByText(/duplicate · code/)).toBeTruthy();
		expect(screen.getByText(/stale · updated_at older than 30d/)).toBeTruthy();
		expect(screen.getByText('2 rules checked')).toBeTruthy();
		expect(screen.getByText(/truncated — more rows exist/)).toBeTruthy();
	});

	it('shows a run failure instead of a clean report', async () => {
		mockList.mockResolvedValue([]);
		mockIntegrity.mockRejectedValue(new Error('Collection not found'));
		await runIntegrityOnFirstCollection();
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain('Collection not found');
	});
});
