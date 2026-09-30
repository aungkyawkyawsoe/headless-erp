/**
 * The module switcher — the sidebar header's picker button + its full-screen
 * module grid, which also owns the global ⌘K binding.
 *
 * A surface whose navigation does not include switching modules (a portal whose
 * domains live in a rail) passes `showModuleSwitcher: false`: the header row
 * disappears ENTIRELY and ⌘K is left unbound, so whoever owns the shortcut there
 * can use it. Both sides are pinned here, because the default must stay exactly
 * as it was for every other consumer — including the picker button, which is not
 * the same flag as `enableModuleShortcut`.
 */
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LayoutGrid } from 'lucide-react';

import { SidebarProvider } from '../sidebar';
import { AppShell } from './index';
import { SidebarHeader } from './sidebar-header';

const DATA = {
	user: { name: 'Dev', email: 'dev@example.com', avatar: '' },
	modules: [{ name: 'IDP', icon: LayoutGrid }],
	navByModule: {},
};

type HeaderFlags = { showModuleSwitcher?: boolean; enableModuleShortcut?: boolean };

function renderShell(sidebarHeaderProps?: HeaderFlags) {
	return render(
		<AppShell
			data={DATA}
			panel={<div>Panel body</div>}
			breadcrumbs={[{ label: 'Home' }]}
			sidebarProps={sidebarHeaderProps ? { sidebarHeaderProps } : undefined}
		>
			<main>content</main>
		</AppShell>,
	);
}

/** `SidebarHeader` is exported on its own, so its own guard is pinned too. */
function renderHeader(props: HeaderFlags) {
	return render(
		<SidebarProvider>
			<SidebarHeader modules={DATA.modules} activeModule={DATA.modules[0]} onModuleChange={() => {}} {...props} />
		</SidebarProvider>,
	);
}

/**
 * ⌘K — the shortcut `SidebarHeader` registers on `window`. Returns the event so
 * a test can tell whether the header CLAIMED the key (`preventDefault`), which
 * is the only observable difference between "binds no ⌘K" and "binds a ⌘K that
 * happens to render nothing".
 */
function pressCmdK() {
	const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true, bubbles: true });
	act(() => {
		window.dispatchEvent(event);
	});
	return event;
}

const header = () => document.querySelector('[data-slot="sidebar-header"]');
/** The switcher's own search bar — it portals to `document.body`. */
const switcherSearch = () => screen.queryByPlaceholderText('Search apps...');

describe('module switcher', () => {
	it('renders the picker and opens the full-screen grid on ⌘K by default', () => {
		renderShell();

		expect(header()).toBeTruthy();
		expect(screen.queryByText('IDP')).toBeTruthy();
		expect(switcherSearch()).toBeNull();

		expect(pressCmdK().defaultPrevented).toBe(true);

		expect(switcherSearch()).toBeTruthy();
	});

	it('renders no header row and binds no ⌘K when the switcher is off', () => {
		renderShell({ showModuleSwitcher: false });

		// The container carries its own padding, so it must go with the header.
		expect(header()).toBeNull();
		expect(screen.queryByText('IDP')).toBeNull();
		expect(screen.getByText('Panel body')).toBeTruthy();

		// The key is left to whoever owns it — the app's own palette.
		expect(pressCmdK().defaultPrevented).toBe(false);

		expect(switcherSearch()).toBeNull();
	});

	it('does the same for a consumer that renders SidebarHeader directly', () => {
		renderHeader({ showModuleSwitcher: false });

		expect(screen.queryByText('IDP')).toBeNull();
		expect(pressCmdK().defaultPrevented).toBe(false);

		expect(switcherSearch()).toBeNull();
	});

	it('keeps the picker when only the shortcut is disabled', () => {
		renderShell({ enableModuleShortcut: false });

		expect(header()).toBeTruthy();
		expect(screen.queryByText('IDP')).toBeTruthy();

		expect(pressCmdK().defaultPrevented).toBe(false);

		expect(switcherSearch()).toBeNull();
	});
});
