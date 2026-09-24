import { MRO_LOCATION_LABELS } from '@/shared/mro';
import { dateLabel, formatCount, MOVEMENT_LINE_META, movementKindLabel, serialUnitCount } from '../data/meta';
import type { MovementLineRow } from '../data/types';

/** A store value → its display label (falls back to the raw value). */
function storeLabel(value: string | null): string | null {
	if (!value) return null;
	return MRO_LOCATION_LABELS[value] ?? value;
}

/**
 * ONE confirmed movement line's CARD BODY — the shared anatomy of the Screen 2
 * group feed and the Screen 3 ledger cards:
 *
 *  ┌───────────────────────────────────────────────┐
 *  │ (+1)            [Purchase]  5 Sep 2026        │
 *  │ Battery Terminal Clamp                        │
 *  │ INB-00014 · Main store                        │
 *  │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
 *  │ CREATED BY              TOTAL                 │
 *  │ John Doe               850 Ks                 │
 *  └───────────────────────────────────────────────┘
 *
 *  - **Top row** — the signed QUANTITY pill (left, tinted by the direction: IN
 *    green + / OUT red − / TRF blue −); the movement's DOC-TYPE tag (Purchase /
 *    Issue / Transfer / … — there is deliberately no IN/OUT/TRF badge; the pill
 *    tone + sign already say the direction) and the date beside it (right).
 *  - **Body** — the model name bold over its identity line: the doc number
 *    followed by the store (IN/OUT) or the route (`from → to` on TRF), then
 *    batch/serial extras + the operator note when present. Dashed divider.
 *  - **Footer** — the person who created the document (their EMPLOYEE name —
 *    `created_name` — so the same act reads the same whichever way they signed
 *    in) on the left; the line TOTAL (`qty × unit_price`, Ks) on
 *    the right when the line carries a price (TRF lines carry none). A side
 *    with nothing to show is omitted.
 *
 * The component renders NO outer border/padding — the two list variants wrap it
 * (`<li>` card for the ledger, a tappable `<li>` card on the group feed).
 */
export function MovementCardBody({ line }: { line: MovementLineRow }) {
	const meta = MOVEMENT_LINE_META[line.direction] ?? MOVEMENT_LINE_META.in;
	const kindLabel = movementKindLabel(line.kind);
	const title = line.model_name?.trim() || '—';

	const hasQty = line.qty != null && Number.isFinite(line.qty);
	const qtyText = hasQty ? `${meta.sign}${formatCount(line.qty)}` : null;
	const dateText = dateLabel(line.date);

	// The body's identity line — the store (IN/OUT) or the route (TRF from → to)
	// sits NEXT TO the doc number; a doc without one still shows the store alone.
	const placeLabel =
		line.direction === 'trf'
			? [storeLabel(line.from_location), storeLabel(line.to_location)].map((label) => label ?? '—').join(' → ')
			: storeLabel(line.location);
	const docNo = line.doc_no?.trim() || null;
	const identityLine = docNo || placeLabel ? [docNo, placeLabel].filter((part) => part != null && part !== '').join(' · ') : null;

	// Reference extras — every one rendered only when present (one clipped line).
	const serialCount = serialUnitCount(line.serials);
	const extras: string[] = [];
	if (line.batch_no) extras.push(`Batch ${line.batch_no}`);
	if (serialCount > 0) extras.push(`Serial ${serialCount} unit(s)`);

	// Footer right — the line total (`qty × unit_price`); TRF lines carry no
	// price, and a line without qty can't total, so the block hides then.
	const unitPrice = line.unit_price;
	const total = hasQty && unitPrice != null && Number.isFinite(unitPrice) ? (line.qty as number) * (unitPrice as number) : null;

	// Footer left — the person who created the document (their employee name).
	const creator = line.created_name?.trim() || null;

	return (
		<div className="flex flex-col">
			{/* Top row — qty pill left · doc-type tag + date right. */}
			<div className="flex items-start justify-between gap-3">
				<span
					className={`inline-flex items-center rounded-full px-3.5 py-1 text-lg font-bold leading-none tabular-nums ${meta.chipClass}`}
					aria-label={`${meta.label} ${qtyText ?? '—'}`}
				>
					{qtyText ?? '—'}
				</span>
				<span className="flex shrink-0 items-center gap-2">
					{kindLabel && (
						<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-foreground/80">
							{kindLabel}
						</span>
					)}
					<span className="whitespace-nowrap text-sub font-medium leading-none text-muted-foreground tabular-nums">{dateText}</span>
				</span>
			</div>

			{/* Body — item name + its identity line, extras/note, dashed divider. */}
			<div className="mt-3 border-b border-dashed border-border pb-3">
				<h3 className="font-display text-[17px] font-semibold leading-tight text-foreground">{title}</h3>
				{identityLine && <p className="mt-1 truncate text-sub leading-myanmar text-muted-foreground">{identityLine}</p>}
				{extras.length > 0 && (
					<p className="mt-0.5 truncate text-meta font-medium leading-myanmar text-muted-foreground">{extras.join(' · ')}</p>
				)}
				{line.note && (
					<p className="mt-1.5 line-clamp-2 border-l-2 border-border pl-2 text-meta leading-myanmar text-muted-foreground">{line.note}</p>
				)}
			</div>

			{/* Footer — document creator left · line total right (blocks with nothing
				to show are omitted; a TRF row may carry only its creator). */}
			{(creator || total != null) && (
				<div className="mt-3 flex items-end justify-between gap-3">
					{creator && (
						<div className="min-w-0">
							<p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Created by</p>
							<p className="mt-0.5 truncate text-sm font-medium leading-myanmar text-foreground/90">{creator}</p>
						</div>
					)}
					{total != null && (
						<div className="ml-auto shrink-0 text-right">
							<p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Total</p>
							<p className="mt-0.5 whitespace-nowrap text-lg font-bold leading-none text-primary tabular-nums">{formatCount(total)} Ks</p>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
