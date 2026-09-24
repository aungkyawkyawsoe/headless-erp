// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ListPage } from './list-page';

// The shell is chrome only (app bar + body) — the subject here is the list body.
vi.mock('@/shared/components/module-shell', () => ({
	ModuleShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// The toolbar search needs nuqs + URL state; the cap has nothing to do with it,
// so it is stubbed to a closed, empty search.
vi.mock('@/shared/hooks/use-bar-search', () => ({
	useBarSearch: () => ({
		query: '',
		open: false,
		button: <span />,
		panel: <span />,
		results: [],
		searching: false,
		error: false,
		clear: () => {},
	}),
}));

const ROWS = Array.from({ length: 400 }, (_, i) => ({ id: `r${i}` }));

beforeEach(() => {
	// LoadMoreSentinel / BottomActionBar touch these; the cap test passes no pagination.
	if (!globalThis.IntersectionObserver) {
		globalThis.IntersectionObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof IntersectionObserver;
	}
});

afterEach(cleanup);

function renderList() {
	return render(
		<MemoryRouter>
			<ListPage
				title="Rows"
				rows={ROWS}
				skeletonVariant="store-request"
				renderItem={(row) => <li key={row.id}>{row.id}</li>}
				emptyState={{ title: 'none', hint: 'none' }}
				searchPlaceholder="Search"
				fetchSearch={async () => []}
			/>
		</MemoryRouter>,
	);
}

/**
 * The bounded-DOM contract.
 *
 * Scrolling a large register used to append every loaded row to the DOM, so
 * layout + memory grew with N. The list now renders a fixed chunk and reveals
 * the rest on demand — this pins the cap AND the reveal so a future edit cannot
 * silently restore the unbounded render.
 */
describe('ListPage — bounded DOM', () => {
	it('renders only the first chunk of a large list, with a reveal control', () => {
		renderList();

		expect(screen.getByText('r0')).toBeTruthy();
		expect(screen.getByText('r299')).toBeTruthy();
		// Row 300 is NOT rendered yet.
		expect(screen.queryByText('r300')).toBeNull();

		const reveal = screen.getByRole('button', { name: /Show .* more/ });
		expect(reveal.textContent).toContain('100 left');
	});

	it('reveals the next chunk on tap, then the control disappears', () => {
		renderList();

		fireEvent.click(screen.getByRole('button', { name: /Show .* more/ }));

		expect(screen.getByText('r300')).toBeTruthy();
		expect(screen.getByText('r399')).toBeTruthy();
		// Nothing left to reveal — the control is gone.
		expect(screen.queryByRole('button', { name: /Show .* more/ })).toBeNull();
	});

	it('renders a short list in full, with no reveal control', () => {
		render(
			<MemoryRouter>
				<ListPage
					title="Rows"
					rows={ROWS.slice(0, 10)}
					skeletonVariant="store-request"
					renderItem={(row) => <li key={row.id}>{row.id}</li>}
					emptyState={{ title: 'none', hint: 'none' }}
					searchPlaceholder="Search"
					fetchSearch={async () => []}
				/>
			</MemoryRouter>,
		);

		expect(screen.getByText('r9')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Show .* more/ })).toBeNull();
	});
});

/**
 * The silent-failure contract — a FAILED first page must render the retry block,
 * never the "no records" empty state (the regression that made an outage read as
 * a lie). Pinned so a future edit cannot drop the `isError` branch.
 */
describe('ListPage — a failed read is not an empty list', () => {
	it('shows the retry block (not the empty state) when the first page fails', () => {
		const onRetry = vi.fn();
		render(
			<MemoryRouter>
				<ListPage
					title="Rows"
					rows={[] as { id: string }[]}
					isError
					onRetry={onRetry}
					skeletonVariant="store-request"
					renderItem={(row) => <li key={row.id}>{row.id}</li>}
					emptyState={{ title: 'No records yet', hint: 'Check back later.' }}
					searchPlaceholder="Search"
					fetchSearch={async () => []}
				/>
			</MemoryRouter>,
		);

		expect(screen.getByRole('alert').textContent).toContain('Could not load this list.');
		// The empty-state copy must NOT stand in for the failure.
		expect(screen.queryByText('No records yet')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: /try again/i }));
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it('shows the empty state when there is no error and no rows', () => {
		render(
			<MemoryRouter>
				<ListPage
					title="Rows"
					rows={[] as { id: string }[]}
					skeletonVariant="store-request"
					renderItem={(row) => <li key={row.id}>{row.id}</li>}
					emptyState={{ title: 'No records yet', hint: 'Check back later.' }}
					searchPlaceholder="Search"
					fetchSearch={async () => []}
				/>
			</MemoryRouter>,
		);

		expect(screen.getByText('No records yet')).toBeTruthy();
		expect(screen.queryByRole('alert')).toBeNull();
	});
});
