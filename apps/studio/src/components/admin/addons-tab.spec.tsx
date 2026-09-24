// @vitest-environment jsdom
/**
 * AddonsTab — the Studio's runtime install/remove surface, driven through a DOM.
 *
 * Pins the wiring: the catalog renders with its install state, and clicking
 * Install/Remove calls the `/api/addons` action for the RIGHT id (so a rename
 * cannot silently hit the wrong add-on).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../../lib/api', () => ({
	listAddons: vi.fn(),
	installAddon: vi.fn(),
	uninstallAddon: vi.fn(),
}));

import { installAddon, listAddons, uninstallAddon } from '../../lib/api';
import { AddonsTab } from './addons-tab';

const mockList = vi.mocked(listAddons) as unknown as Mock;
const mockInstall = vi.mocked(installAddon) as unknown as Mock;
const mockUninstall = vi.mocked(uninstallAddon) as unknown as Mock;

const CATALOG = {
	addons: [
		{
			id: 'idp',
			name: 'Internal Developer Platform',
			version: '1.0.0',
			scope: 'domain' as const,
			available: true,
			installed: true,
			depends: [],
			provides: [],
			requires: [],
			extends: [],
		},
		{
			id: 'crm',
			name: 'CRM',
			version: '1.0.0',
			scope: 'domain' as const,
			available: true,
			installed: false,
			depends: ['idp'],
			provides: [],
			requires: [],
			extends: [],
		},
	],
	issues: [],
};

function renderTab() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<AddonsTab token="tk" />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	mockList.mockReset();
	mockInstall.mockReset();
	mockUninstall.mockReset();
	mockList.mockResolvedValue(CATALOG);
	mockInstall.mockResolvedValue(CATALOG);
	mockUninstall.mockResolvedValue(CATALOG);
});

afterEach(() => cleanup());

describe('AddonsTab', () => {
	it('renders the catalog with each add-on install state', async () => {
		renderTab();
		await screen.findByText('Internal Developer Platform');
		expect(screen.getByText('installed')).toBeTruthy();
		expect(screen.getByText('not installed')).toBeTruthy();
		// The dependency is stated for the uninstalled add-on.
		expect(screen.getByText(/needs: idp/)).toBeTruthy();
	});

	it('Remove calls uninstall for the right id', async () => {
		renderTab();
		await screen.findByText('Internal Developer Platform');
		const remove = screen.getByRole('button', { name: /Remove/i });
		fireEvent.click(remove);
		await waitFor(() => expect(mockUninstall).toHaveBeenCalledWith('tk', 'idp'));
	});

	it('Install calls install for the right id', async () => {
		renderTab();
		await screen.findByText('CRM');
		const install = screen.getByRole('button', { name: /Install/i });
		fireEvent.click(install);
		await waitFor(() => expect(mockInstall).toHaveBeenCalledWith('tk', 'crm'));
	});
});
