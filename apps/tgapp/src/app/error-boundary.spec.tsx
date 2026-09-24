// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './error-boundary';
import { reloadApp } from '@/shared/platform/reload';

// `window.location.reload` is unforgeable on jsdom, so the boundary reloads
// through this helper — mocking it is what lets us assert the reload behaviour.
vi.mock('@/shared/platform/reload', () => ({ reloadApp: vi.fn() }));

/**
 * The app-wide boundary that turns a render crash (usually a lazy route chunk that
 * failed to load) into a themed Reload screen instead of an empty `#root` — the
 * "blank white/black screen until I reload" report. Its auto-reload is guarded so
 * a genuinely missing chunk cannot trap the user in a reload loop.
 */

const GUARD_KEY = 'mmbix:chunk-reload-at';
const reload = vi.mocked(reloadApp);

/** Throws during render so the boundary catches it. */
function Boom({ error }: { error: Error }): never {
	throw error;
}

describe('ErrorBoundary', () => {
	beforeEach(() => {
		sessionStorage.clear();
		reload.mockClear();
		// React (and the boundary itself) log the caught error; keep the run quiet.
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it('renders its children when nothing throws', () => {
		render(
			<ErrorBoundary>
				<div>dashboard</div>
			</ErrorBoundary>,
		);
		expect(screen.getByText('dashboard')).toBeTruthy();
	});

	it('shows the reload screen — never an empty tree — for a plain render error', () => {
		render(
			<ErrorBoundary>
				<Boom error={new Error('boom')} />
			</ErrorBoundary>,
		);

		expect(screen.getByText('Something went wrong')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
		// A plain render bug must NOT touch the auto-reload guard.
		expect(reload).not.toHaveBeenCalled();
		expect(sessionStorage.getItem(GUARD_KEY)).toBeNull();
	});

	it('auto-reloads once for a chunk-load error and records the guard', () => {
		render(
			<ErrorBoundary>
				<Boom error={new Error('Failed to fetch dynamically imported module: /assets/x-abc.js')} />
			</ErrorBoundary>,
		);

		expect(reload).toHaveBeenCalledTimes(1);
		expect(Number(sessionStorage.getItem(GUARD_KEY))).toBeGreaterThan(0);
	});

	it('does not auto-reload a second chunk error inside the guard window', () => {
		sessionStorage.setItem(GUARD_KEY, String(Date.now()));

		render(
			<ErrorBoundary>
				<Boom error={new Error('Loading chunk 42 failed')} />
			</ErrorBoundary>,
		);

		expect(reload).not.toHaveBeenCalled();
		// The manual fallback is still offered, so the user is never stuck.
		expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
	});

	it('auto-reloads again once the guard window has passed', () => {
		sessionStorage.setItem(GUARD_KEY, String(Date.now() - 60_000));

		render(
			<ErrorBoundary>
				<Boom error={new Error('ChunkLoadError')} />
			</ErrorBoundary>,
		);

		expect(reload).toHaveBeenCalledTimes(1);
	});

	// After a deploy the worker 404s a stale chunk (so the browser words it
	// "Failed to fetch dynamically imported module"), but a WebView may still
	// hold a CACHED html-for-.js response; every browser words that failure as
	// a MIME-type error, which the boundary must also auto-recover from — not
	// leave the user on a panel whose Retry re-imports the same dead module.
	it.each([
		['chrome', "'text/html' is not a valid JavaScript MIME type."],
		['safari', 'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html". Strict MIME type checking is enabled.'],
		['firefox', 'The server responded with a non-JavaScript MIME type ("text/html").'],
	])('auto-reloads once for a %s MIME-type chunk error', (_browser, message) => {
		render(
			<ErrorBoundary>
				<Boom error={new Error(message)} />
			</ErrorBoundary>,
		);

		expect(reload).toHaveBeenCalledTimes(1);
		expect(Number(sessionStorage.getItem(GUARD_KEY))).toBeGreaterThan(0);
	});

	it('does NOT auto-reload an unrelated TypeError (a MIME mention outside a module load)', () => {
		render(
			<ErrorBoundary>
				<Boom error={new TypeError('unsupported content type, expected image/jpeg')} />
			</ErrorBoundary>,
		);

		expect(reload).not.toHaveBeenCalled();
		expect(sessionStorage.getItem(GUARD_KEY)).toBeNull();
	});

	it('the manual Reload button always reloads', () => {
		render(
			<ErrorBoundary>
				<Boom error={new Error('boom')} />
			</ErrorBoundary>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
		expect(reload).toHaveBeenCalledTimes(1);
	});
});
