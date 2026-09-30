// @vitest-environment jsdom
/**
 * ViewsPanel — the user directory's saved views as the shell's side panel, the
 * Directus sidebar shape, driven through a real DOM.
 *
 * Two contracts matter and are pinned here:
 *
 *   1. the rows ARE `USER_VIEWS` (labels, order, and the one the URL names is
 *      the marked one) — the panel cannot offer a view the table does not
 *      filter by, and
 *   2. picking a row writes `?view=` as VIEW STATE — a REPLACE, never a history
 *      entry (the Studio URL/history contract in lib/view-state.ts), with the
 *      default view written as the bare canonical URL.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import ViewsPanel from './ViewsPanel';

/** The panel is URL-backed — show what the router sees after each pick. */
function Probe() {
	const { search } = useLocation();
	const type = useNavigationType();
	return <span data-testid="url">{`${type}:${search}`}</span>;
}

function renderPanel(initialEntry = '/idp/users') {
	return render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<ViewsPanel title="Users" />
			<Probe />
		</MemoryRouter>,
	);
}

const row = (name: string) => screen.getByRole('button', { name });

afterEach(() => cleanup());

describe('ViewsPanel', () => {
	it("lists the views in the registry's order — Directus's sidebar", () => {
		renderPanel();
		const rows = screen.getAllByRole('button').map((b) => b.textContent);
		expect(rows).toEqual(['Active Users', 'Suspended Users', 'Invited Users', 'All Users']);
	});

	it('marks the view the URL names, so a pasted link restores the view', () => {
		renderPanel();
		// A bare URL is the default view — Directus lands on Active Users.
		expect(row('Active Users').getAttribute('aria-current')).toBe('true');
		expect(row('Suspended Users').getAttribute('aria-current')).toBeNull();

		cleanup();
		renderPanel('/idp/users?view=invited');
		expect(row('Invited Users').getAttribute('aria-current')).toBe('true');
		expect(row('Active Users').getAttribute('aria-current')).toBeNull();
	});

	it('reads an out-of-vocabulary value as the default rather than marking nothing', () => {
		renderPanel('/idp/users?view=banana');
		expect(row('Active Users').getAttribute('aria-current')).toBe('true');
	});

	it('picking a view REPLACES the URL — a filter, never a new history entry', async () => {
		renderPanel();

		fireEvent.click(row('Suspended Users'));
		// REPLACE, not PUSH: the section keeps its ONE history entry, so the back
		// arrow still leaves Users in one press.
		await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('REPLACE:?view=suspended'));
		expect(row('Suspended Users').getAttribute('aria-current')).toBe('true');

		// Back to the default: the param is DELETED, not written — `/idp/users` is
		// the canonical URL for the Active view (the Directus landing).
		fireEvent.click(row('Active Users'));
		await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('REPLACE:'));
		expect(row('Active Users').getAttribute('aria-current')).toBe('true');
	});
});
