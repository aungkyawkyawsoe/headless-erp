import { memo } from 'react';
import { Users } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@mmbix/design-system/avatar';

import { CARD_FRAME } from '@/shared/components/card';
import { PlateChip } from '@/shared/components/plate-chip';

import { KIND_META, SEVERITY_META } from '../data/status';
import type { IncidentCardModel, IncidentSeverity } from '../data/types';

/**
 * Incident card — ONE record row for the မှတ်တမ်း (`/app/incidents`) register:
 * the toolbar search's results AND the unassigned (no-truck) records, following
 * the store-request card's design language:
 *
 *  ┌──────────────────────────────────────────────┐
 *  │ [7S-6158] [HINO]                    [LOW]     │
 *  │ [Accident]                                    │
 *  │ Warehouse B #4 ················· 19-Aug-2026  │
 *  │ ခန့်မှန်း တောင်းဆိုငွေ/စရိတ် ········· MMK 120 │
 *  │ ▏ Minor paint scrape on rear bumper guard…   │
 *  │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
 *  │ (crew) Driver · U Soe Naing  +2     1 week ago │
 *  └──────────────────────────────────────────────┘
 *
 *  - **Header** — the vehicle's plate in the bordered plate-style chip + the
 *    brand as a quiet uppercase chip, with the severity pill top-right;
 *  - **Kind** — the accident-vs-incident pill under the identity chips;
 *  - **Location · Date / ခန့်မှန်း တောင်းဆိုငွေ/စရိတ်** — two dotted-leader rows:
 *    the location and incident date share ONE row (location leading, date
 *    trailing — labels dropped for space), then the claim / cost row (the fleet
 *    cards' compliance-row anatomy);
 *  - **Description** — the incident account BELOW the fact rows, styled as a
 *    quote (muted, small, left border), clamped to two lines;
 *  - **Footer** — the record's CREW (the `personnel` m2m): the lead member's
 *    designation role · name plus a `+N` count of the rest, with the relative
 *    age stamp under a dashed divider. Never the `reported_by` attribution —
 *    the people on the record are its personnel, not whoever logged it.
 *
 *  With `onOpen` the WHOLE CARD becomes the tap target (the register's search
 *  results pass it to open that record's edit form); without it the card is a
 *  plain non-interactive row.
 */

/** The card surface — shared by the plain row and the tap-target button. */
const CARD = `${CARD_FRAME} p-4 shadow-card`;

/** Severity pill — ROUNDED-FULL + tinted (soft bg + tone text), no border — the
 *  HR request-card pill, mapped onto the incident's urgency tiers. */
export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
	const meta = SEVERITY_META[severity] ?? SEVERITY_META.low;
	return (
		<span className={`shrink-0 rounded-full px-3 py-0.5 text-meta font-semibold leading-myanmar ${meta.className}`}>{meta.label}</span>
	);
}

/** Dotted-leader fact row — label ················· value (the fleet cards'
 *  compliance-row anatomy: label muted on the left, value semibold right). */
function FactRow({ label, value }: { label: string; value: string | null }) {
	return (
		<div className="flex items-center gap-2 text-xs">
			<span className="shrink-0 font-medium leading-myanmar text-muted-foreground">{label}</span>
			<span aria-hidden className="min-w-0 flex-1 border-b border-dotted border-border/70" />
			<span className="shrink-0 font-semibold leading-myanmar text-foreground tabular-nums">{value ?? '—'}</span>
		</div>
	);
}

export const IncidentCard = memo(function IncidentCard({
	record,
	onOpen,
}: {
	record: IncidentCardModel;
	/** Tap handler — makes the whole card one button (the record it shows is the
	 *  thing that opens). Omitted renders a plain non-interactive row. */
	onOpen?: (record: IncidentCardModel) => void;
}) {
	const body = (
		<>
			{/* Header — the plate chip + brand with the severity pill top-right. */}
			<div className="flex min-w-0 items-start justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-1">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<PlateChip className="w-fit shrink-0">{record.plateNo ?? '—'}</PlateChip>
						{record.brandLabel && (
							<span className="inline-flex items-center self-stretch text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
								{record.brandLabel}
							</span>
						)}
					</div>
					<span
						className={`w-fit rounded-full px-2.5 py-0.5 text-[10px] font-semibold leading-myanmar ${(KIND_META[record.kind] ?? KIND_META.incident).className}`}
					>
						{(KIND_META[record.kind] ?? KIND_META.incident).label}
					</span>
				</div>
				<SeverityBadge severity={record.severity} />
			</div>

			{/* Location · Date + ခန့်မှန်း တောင်းဆိုငွေ/စရိတ် — the dotted-leader rows:
				the location and incident date share ONE row (location leading, date
				trailing) so the card stays two rows of facts. */}
			<div className="mt-3 flex flex-col gap-1.5">
				<FactRow label={record.location ?? '—'} value={record.dateLabel} />
				<FactRow label="Estimated Cost" value={record.costLabel} />
			</div>

			{/* Description — the incident account BELOW the fact rows, styled as a
				quote (muted, small, left border), clamped to two lines. */}
			{record.description && (
				<p className="mt-2.5 line-clamp-2 border-l-2 border-border pl-2.5 text-xs leading-myanmar text-muted-foreground">
					{record.description}
				</p>
			)}

			{/* Footer — the record's CREW (the `personnel` m2m) with the relative age
				stamp under a dashed divider: the lead member's designation role · name,
				the rest collapsed to a count. Each side skips when absent. */}
			{(record.personnel.length > 0 || record.ageLabel) && (
				<div className="mt-3 flex items-center gap-2 border-t border-dashed border-border/70 pt-2.5">
					{record.personnel.length > 0 && (
						<>
							<Avatar className="size-6">
								{record.personnel[0].photo ? <AvatarImage src={record.personnel[0].photo} alt={record.personnel[0].name} /> : null}
								{/* No directory photo → the lucide crew icon, never a letter avatar. */}
								<AvatarFallback>
									<Users className="size-3.5" strokeWidth={2} aria-hidden />
								</AvatarFallback>
							</Avatar>
							<span className="min-w-0 truncate text-xs font-medium leading-myanmar text-foreground">
								{record.personnel[0].role ? `${record.personnel[0].role} · ` : ''}
								{record.personnel[0].name}
							</span>
							{record.personnel.length > 1 && (
								<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
									+{record.personnel.length - 1}
								</span>
							)}
						</>
					)}
					{record.ageLabel && (
						<span
							className={`shrink-0 text-xs font-medium leading-myanmar text-muted-foreground${record.personnel.length > 0 ? ' ml-auto' : ''}`}
						>
							{record.ageLabel}
						</span>
					)}
				</div>
			)}
		</>
	);

	if (onOpen) {
		return (
			<li>
				<button
					type="button"
					onClick={() => onOpen(record)}
					aria-label={`${record.plateNo ?? 'Record'} — edit record`}
					className={`block w-full text-left ${CARD} transition-transform duration-150 active:scale-[0.99] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
				>
					{body}
				</button>
			</li>
		);
	}

	return <li className={CARD}>{body}</li>;
});
