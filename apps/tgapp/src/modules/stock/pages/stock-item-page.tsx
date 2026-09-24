import { useQuery } from '@tanstack/react-query';
import { DENSE_CARD_FRAME } from '@/shared/components/card';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { linesOf, type StockLine, type StockLineTone } from '../data/lines';
import { qk, STOCK_STALE_MS } from '../data/query-keys';
import { EmptyState } from '@/shared/components/empty-state';
import { ModuleShell } from '@/shared/components/module-shell';
import { Shimmer } from '@/shared/components/skeletons';
import { mroApi, itemModelEditPath } from '@/shared/mro';
import { canReadCollection } from '@/shared/app-access';
import { getCachedMe } from '@/shared/auth';
import { ItemThumb } from '@/shared/components/item-thumb';
import { hapticImpact } from '@/shared/platform/haptics';

/**
 * စတော့ → ONE item's stock lines (`/app/stocks/item/:modelId`) — the full-screen
 * answer to a stock card tap, replacing the former inline expansion. Reached
 * from BOTH stock surfaces (the kiosk's cross-store result rows and the alert
 * dashboard), so the back arrow pops to wherever the operator came from.
 *
 * The page shows the SKU's details as a split card — the item's photo FULL
 * HEIGHT on the left, and its name / part-group / on-hand + expired totals on the
 * right — and then its inventory lines by that policy — a batch item's FEFO lots,
 * a serial item's units (one line each, tapping through to the unit page), a plain
 * item's per-store balances. The line caption names the policy in words ("Lots ·
 * soonest expiry first"), so the policy is stated where it explains something and
 * is NOT printed a second time as a chip on the header. Read-only on purpose:
 * stock is written only by a confirmed
 * document under a two-person rule, so there are deliberately NO inline
 * issue/adjust/transfer actions here — the master edit is the ONLY write-side
 * errand, and it is the DETAILS CARD itself (tap → `/app/items/:id/edit`), gated
 * on the session's read grant for `mro_item_model`. The card's left tile shows
 * the SKU's own photo (its monogram when it has none).
 */

/** The qty tone → theme token (light + dark safe). */
const TONE_CLASS: Record<StockLineTone, string> = {
	neutral: 'text-foreground',
	warning: 'text-status-warning',
	danger: 'text-status-danger',
};

/** What the line list below IS, in the policy's own words. */
const LINE_CAPTION: Record<string, string> = {
	standard: 'Balances by store',
	batch: 'Lots · soonest expiry first',
	serial: 'In-stock units',
};

/** The card that was tapped can hand the header over for an instant paint
 *  (the same convention as the tyre unit page). It is never trusted for
 *  anything but the title/photo — the authoritative read follows. */
interface StockItemSeed {
	name?: string;
	image?: string | null;
}

export default function StockItemPage() {
	const { modelId } = useParams<{ modelId: string }>();
	const navigate = useNavigate();
	const location = useLocation();

	const seed = useMemo<StockItemSeed>(() => {
		const state = location.state as StockItemSeed | null;
		return state && typeof state === 'object' ? state : {};
	}, [location.state]);

	const query = useQuery({
		queryKey: qk.itemStock(modelId ?? ''),
		queryFn: () => mroApi.itemStock(modelId as string),
		enabled: Boolean(modelId),
		staleTime: STOCK_STALE_MS,
	});

	const composition = query.data;
	const model = composition?.model;
	const lines = useMemo(() => (composition ? linesOf(composition) : []), [composition]);

	const title = model?.name_en ?? model?.name_mm ?? seed.name ?? 'Stock lines';
	const image = model?.image ?? seed.image ?? null;
	// The master edit is a WRITE screen: offer it only to a session that may at
	// least read the SKU collection (deny-by-default — no button leading to a 403).
	const canEditMaster = useMemo(() => {
		const me = getCachedMe();
		return me ? canReadCollection(me, 'mro_item_model') : false;
	}, []);
	/** The card's tap target — the SKU's master edit (no app-bar pencil any more). */
	const openMaster = useCallback(() => {
		if (!canEditMaster || !modelId) return;
		hapticImpact('light');
		navigate(itemModelEditPath(modelId));
	}, [canEditMaster, modelId, navigate]);

	return (
		<ModuleShell title={title} backTo="/app/stocks">
			{query.isPending ? (
				<StockItemSkeleton />
			) : query.isError || !composition ? (
				<div className="flex flex-col items-center gap-2.5 rounded-xl border border-border bg-card/50 px-4 py-8 text-center">
					<p className="text-sm font-medium leading-myanmar text-destructive">Couldn't read this item's stock</p>
					<p className="text-xs leading-myanmar text-muted-foreground">The item may have been removed, or the connection dropped.</p>
					<button
						type="button"
						onClick={() => void query.refetch()}
						className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
					>
						Try again
					</button>
				</div>
			) : (
				<div className="flex flex-col gap-3">
					{/* ── The item's own details — the FULL-HEIGHT photo on the left, the
					    identity + the totals the lines below must add up to on the right.
					    Tapping the card opens the SKU's edit form (no app-bar pencil). ── */}
					<section className={`overflow-hidden ${DENSE_CARD_FRAME} shadow-card`}>
						<button
							type="button"
							onClick={openMaster}
							disabled={!canEditMaster}
							aria-label={canEditMaster ? `${title} — edit item model` : undefined}
							className="flex w-full items-stretch text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
						>
							{/* The item's OWN image, full card height (its monogram when it has
							    none) — the row's identity is the thing, not a generic glyph. */}
							<span className="w-28 shrink-0 self-stretch overflow-hidden bg-muted/40">
								<ItemThumb name={title} image={image} className="flex size-full items-center justify-center text-2xl" />
							</span>

							<span className="flex min-w-0 flex-1 flex-col gap-3 p-4">
								<span className="flex min-w-0 flex-col gap-0.5">
									{/* The identity line: the model name on the left and the ON-HAND
									    figure on the right, at the SAME level — the bare number the
									    lines below add up to (no label; its accessible name carries
									    the meaning for screen readers). The name WRAPS rather than
									    truncating — it is the one thing this page is about. */}
									<span className="flex min-w-0 items-baseline gap-2">
										<span className="min-w-0 flex-1 font-display text-key font-semibold leading-tight text-foreground">{title}</span>
										<span
											aria-label={`On hand ${composition.totals.on_hand}`}
											className="ml-auto shrink-0 text-base font-semibold leading-none tabular-nums text-foreground"
										>
											{composition.totals.on_hand}
										</span>
									</span>
									<span className="text-xs leading-myanmar text-muted-foreground">{model?.group_name ?? model?.name_mm ?? '—'}</span>
								</span>

								{/* The remaining fact: whether the SKU sits under its reorder level. There
								    is deliberately NO tracking-policy chip — the caption above the line
								    list below already says what those lines ARE (lots / units /
								    balances), so a chip restated the same policy a second time. When
								    there is neither an expired slice nor a reorder flag the row is
								    omitted entirely — a divider over two absent facts is pure ink. */}
								{composition.totals.expired > 0 || composition.totals.any_below_reorder ? (
									<span className="flex items-end gap-4 border-t border-border/60 pt-3">
										{composition.totals.expired > 0 ? (
											<Stat label="Expired" value={String(composition.totals.expired)} tone="text-status-danger" />
										) : null}
										{composition.totals.any_below_reorder ? (
											<Stat label="Below reorder" value="Yes" tone="text-status-warning" icon />
										) : null}
									</span>
								) : null}
							</span>
						</button>
					</section>

					{/* ── The inventory lines, by tracking policy ────────────────── */}
					<section className="flex flex-col">
						<p className="mb-1.5 text-meta font-semibold uppercase tracking-wide text-muted-foreground">
							{LINE_CAPTION[model?.tracking ?? 'standard'] ?? 'Stock lines'}
						</p>
						{lines.length === 0 ? (
							<EmptyState title="No stock lines yet" hint="Nothing has been received for this item in any store." />
						) : (
							<div className={`overflow-hidden ${DENSE_CARD_FRAME} shadow-card`}>
								<ul className="divide-y divide-border/70">
									{lines.map((line) => (
										<StockLineRow key={line.key} line={line} />
									))}
								</ul>
							</div>
						)}
					</section>
				</div>
			)}
		</ModuleShell>
	);
}

/** One headline number in the details card. */
function Stat({ label, value, tone = 'text-foreground', icon = false }: { label: string; value: string; tone?: string; icon?: boolean }) {
	return (
		<div className="flex flex-col">
			<span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
			<span className={`flex items-center gap-1 text-base font-semibold leading-tight tabular-nums ${tone}`}>
				{icon ? <AlertTriangle className="size-3.5 shrink-0" strokeWidth={2.2} aria-hidden /> : null}
				{value}
			</span>
		</div>
	);
}

/** ONE inventory line — identity over its detail, the quantity on the right.
 *  A read-out row, deliberately NOT a doorway: this list answers "what is here",
 *  so it paints no tap target (no chevron, no hover) and nothing here writes
 *  stock. */
function StockLineRow({ line }: { line: StockLine }) {
	return (
		<li className="flex w-full items-center gap-3 px-4 py-3">
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<p className="truncate text-[14px] font-semibold leading-tight text-foreground">{line.primary}</p>
				{line.secondary ? <p className="truncate text-meta leading-myanmar text-muted-foreground">{line.secondary}</p> : null}
			</div>
			{line.qty != null ? (
				<span className={`shrink-0 text-base font-semibold leading-none tabular-nums ${TONE_CLASS[line.tone]}`}>{line.qty}</span>
			) : null}
		</li>
	);
}

/** The first-paint shape — the details card and two lines. */
function StockItemSkeleton() {
	return (
		<div className="flex flex-col gap-3" aria-hidden>
			<div className={`${DENSE_CARD_FRAME} p-4 shadow-card`}>
				<div className="flex items-center gap-3.5">
					<Shimmer className="size-14 shrink-0 rounded-xl" />
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						<Shimmer className="h-4 w-2/3 rounded" />
						<Shimmer className="h-3 w-1/3 rounded" />
					</div>
				</div>
			</div>
			<div className={`overflow-hidden ${DENSE_CARD_FRAME} shadow-card`}>
				{[0, 1, 2].map((i) => (
					<div key={i} className="flex items-center gap-3 border-b border-border/70 px-4 py-3 last:border-b-0">
						<div className="flex min-w-0 flex-1 flex-col gap-1.5">
							<Shimmer className="h-4 w-1/2 rounded" />
							<Shimmer className="h-3 w-2/3 rounded" />
						</div>
						<Shimmer className="h-5 w-8 shrink-0 rounded" />
					</div>
				))}
			</div>
		</div>
	);
}
