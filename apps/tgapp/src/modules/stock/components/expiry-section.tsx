import { CalendarClock, Check, Copy, FileText } from 'lucide-react';
import { DENSE_CARD_FRAME } from '@/shared/components/card';
import { useEffect, useRef, useState } from 'react';
import type { MroExpiryRow } from '@/shared/mro';

import { EmptyState } from '@/shared/components/empty-state';
import { Shimmer } from '@/shared/components/skeletons';
import { formatEnglishDateLabel } from '@/shared/time/myanmar';
import { hapticImpact } from '@/shared/platform/haptics';
import { EXPIRY_KIND_LABELS, fmtQty, modelNameOf } from './display';

/** The expiry section's DOM anchor — the summary strip's သက်တမ်းကုန်ခါနီး tile
 *  scrolls here (the page owns the scroll handler). */
export const EXPIRY_SECTION_ID = 'stock-expiry';

interface ExpirySectionProps {
	/** The alerting rows, sorted expired-first then by days_left (`fetchAlertingExpiry`). */
	rows: MroExpiryRow[];
	/** While the expiry feed is fetching, render shimmer rows. */
	loading?: boolean;
	/** The raw route failed — say so with a retry. */
	error?: boolean;
	/** Retry the failed read (the page's refresh handler). */
	onRetry: () => void;
	/** 📄 tap — open the expiring model's record on the catalog (`/app/items/:id`).
	 *  Absent, the row shows no document action (same affordance as the on-hand rows). */
	onOpenDocument?: (row: MroExpiryRow) => void;
	/** Bare mode — no outer section padding/anchor and no internal header/count.
	 *  For a page that already labels the feed in its own top tab (the stock page);
	 *  the standalone dashboard section keeps its title + id + big top gap. */
	bare?: boolean;
}

/**
 * Expiry alerts — every lot/serial the report flags as "act now" (expired, or
 * inside its model's alert window), expired first then soonest-expiring. The
 * CARD anatomy mirrors the dashboard's on-hand (`OnHandRow`) reference: a round
 * qty badge on the left (qty at risk), the model over its batch/serial ref and an
 * inline “Expires <date> · N days” line in the centre, and 📄 / ⋮ on the right —
 * so all four stock tabs read as one visual language.
 */
export function ExpirySection({ rows, loading = false, error = false, onRetry, onOpenDocument, bare = false }: ExpirySectionProps) {
	const body = loading ? (
		<div className={`overflow-hidden ${DENSE_CARD_FRAME} shadow-card`}>
			{[0, 1, 2].map((i) => (
				<div key={i} className="flex items-center gap-3.5 border-b border-border/70 px-4 py-3.5 last:border-b-0">
					<Shimmer className="size-12 shrink-0 rounded-full" />
					<div className="min-w-0 flex-1 space-y-1.5">
						<Shimmer className="h-4 w-1/2 rounded" />
						<Shimmer className="h-3 w-2/3 rounded" />
					</div>
					<Shimmer className="h-5 w-20 shrink-0 rounded-full" />
				</div>
			))}
		</div>
	) : error ? (
		<div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/50 px-4 py-6 text-center">
			<p className="text-sm font-medium leading-myanmar text-destructive">Couldn't read expiry alerts</p>
			<button
				type="button"
				onClick={onRetry}
				className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
			>
				Try again
			</button>
		</div>
	) : rows.length === 0 ? (
		<EmptyState title="No expiry alerts" hint="Every expiring item in this store is healthy." />
	) : (
		// The same reference list container the on-hand rows live in — one rounded
		// white card with hairline dividers, so the Expiring Soon feed reads as the
		// sibling of In Stock / Reorder / Stock Out.
		<div className={`overflow-hidden ${DENSE_CARD_FRAME} shadow-card`}>
			<div className="divide-y divide-border/70">
				{rows.map((row) => (
					<ExpiryRow key={row.id} row={row} onOpenDocument={onOpenDocument && row.model ? () => onOpenDocument(row) : undefined} />
				))}
			</div>
		</div>
	);

	if (bare) {
		return body;
	}

	return (
		<section id={EXPIRY_SECTION_ID} className="mt-8 scroll-mt-36">
			<div className="mb-3 flex items-center justify-between gap-3">
				<h2 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold leading-myanmar text-foreground">
					<CalendarClock className="size-4 shrink-0 text-muted-foreground" strokeWidth={2.1} aria-hidden />
					<span className="truncate">Expiring soon alerts</span>
				</h2>
				{rows.length > 0 ? (
					<span className="shrink-0 rounded-full bg-status-danger-soft px-2 py-0.5 text-meta font-semibold leading-myanmar text-status-danger tabular-nums">
						{rows.length}
					</span>
				) : null}
			</div>

			{body}
		</section>
	);
}

/**
 * One alerting lot/serial row — mirrors the on-hand / reorder card recipe: a
 * circular qty-at-risk badge on the left, the model name over a muted ref + the
 * “Expires <date> · N days” inline line in the centre, and 📄 / ⋮ on the right.
 * The row is always under the page's store-scoped filter, so the store is never
 * repeated inside the card.
 */
function ExpiryRow({ row, onOpenDocument }: { row: MroExpiryRow; onOpenDocument?: () => void }) {
	const expired = row.days_left < 0;
	const kindLabel = EXPIRY_KIND_LABELS[row.kind] ?? row.kind;
	const dateLabel = formatEnglishDateLabel(row.expiry_date);
	const detail = `${kindLabel}${row.ref ? ` · ${row.ref}` : ''}`;

	return (
		<article className="flex items-center gap-3.5 px-4 py-3.5 transition-colors duration-150 hover:bg-muted/30 active:bg-muted/40">
			{/* Quantity-at-risk circle — same 48px badge as the on-hand reference, red
				when already expired, amber while inside the alert window. */}
			<div
				className={`flex size-12 shrink-0 items-center justify-center rounded-full text-base font-semibold leading-none tabular-nums ${
					expired ? 'bg-status-danger-soft text-status-danger' : 'bg-status-warning-soft text-status-warning'
				}`}
				// Hue is the glance cue; the accessible name states the state itself so an
				// expired lot is not "At risk" only to sighted users.
				aria-label={`${expired ? 'Expired' : 'Expiring soon'} — ${fmtQty(row.qty)} at risk`}
			>
				{fmtQty(row.qty)}
			</div>

			{/* Details — the model name over a ref line and the Expires line (mirrors
				OnHandRow's centred column so all four stock tabs share a card language). */}
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<p className="font-display text-key font-semibold leading-tight text-foreground">{modelNameOf(row)}</p>
				<p className="truncate text-xs leading-myanmar text-muted-foreground">{detail}</p>
				<span
					className={`inline-flex items-center gap-1 text-xs leading-myanmar tabular-nums ${expired ? 'text-status-danger' : 'text-status-warning'}`}
				>
					Expires {dateLabel ?? '—'}
					<span aria-hidden>·</span>
					<span className="font-semibold">{expired ? 'Expired' : `${row.days_left} days`}</span>
				</span>
			</div>

			{/* 📄 opens the item record, ⋮ copies the name — same right affordances as
				the on-hand rows (no alert pill here: the time lives on the Expires line). */}
			<div className="ml-1 flex shrink-0 items-center gap-1">
				{onOpenDocument ? (
					<button
						type="button"
						onClick={onOpenDocument}
						aria-label="Open item record"
						className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<FileText className="size-4.5" aria-hidden />
					</button>
				) : null}
				<CopyNameButton name={modelNameOf(row)} />
			</div>
		</article>
	);
}

/** The ⋮ copy button — same affordance as the on-hand rows' copy (haptic + ✓). */
function CopyNameButton({ name }: { name: string }) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<number | null>(null);

	useEffect(
		() => () => {
			if (timer.current != null) window.clearTimeout(timer.current);
		},
		[],
	);

	const copy = () => {
		hapticImpact('light');
		void navigator.clipboard
			?.writeText(name)
			.then(() => {
				setCopied(true);
				if (timer.current != null) window.clearTimeout(timer.current);
				timer.current = window.setTimeout(() => setCopied(false), 1200);
			})
			.catch(() => undefined);
	};

	return (
		<button
			type="button"
			onClick={copy}
			aria-label={copied ? 'Copied' : 'Copy item name'}
			className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			{copied ? <Check className="size-4.5 text-status-success" aria-hidden /> : <Copy className="size-4.5" aria-hidden />}
		</button>
	);
}
