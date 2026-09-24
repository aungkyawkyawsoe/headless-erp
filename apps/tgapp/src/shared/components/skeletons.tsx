/**
 * Shared shimmer loading skeletons — muted blocks shaped like the content they
 * replace (avatar circle, text lines, cards, action pills), each with the
 * moving light sweep from the `skeleton-shimmer` utility. Every block is
 * decorative: the surrounding container is `aria-hidden` and the real content
 * swaps in once the fetch settles.
 */

import type { ReactNode } from 'react';

/** Base shimmer block — size/shape via `className` (rounded, w/h, …). */
export function Shimmer({ className }: { className?: string }) {
	return <div aria-hidden className={`skeleton-shimmer ${className ?? ''}`} />;
}

/** The real card shell a skeleton mirrors — `request` = RequestCard,
 *  `employee` = EmployeeCard, `vehicle` = the plate-chip vehicle register card,
 *  `fleet` = FleetCard (photo tile + facts + care strip), `insurance` =
 *  InsuranceCard, `license` = LicenseCard, `tyre` = TyreCard,
 *  `store-request` = StoreRequestCard, `maintenance` = MaintenanceCard,
 *  `incidents` = IncidentCard, `scrapes` =
 *  ScrapeCard,
 *  `items` = ItemCard (photo + name header, dotted category/location facts),
 *  `approval` = the approval-center card (dotted fact rows + decision footer). */
export type ListSkeletonVariant =
	| 'request'
	| 'employee'
	| 'vehicle'
	| 'fleet'
	| 'insurance'
	| 'license'
	| 'tyre'
	| 'store-request'
	| 'maintenance'
	| 'incidents'
	| 'scrapes'
	| 'write-off'
	| 'items'
	| 'stock'
	| 'category'
	| 'approval'
	/** The dense ERP row — mirrors `ErpRow` (flat rows in one bordered frame). */
	| 'dense';

interface ListSkeletonProps {
	count?: number;
	/** Decision controls in the footer (approval center / pending own-rows). */
	showActions?: boolean;
	/** Which real card the skeleton mirrors — same radius, padding and size. */
	variant?: ListSkeletonVariant;
}

/** Variant → the row skeleton that mirrors that card — ONE lookup instead of a
 *  branching chain; `approval` forces the decision footer, `request` follows
 *  the caller's `showActions`. The row components below stay individual (each
 *  mirrors a real card's anatomy). */
const ROW_SKELETON: Record<ListSkeletonVariant, (showActions: boolean) => ReactNode> = {
	request: (showActions) => <RequestCardSkeleton showActions={showActions} />,
	approval: () => <RequestCardSkeleton showActions />,
	employee: () => <EmployeeRowSkeleton />,
	vehicle: () => <VehicleRowSkeleton />,
	fleet: () => <FleetRowSkeleton />,
	insurance: () => <InsuranceRowSkeleton />,
	license: () => <LicenseRowSkeleton />,
	tyre: () => <TyreRowSkeleton />,
	'store-request': () => <StoreRequestRowSkeleton />,
	maintenance: () => <MaintenanceRowSkeleton />,
	incidents: () => <IncidentRowSkeleton />,
	scrapes: () => <ScrapeRowSkeleton />,
	'write-off': () => <WriteoffRowSkeleton />,
	items: () => <ItemRowSkeleton />,
	stock: () => <StockRowSkeleton />,
	category: () => <CategoryRowSkeleton />,
	dense: () => <DenseRowSkeleton />,
};

/**
 * Skeleton rows shaped like the REAL cards they replace — same border radius,
 * card shell (`rounded-2xl`/`rounded-xl`/`rounded-lg` + padding) and internal
 * layout, so the loading state never reflows the list. `gap-3` matches the
 * card lists.
 */
export function ListSkeleton({ count = 4, showActions = false, variant = 'request' }: ListSkeletonProps) {
	// The dense variant lives in the SAME flat bordered frame the real
	// `ErpRow`s use, so the loading state cannot reflow into a card list.
	const dense = variant === 'dense';
	return (
		<ul
			className={
				dense ? 'flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card' : 'flex flex-col gap-3'
			}
			aria-hidden
		>
			{Array.from({ length: count }, (_, i) => (
				<li key={i}>{ROW_SKELETON[variant](variant === 'approval' || showActions)}</li>
			))}
		</ul>
	);
}

/**
 * Mirrors the employee edit wizard's အချက်အလက် step — three label + input
 * bars (name MM/EN, eid), the ကျား/မ radio pills and the မွေးသက္ကရာဇ် date
 * field. Same gaps and the same `h-11 rounded-xl` field blocks as the real
 * form, so the loading state never reflows when the form swaps in.
 */
export function FormSkeleton() {
	return (
		<div className="flex flex-col gap-4" aria-hidden>
			{/* အမည် (မြန်မာ) / အမည် (အင်္ဂလိပ်) / ဝန်ထမ်းအမှတ် — label + full-width input. */}
			{Array.from({ length: 3 }, (_, i) => (
				<div key={i}>
					<Shimmer className="mb-1.5 h-3.5 w-24 rounded" />
					<Shimmer className="h-11 w-full rounded-xl" />
				</div>
			))}
			{/* ကျား/မ — the two radio pills. */}
			<div>
				<Shimmer className="mb-1.5 h-3.5 w-14 rounded" />
				<div className="flex gap-6">
					<Shimmer className="h-6 w-20 rounded-full" />
					<Shimmer className="h-6 w-20 rounded-full" />
				</div>
			</div>
			{/* မွေးသက္ကရာဇ် — the date-picker field. */}
			<div>
				<Shimmer className="mb-1.5 h-3.5 w-20 rounded" />
				<Shimmer className="h-11 w-full rounded-xl" />
			</div>
		</div>
	);
}

/** Mirrors `RequestCard` in its `self` form (the my-request lists) — a TYPE
 *  glyph + date header, the type's dotted-leader fact rows on the face, a reason
 *  quote and a quiet submission footnote. The approval center uses the 'approval'
 *  variant below, which keeps the applicant avatar. */
function RequestCardSkeleton({ showActions }: { showActions: boolean }) {
	return (
		<div className="rounded-2xl border border-border bg-card shadow-card">
			{/* Header — type tile + date, status pill top-right. */}
			<div className="flex items-center justify-between gap-3 px-3.5 pt-3.5">
				<div className="flex min-w-0 flex-1 items-center gap-2.5">
					<Shimmer className="size-9 shrink-0 rounded-xl" />
					<Shimmer className="h-4 w-28 rounded" />
				</div>
				<Shimmer className="h-5 w-14 shrink-0 rounded-full" />
			</div>

			{/* Face — duration chip + submitted stamp, then the dotted fact rows
			 * (ရက်စွဲ / အချိန် / တာဝန်လွှဲ …). */}
			<div className="flex flex-col gap-2.5 px-3.5 pt-2.5 pb-3.5">
				<div className="flex items-center justify-between gap-2">
					<Shimmer className="h-3.5 w-20 rounded" />
					<Shimmer className="h-3 w-14 rounded" />
				</div>
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center gap-2">
						<Shimmer className="h-3 w-12 shrink-0 rounded" />
						<Shimmer className="h-3 w-full rounded" />
						<Shimmer className="h-3 w-16 shrink-0 rounded" />
					</div>
					<div className="flex items-center gap-2">
						<Shimmer className="h-3 w-14 shrink-0 rounded" />
						<Shimmer className="h-3 w-full rounded" />
						<Shimmer className="h-3 w-12 shrink-0 rounded" />
					</div>
				</div>

				{/* Reason quote — left-ruled two clamped lines. */}
				<div className="border-l-2 border-border/60 pl-2.5">
					<Shimmer className="h-3 w-full rounded" />
					<Shimmer className="mt-1.5 h-3 w-4/5 rounded" />
				</div>
			</div>

			{showActions ? (
				<div className="flex items-center justify-end gap-2 border-t border-border/70 px-3.5 py-2.5">
					<Shimmer className="size-9 rounded-full" />
					<Shimmer className="size-9 rounded-full" />
				</div>
			) : null}
		</div>
	);
}

/** Mirrors `EmployeeCard` — one compact row: avatar + name/meta. */
function EmployeeRowSkeleton() {
	return (
		<div className="flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-card px-3 py-1.5 shadow-card">
			<Shimmer className="size-10 shrink-0 rounded-full" />
			<div className="min-w-0 flex-1">
				<Shimmer className="h-4.5 w-28 rounded" />
				<Shimmer className="mt-2 h-3.5 w-40 rounded" />
			</div>
		</div>
	);
}

/** Mirrors the plate-chip vehicle register cards — plate chip + brand · type
 *  meta, the year chip top-right, then the two dotted-leader fact rows. */
function VehicleRowSkeleton() {
	return (
		<div className="rounded-xl border border-border bg-card p-3.5 shadow-card">
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<Shimmer className="h-6 w-20 rounded-md" />
					<Shimmer className="h-3.5 w-24 rounded" />
				</div>
				<Shimmer className="h-5 w-10 shrink-0 rounded-md" />
			</div>

			<div className="mt-3 flex flex-col gap-1.5">
				<Shimmer className="h-3.5 w-full rounded" />
				<Shimmer className="h-3.5 w-3/4 rounded" />
			</div>
		</div>
	);
}

/** Mirrors `FleetCard` — the flush left PHOTO tile + the stacked identity (plate
 *  with the wheel + length spec tags on ITS line, then brand · unit · year, then
 *  the license place), and the care strip.
 *  Same `h-[160px]` and `rounded-2xl` as the real card. */
function FleetRowSkeleton() {
	return (
		<div className="flex h-[160px] overflow-hidden rounded-2xl border border-border bg-card shadow-card">
			<Shimmer className="w-32 shrink-0 self-stretch rounded-none" />
			<div className="flex min-w-0 flex-1 flex-col justify-between p-2.5">
				<div className="flex flex-col gap-1.5">
					<div>
						<div className="flex items-center gap-2">
							<Shimmer className="h-6 w-24 rounded bg-muted" />
							<div className="ml-auto flex shrink-0 items-center gap-1">
								<Shimmer className="h-5 w-9 rounded bg-muted" />
								<Shimmer className="h-5 w-9 rounded bg-muted" />
							</div>
						</div>
						<Shimmer className="mt-0.5 h-3.5 w-32 rounded bg-muted" />
						<Shimmer className="mt-0.5 h-3.5 w-20 rounded bg-muted" />
					</div>
					<div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1.5 pr-1">
						<Shimmer className="h-5 w-24 rounded-full bg-muted shrink-0" />
						<Shimmer className="h-5 w-24 rounded-full bg-muted shrink-0" />
					</div>
				</div>
			</div>
		</div>
	);
}

/** Mirrors `InsuranceCard` — plate + provider chips, the remaining-days pill,
 *  then the two dotted-leader rows. */
function InsuranceRowSkeleton() {
	return (
		<div className="rounded-xl border border-border bg-card p-3.5 shadow-card">
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<Shimmer className="h-6 w-20 rounded-md" />
					<Shimmer className="h-4 w-16 rounded-md" />
				</div>
				<Shimmer className="h-5 w-16 shrink-0 rounded-full" />
			</div>

			<div className="mt-3 flex flex-col gap-1.5">
				<Shimmer className="h-3.5 w-full rounded" />
				<Shimmer className="h-3.5 w-3/4 rounded" />
			</div>
		</div>
	);
}

/** Mirrors `LicenseCard` — plate + brand chips, the remaining-days pill,
 *  then the two dotted-leader rows. */
function LicenseRowSkeleton() {
	return (
		<div className="rounded-xl border border-border bg-card p-3.5 shadow-card">
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<Shimmer className="h-6 w-20 rounded-md" />
					<Shimmer className="h-4 w-12 rounded-md" />
				</div>
				<Shimmer className="h-5 w-16 shrink-0 rounded-full" />
			</div>

			<div className="mt-3 flex flex-col gap-1.5">
				<Shimmer className="h-3.5 w-full rounded" />
				<Shimmer className="h-3.5 w-3/4 rounded" />
			</div>
		</div>
	);
}

/** Mirrors `TyreCard` — model row + identity chip, the condition (label
 *  + thickness over the bar) and the S/N footer. */
function TyreRowSkeleton() {
	return (
		<div className="rounded-2xl border border-border bg-card p-4 shadow-card">
			<div className="flex items-center justify-between gap-3">
				<Shimmer className="h-5 w-36 rounded" />
				<Shimmer className="h-6 w-24 shrink-0 rounded-md" />
			</div>
			<div className="mt-2.5">
				<div className="flex items-center justify-between">
					<Shimmer className="h-3.5 w-28 rounded" />
					<Shimmer className="h-5 w-14 rounded" />
				</div>
				<Shimmer className="mt-2.5 h-1.5 w-full rounded-full" />
			</div>
			<div className="mt-3 flex items-center justify-between border-t border-dashed border-border/70 pt-2.5">
				<Shimmer className="h-4 w-36 rounded" />
				<Shimmer className="h-3.5 w-16 rounded" />
			</div>
		</div>
	);
}

/** Mirrors `StoreRequestCard` — plate chip + status pill, the dotted-leader
 *  department row, the description quote and the requester + age footer. */
function StoreRequestRowSkeleton() {
	return (
		<div className="rounded-2xl border border-border bg-card p-4 shadow-card">
			<div className="flex items-start justify-between gap-3">
				<Shimmer className="h-6 w-20 rounded-md" />
				<Shimmer className="h-5 w-16 shrink-0 rounded-full" />
			</div>
			<div className="mt-3 flex items-center gap-2">
				<Shimmer className="h-3.5 w-16 rounded" />
				<Shimmer className="ml-auto h-3 w-20 rounded" />
			</div>
			{/* The description quote — BELOW the department row, matching the card. */}
			<div className="mt-2.5 border-l-2 border-border/60 pl-2.5">
				<Shimmer className="h-3 w-3/4 rounded" />
				<Shimmer className="mt-1.5 h-3 w-1/2 rounded" />
			</div>
			<div className="mt-3 flex items-center gap-2 border-t border-dashed border-border/70 pt-2.5">
				<Shimmer className="size-6 shrink-0 rounded-full" />
				<Shimmer className="h-3 w-20 rounded" />
				<Shimmer className="ml-auto h-3 w-14 rounded" />
			</div>
		</div>
	);
}

/** Mirrors `MaintenanceCard` — plate chip + status pill, the two dotted-leader
 *  fact rows (Reported Date / Cost), the description quote and the requester +
 *  age footer. */
function MaintenanceRowSkeleton() {
	return (
		<div className="rounded-2xl border border-border bg-card p-4 shadow-card">
			<div className="flex items-start justify-between gap-3">
				<Shimmer className="h-6 w-20 rounded-md" />
				<Shimmer className="h-5 w-16 shrink-0 rounded-full" />
			</div>
			<div className="mt-3 flex flex-col gap-1.5">
				<div className="flex items-center gap-2">
					<Shimmer className="h-3.5 w-24 rounded" />
					<Shimmer className="ml-auto h-3 w-24 rounded" />
				</div>
				<div className="flex items-center gap-2">
					<Shimmer className="h-3.5 w-12 rounded" />
					<Shimmer className="ml-auto h-3 w-16 rounded" />
				</div>
			</div>
			{/* The description quote — BELOW the fact rows, matching the card. */}
			<div className="mt-2.5 border-l-2 border-border/60 pl-2.5">
				<Shimmer className="h-3 w-3/4 rounded" />
				<Shimmer className="mt-1.5 h-3 w-1/2 rounded" />
			</div>
			<div className="mt-3 flex items-center gap-2 border-t border-dashed border-border/70 pt-2.5">
				<Shimmer className="size-6 shrink-0 rounded-full" />
				<Shimmer className="h-3 w-20 rounded" />
				<Shimmer className="ml-auto h-3 w-14 rounded" />
			</div>
		</div>
	);
}

/** Mirrors `IncidentCard` — plate chip + severity pill, the description, the
 *  two dotted-leader fact rows (location · date / est. claim-cost) and the
 *  reporter + age footer. */
function IncidentRowSkeleton() {
	return (
		<div className="rounded-2xl border border-border bg-card p-4 shadow-card">
			<div className="flex items-start justify-between gap-3">
				<Shimmer className="h-6 w-20 rounded-md" />
				<Shimmer className="h-5 w-16 shrink-0 rounded-full" />
			</div>
			<div className="mt-3 flex flex-col gap-1.5">
				<div className="flex items-center gap-2">
					<Shimmer className="h-3.5 w-28 rounded" />
					<Shimmer className="ml-auto h-3 w-24 rounded" />
				</div>
				<div className="flex items-center gap-2">
					<Shimmer className="h-3.5 w-24 rounded" />
					<Shimmer className="ml-auto h-3 w-16 rounded" />
				</div>
			</div>
			{/* The description quote — BELOW the fact rows, matching the card. */}
			<div className="mt-2.5 border-l-2 border-border/60 pl-2.5">
				<Shimmer className="h-3 w-3/4 rounded" />
				<Shimmer className="mt-1.5 h-3 w-1/2 rounded" />
			</div>
			<div className="mt-3 flex items-center gap-2 border-t border-dashed border-border/70 pt-2.5">
				<Shimmer className="size-6 shrink-0 rounded-full" />
				<Shimmer className="h-3 w-20 rounded" />
				<Shimmer className="ml-auto h-3 w-14 rounded" />
			</div>
		</div>
	);
}

/** Mirrors `ScrapeCard` — the plate chip with the reason pill top-right, the
 *  item (qty) · date fact row, the description quote and the requester + age
 *  footer. */
function ScrapeRowSkeleton() {
	return (
		<div className="rounded-2xl border border-border bg-card p-4 shadow-card">
			<div className="flex items-start justify-between gap-3">
				<Shimmer className="h-6 w-20 rounded-md" />
				<Shimmer className="h-5 w-16 shrink-0 rounded-full" />
			</div>
			<div className="mt-3 flex items-center gap-2">
				<Shimmer className="h-3.5 w-24 rounded" />
				<Shimmer className="ml-auto h-3 w-32 rounded" />
			</div>
			{/* The description quote — BELOW the fact rows, matching the card. */}
			<div className="mt-2.5 border-l-2 border-border/60 pl-2.5">
				<Shimmer className="h-3 w-3/4 rounded" />
				<Shimmer className="mt-1.5 h-3 w-1/2 rounded" />
			</div>
			<div className="mt-3 flex items-center gap-2 border-t border-dashed border-border/70 pt-2.5">
				<Shimmer className="size-6 shrink-0 rounded-full" />
				<Shimmer className="h-3 w-20 rounded" />
				<Shimmer className="ml-auto h-3 w-14 rounded" />
			</div>
		</div>
	);
}

/** Mirrors `WriteoffCard` — the item chip with the reason pill top-right, the
 *  date · qty fact row, the description quote and the requester + age footer. */
function WriteoffRowSkeleton() {
	return (
		<div className="rounded-2xl border border-border bg-card p-4 shadow-card">
			<div className="flex items-start justify-between gap-3">
				<Shimmer className="h-6 w-24 rounded-md" />
				<Shimmer className="h-5 w-16 shrink-0 rounded-full" />
			</div>
			<div className="mt-3 flex items-center gap-2">
				<Shimmer className="h-3.5 w-24 rounded" />
				<Shimmer className="ml-auto h-3 w-16 rounded" />
			</div>
			{/* The description quote — BELOW the fact row, matching the card. */}
			<div className="mt-2.5 border-l-2 border-border/60 pl-2.5">
				<Shimmer className="h-3 w-3/4 rounded" />
				<Shimmer className="mt-1.5 h-3 w-1/2 rounded" />
			</div>
			<div className="mt-3 flex items-center gap-2 border-t border-dashed border-border/70 pt-2.5">
				<Shimmer className="size-6 shrink-0 rounded-full" />
				<Shimmer className="h-3 w-20 rounded" />
				<Shimmer className="ml-auto h-3 w-14 rounded" />
			</div>
		</div>
	);
}

/** Mirrors `ErpRow` — the 3-scale face inside a flush bordered frame: the L1
 *  anchor (bold) over the L2 identity line, with the L3 meta stub and the status
 *  pill pinned top-right. No outer card chrome — the list frame owns it. */
function DenseRowSkeleton() {
	return (
		<div className="flex min-h-14 items-start justify-between gap-2.5 px-3 py-2.5">
			<div className="min-w-0 flex-1">
				<Shimmer className="h-4 w-24 rounded" />
				<Shimmer className="mt-1.5 h-3 w-32 rounded" />
				<Shimmer className="mt-1.5 h-2.5 w-40 rounded" />
			</div>
			<Shimmer className="h-5 w-16 shrink-0 rounded-full" />
		</div>
	);
}

/** Mirrors `MroCategoryCard` — two compact lines: the EN title over the muted
 *  MM line (thin padding, no inter-line gap). */
function CategoryRowSkeleton() {
	return (
		<div className="rounded-xl border border-border bg-card px-3 py-2 shadow-card">
			<Shimmer className="h-5 w-2/3 rounded" />
			<Shimmer className="mt-0.5 h-4 w-1/3 rounded" />
		</div>
	);
}

/** Mirrors `ItemCard` — photo block + name/subtitle header, with the location
 *  chip and the remaining-qty number on the SAME bottom row (no fact rows, no
 *  footer). */
function ItemRowSkeleton() {
	return (
		<div className="rounded-xl border border-border bg-card p-2.5 shadow-card">
			{/* Header — photo + name/subtitle. */}
			<div className="flex items-center gap-3">
				<Shimmer className="h-22 w-22 shrink-0 rounded-lg" />
				<div className="min-w-0 flex-1">
					<Shimmer className="h-4.5 w-28 rounded" />
					<Shimmer className="mt-2 h-3.5 w-36 rounded" />
					{/* Chip row — location chip left, remaining number right. */}
					<div className="mt-1.5 flex items-center gap-2">
						<Shimmer className="h-5 w-24 shrink-0 rounded-full" />
						<Shimmer className="ml-auto mr-1.5 h-4.5 w-8 shrink-0 rounded" />
					</div>
				</div>
			</div>
		</div>
	);
}

/** Mirrors `StockCard` — the item identity block (photo + name/subtitle +
 *  location chip) over the လက်ကျန် row with its circular ring at the corner. */
function StockRowSkeleton() {
	return (
		<div className="rounded-xl border border-border bg-card p-2.5 shadow-card">
			{/* Header — photo + name/subtitle + location chip. */}
			<div className="flex items-center gap-3">
				<Shimmer className="h-22 w-22 shrink-0 rounded-lg" />
				<div className="min-w-0 flex-1">
					<Shimmer className="h-4.5 w-28 rounded" />
					<Shimmer className="mt-2 h-3.5 w-36 rounded" />
					<Shimmer className="mt-1.5 h-5 w-24 shrink-0 rounded-full" />
				</div>
			</div>
			{/* Gauge — လက်ကျန် label + the qty with the circular ring at the corner. */}
			<div className="mt-2.5 flex items-center justify-between gap-3 border-t border-dashed border-border/70 pt-2">
				<Shimmer className="h-3.5 w-12 rounded" />
				<div className="flex items-center gap-2">
					<Shimmer className="h-4.5 w-8 rounded" />
					<Shimmer className="size-5 shrink-0 rounded-full" />
				</div>
			</div>
		</div>
	);
}
