// @vitest-environment jsdom
/**
 * CommandPalette — ⌘K open/close + filter, driven through a DOM.
 *
 * The filter itself is unit-tested (`command-palette.spec.ts`); this pins the
 * keyboard wiring (⌘K toggles, Esc closes), the static destinations, and the
 * dialog/listbox ARIA contract (activedescendant tracking + focus return).
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

	it('exposes a listbox of options with a tracked activedescendant', async () => {
		renderPalette();
		fireEvent.keyDown(window, { key: 'k', metaKey: true });
		const input = await screen.findByLabelText('Search commands');

		const listbox = screen.getByRole('listbox');
		expect(listbox).toBeTruthy();
		expect(input.getAttribute('aria-controls')).toBe(listbox.id);
		expect(input.getAttribute('role')).toBe('combobox');
		expect(input.getAttribute('aria-expanded')).toBe('true');

		const options = screen.getAllByRole('option');
		expect(options.length).toBe(4);
		// The input owns the selection: the first option is active to start.
		expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
		expect(options[0].getAttribute('aria-selected')).toBe('true');
		expect(options[1].getAttribute('aria-selected')).toBe('false');

		// ArrowDown moves the active option without moving DOM focus off the input.
		fireEvent.keyDown(input, { key: 'ArrowDown' });
		await waitFor(() => expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id));
		expect(options[1].getAttribute('aria-selected')).toBe('true');
		expect(document.activeElement).toBe(input);
	});

	it('returns focus to the trigger on close', async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={client}>
				<MemoryRouter>
					<button type="button">trigger</button>
					<CommandPalette token="tk" />
				</MemoryRouter>
			</QueryClientProvider>,
		);
		const trigger = screen.getByText('trigger');
		trigger.focus();
		expect(document.activeElement).toBe(trigger);

		fireEvent.keyDown(window, { key: 'k', metaKey: true });
		const input = await screen.findByLabelText('Search commands');
		await waitFor(() => expect(document.activeElement).toBe(input));

		fireEvent.keyDown(input, { key: 'Escape' });
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(trigger));
	});
});
