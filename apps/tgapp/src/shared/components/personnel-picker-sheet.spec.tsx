// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersonnelPickerSheet } from './personnel-picker-sheet';

/** The server-side directory lookup the sheet drives — captured to pin the scope. */
const { searchEmployees } = vi.hoisted(() => ({
	searchEmployees: vi.fn(async () => []),
}));

vi.mock('@/shared/lookups/api', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/shared/lookups/api')>()),
	searchEmployees,
}));

// jsdom ships neither, and the design-system Sheet's portal/animation path
// touches both. Both are inert here — the tests assert the query the sheet issues.
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
beforeEach(() => searchEmployees.mockClear());

function renderSheet(designationFilter?: string) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<PersonnelPickerSheet
				open
				onOpenChange={() => {}}
				value={[]}
				onToggle={() => {}}
				singleSelect
				designationFilter={designationFilter}
			/>
		</QueryClientProvider>,
	);
}

/**
 * The driver field's narrowing must be a SERVER-side scope, not a client filter:
 * the picker passes `designationContains` straight into the one lookup per term.
 */
describe('PersonnelPickerSheet — the designation scope', () => {
	it('scopes the lookup to drivers when `designationFilter` is set', async () => {
		renderSheet('driver');
		fireEvent.change(screen.getByLabelText('Search personnel'), { target: { value: 'aung' } });

		await waitFor(() => expect(searchEmployees).toHaveBeenCalledWith('aung', { designationContains: 'driver' }), {
			timeout: 2000,
		});
	});

	it('searches the whole directory when no filter is given (a crew / holder field)', async () => {
		renderSheet();
		fireEvent.change(screen.getByLabelText('Search personnel'), { target: { value: 'aung' } });

		await waitFor(() => expect(searchEmployees).toHaveBeenCalledWith('aung', { designationContains: undefined }), {
			timeout: 2000,
		});
	});
});
