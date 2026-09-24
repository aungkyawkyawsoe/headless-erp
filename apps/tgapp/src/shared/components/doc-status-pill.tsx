import { MRO_DOC_STATUS_META, type MroDocStatus } from '@/shared/mro';

/**
 * The lifecycle pill of ONE stock document — the badge every full-screen document
 * page carries at its top-left, rendered from the shared `MRO_DOC_STATUS_META` so a
 * page can never tint or word a status differently from the list card it was opened
 * from (one definition for all four families: inbounds / goods-issues / adjustments /
 * stock-moves).
 *
 * `kind` is the document's OWN kind joined into the same badge — `Purchase ·
 * Confirmed`. It exists because a SETTLED document's form drops its kind selector
 * (a row of dead tabs would offer a change the engine refuses), so the pill is where
 * an operator still reads WHICH document this is, in one glance and in ONE place: the
 * kind rides the state it is in, never as a third line or a second badge beside it.
 * A writable draft keeps its kind control, so it passes no `kind` and the pill reads
 * the bare status.
 *
 * Deliberately a `span` (not a component that owns layout): the page places it in its
 * own corner row beside the ⋮ menu.
 */
export function DocStatusPill({ status, kind }: { status: MroDocStatus; kind?: string | null }) {
	// The status comes off the wire, so an unknown value reads as the draft tone — the
	// same safe direction `inboundDocStatusOf` and the list cards take.
	const meta = MRO_DOC_STATUS_META[status] ?? MRO_DOC_STATUS_META.draft;
	return (
		<span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold leading-myanmar ${meta.className}`}>
			{kind ? (
				<>
					<span className="font-medium opacity-75">{kind}</span>
					<span aria-hidden className="opacity-60">
						·
					</span>
				</>
			) : null}
			<span>{meta.label}</span>
		</span>
	);
}
