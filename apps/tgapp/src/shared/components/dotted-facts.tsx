import type { ReactNode } from 'react';

/** A dotted-leader fact row — label on the left, leader dots across the middle,
 *  value text right-aligned (mirrors the directory card's ဌာန / ရာထူး rows).
 *  Reusable by any read-only card / details sheet: children may be a single
 *  `FactValue`, or row of chips / sub-values stacked right-aligned. */
export function FactRow({ label, children }: { label: ReactNode; children: ReactNode }) {
	return (
		<div className="flex items-baseline gap-2 py-1">
			<span className="shrink-0 text-xs font-medium leading-myanmar text-muted-foreground">{label}</span>
			<span aria-hidden className="min-w-0 flex-1 -translate-y-0.75 border-b border-dotted border-border/70" />
			<div className="flex min-w-0 flex-col items-end gap-0.5">{children}</div>
		</div>
	);
}

/** A single-line fact value — the shared right-aligned text look for a fact row. */
export function FactValue({ children }: { children: ReactNode }) {
	return <span className="text-right text-xs font-semibold leading-myanmar text-foreground">{children}</span>;
}

/**
 * The `label` / `value` pair form of a dotted fact row — the tight CARD variant
 * (no inter-row padding, truncating value). This exact markup was copied into
 * the insurance, license and fleet register cards; one definition now.
 */
export function FactRowKV({ label, value }: { label: ReactNode; value: ReactNode }) {
	return (
		<div className="flex items-baseline gap-2 text-xs">
			<span className="shrink-0 font-medium leading-myanmar text-muted-foreground">{label}</span>
			<span aria-hidden className="min-w-0 flex-1 -translate-y-0.75 border-b border-dotted border-border/70" />
			<span className="min-w-0 truncate text-right font-semibold leading-myanmar text-foreground">{value}</span>
		</div>
	);
}
