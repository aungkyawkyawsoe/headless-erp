import { XCircle } from 'lucide-react';

/**
 * The document detail pages' line-list states — loading rows, a retryable load
 * failure, and the empty line. The four MRO document pages (inbound / outbound /
 * stock-move / adjustment) had copied the same markup for each.
 */

/** Pulsing shell rows that mirror the real line frame. */
export function LinesSkeleton({ count = 3 }: { count?: number }) {
	return (
		<div className="flex animate-pulse flex-col gap-2" aria-hidden>
			{Array.from({ length: count }, (_, i) => (
				<div key={i} className="h-14 rounded-lg bg-muted/60" />
			))}
		</div>
	);
}

/** A failed line read — inline, announced, and retryable (never silent). */
export function LinesError({ onRetry }: { onRetry: () => void }) {
	return (
		<div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs leading-myanmar text-muted-foreground">
			<XCircle className="size-4 shrink-0 text-destructive" aria-hidden />
			<span className="min-w-0 flex-1">Could not load items.</span>
			<button
				type="button"
				onClick={onRetry}
				className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-meta font-semibold leading-myanmar text-primary-foreground"
			>
				Retry
			</button>
		</div>
	);
}

/** The empty line list. */
export function LinesEmpty() {
	return (
		<p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs leading-myanmar text-muted-foreground">
			No items.
		</p>
	);
}
