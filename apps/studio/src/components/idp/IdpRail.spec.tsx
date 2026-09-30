// @vitest-environment jsdom
/**
 * IdpRail — a rail click must never HIDE the panel.
 *
 * The rail used to toggle the panel when the clicked icon was the section you
 * were already in (the VS Code gesture). A real double-click lands its second
 * click on the now-active icon, so it navigated and then slid the whole nav
 * away — the "double click hides my nav" report. The contract now: EVERY click
 * leaves the panel open (expanding it if it was collapsed) and only navigates
 * when the section actually changes; collapsing stays an explicit act — ⌘/Ctrl+B
 * here, or the sidebar edge.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';

vi.mock('../../lib/use-me', () => ({ useMe: () => ({ isAdmin: true }) }));
vi.mock('../../lib/i18n', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('../ThemeToggle', () => ({ default: () => <span /> }));

import { SidebarProvider, useSidebar } from '@mmbix/design-system';
import IdpRail from './IdpRail';

/** Renders the two facts the assertions read: the provider's state + the route. */
function Probe() {
	const { state } = useSidebar();
	const { pathname } = useLocation();
	return (
		<>
			<span data-testid="state">{state}</span>
			<span data-testid="path">{pathname}</span>
		</>
	);
}

function renderRail(initial = '/idp') {
	return render(
		<MemoryRouter initialEntries={[initial]}>
			<SidebarProvider>
				<IdpRail token="dev-token" />
				<Probe />
			</SidebarProvider>
		</MemoryRouter>,
	);
}

const state = () => screen.getByTestId('state').textContent;
const path = () => screen.getByTestId('path').textContent;
const icon = (label: string) => screen.getByRole('button', { name: label });

beforeEach(() => {
	// The provider seeds from `sidebar_state`; a toggle in one test must not leak.
	document.cookie = 'sidebar_state=; path=/; max-age=0';
});

// The studio suite runs without vitest `globals`, so testing-library's own
// auto-cleanup is not registered — unmount between tests explicitly.
afterEach(() => cleanup());

describe('IdpRail — a click never hides the panel', () => {
	it('stays open when the same icon is clicked twice (the double-click report)', () => {
		renderRail();

		fireEvent.click(icon('Collections'));
		expect(path()).toBe('/idp/collections');
		expect(state()).toBe('expanded');

		// The second click of a double-click now hits the ACTIVE icon.
		fireEvent.click(icon('Collections'));
		expect(path()).toBe('/idp/collections');
		expect(state()).toBe('expanded');
	});

	it('re-expands a collapsed panel when the ACTIVE icon is clicked', () => {
		renderRail();
		fireEvent.keyDown(window, { key: 'b', metaKey: true });
		expect(state()).toBe('collapsed');

		fireEvent.click(icon('Overview'));

		expect(state()).toBe('expanded');
		expect(path()).toBe('/idp');
	});

	it('opens the panel when another section is picked while collapsed', () => {
		renderRail();
		fireEvent.keyDown(window, { key: 'b', metaKey: true });
		expect(state()).toBe('collapsed');

		fireEvent.click(icon('Catalog'));

		expect(state()).toBe('expanded');
		expect(path()).toBe('/idp/catalog');
	});
});
