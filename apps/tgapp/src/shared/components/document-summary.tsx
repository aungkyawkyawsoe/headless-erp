import type { ReactNode } from 'react';

import { SectionCard } from './card';
import { FactRow } from './dotted-facts';

/** One dotted-leader fact on the summary — `value` is the FactRow's children, so
 *  a caller can pass a plain `<FactValue>` or a richer node (a link + a pill). */
export interface DocumentSummaryFact {
	label: string;
	value: ReactNode;
}

interface DocumentSummaryCardProps {
	/** The leading glyph in the tinted tile. */
	icon: ReactNode;
	/** The document number (the card's anchor line). */
	title: string;
	/** The kind tag pill (e.g. "Inbound"). */
	typeLabel: string;
	/** The lifecycle status pill (label + module-owned tone classes). */
	statusMeta: { label: string; className: string };
	/** Dotted-leader facts, in display order. */
	facts: DocumentSummaryFact[];
	/** An extra block below the facts (e.g. the two-role audit trail). */
	footer?: ReactNode;
	/** A top-right slot on the header row — the document's own ⋮ actions menu, so it
	 *  sits in the same corner (and opens the same sheet) as the list row it came from. */
	trailing?: ReactNode;
	/** The operator's free-text note (shown only when present). */
	note?: string | null;
}

/**
 * The MRO document header summary — the card at the top of every inbound /
 * outbound / stock-move / adjustment detail page. The four pages had copied the
 * exact scaffold (icon tile · number · type + status pills · dashed facts block ·
 * note) with only the icon/labels swapped; one definition now.
 */
export function DocumentSummaryCard({ icon, title, typeLabel, statusMeta, facts, footer, trailing, note }: DocumentSummaryCardProps) {
	return (
		<SectionCard className="p-4">
			<div className="flex items-center gap-3">
				<span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{icon}</span>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<p className="truncate text-key font-bold leading-tight tracking-tight text-foreground">{title}</p>
					<div className="flex items-center gap-1.5">
						<span className="max-w-24 truncate rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold leading-myanmar text-muted-foreground">
							{typeLabel}
						</span>
						<span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold leading-myanmar ${statusMeta.className}`}>
							{statusMeta.label}
						</span>
					</div>
				</div>
				{trailing}
			</div>

			<div className="mt-3 border-t border-dashed border-border pt-1.5">
				{facts.map((fact) => (
					<FactRow key={fact.label} label={fact.label}>
						{fact.value}
					</FactRow>
				))}
			</div>

			{footer}

			{note ? <p className="mt-2.5 border-l-2 border-border pl-2.5 text-xs leading-myanmar text-muted-foreground">{note}</p> : null}
		</SectionCard>
	);
}
