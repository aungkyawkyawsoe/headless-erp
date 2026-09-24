// @vitest-environment jsdom
/**
 * CommandPalette — ⌘K open/close + filter, driven through a DOM.
 *
 * The filter itself is unit-tested (`command-palette.spec.ts`); this pins the
 * keyboard wiring (⌘K toggles, Esc closes) and that the static destinations
 * render.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../lib/api', () => ({ listModules: vi.fn() }));

import { listModules } from '../lib/api';
import { CommandPalette } from './CommandPalette';

const mockModules = vi.mocked(listModules) as unknown as Mock;

function renderPalette() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<CommandPalette token="tk" />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	mockModules.mockReset();
	mockModules.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe('CommandPalette', () => {
	it('is closed until ⌘K, then lists the static destinations', async () => {
		renderPalette();
		expect(screen.queryByRole('dialog')).toBeNull();
		fireEvent.keyDown(window, { key: 'k', metaKey: true });
		await screen.findByRole('dialog');
		expect(screen.getByText('Studio Admin')).toBeTruthy();
		expect(screen.getByText('API Docs')).toBeTruthy();
	});

	it('filters as you type', async () => {
		renderPalette();
		fireEvent.keyDown(window, { key: 'k', metaKey: true });
		const input = await screen.findByLabelText('Search commands');
		fireEvent.change(input, { target: { value: 'api' } });
		await waitFor(() => expect(screen.queryByText('Studio Admin')).toBeNull());
		expect(screen.getByText('API Docs')).toBeTruthy();
	});

	it('closes on Escape', async () => {
		renderPalette();
		fireEvent.keyDown(window, { key: 'k', metaKey: true });
		const input = await screen.findByLabelText('Search commands');
		fireEvent.keyDown(input, { key: 'Escape' });
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	});
});
