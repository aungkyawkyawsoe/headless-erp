// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RouteErrorBoundary } from './route-error';
import { reloadApp } from '@/shared/platform/reload';

vi.mock('@/shared/platform/reload', () => ({ reloadApp: vi.fn() }));

const GUARD_KEY = 'mmbix:chunk-reload-at';
const reload = vi.mocked(reloadApp);

function Boom({ error }: { error: Error }): never {
	throw error;
}

describe('RouteErrorBoundary', () => {
	beforeEach(() => {
		sessionStorage.clear();
		reload.mockClear();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	// React `lazy()` caches the rejected import for the page's lifetime, so the
	// old "Retry" button re-threw the same error — a dead control. The panel
	// must offer a full reload instead whenever the failure is a chunk/MIME one.
	// The guard is pre-set so componentDidCatch's own auto-reload is suppressed
	// (this asserts the PANEL's button alone).
	it('offers Reload — not the dead Retry — for a chunk-load error', () => {
		sessionStorage.setItem(GUARD_KEY, String(Date.now()));

		render(
			<RouteErrorBoundary>
				<Boom error={new Error('Failed to fetch dynamically imported module: /assets/x-abc.js')} />
			</RouteErrorBoundary>,
		);

		expect(screen.getByText('This screen failed to load')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('offers Reload for the MIME-type wording (cached SPA shell served for a .js URL)', () => {
		sessionStorage.setItem(GUARD_KEY, String(Date.now()));

		render(
			<RouteErrorBoundary>
				<Boom error={new TypeError("'text/html' is not a valid JavaScript MIME type.")} />
			</RouteErrorBoundary>,
		);

		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
		expect(reload).toHaveBeenCalledTimes(1);
	});

	// A plain render error keeps the working Retry: clicking it clears the
	// boundary and re-renders the children (a transient failure recovers;
	// a permanent one re-throws into the same panel). Assert the re-render
	// rather than a success path — a component that throws then succeeds
	// trips React 19's concurrent-recovery notice in jsdom.
	it('keeps a working Retry for a plain render error', () => {
		let renders = 0;
		function AlwaysThrows(): never {
			renders += 1;
			throw new Error('boom');
		}

		render(
			<RouteErrorBoundary>
				<AlwaysThrows />
			</RouteErrorBoundary>,
		);

		expect(screen.getByText('This screen failed to load')).toBeTruthy();
		expect(renders).toBeGreaterThanOrEqual(1);

		fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		// Retry re-rendered the child (it threw again into the same panel).
		expect(renders).toBeGreaterThan(1);
		expect(screen.getByText('This screen failed to load')).toBeTruthy();
		expect(reload).not.toHaveBeenCalled();
	});
});
