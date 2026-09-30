/**
 * SidebarProvider — the pin (`collapsible: false`).
 *
 * A shell whose sidebar IS the navigation can decide it never hides: every
 * collapse path — the ⌘/Ctrl+B shortcut and the edge strip's click — is dead in
 * that mode, and even a stale `sidebar_state=false` cookie cannot boot it
 * collapsed. This pins BOTH sides of the switch, because the default must stay
 * exactly as it was for every other consumer.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { Sidebar, SidebarProvider, SidebarRail } from './index';

function Harness({ collapsible, resizable }: { collapsible?: boolean; resizable?: boolean }) {
	return (
		<SidebarProvider collapsible={collapsible} resizable={resizable}>
			<Sidebar>
				<SidebarRail />
			</Sidebar>
		</SidebarProvider>
	);
}

const sidebarState = () => document.querySelector('[data-slot="sidebar"]')?.getAttribute('data-state');
const rail = () => document.querySelector('[data-slot="sidebar-rail"]');

/** ⌘/Ctrl+B — the shortcut the provider registers on `window`. */
function pressShortcut() {
	act(() => {
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true }));
	});
}

beforeEach(() => {
	document.cookie = 'sidebar_state=; path=/; max-age=0';
});

describe('SidebarProvider collapsible', () => {
	it('collapses on ⌘B by default (the pin must not change the default)', () => {
		render(<Harness />);
		expect(sidebarState()).toBe('expanded');

		pressShortcut();

		expect(sidebarState()).toBe('collapsed');
	});

	it('ignores ⌘B when pinned', () => {
		render(<Harness collapsible={false} />);

		pressShortcut();

		expect(sidebarState()).toBe('expanded');
	});

	it('ignores the edge strip click when pinned — the grip only resizes', () => {
		render(<Harness collapsible={false} resizable />);
		const grip = rail();
		expect(grip?.getAttribute('aria-label')).toBe('Resize sidebar');
		expect(grip?.getAttribute('title')).toBe('Drag to resize');

		fireEvent.click(grip as Element);

		expect(sidebarState()).toBe('expanded');
	});

	it('drops the edge strip entirely when pinned and not resizable', () => {
		render(<Harness collapsible={false} />);

		expect(rail()).toBeNull();
	});

	it('boots expanded despite a stale `sidebar_state=false` cookie', () => {
		document.cookie = 'sidebar_state=false; path=/';

		render(<Harness collapsible={false} />);

		expect(sidebarState()).toBe('expanded');
	});

	it('still honours the cookie when not pinned', () => {
		document.cookie = 'sidebar_state=false; path=/';

		render(<Harness />);

		expect(sidebarState()).toBe('collapsed');
	});
});
