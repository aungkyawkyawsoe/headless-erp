/**
 * The fact rows a request card shows, as a closed union so each kind is explicit:
 *  - `label — value`  → a dotted-leader row (label left ····· value right)
 *  - `standalone`     → a full-width value line with no label (e.g. the leave
 *    card's date range leads the block as just the range)
 * The union (not a `{ label, value, plain? }` bag) means a standalone fact never
 * carries a meaningless label, and the renderer switches on `kind` cleanly.
 */
export type RequestFact = { kind: 'label-value'; label: string; value: string } | { kind: 'standalone'; value: string };

/** A dotted-leader fact row — label left, dots across the middle, value right.
 *  The value is NEVER truncated: on a narrow phone a long time span (e.g.
 *  "08:00 AM → 05:00 PM") wraps to its own right-aligned line rather than
 *  clipping, so the whole fact is always readable. */
function DottedFact({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
			<span className="shrink-0 font-medium leading-myanmar text-muted-foreground">{label}</span>
			<span aria-hidden className="min-w-0 flex-1 -translate-y-0.75 border-b border-dotted border-border/70" />
			<span className="break-words text-right font-medium leading-myanmar text-foreground">{value}</span>
		</div>
	);
}

/** A full-width value line with no label — the leading fact on some cards. */
function StandaloneFact({ value }: { value: string }) {
	return <p className="break-words leading-myanmar text-sub font-medium text-foreground">{value}</p>;
}

/** Renders any array of request facts — one row each, in order. Spacing around
 *  the block belongs to the card shell (it sits in a flex column with its own
 *  gap), so this stays margin-free. */
export function Facts({ facts }: { facts: RequestFact[] }) {
	if (facts.length === 0) return null;
	return (
		<div className="flex flex-col gap-1.5">
			{facts.map((fact, index) =>
				fact.kind === 'standalone' ? (
					<StandaloneFact key={index} value={fact.value} />
				) : (
					<DottedFact key={index} label={fact.label} value={fact.value} />
				),
			)}
		</div>
	);
}
