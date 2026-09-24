import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reloadApp } from '@/shared/platform/reload';

/**
 * App-wide error boundary.
 *
 * Without one, ANY render error (most often a lazy route chunk that fails to
 * load) makes React unmount the whole tree and leaves `#root` empty — on a phone
 * that reads as the bare `html` background (near-white in light mode, near-black
 * in dark mode) until the user reloads. This is the "blank white/black screen,
 * then reload shows the view" report.
 *
 * A failed chunk import is the common, recoverable case: after a deploy the old
 * hashed chunk 404s, or Telegram backgrounds the WebView and aborts an in-flight
 * import. Reloading re-fetches the (new) chunk, so we do that ONCE automatically
 * — guarded so a genuinely missing chunk cannot trap the user in a reload loop.
 */
const RELOAD_GUARD_KEY = 'mmbix:chunk-reload-at';
const RELOAD_GUARD_MS = 10_000;

/** Does this error look like a failed dynamic import / chunk fetch?
 *
 * Includes every browser's wording of the SPA-shell-as-module failure
 * (`'text/html' is not a valid JavaScript MIME type` — Chrome; `MIME type of
 * "text/html"` — Safari; `non-JavaScript MIME type` — Firefox): after a
 * deploy a WebView can still hold a CACHED html-for-.js response even once
 * the worker 404s stale hashes, and without these patterns the boundary
 * skipped the auto-reload and left the user on a panel whose Retry cannot
 * recover (React `lazy()` caches the rejected import for the page's life). */
export function isChunkLoadError(error: unknown): boolean {
	const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	return /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed|Failed to fetch|NetworkError|Failed to load module script|MIME type of|not a valid JavaScript MIME type|non-JavaScript MIME type/i.test(
		message,
	);
}

interface ErrorBoundaryState {
	error: Error | null;
}

/** Render a scoped fallback instead of the whole-app reload panel. */
export type ErrorFallback = (error: Error, reset: () => void) => ReactNode;

export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ErrorFallback }, ErrorBoundaryState> {
	state: ErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error('[tgapp] render error', error, info.componentStack);
		if (!isChunkLoadError(error)) return;
		try {
			const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? '0');
			if (Date.now() - last > RELOAD_GUARD_MS) {
				sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
				reloadApp();
			}
		} catch {
			reloadApp();
		}
	}

	/** Clear the error and re-render the children (a route-level retry). */
	reset = (): void => this.setState({ error: null });

	/** Copy the failure so the user can hand it to support instead of describing it. */
	copyDetails = (): void => {
		const error = this.state.error;
		const detail = error ? `${error.name}: ${error.message}\n\n${error.stack ?? ''}` : 'unknown error';
		void navigator.clipboard?.writeText(detail).catch(() => {});
	};

	render(): ReactNode {
		if (!this.state.error) return this.props.children;
		const error = this.state.error;
		// A scoped caller (the route boundary) renders its own compact panel that
		// keeps the rest of the app alive; the chunk-reload catch above still ran.
		if (this.props.fallback) return this.props.fallback(error, this.reset);
		// A SHORT, quotable reason — the panel used to say only "Something went
		// wrong", so a user could not report anything actionable and a reload that
		// re-hit the same error looped with no second option.
		const reason = `${error.name}: ${error.message}`.slice(0, 160);
		return (
			<div className="launcher-bg flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
				<h1 className="text-lg font-bold text-foreground">Something went wrong</h1>
				<p className="max-w-sm text-sm leading-myanmar text-muted-foreground">
					Reload the app to continue. If it keeps happening, share the details below with an administrator.
				</p>
				<p className="max-w-sm rounded-lg border border-border bg-muted/40 px-3 py-2 text-left font-mono text-meta break-words text-muted-foreground">
					{reason}
				</p>
				<div className="flex flex-wrap items-center justify-center gap-2">
					<button
						type="button"
						onClick={() => reloadApp()}
						className="rounded-full bg-primary px-4 py-2 text-sm font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						Reload
					</button>
					<button
						type="button"
						onClick={() => window.location.assign('/app')}
						className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						Go home
					</button>
					<button
						type="button"
						onClick={this.copyDetails}
						className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						Copy details
					</button>
				</div>
			</div>
		);
	}
}
