// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MaintenanceLogForm } from './maintenance-log-form';

const mocks = vi.hoisted(() => ({
	createMaintenanceLog: vi.fn(async () => ({ id: 'log-1' })),
	updateMaintenanceLog: vi.fn(async () => ({ id: 'log-1' })),
	fetchIssueTypesSearch: vi.fn(async () => []),
	searchEmployees: vi.fn(async () => []),
	useTelegramMainButton: vi.fn(() => false),
}));

vi.mock('../data/api', () => ({
	createMaintenanceLog: mocks.createMaintenanceLog,
	updateMaintenanceLog: mocks.updateMaintenanceLog,
	fetchIssueTypesSearch: mocks.fetchIssueTypesSearch,
	ISSUE_TYPES_STALE_MS: 1000,
}));
vi.mock('@/shared/lookups/api', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/shared/lookups/api')>()),
	searchEmployees: mocks.searchEmployees,
}));
// The native MainButton is captured (not exercised) — the form's own call is the
// contract: a bottom sheet must tuck it away while it covers the button.
vi.mock('@/shared/platform/use-main-button', () => ({ useTelegramMainButton: mocks.useTelegramMainButton }));

// jsdom ships neither, and the design-system Sheet / DatePicker touch both.
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
	mocks.useTelegramMainButton.mockReturnValue(false);
});

function renderForm() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<MaintenanceLogForm vehicleId="v1" onSaved={() => {}} />
		</QueryClientProvider>,
	);
}

/**
 * The driver picker is a bottom sheet, and the native Telegram MainButton is
 * drawn by the client OVER the WebView's bottom edge — left visible it sits on
 * top of the sheet. Opening the driver sheet must hide it, and closing it must
 * bring the submit affordance back.
 */
describe('MaintenanceLogForm — the driver sheet tucks the native MainButton away', () => {
	it('hides the MainButton while the driver sheet is open and restores it on close', () => {
		renderForm();

		expect(mocks.useTelegramMainButton).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }));

		fireEvent.click(screen.getByRole('button', { name: 'Select a driver…' }));
		expect(mocks.useTelegramMainButton).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));

		fireEvent.click(screen.getByRole('button', { name: 'Done' }));
		expect(mocks.useTelegramMainButton).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }));
	});
});
