// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TyreActionPage from './tyre-action-page';
import { fetchHolderAssets } from '../data/api';
import type { TyreCardModel } from '../data/types';

// The action bodies are separate units (each has its own behaviour to prove) — here
// they are markers. This file pins the PAGE: which section a route kind dispatches
// to, the app-bar title, and the empty states.
vi.mock('../components/tyre-detail-body', () => ({
	InspectSection: () => <div data-testid="inspect" />,
	MovePositionSection: () => <div data-testid="move" />,
}));
vi.mock('../components/tyre-action-sections', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../components/tyre-action-sections')>();
	return {
		...actual,
		// Echo the partner list so a test can prove WHO the page offered to swap with.
		SwapSection: ({ partners }: { partners: TyreCardModel[] }) => (
			<div data-testid="swap" data-partners={partners.map((p) => p.serialNo ?? p.id).join(',')} />
		),
		ScrapRequestSection: () => <div data-testid="scrap" />,
		UnseatSection: () => <div data-testid="unseat" />,
	};
});
vi.mock('../data/api', () => ({ fetchHolderAssets: vi.fn() }));
vi.mock('@/modules/asset-transfers/components/transfer-request-section', () => ({
	TransferRequestSection: ({ tyre }: { tyre: TyreCardModel }) => <div data-testid="transfer" data-serial={tyre.serialNo ?? ''} />,
}));
vi.mock('@/shared/components/module-shell', () => ({
	ModuleShell: ({ title, children }: { title: string; children: ReactNode }) => (
		<div data-testid="shell" data-title={title}>
			{children}
		</div>
	),
}));

afterEach(cleanup);

function unit(over: Partial<TyreCardModel> & { id: string }): TyreCardModel {
	return {
		kind: 'tyre',
		modelName: 'R268',
		serialNo: 'BR-9902',
		status: 'issued',
		itemNameEn: null,
		itemNameMm: null,
		plateNo: '5S-6467',
		slot: null,
		employeeId: null,
		employeeName: null,
		locationLabel: null,
		treadMm: 8,
		psi: null,
		condition: null,
		referenceTreadMm: null,
		...over,
	};
}

const TYRE = unit({ id: 'w1', slot: 'RL1-O' });
const PEER = unit({ id: 'w2', serialNo: 'MX-4410', slot: 'RL1-I' });
/** Fitted to a DIFFERENT truck — never a swap partner, whatever the read returns. */
const OTHER_TRUCK = unit({ id: 'w3', serialNo: 'GY-8812', plateNo: 'TRK-Y', slot: 'RL1-O' });
/** Riding THIS truck but off every wheel (the tray) — nothing to exchange with. */
const SPARE = unit({ id: 'w4', serialNo: 'BS-1123', slot: null });

function renderPage(path: string) {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={[path]}>
				<Routes>
					<Route path="/app/tyres/vehicle/:id/action/:kind/:tyreId" element={<TyreActionPage />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

const pathFor = (kind: string, tyreId = 'w1') => `/app/tyres/vehicle/v1/action/${kind}/${tyreId}`;

describe('TyreActionPage — the full-screen wheel action', () => {
	it.each([
		['inspect', 'Record inspection'],
		['move', 'Move to a wheel position'],
		['unseat', 'Take off wheel'],
		['scrap', 'Request write-off'],
		['transfer', 'Request a transfer'],
	])('dispatches %s to its section, titled in the app bar', async (kind, title) => {
		vi.mocked(fetchHolderAssets).mockResolvedValue([TYRE, PEER]);
		renderPage(pathFor(kind));

		expect((await screen.findByTestId(kind)).textContent).toBeDefined();
		expect(screen.getByTestId('shell').getAttribute('data-title')).toBe(title);
	});

	it('hands the governed transfer filer the unit the menu was opened on', async () => {
		vi.mocked(fetchHolderAssets).mockResolvedValue([TYRE, PEER]);
		renderPage(pathFor('transfer'));

		expect((await screen.findByTestId('transfer')).getAttribute('data-serial')).toBe('BR-9902');
	});

	it('offers the OTHER mounted tyres as swap partners — same truck ONLY', async () => {
		vi.mocked(fetchHolderAssets).mockResolvedValue([TYRE, PEER, OTHER_TRUCK, SPARE]);
		renderPage(pathFor('swap'));

		// The peer on this truck is offered; another truck's wheel and a tray spare are not.
		expect((await screen.findByTestId('swap')).getAttribute('data-partners')).toBe('MX-4410');
	});

	it('shows the no-partner empty state when it is the only mounted tyre', async () => {
		vi.mocked(fetchHolderAssets).mockResolvedValue([TYRE, SPARE, OTHER_TRUCK]);
		renderPage(pathFor('swap'));

		expect(await screen.findByText('No other tyre to swap')).toBeTruthy();
		expect(screen.queryByTestId('swap')).toBeNull();
	});

	it('rejects an unknown action route', async () => {
		vi.mocked(fetchHolderAssets).mockResolvedValue([TYRE]);
		renderPage(pathFor('teleport'));

		expect(await screen.findByText('Unknown action')).toBeTruthy();
	});

	it('reports a tyre that is no longer on this truck’s register', async () => {
		vi.mocked(fetchHolderAssets).mockResolvedValue([PEER]);
		renderPage(pathFor('unseat', 'w1'));

		expect(await screen.findByText('Unit not on this truck')).toBeTruthy();
	});
});
