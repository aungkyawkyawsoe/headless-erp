// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LicenseRenewPage from './license-renew-page';
import type { TruckCurrentPermit } from '../data/types';

/**
 * The truck's renewal is its OWN page (`/app/licenses/:id/renew`) — full-screen,
 * with NO bottom toolbar, and the form mounts with the NATIVE Telegram
 * MainButton as its save (`nativeSubmit` default). The renew gate travels with
 * it: a still comfortably valid permit renders the locked notice and offers no
 * form at all, so a premature / duplicate renewal stays blocked.
 */

vi.mock('../data/api', () => ({
	fetchTruckIdentity: async () => ({ plate: '2Q-8386', brand: null, image: null }),
	fetchTruckCurrentPermit: async () => null,
	permitSummaryOf: (card: unknown) => card,
}));
// The form is stubbed down to the ONE contract this page owns: it is mounted with
// the native submit (no `nativeSubmit={false}` override).
vi.mock('../components/license-record-form', () => ({
	LicenseRecordForm: ({ nativeSubmit = true }: { nativeSubmit?: boolean }) => (
		<button type="button" data-native-submit={String(nativeSubmit)}>
			Save license
		</button>
	),
}));
vi.mock('@/shared/components/module-shell', () => ({
	ModuleShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/shared/save-feedback', () => ({ notifySaved: vi.fn() }));

const DUE: TruckCurrentPermit = { licenseNo: 'YGN-1', expiryDate: '2026-09-01', remainingDays: -5, tone: 'alert' };
const VALID: TruckCurrentPermit = { licenseNo: 'YGN-1', expiryDate: '2027-06-01', remainingDays: 250, tone: 'ok' };

function renderPage(current: TruckCurrentPermit | null) {
	const path = '/app/licenses/veh-1/renew';
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[{ pathname: path, state: { plate: '2Q-8386', current } }]}>
				<Routes>
					<Route path="/app/licenses/:id/renew" element={<LicenseRenewPage />} />
					{/* The post-save destination. */}
					<Route path="/app/licenses/:id" element={<div />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe('LicenseRenewPage — a dedicated, bar-free form page', () => {
	it('mounts the form with the NATIVE submit when renewal is due', () => {
		renderPage(DUE);
		const save = screen.getByRole('button', { name: 'Save license' });
		expect(save.getAttribute('data-native-submit')).toBe('true');
	});

	it('keeps a still-valid permit LOCKED — no form is offered', () => {
		renderPage(VALID);
		expect(screen.queryByRole('button', { name: 'Save license' })).toBeNull();
		expect(screen.getByText(/Renew within the last 30 days/)).toBeTruthy();
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
