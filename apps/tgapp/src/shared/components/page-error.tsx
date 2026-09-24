import { RefreshCw } from 'lucide-react';

interface PageErrorProps {
	/** The bold first line. Defaults to the generic list failure copy. */
	title?: string;
	/** Optional muted second line (what to check). */
	hint?: string;
	/** Retry the failed read. Absent ⇒ no retry button (a read with no refetch). */
	onRetry?: () => void;
	/** The retry button label (defaults to "Try again"). */
	retryLabel?: string;
	/** Stretch the dashed block to its pane's full height (a failed list body
	 *  owns the pane exactly like an empty state does). Default: hug the copy. */
	fill?: boolean;
}

/**
 * The ONE page-level load-failure block — the twin of `EmptyState`.
 *
 * A failed read must never masquerade as "no records": the list pages used to
 * fall through to the empty state on a server error, and ~10 detail screens
 * each re-declared their own dashed-border + "Try again" retry block with
 * drifting copy and sizing. This is that block, stated once, so every failed
 * read looks and announces the same way.
 *
 * `role="alert"` so a screen reader hears the failure the moment it renders
 * (the empty state is a `status` region — failure is not a status).
 */
export function PageError({ title = 'Could not load this list.', hint, onRetry, retryLabel = 'Try again', fill = false }: PageErrorProps) {
	return (
		<div
			role="alert"
			className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-4 py-12 text-center${
				fill ? ' min-h-full grow' : ''
			}`}
		>
			<div className="flex flex-col gap-1">
				<p className="text-sm font-medium leading-myanmar text-status-danger">{title}</p>
				{hint ? <p className="text-xs leading-myanmar text-muted-foreground">{hint}</p> : null}
			</div>
			{onRetry ? (
				<button
					type="button"
					onClick={onRetry}
					className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
					{retryLabel}
				</button>
			) : null}
		</div>
	);
}
