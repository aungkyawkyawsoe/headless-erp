import type { ReactNode } from 'react';

/**
 * The **record hero** — the top card of a per-truck file screen.
 *
 * It answers "what is this asset and where does it stand RIGHT NOW" in one
 * glance, so the ledger below can be pure history:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ [ 6S-2439 ]  HINO                  [ 214d ]  │  ← identity + status
 *   │ AYA SOMPO                                    │  ← the current headline
 *   │ ──────────────────────────────────────────── │
 *   │ EXPIRES          PREMIUM                     │  ← facts (label over value)
 *   │ 30 Sep 2026      1,250,000 Ks                │
 *   │ ▓▓▓▓▓▓▓▓▓░░░░░  214 of 365 days              │  ← time remaining
 *   └──────────────────────────────────────────────┘
 *
 * Before this, a truck page had NO summary at all — the plate lived only in the
 * app-bar title and the current state was implicit in the newest list row, so
 * the user had to read the history to learn the present. Tap → the correction /
 * renewal action.
 */

export interface RecordHeroFact {
	label: string;
	value: ReactNode;
	/** A status tone for the value (e.g. `text-status-danger` when overdue). */
	tone?: string;
}

export interface RecordHeroProgress {
	/** 0..1 — the fraction of the period still remaining (or elapsed). */
	value: number;
	/** The bar's fill colour (defaults to the brand primary). */
	tone?: string;
	/** The line under the bar (e.g. "214 of 365 days"). */
	caption?: ReactNode;
}

interface RecordHeroProps {
	/** The identity anchor — the plate chip. */
	identity: string;
	/** A quiet identity line beside the chip (brand). */
	identitySub?: ReactNode;
	/** The current state, one line (e.g. the provider, or "Odometer"). */
	headline?: ReactNode;
	/** A quiet right-aligned note on the headline's OWN line (e.g. the last
	 *  reading's date) — lets a hero drop its facts row and save a line. */
	headlineRight?: ReactNode;
	/** The status pill at the top-right (renewal urgency). Decorative only —
	 *  when an INTERACTIVE control belongs there, use `action` instead (a pill
	 *  rendered inside the tap-to-open button is fine, a button is not). */
	status?: ReactNode;
	/** An INTERACTIVE top-right control (e.g. a history icon). Rendered OUTSIDE
	 *  the tap-to-open button — a nested button is invalid — so the identity row
	 *  stays static and only the facts below form the tap target. */
	action?: ReactNode;
	/** Label-over-value facts across the bottom. */
	facts?: RecordHeroFact[];
	/** The time-remaining bar. */
	progress?: RecordHeroProgress | null;
	/** Tap → correct / renew the current record. */
	onOpen?: () => void;
	ariaLabel?: string;
	/** Extra content below the facts inside the same card (e.g. a locked notice). */
	children?: ReactNode;
}

export function RecordHero({
	identity,
	identitySub,
	headline,
	headlineRight,
	status,
	facts,
	progress,
	onOpen,
	ariaLabel,
	action,
	children,
}: RecordHeroProps) {
	// The identity row — the plate chip + brand + the top-right slot (the static
	// `status` pill, or the interactive `action` when one is given).
	const identityRow = (
		<span className="flex w-full min-w-0 items-center gap-2">
			<span className="inline-flex shrink-0 items-center rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-base font-bold leading-none tracking-wide text-foreground">
				{identity}
			</span>
			{identitySub ? (
				<span className="truncate text-meta font-semibold uppercase tracking-[0.14em] text-muted-foreground">{identitySub}</span>
			) : null}
			{action != null ? (
				<span className="ml-auto shrink-0">{action}</span>
			) : status ? (
				<span className="ml-auto shrink-0">{status}</span>
			) : null}
		</span>
	);

	const lowerBody = (
		<>
			{headline || headlineRight != null ? (
				<span className="mt-2.5 flex w-full min-w-0 items-baseline justify-between gap-3">
					{headline ? <span className="min-w-0 truncate text-key font-semibold leading-tight text-foreground">{headline}</span> : null}
					{headlineRight != null ? (
						<span className="shrink-0 text-meta font-semibold leading-myanmar tabular-nums text-muted-foreground">{headlineRight}</span>
					) : null}
				</span>
			) : null}

			{facts && facts.length > 0 ? (
				<span className="mt-3 flex w-full items-end gap-4 border-t border-border/60 pt-3">
					{facts.map((fact) => (
						<span key={fact.label} className="flex min-w-0 flex-col">
							<span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{fact.label}</span>
							<span className={`mt-0.5 truncate text-base font-semibold leading-tight tabular-nums ${fact.tone ?? 'text-foreground'}`}>
								{fact.value}
							</span>
						</span>
					))}
				</span>
			) : null}

			{progress ? (
				<span className="mt-3 block w-full">
					<span className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
						<span
							className={`h-full rounded-full ${progress.tone ?? 'bg-primary'}`}
							style={{ width: `${Math.round(Math.min(1, Math.max(0, progress.value)) * 100)}%` }}
						/>
					</span>
					{progress.caption ? (
						<span className="mt-1 block text-[10px] font-medium leading-myanmar text-muted-foreground">{progress.caption}</span>
					) : null}
				</span>
			) : null}
		</>
	);

	const tapButtonClass =
		'flex w-full flex-col items-start text-left outline-none transition-colors duration-150 hover:bg-muted/40 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

	return (
		<section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
			{action != null ? (
				// An interactive action moves the identity row OUT of the tap-to-open
				// button (a nested button is invalid and unreliable) — only the facts
				// below stay a tap target.
				<div className="flex w-full flex-col items-start p-4">
					{identityRow}
					{onOpen ? (
						<button type="button" onClick={onOpen} aria-label={ariaLabel} className={tapButtonClass}>
							{lowerBody}
						</button>
					) : (
						<div className="flex w-full flex-col items-start">{lowerBody}</div>
					)}
				</div>
			) : onOpen ? (
				<button type="button" onClick={onOpen} aria-label={ariaLabel} className={`${tapButtonClass} p-4`}>
					{identityRow}
					{lowerBody}
				</button>
			) : (
				<div className="flex w-full flex-col items-start p-4">
					{identityRow}
					{lowerBody}
				</div>
			)}
			{children ? <div className="px-4 pb-4">{children}</div> : null}
		</section>
	);
}
