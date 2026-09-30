/**
 * AppShell — the sidebar slot.
 *
 * The shell gained a nullable `panel`: a destination that has NO tier-2 list of
 * its own (the API reference is one page) passes `null` and the sidebar column
 * disappears completely, instead of leaving an empty 14rem gutter next to the
 * rail. Everything else — the default nav lists, or a panel node — must still
 * render a sidebar, so this pins BOTH sides of the switch.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LayoutGrid } from 'lucide-react';

import { AppShell } from './index';

const DATA = {
	user: { name: 'Dev', email: 'dev@example.com', avatar: '' },
	// `icon` is mandatory on a Module — the header renders it as a component.
	modules: [{ name: 'IDP', icon: LayoutGrid }],
	navByModule: {},
};

function renderShell(panel?: React.ReactNode) {
	return render(
		<AppShell data={DATA} rail={<nav aria-label="Sections" />} panel={panel} breadcrumbs={[{ label: 'IDP' }, { label: 'Page' }]}>
			<main>content</main>
		</AppShell>,
	);
}

/** The `<li>` of the crumb with this label (the `hidden md:block` sits on the item). */
function crumbItem(label: string) {
	return Array.from(document.querySelectorAll('[data-slot="breadcrumb-item"]')).find(
		(li) => li.textContent?.trim() === label,
	);
}

describe('AppShell — sidebar slot', () => {
	it('drops the sidebar column entirely when `panel` is null', () => {
		renderShell(null);

		expect(document.querySelector('[data-slot="sidebar"]')).toBeNull();
		expect(document.querySelector('[data-slot="sidebar-gap"]')).toBeNull();
		// Without a sidebar there is nothing for the mobile trigger to open.
		expect(document.querySelector('[data-slot="sidebar-trigger"]')).toBeNull();
		expect(screen.getByText('content')).toBeTruthy();
		expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy();
		// …and the parent crumb stays visible below `md` as the way back out, so
		// its separator must not be hidden there either.
		expect(crumbItem('IDP')?.className ?? '').not.toContain('hidden');
		expect(document.querySelector('[data-slot="breadcrumb-separator"]')?.className).not.toContain('hidden');
	});

	it('keeps the sidebar (and the mobile trigger) when a panel is given', () => {
		renderShell(<div>Panel body</div>);

		expect(document.querySelector('[data-slot="sidebar-gap"]')).toBeTruthy();
		expect(document.querySelector('[data-slot="sidebar-trigger"]')).toBeTruthy();
		expect(screen.getByText('Panel body')).toBeTruthy();
		// The mobile Sheet replaces the crumbs as the route to the parent.
		expect(crumbItem('IDP')?.className ?? '').toContain('hidden');
		expect(document.querySelector('[data-slot="breadcrumb-separator"]')?.className).toContain('hidden');
	});

	it('keeps the sidebar (with its default nav lists) when `panel` is omitted', () => {
		renderShell(undefined);

		expect(document.querySelector('[data-slot="sidebar-gap"]')).toBeTruthy();
		expect(screen.queryByText('Panel body')).toBeNull();
	});
});

/**
 * The chrome switches — a destination that owns the whole canvas renders
 * NEITHER the header row (crumbs + `headerChildren` + the fullscreen toggle) NOR
 * the footer. Both are opt-outs that default to on, so each case is pinned from
 * both sides: the flag drops the element, the default keeps it.
 */
describe('AppShell — header and footer switches', () => {
	const shell = (props: Partial<React.ComponentProps<typeof AppShell>> = {}) =>
		render(
			<AppShell data={DATA} breadcrumbs={[{ label: 'IDP' }, { label: 'API Docs' }]} {...props}>
				<main>content</main>
			</AppShell>,
		);

	it('drops the header row with `showHeader={false}` — crumbs, toggle and all', () => {
		shell({ showHeader: false });

		expect(document.querySelector('[data-slot="app-shell-header"]')).toBeNull();
		expect(document.querySelector('[data-slot="breadcrumb"]')).toBeNull();
		expect(document.querySelector('[data-slot="status-bar"]')).toBeTruthy();
		expect(screen.getByText('content')).toBeTruthy();
	});

	it('renders the header row by default — even with no crumbs to show', () => {
		shell({ breadcrumbs: [] });

		expect(document.querySelector('[data-slot="app-shell-header"]')).toBeTruthy();
	});

	it('drops the footer with `statusBar={null}`', () => {
		shell({ statusBar: null });

		expect(document.querySelector('[data-slot="status-bar"]')).toBeNull();
		expect(document.querySelector('[data-slot="app-shell-header"]')).toBeTruthy();
	});

	it('renders the default status bar when `statusBar` is omitted', () => {
		shell();

		expect(document.querySelector('[data-slot="status-bar"]')).toBeTruthy();
	});
});
