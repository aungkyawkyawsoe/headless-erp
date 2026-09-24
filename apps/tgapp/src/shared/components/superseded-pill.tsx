/**
 * The "Superseded" chip for a DOCUMENT LEDGER's history rows (licenses,
 * insurance policies).
 *
 * Why this exists: a history ledger lists every record a truck ever had, and each
 * older record's own expiry necessarily sits in the PAST. Painting it with the
 * renewal-urgency pill therefore labelled superseded paperwork "Overdue" in red —
 * e.g. a truck renewed to 2027 still showed its 2026 permit as "Overdue", which
 * reads as an action demand on a document that no longer governs anything.
 *
 * Urgency is a property of the CURRENT record only (the head of the feed, the one
 * the hero card and the register show). A past record gets this neutral chip
 * instead, which says what it actually is: replaced by a later record. The row's
 * `secondary` line already carries the factual expiry date.
 */
export function SupersededPill() {
	return (
		<span className="shrink-0 rounded-full bg-muted px-3 py-0.5 text-meta font-semibold leading-myanmar text-muted-foreground">
			Superseded
		</span>
	);
}
