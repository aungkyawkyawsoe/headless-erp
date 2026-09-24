// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchKiosk } from './search-kiosk';

// The shell is chrome only — the kiosk body is the spec's subject.
vi.mock('@/shared/components/module-shell', () => ({ ModuleShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

interface Row {
	id: string;
	name: string;
}

const rows: Row[] = [
	{ id: 'a', name: 'Alpha' },
	{ id: 'b', name: 'Alpine' },
	{ id: 'c', name: 'Beta' },
];

const search = vi.fn(async (term: string) => rows.filter((row) => row.name.toLowerCase().includes(term.toLowerCase())));

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Render inside the app's providers (the kiosk reads the router). */
function renderKiosk() {
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter>
				<SearchKiosk<Row>
					title="Test"
					heading="Find it"
					placeholder="Enter term"
					inputLabel="term"
					search={search}
					queryKeyPrefix={['test']}
					staleTime={60_000}
					keyOf={(row) => row.id}
					primaryText={(row) => row.name}
					renderResult={(row) => <p key={row.id}>{row.name}</p>}
				/>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe('search kiosk (search-first, zero idle reads)', () => {
	beforeEach(() => {
		search.mockClear();
		qc.clear();
	});

	afterEach(cleanup);

	it('never fetches while idle', () => {
		renderKiosk();
		expect(screen.getByRole('combobox')).toBeTruthy();
		expect(screen.getByRole('search')).toBeTruthy();
		expect(search).not.toHaveBeenCalled();
	});

	it('fetches once per settled term and answers as a suggestion listbox, cached per term', async () => {
		renderKiosk();
		const combo = screen.getByRole('combobox');
		fireEvent.change(combo, { target: { value: 'alp' } });
		await waitFor(() => expect(search).toHaveBeenCalledTimes(1), { timeout: 2000 });
		const listbox = await screen.findByRole('listbox');
		expect(within(listbox).getAllByRole('option')).toHaveLength(2);

		// Retyping the SAME text (e.g. the browser re-emitting events) must not
		// re-read — the debounced term's answer is cached under its own key.
		fireEvent.change(combo, { target: { value: 'alp' } });
		await waitFor(() => expect(search).toHaveBeenCalledTimes(1), { timeout: 2000 });
		expect(qc.getQueryData(['test', 'search', 'alp'])).toEqual(rows.filter((r) => r.name.toLowerCase().includes('alp')));
	});

	it('answers a submitted term with ranked rows + matches line', async () => {
		renderKiosk();
		fireEvent.change(screen.getByRole('combobox'), { target: { value: 'alp' } });
		await waitFor(() => expect(search).toHaveBeenCalledTimes(1), { timeout: 3000 });
		fireEvent.submit(screen.getByRole('search'));
		await waitFor(() => expect(screen.getByText(/· alp/)).toBeTruthy(), { timeout: 3000 });
		expect(screen.getByText('Alpha')).toBeTruthy();
		expect(screen.queryByRole('listbox')).toBeNull(); // results stage, not suggestions
	});
});
