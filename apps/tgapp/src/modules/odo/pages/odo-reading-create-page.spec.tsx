// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import OdoReadingCreatePage from './odo-reading-create-page';

const VEHICLE = 'v1';

const mocks = vi.hoisted(() => ({
	fetchOdoCurrent: vi.fn(async () => ({ currentOdo: 120_000, latestOdoDate: '2026-09-21' })),
	fetchOdoFleetIdentity: vi.fn(async () => ({ plateNo: '5S-6467', brandLabel: 'NISSAN' })),
	createOdoLog: vi.fn(async () => ({ id: 'm1' })),
	useTelegramMainButton: vi.fn(() => true),
}));

vi.mock('../data/api', () => ({
	fetchOdoCurrent: mocks.fetchOdoCurrent,
	fetchOdoFleetIdentity: mocks.fetchOdoFleetIdentity,
	createOdoLog: mocks.createOdoLog,
}));
vi.mock('@/shared/platform/use-main-button', () => ({ useTelegramMainButton: mocks.useTelegramMainButton }));

// jsdom ships neither, and the design-system DatePicker touches both.
beforeAll(() => {
	if (!globalThis.ResizeObserver) {
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
	}
	if (!Element.prototype.getAnimations) {
		Element.prototype.getAnimations = () => [];
	}
	if (!window.matchMedia) {
		window.matchMedia = ((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		})) as unknown as typeof window.matchMedia;
	}
});

afterEach(cleanup);
beforeEach(() => {
	vi.clearAllMocks();
	mocks.useTelegramMainButton.mockReturnValue(true);
});

function renderPage() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[`/app/daily-odo/${VEHICLE}/reading/new`]}>
				<Routes>
					<Route path="/app/daily-odo/:id/reading/new" element={<OdoReadingCreatePage />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

/**
 * The record form is its OWN full page — the bottom toolbar never renders here
 * (only the vehicle page draws it), and the save is the NATIVE Telegram
 * MainButton: the in-page `FormSubmitBar` must NOT also render (never both, the
 * app-wide rule). When the native button is unavailable (Apple clients / plain
 * browser), the in-page fallback appears — inside a `gap-4` form, so the button
 * keeps its breathing room from the last field.
 */
describe('OdoReadingCreatePage — a separate page, native MainButton save', () => {
	it('requests a visible native Save reading button and renders no bottom toolbar or in-page duplicate', async () => {
		const { container } = renderPage();

		expect(await screen.findByLabelText('Odometer (km)')).toBeTruthy();
		expect(mocks.useTelegramMainButton).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'Save reading', disabled: true }));
		// `isMainButton` true → the in-page save bar renders nothing.
		expect(screen.queryByRole('button', { name: /save reading/i })).toBeNull();
		// The vehicle page's floating bar (search / count / + / history) belongs to
		// the vehicle page — this route must not draw it.
		expect(screen.queryByLabelText('Show the reading history')).toBeNull();
		expect(screen.queryByLabelText('Record a reading')).toBeNull();
		expect(container.querySelector('[class*="fixed inset-x-0"]')).toBeNull();
	});

	it('falls back to an in-page save button with breathing room from the fields', async () => {
		mocks.useTelegramMainButton.mockReturnValue(false);
		renderPage();

		const save = await screen.findByRole('button', { name: /save reading/i });
		expect(save.closest('form')?.className).toContain('gap-4');
	});
});
