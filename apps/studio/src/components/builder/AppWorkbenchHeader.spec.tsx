// @vitest-environment jsdom
/**
 * AppWorkbenchHeader + the app workbench's mode routing.
 *
 * Two halves:
 *   • the switcher itself — the active mode is exposed to assistive tech
 *     (`aria-current`, not colour alone), and a pick reports the chosen mode;
 *   • the routing contract — the header wired to the REAL `useAppSectionRoute`
 *     hook (the same one AppDetailPage calls) navigates to the canonical mode
 *     PATH, and a bare `/apps/:slug` canonicalises to the default mode.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@mmbix/design-system';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppWorkbenchHeader } from './AppWorkbenchHeader';
import { useAppSectionRoute } from '../../lib/use-app-section-route';
import type { ModuleDetail } from '../../lib/api';

afterEach(cleanup);

const MOD = {
	id: 'm1',
	slug: 'orders',
	name: 'Orders',
	icon: 'lucide:box',
	is_active: 1,
	collections: [],
} as unknown as ModuleDetail;

type HeaderProps = ComponentProps<typeof AppWorkbenchHeader>;

function renderHeader(props: Partial<HeaderProps> = {}) {
	const merged: HeaderProps = {
		mod: MOD,
		section: 'models',
		hasSelectedModel: false,
		view: 'schema',
		onSectionChange: vi.fn(),
		onViewChange: vi.fn(),
		onManage: vi.fn(),
		...props,
	};
	render(
		<ThemeProvider defaultTheme="light">
			<MemoryRouter initialEntries={['/apps/orders/models']}>
				<AppWorkbenchHeader {...merged} />
			</MemoryRouter>
		</ThemeProvider>,
	);
	return merged;
}

const modeButton = (name: string) => screen.getByRole('button', { name });
const path = () => screen.getByTestId('path').textContent;

/** The header wired to the real routing hook, inside the real route shape. */
function Workbench({ slug }: { slug: string }) {
	const { section, setSection } = useAppSectionRoute(slug);
	return (
		<>
			<AppWorkbenchHeader
				mod={MOD}
				section={section}
				hasSelectedModel={false}
				view="schema"
				onSectionChange={setSection}
				onViewChange={vi.fn()}
				onManage={vi.fn()}
			/>
			<LocationProbe />
		</>
	);
}

function LocationProbe() {
	return <span data-testid="path">{useLocation().pathname}</span>;
}

function renderWorkbench(initialPath: string) {
	render(
		<ThemeProvider defaultTheme="light">
			<MemoryRouter initialEntries={[initialPath]}>
				<Routes>
					<Route path="/apps/:slug/*" element={<Workbench slug="orders" />} />
				</Routes>
			</MemoryRouter>
		</ThemeProvider>,
	);
}

describe('AppWorkbenchHeader — mode switcher', () => {
	it('renders one tab per mode, marking only the active mode for assistive tech', () => {
		renderHeader({ section: 'models' });
		for (const name of ['models', 'menus', 'pages']) expect(modeButton(name)).toBeTruthy();
		expect(modeButton('models').getAttribute('aria-current')).toBe('page');
		expect(modeButton('menus').getAttribute('aria-current')).toBeNull();
		expect(modeButton('pages').getAttribute('aria-current')).toBeNull();
	});

	it('moves the active marker with the active mode', () => {
		renderHeader({ section: 'menus' });
		expect(modeButton('menus').getAttribute('aria-current')).toBe('page');
		expect(modeButton('models').getAttribute('aria-current')).toBeNull();
	});

	it('reports the mode the operator picked', () => {
		const { onSectionChange } = renderHeader({ section: 'models' });
		fireEvent.click(modeButton('pages'));
		expect(onSectionChange).toHaveBeenCalledWith('pages');
	});
});

describe('AppWorkbenchHeader — view toggle', () => {
	it('is hidden until a collection is focused, then reflects the active view', () => {
		renderHeader({ section: 'models', hasSelectedModel: false });
		expect(screen.queryByRole('button', { name: 'Table view' })).toBeNull();

		cleanup();
		renderHeader({ section: 'models', hasSelectedModel: true, view: 'table' });
		expect(screen.getByRole('button', { name: 'Table view' }).getAttribute('aria-pressed')).toBe('true');
		expect(screen.getByRole('button', { name: 'Schema view' }).getAttribute('aria-pressed')).toBe('false');
	});

	it('is not offered outside the models mode', () => {
		renderHeader({ section: 'menus', hasSelectedModel: true });
		expect(screen.queryByRole('button', { name: 'Table view' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Schema view' })).toBeNull();
	});

	it('reports the view the operator picked', () => {
		const { onViewChange } = renderHeader({ section: 'models', hasSelectedModel: true, view: 'schema' });
		fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
		expect(onViewChange).toHaveBeenCalledWith('table');
	});
});

describe('AppWorkbenchHeader — identity', () => {
	it('offers a back control labelled for a plain app', () => {
		renderHeader();
		expect(screen.getByRole('button', { name: 'Back to apps' })).toBeTruthy();
		expect(screen.getByText('Orders')).toBeTruthy();
	});

	it('always surfaces the theme toggle (the workbench has no account menu)', () => {
		renderHeader();
		expect(screen.getByRole('button', { name: /switch to (dark|light) mode/i })).toBeTruthy();
	});

	it('reports the Manage action', () => {
		const { onManage } = renderHeader();
		fireEvent.click(screen.getByRole('button', { name: /manage/i }));
		expect(onManage).toHaveBeenCalled();
	});
});

describe('mode routing (header wired to useAppSectionRoute)', () => {
	it('canonicalises a bare /apps/:slug to the default mode', async () => {
		renderWorkbench('/apps/orders');
		await waitFor(() => expect(path()).toBe('/apps/orders/models'));
		expect(modeButton('models').getAttribute('aria-current')).toBe('page');
	});

	it('self-heals an unknown mode segment to the default mode', async () => {
		renderWorkbench('/apps/orders/nonsense');
		await waitFor(() => expect(path()).toBe('/apps/orders/models'));
	});

	it('navigates to the canonical mode PATH when the operator switches mode', async () => {
		renderWorkbench('/apps/orders/models');
		fireEvent.click(modeButton('menus'));
		await waitFor(() => expect(path()).toBe('/apps/orders/menus'));
		expect(modeButton('menus').getAttribute('aria-current')).toBe('page');

		// …and back again — a mode switch is symmetric and each target owns its path.
		fireEvent.click(modeButton('models'));
		await waitFor(() => expect(path()).toBe('/apps/orders/models'));
	});
});
