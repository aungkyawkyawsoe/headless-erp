import type { ReactNode } from 'react';
import { useState } from 'react';

import { ErrorBoundary, isChunkLoadError } from './error-boundary';
import { reloadApp } from '@/shared/platform/reload';

/**
 * A route render error, contained: the app-wide `ErrorBoundary` (main.tsx)
 * replaces the WHOLE app with a reload panel, so one page's render throw used
 * to blank every screen (and the shell that could navigate away from it). This
 * boundary sits around the route table and shows a compact, quotable panel that
 * keeps the router alive — Retry re-renders the route, Go home leaves it.
 *
 * Chunk-load failures still auto-reload once via the boundary's `componentDidCatch`
 * (the fallback only replaces the UI, not that behavior). When the panel is
 * reached WITH such an error (the auto-reload was suppressed inside the guard
 * window), Retry cannot recover: React `lazy()` caches the rejected import for
 * the page's lifetime, so the only working action is a full reload — offer
 * Reload instead of a dead Retry.
 */
function RouteErrorFallback(error: Error, reset: () => void): ReactNode {
	const reason = `${error.name}: ${error.message}`.slice(0, 200);
	const chunky = isChunkLoadError(error);
	return (
		<div className="launcher-bg flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
			<h1 className="text-lg font-bold text-foreground">This screen failed to load</h1>
			<p className="max-w-sm text-sm leading-myanmar text-muted-foreground">
				{chunky
					? 'The app updated while this screen was open — reload to get the latest version. If it keeps happening, share the details with an administrator.'
					: 'Retry the screen, or go back to the app. If it keeps happening, share the details with an administrator.'}
			</p>
			<p className="max-w-sm rounded-lg border border-border bg-muted/40 px-3 py-2 text-left font-mono text-meta break-words text-muted-foreground">
				{reason}
			</p>
			<div className="flex flex-wrap items-center justify-center gap-2">
				{chunky ? (
					<button
						type="button"
						onClick={() => reloadApp()}
						className="rounded-full bg-primary px-4 py-2 text-sm font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						Reload
					</button>
				) : (
					<button
						type="button"
						onClick={reset}
						className="rounded-full bg-primary px-4 py-2 text-sm font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						Retry
					</button>
				)}
				<button
					type="button"
					onClick={() => window.location.assign('/app')}
					className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					Go home
				</button>
				{/* Copy the full stack so a user can hand support the exact failure
				    instead of describing it — mirrors the app-wide boundary. */}
				<CopyDetailsButton error={error} />
			</div>
		</div>
	);
}

/** A self-contained copy-to-clipboard control (own state, so the fallback can
 *  stay a plain render function the class invokes without a hook boundary). */
function CopyDetailsButton({ error }: { error: Error }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			onClick={() => {
				const detail = `${error.name}: ${error.message}\n\n${error.stack ?? ''}`;
				void navigator.clipboard
					?.writeText(detail)
					.then(() => setCopied(true))
					.catch(() => {});
			}}
			className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			{copied ? 'Copied' : 'Copy details'}
		</button>
	);
}

/** Wrap the route table so one page's render throw is contained. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
	return <ErrorBoundary fallback={RouteErrorFallback}>{children}</ErrorBoundary>;
}
