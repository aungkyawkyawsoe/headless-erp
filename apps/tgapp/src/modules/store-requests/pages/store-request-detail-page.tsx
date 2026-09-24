import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { CARD_FRAME, DENSE_CARD_FRAME } from '@/shared/components/card';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Loader2, Minus, Package, Plus, XCircle } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';

import { ConfirmSheet } from '@/shared/components/confirm-sheet';
import { ModuleShell } from '@/shared/components/module-shell';
import { hapticImpact } from '@/shared/platform/haptics';
import { encodePrefillJson, fetchRequisitionView, issueRequisition, rejectRequisition, updateRequisition } from '../data/api';
import { fetchCurrentEmployee } from '@/modules/attendance/data/api';
import { qk, REQUISITIONS_STALE_MS } from '../data/query-keys';
import { REQUISITION_CLOSE_REASONS } from '../data/status';
import type { OutboundPrefillLine } from '@/modules/goods-issues/components/outbound-doc-form';
import { StoreRequestCard } from '../components/store-request-card';
import { RequisitionForm, type RequisitionFormInitial, type RequisitionFormValue } from '../components/requisition-form';
import { notifySaved } from '@/shared/save-feedback';
import { todayMmtDate } from '@/shared/time/myanmar';
import {
	lineModelOf,
	lineTrackingOf,
	type MroRequisitionCardModel,
	type MroRequisitionDetailModel,
	type MroRequisitionLineRow,
} from '../data/types';
import { qk as outboundQk } from '@/modules/goods-issues/data/query-keys';
import { invalidateDomain } from '@/shared/api/invalidation';
import { mroApi, mroStockIndexOf } from '@/shared/mro';
import { URL_PARAM } from '@/shared/url-state';

// The outbounds create page's prefill shape — what `?prefill=` decodes to. Imported
// (not re-declared) so the two sides stay structurally bound.

/** A positive parsable number from an "issue now" input — null when blank. */
function qtyOf(raw: string): number | null {
	if (raw.trim() === '') return null;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 ? value : null;
}

/** A stepper tile — the − / + button flanking the issue-qty input. */
function StepperButton({
	label,
	disabled,
	onClick,
	children,
}: {
	label: string;
	disabled: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			tabIndex={-1}
			disabled={disabled}
			onClick={onClick}
			className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-input bg-card text-muted-foreground transition-colors hover:text-foreground active:bg-muted disabled:cursor-not-allowed disabled:opacity-35"
		>
			{children}
		</button>
	);
}

/** "1,200" / "1,200.5" — count display, no trailing zeros. */
function formatCount(value: number | null): string {
	if (value == null || !Number.isFinite(value)) return '—';
	return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** A line is a packed serial SKU when its SKU's inherited policy is `serial`
 *  (`item_model.item_name.tracking`) — such units need EXPLICIT picks, so they
 *  are read-only here and excluded from the quick-issue aggregate (never confirm a
 *  partial serial without picks). */
function isSerialOf(tracking: string | undefined): boolean {
	return tracking === 'serial';
}

const requireLabel = 'mb-1.5 flex items-center gap-1 font-sans text-sm font-semibold leading-myanmar text-muted-foreground';

export default function StoreRequestDetailPage() {
	const { id = '' } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	// ONE `POST /api/query` round trip carries the header AND the child lines
	// (relations joined server-side: `vehicle.plate_no`, `item_model.name_en` +
	// `item_model.name_mm` + `item_model.item_name.tracking`) — the whole detail
	// view arrives in a single request.
	const viewQuery = useQuery({
		queryKey: qk.requisitionView(id),
		queryFn: () => fetchRequisitionView(id),
		enabled: id !== '',
		staleTime: REQUISITIONS_STALE_MS,
	});
	const requirement = viewQuery.data?.header ?? null;
	const lines = viewQuery.data?.lines ?? [];

	// The store's live availability — ONE `/stock/onhand` read (every model at every
	// store), so each line can show what is actually issuable WITHOUT a read per
	// line. Read only while the FULFIL screen is reachable (a `requested` doc's
	// amend form reads availability through the shared `useOnHandReport` hook, so
	// this page-level read would be a duplicate).
	const decisionReachable = requirement?.requisitionStatus === 'approved' || requirement?.requisitionStatus === 'partially_issued';
	const onHand = useQuery({
		queryKey: ['mro', 'stock', 'onhand'],
		queryFn: () => mroApi.onhand(),
		staleTime: 30_000,
		enabled: decisionReachable,
	});
	// `${model}|${location}` → the issue-able qty (derived balance minus the expired
	// slice) — the ONE shared rule in `@/shared/mro`, so this page can never
	// disagree with the stock screen.
	const availableByKey = useMemo(() => mroStockIndexOf(onHand.data?.rows ?? [], 'available'), [onHand.data]);
	// A line's available qty at this request's store — null while the read is in
	// flight (no misleading 0) or when the request carries no store / the line no SKU.
	const availableOf = (line: MroRequisitionLineRow): number | null => {
		const modelId = lineModelOf(line).id;
		if (!modelId || !requirement?.location) return null;
		return availableByKey.get(`${modelId}|${requirement.location}`) ?? 0;
	};

	// UI state.
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState<'issue' | 'reject' | null>(null);
	const [reasonOpen, setReasonOpen] = useState(false);
	const [issueOpen, setIssueOpen] = useState(false);
	const [issueQtys, setIssueQtys] = useState<Record<string, string>>({});

	const refreshAfterAction = useCallback(async () => {
		// Approving / issuing / rejecting flips the doc's lifecycle — refresh every
		// status group's list cache (the requester may return to ANY tab) so the
		// card's pill is current when the list remounts, plus this doc's view.
		await queryClient.invalidateQueries({ queryKey: qk.requisitionsAll(), refetchType: 'active' });
		await queryClient.invalidateQueries({ queryKey: qk.requisitionView(id) });
	}, [queryClient, id]);

	const runAction = async (work: () => Promise<void>, kind: 'issue' | 'reject'): Promise<boolean> => {
		setBusy(kind);
		setError(null);
		setNotice(null);
		try {
			await work();
			hapticImpact('medium');
			return true;
		} catch (err) {
			hapticImpact('light');
			console.error('[store-requests] action failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Something went wrong — try again.');
			return false;
		} finally {
			setBusy(null);
		}
	};

	const reject = (closeReason: string) =>
		runAction(async () => {
			if (!requirement) return;
			await rejectRequisition(requirement.id, closeReason);
			setReasonOpen(false);
			await refreshAfterAction();
			setNotice(`${requirement.displayNumber ?? 'Request'} closed.`);
		}, 'reject');

	// Amend a REQUESTED request — the requester may still change the date, vehicle,
	// note and lines until a keeper approves it. The engine freezes the doc once
	// `doc_status` flips to `confirmed`, so an approved request rejects this write.
	// Errors PROPAGATE to the form (which renders them inline and stays open) rather
	// than through `runAction`, so the edit surface owns its own failure copy.
	const amend = async (value: RequisitionFormValue) => {
		if (!requirement) return;
		await updateRequisition(requirement.id, value);
		notifySaved('Request updated');
		await refreshAfterAction();
		setNotice(`${requirement.displayNumber ?? 'Request'} updated.`);
	};

	const issue = () =>
		runAction(async () => {
			const me = await fetchCurrentEmployee();
			if (!me) throw new Error('No employee account is linked to this session — someone else must issue this request.');
			if (!requirement || !requirement.location) throw new Error('This request has no store to issue from.');
			const issueRows: Array<{ item_model: string; qty: number }> = [];
			for (const line of lines) {
				const modelId = lineModelOf(line).id;
				if (!modelId) continue;
				const qty = effectiveIssueQty(line);
				if (qty <= 0) continue;
				issueRows.push({ item_model: modelId, qty });
			}
			if (issueRows.length === 0) throw new Error('Choose at least one item to issue.');

			// ONE server call creates the goods-issue outbound AND confirms it — no
			// client-side create→confirm chain that could strand an orphaned draft.
			await issueRequisition(requirement.id, issueRows, me.id);
			setIssueQtys({});
			// The confirm writes a CONFIRMED OUT doc + moves stock. It is a raw route
			// (it bypasses the SDK's collection-change hook), so refresh the outbound
			// lists explicitly — otherwise the new doc is invisible until a manual
			// reload — plus the movement/stock domains the move touched.
			void queryClient.invalidateQueries({ queryKey: outboundQk.outboundsAll(), refetchType: 'active' });
			void invalidateDomain(queryClient, 'mro-movements');
			void invalidateDomain(queryClient, 'stock');
			await refreshAfterAction();
			setNotice('Goods issued against this request.');
		}, 'issue');

	// Lines whose SKU is serial-tracked — they can never be quick-issued here
	// (each unit needs an explicit serial pick), so they route to the outbounds
	// form, prefilled from THIS request (see `openOutboundsIssue`).
	const serialLines = lines.filter((line) => isSerialOf(lineTrackingOf(line)));

	/** The outbounds create page's prefill — one row per request line that has a
	 *  model and a positive qty. A serial line is pre-set to the qty the request
	 *  asked for (the operator still PICKS the exact units — for a serial row the
	 *  count travels as an advisory target, never a quantity); a stock-attributable
	 *  line carries the qty chosen in the stepper. */
	const buildIssuePrefill = (): OutboundPrefillLine[] =>
		lines.flatMap((line) => {
			const modelId = lineModelOf(line).id;
			const requested = Number(line.qty) > 0 ? Number(line.qty) : 0;
			if (!modelId || requested <= 0) return [];
			// A serial line carries the REQUESTED count (the outbounds form reads it as the
			// row's target and derives the real quantity from the units picked); anything
			// else carries the qty the keeper chose in the stepper.
			const qty = isSerialOf(lineTrackingOf(line)) ? requested : effectiveIssueQty(line);
			if (qty <= 0) return [];
			return [{ modelId, qty: String(qty) }];
		});

	/** Hand the WHOLE request to the outbounds create page — the only path that can
	 *  issue serial lines (it collects the exact serial picks). The draft is born
	 *  linked to this request (`?request=`) so its confirm advances this lifecycle,
	 *  and the prefill short-circuits re-typing the lines. */
	const openOutboundsIssue = () => {
		if (!requirement) return;
		hapticImpact('light');
		const params = new URLSearchParams({
			[URL_PARAM.type]: 'goods_issue',
			[URL_PARAM.request]: requirement.id,
			[URL_PARAM.prefill]: encodePrefillJson(buildIssuePrefill()),
		});
		if (requirement.displayNumber) params.set(URL_PARAM.requestRef, requirement.displayNumber);
		navigate(`/app/outbounds/+?${params.toString()}`);
	};

	const status = requirement?.requisitionStatus;

	// Header quantities — the engine tracks `issued_qty` at the HEADER aggregate.
	const requestedTotal = requirement?.requestedQty ?? null;
	const issuedTotal = requirement?.issuedQty ?? null;
	const remaining = requestedTotal != null && issuedTotal != null ? Math.max(0, requestedTotal - issuedTotal) : null;

	// A line's effective quick-issue qty: its explicit `issueQtys` override when
	// set, else its FULL requested qty (the default — leave untouched to issue the
	// whole line). CLAMPED to the line's requested qty so a typed-over number can
	// never issue more than the request asked for. Serial lines never fold in (0) —
	// they need explicit picks.
	const effectiveIssueQty = (line: MroRequisitionLineRow): number => {
		if (isSerialOf(lineTrackingOf(line))) return 0;
		const requested = Number(line.qty) > 0 ? Number(line.qty) : 0;
		return Math.min(Math.max(0, qtyOf(issueQtys[line.id] ?? String(requested)) ?? 0), requested);
	};
	const totalIssue = lines.reduce((sum, line) => sum + effectiveIssueQty(line), 0);
	const issueQtyLabel = `${formatCount(totalIssue)} ${totalIssue === 1 ? 'unit' : 'units'}`;

	const title = requirement?.displayNumber ?? 'Requisition';

	if (viewQuery.isPending) {
		return (
			<ModuleShell title={title} backTo="/app/store-requests">
				<RequirementSkeleton />
			</ModuleShell>
		);
	}

	if (viewQuery.isError || !requirement) {
		return (
			<ModuleShell title={title} backTo="/app/store-requests">
				<div className="flex flex-col items-center gap-3 px-4 pt-16 text-center">
					<AlertTriangle className="size-6 text-destructive" aria-hidden />
					<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load this request.</p>
					<button
						type="button"
						onClick={() => void viewQuery.refetch()}
						className="rounded-full bg-primary px-4 py-2 text-sm font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
					>
						Retry
					</button>
				</div>
			</ModuleShell>
		);
	}

	return (
		<ModuleShell title={title} backTo="/app/store-requests">
			<div className="flex flex-1 flex-col gap-5 pb-4">
				{/* The header — the SAME card the list / approval queues render, so a
				    DECIDED request reads identically wherever it is opened (static here:
				    the tap target is the list, not a page already on screen). It is
				    deliberately omitted while the doc is still `requested`: that screen
				    is the AMEND layout, and the form below already names the request. */}
				{status !== 'requested' && (
					<ul>
						<StoreRequestCard request={cardModelOf(requirement)} />
					</ul>
				)}

				{/* Amend (requested) — the request is still OPEN, so the requester edits
				    the SAME form used to create it, pre-filled with the current date /
				    vehicle / note / lines, instead of a read-only view. There is no
				    Approve verb here: the decision belongs to the store keeper in the
				    Approval Center. Closing the request stays available. */}
				{status === 'requested' && (
					<>
						<RequisitionForm
							mode="edit"
							store={requirement.location ?? undefined}
							initial={formInitialOf(requirement, lines)}
							onSubmit={amend}
						/>

						<div className="flex flex-col gap-2">
							<button
								type="button"
								disabled={busy !== null}
								onClick={() => setReasonOpen(true)}
								className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-border/70 bg-card px-4 py-2.5 text-sm font-semibold leading-myanmar text-foreground/70 transition-transform duration-150 active:scale-95 disabled:opacity-50"
							>
								<XCircle className="size-4" aria-hidden />
								Cancel request
							</button>
						</div>

						<InlineFeedback notice={notice} error={error} />
					</>
				)}

				{/* Fulfil & issue (approved / partially issued). */}
				{(status === 'approved' || status === 'partially_issued') && (
					<>
						<FulfilNotes
							requestedTotal={requestedTotal}
							issuedTotal={issuedTotal}
							remaining={remaining}
							lines={lines}
							isSerialLine={lineTrackingOf}
						/>

						<FulfilLines
							lines={lines}
							linesLoading={viewQuery.isPending}
							isSerialLine={lineTrackingOf}
							issueQtys={issueQtys}
							onIssueQty={(lineId, value) => setIssueQtys((cur) => ({ ...cur, [lineId]: value }))}
							defaultQtyOf={(line) => String(line.qty ?? 0)}
							availableOf={availableOf}
						/>

						<InlineFeedback notice={notice} error={error} />

						<div className="mt-auto flex flex-col gap-2">
							<button
								type="button"
								disabled={busy !== null || totalIssue <= 0}
								onClick={() => setIssueOpen(true)}
								className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-primary px-4 py-3.5 text-base font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-50"
							>
								{busy === 'issue' ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ArrowRight className="size-5" aria-hidden />}
								{busy === 'issue' ? 'Issuing…' : `Issue ${formatCount(totalIssue)} units`}
							</button>
							{/* Serial lines cannot be quick-issued here — one explicit pick per unit.
							    Hand the WHOLE request to the outbounds form (prefilled + linked
							    back) so the keeper collects the exact serial numbers in one place. */}
							{serialLines.length > 0 && (
								<button
									type="button"
									disabled={busy !== null}
									onClick={openOutboundsIssue}
									className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-border/70 bg-card px-4 py-2.5 text-sm font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95 disabled:opacity-50"
								>
									<Package className="size-4" aria-hidden />
									Issue serial items in outbounds
								</button>
							)}
							<button
								type="button"
								disabled={busy !== null}
								onClick={() => setReasonOpen(true)}
								className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-border/70 bg-card px-4 py-2.5 text-sm font-semibold leading-myanmar text-foreground/70 transition-transform duration-150 active:scale-95 disabled:opacity-50"
							>
								<XCircle className="size-4" aria-hidden />
								Reject remaining (close request)
							</button>
						</div>
					</>
				)}

				{/* Closed read-only — fulfilled or cancelled/rejected. */}
				{(status === 'fulfilled' || status === 'cancelled') && (
					<>
						<ClosedNote status={status} closeReason={requirement.closeReason} requestedTotal={requestedTotal} issuedTotal={issuedTotal} />
						<LinesSection lines={lines} linesLoading={viewQuery.isPending} isSerialLine={lineTrackingOf} />
						<InlineFeedback notice={notice} error={error} />
					</>
				)}
			</div>

			{/* The reject reason sheet — shared by the Decide and Fulfil screens. */}
			<Sheet open={reasonOpen} onOpenChange={setReasonOpen}>
				<SheetContent side="bottom">
					<SheetHeader className="pb-1">
						<SheetTitle>Close this request?</SheetTitle>
					</SheetHeader>
					<div className="flex flex-col gap-2 px-4 pb-safe">
						{REQUISITION_CLOSE_REASONS.map((option) => (
							<button
								key={option.value}
								type="button"
								disabled={busy === 'reject'}
								onClick={() => void reject(option.value)}
								className="flex-1 rounded-xl border border-border/70 bg-muted/25 px-3 py-2.5 text-left transition-transform duration-150 active:scale-95 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<span className="block text-sm font-medium leading-myanmar text-foreground">{option.label}</span>
								<span className="mt-0.5 block text-xs leading-myanmar text-muted-foreground">{option.hint}</span>
							</button>
						))}
					</div>
				</SheetContent>
			</Sheet>

			{/* The confirm step for the irreversible stock issue action. The reject
			    path already confirms through its reason sheet above. */}
			<ConfirmSheet
				open={issueOpen}
				title={`Issue ${issueQtyLabel}?`}
				description="Issuing creates a confirmed goods-issue and moves the stock out now."
				confirmLabel={`Issue ${issueQtyLabel}`}
				busy={busy === 'issue'}
				error={error}
				onConfirm={() => {
					void issue().then((ok) => {
						if (ok) setIssueOpen(false);
					});
				}}
				onClose={() => setIssueOpen(false)}
			/>
		</ModuleShell>
	);
}

/** Adapt the DETAIL header model to the shared card model, so the detail page
 *  leads with the SAME card the list / approval queues render (one visual
 *  language). The detail read carries no `ageLabel` / `summaryLabel` and keeps
 *  `issuedQty` — the card's face only needs the fields below. */
function cardModelOf(requirement: MroRequisitionDetailModel): MroRequisitionCardModel {
	return {
		id: requirement.id,
		displayNumber: requirement.displayNumber,
		status: requirement.docStatus,
		requisitionStatus: requirement.requisitionStatus,
		requestedBy: requirement.requestedBy,
		approvedBy: requirement.approvedBy,
		vehicleId: requirement.vehicleId,
		vehiclePlate: requirement.vehiclePlate,
		issuedQty: requirement.issuedQty,
		requestedQty: requirement.requestedQty,
		locationLabel: requirement.locationLabel,
		requestDateLabel: requirement.requestDateLabel,
		lineCount: requirement.lineCount,
		totalQty: requirement.requestedQty,
		summaryLabel: null,
		note: requirement.note,
		closeReason: requirement.closeReason,
		ageLabel: null,
	};
}

/** Build the amend form's pre-fill from the loaded detail — the raw date, note,
 *  bound vehicle and every line that still has a resolvable SKU + positive qty
 *  (a dangling line the form cannot represent is dropped rather than shown blank).
 *  The form's `initial` is read ONCE as its initial state, so a later view refetch
 *  never clobbers the user's in-progress edit. */
function formInitialOf(requirement: MroRequisitionDetailModel, lines: MroRequisitionLineRow[]): RequisitionFormInitial {
	return {
		requestDate: requirement.requestDate ?? todayMmtDate(),
		note: requirement.note ?? '',
		vehicleId: requirement.vehicleId,
		lines: lines.flatMap((line) => {
			const itemModelId = lineModelOf(line).id;
			const qty = Number(line.qty);
			if (!itemModelId || !(qty > 0)) return [];
			return [{ itemModelId, qty }];
		}),
	};
}

/** The shared requested-items list with a per-state affordance. */
function LinesSection({
	lines,
	linesLoading,
	isSerialLine,
	availableOf,
}: {
	lines: MroRequisitionLineRow[];
	linesLoading: boolean;
	isSerialLine?: (line: MroRequisitionLineRow) => string | undefined;
	/** The line's issue-able qty at this request's store (null while unknown). */
	availableOf?: (line: MroRequisitionLineRow) => number | null;
}) {
	return (
		<section>
			<h3 className={requireLabel}>
				<Package className="size-4 text-muted-foreground" aria-hidden />
				Requested items
			</h3>
			{linesLoading ? (
				<div className="flex animate-pulse flex-col gap-2">
					{Array.from({ length: Math.min(lines.length || 3, 3) }).map((_, i) => (
						<div key={i} className="h-14 rounded-xl bg-muted/60" />
					))}
				</div>
			) : lines.length === 0 ? (
				<p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs leading-myanmar text-muted-foreground">
					No items on this request.
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{lines.map((line) => {
						const { name } = lineModelOf(line);
						const available = availableOf?.(line) ?? null;
						const short = available != null && Number(line.qty ?? 0) > available;
						return (
							<li key={line.id} className={`${DENSE_CARD_FRAME} px-3 py-2.5 shadow-sm`}>
								<div className="flex items-center justify-between gap-2">
									<div className="flex min-w-0 items-center gap-1.5">
										{isSerialLine?.(line) === 'serial' && (
											<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold leading-myanmar text-muted-foreground">
												Serial
											</span>
										)}
										<p className="min-w-0 flex-1 truncate text-sm font-semibold leading-myanmar text-foreground">{name ?? 'Unknown SKU'}</p>
									</div>
									<div className="flex shrink-0 flex-col items-end">
										<span className="text-sm font-bold tabular-nums leading-myanmar text-foreground">{formatCount(line.qty ?? null)}</span>
										{available != null && (
											<span
												className={`text-[10px] font-semibold tabular-nums leading-myanmar ${short ? 'text-status-warning' : 'text-muted-foreground'}`}
											>
												{formatCount(available)} available
											</span>
										)}
									</div>
								</div>
								{line.note && <p className="mt-1 truncate text-meta leading-myanmar text-muted-foreground">{line.note}</p>}
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

/** The fulfil & issue item rows — editable "issue now" qty per non-serial line. */
function FulfilLines({
	lines,
	linesLoading,
	isSerialLine,
	issueQtys,
	onIssueQty,
	defaultQtyOf,
	availableOf,
}: {
	lines: MroRequisitionLineRow[];
	linesLoading: boolean;
	isSerialLine: (line: MroRequisitionLineRow) => string | undefined;
	issueQtys: Record<string, string>;
	onIssueQty: (lineId: string, value: string) => void;
	defaultQtyOf: (line: MroRequisitionLineRow) => string;
	/** The line's issue-able qty at this store — an "issue more than this" warning. */
	availableOf: (line: MroRequisitionLineRow) => number | null;
}) {
	if (linesLoading) {
		return (
			<div className="flex animate-pulse flex-col gap-2">
				{Array.from({ length: 3 }).map((_, i) => (
					<div key={i} className="h-16 rounded-xl bg-muted/60" />
				))}
			</div>
		);
	}
	return (
		<section className="flex flex-col gap-2">
			<h3 className={requireLabel}>
				<Package className="size-4 text-muted-foreground" aria-hidden />
				Fulfil — issue now
			</h3>
			{lines.filter((line) => !isSerialOf(isSerialLine(line))).length === 0 ? (
				<p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs leading-myanmar text-muted-foreground">
					No stock-attributable lines to quick-issue. Serial items need exact picks from the outbounds flow.
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{lines.map((line) => {
						const { name } = lineModelOf(line);
						const isSerial = isSerialOf(isSerialLine(line));
						// The line's requested qty — the stepper's upper bound (issue at most what
						// was requested).
						const requested = Number(line.qty) > 0 ? Number(line.qty) : 0;
						// The live issue-now value: the user's edit when set, else the full line.
						const valueText = issueQtys[line.id] ?? defaultQtyOf(line);
						const current = Math.min(Math.max(qtyOf(valueText) ?? 0, 0), requested);
						const available = availableOf(line);
						const short = available != null && current > available;
						const step = (next: number) => onIssueQty(line.id, String(Math.min(Math.max(next, 0), requested)));
						return (
							<li key={line.id} className={`${DENSE_CARD_FRAME} px-3 py-2.5 shadow-sm`}>
								<div className="flex items-center justify-between gap-2">
									<div className="min-w-0 flex-1">
										{isSerial && (
											<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold leading-myanmar text-muted-foreground">
												Serial
											</span>
										)}
										<p className="mt-0.5 truncate text-sm font-semibold leading-myanmar text-foreground">{name ?? 'Unknown SKU'}</p>
									</div>
									{!isSerial ? (
										<div className="flex shrink-0 flex-col items-end gap-1">
											<span className="text-[9px] font-semibold uppercase tracking-wide leading-myanmar text-muted-foreground">Issue</span>
											<div className="flex items-center gap-1.5">
												<StepperButton
													label={`Decrease issue quantity for ${name ?? line.id}`}
													disabled={current <= 0}
													onClick={() => step(current - 1)}
												>
													<Minus className="size-4" strokeWidth={2.2} aria-hidden />
												</StepperButton>
												<input
													type="number"
													min={0}
													max={requested}
													inputMode="numeric"
													value={valueText}
													// Clamp to the requested qty as the user types — the SAME bound the
													// stepper enforces, so the field can never display a number the
													// payload would silently ignore.
													onChange={(event) => step(qtyOf(event.target.value) ?? 0)}
													className="h-9 w-16 rounded-lg border border-input bg-card px-1 text-center text-sm font-semibold tabular-nums text-foreground outline-none focus:border-ring/60"
													aria-label={`Issue quantity for ${name ?? line.id}`}
												/>
												<StepperButton
													label={`Increase issue quantity for ${name ?? line.id}`}
													disabled={current >= requested}
													onClick={() => step(current + 1)}
												>
													<Plus className="size-4" strokeWidth={2.2} aria-hidden />
												</StepperButton>
											</div>
										</div>
									) : (
										<span className="shrink-0 text-sm font-bold tabular-nums leading-myanmar text-foreground">
											{formatCount(line.qty ?? null)}
										</span>
									)}
								</div>
								{isSerial && (
									<p className="mt-1 text-meta italic leading-myanmar text-muted-foreground">
										Serial item — issue its exact units from the outbounds flow.
									</p>
								)}
								{!isSerial && (
									<p className="mt-1 text-meta leading-myanmar text-muted-foreground">
										Requested {formatCount(line.qty ?? null)} · set to 0 to skip this line this time.
									</p>
								)}
								{available != null && (
									<p className={`mt-1 text-meta leading-myanmar ${short ? 'font-medium text-status-warning' : 'text-muted-foreground'}`}>
										{short
											? `Only ${formatCount(available)} in stock at this store — issuing more will fail.`
											: `${formatCount(available)} available at this store.`}
									</p>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

/** The header progress strip shown on the fulfil screen. */
function FulfilNotes({
	requestedTotal,
	issuedTotal,
	remaining,
	lines,
	isSerialLine,
}: {
	requestedTotal: number | null;
	issuedTotal: number | null;
	remaining: number | null;
	lines: MroRequisitionLineRow[];
	isSerialLine: (line: MroRequisitionLineRow) => string | undefined;
}) {
	const serialCount = lines.filter((line) => isSerialOf(isSerialLine(line))).length;
	return (
		<section className="rounded-2xl border border-border/70 bg-card/60 px-4 py-3">
			<p className="text-meta font-semibold uppercase tracking-wide leading-myanmar text-muted-foreground">Fulfilment</p>
			<p className="mt-1 text-sm font-medium leading-myanmar text-foreground">
				Issued {formatCount(issuedTotal)} of {formatCount(requestedTotal)} requested
				{remaining != null && remaining > 0 ? ` · ${formatCount(remaining)} remaining` : ''}
			</p>
			{serialCount > 0 && (
				<p className="mt-1 text-xs italic leading-myanmar text-muted-foreground">
					{serialCount} serial {serialCount === 1 ? 'item is' : 'items are'} excluded — their exact units are picked from the outbounds
					flow.
				</p>
			)}
		</section>
	);
}

/** The read-only fulfilment / cancellation / rejection summary. */
function ClosedNote({
	status,
	closeReason,
	requestedTotal,
	issuedTotal,
}: {
	status: 'fulfilled' | 'cancelled';
	closeReason: string | null;
	requestedTotal: number | null;
	issuedTotal: number | null;
}) {
	const closeLabel =
		closeReason === 'stock_low'
			? 'Stock too low — the store could not fulfil this request.'
			: closeReason === 'cancelled'
				? 'No longer needed — the request was cancelled.'
				: null;

	return (
		<section className="rounded-2xl border border-border/70 bg-card/60 px-4 py-3">
			<p className="text-meta font-semibold uppercase tracking-wide leading-myanmar text-muted-foreground">
				{status === 'fulfilled' ? 'Fulfilment' : 'Closed'}
			</p>
			{status === 'fulfilled' ? (
				<p className="mt-1 text-sm font-medium leading-myanmar text-foreground">
					Fully issued — {formatCount(issuedTotal)} of {formatCount(requestedTotal)} units delivered.
				</p>
			) : (
				<>
					<p className="mt-1 text-sm font-medium leading-myanmar text-foreground">This request was closed without further issue.</p>
					{closeLabel && <p className="mt-1 border-l-2 border-border pl-2.5 text-xs leading-myanmar text-muted-foreground">{closeLabel}</p>}
				</>
			)}
		</section>
	);
}

/** Success (green) or failure (red) inline feedback shown after an action. */
function InlineFeedback({ notice, error }: { notice: string | null; error: string | null }) {
	if (!notice && !error) return null;
	return (
		<p
			className={`rounded-md px-3 py-2 text-xs font-medium leading-myanmar ${
				notice ? 'bg-status-success-soft text-status-success' : 'bg-status-danger-soft text-status-danger'
			}`}
			role={error ? 'alert' : 'status'}
		>
			{notice ?? error}
		</p>
	);
}

/** A simple loading skeleton while the header/requirement loads. */
function RequirementSkeleton() {
	return (
		<div className="flex flex-col gap-5" aria-hidden>
			<div className={`flex animate-pulse flex-col gap-2 ${CARD_FRAME} p-4 shadow-card`}>
				<div className="h-5 w-28 rounded bg-muted/60" />
				<div className="h-3.5 w-40 rounded bg-muted/40" />
				<div className="mt-2 h-3.5 w-48 rounded bg-muted/40" />
			</div>
			<div className="flex animate-pulse flex-col gap-2">
				{Array.from({ length: 3 }).map((_, i) => (
					<div key={i} className="h-14 rounded-xl bg-muted/60" />
				))}
			</div>
		</div>
	);
}
