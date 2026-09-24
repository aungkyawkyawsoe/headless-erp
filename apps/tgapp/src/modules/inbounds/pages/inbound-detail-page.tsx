import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';

import { CARD_CLASS } from '@/shared/components/card';
import { ConfirmSheet } from '@/shared/components/confirm-sheet';
import { DocActionsMenu } from '@/shared/components/doc-actions-menu';
import { DocStatusPill } from '@/shared/components/doc-status-pill';
import { EmptyState } from '@/shared/components/empty-state';
import { PageError } from '@/shared/components/page-error';
import { ListSkeleton } from '@/shared/components/skeletons';
import { ModuleShell } from '@/shared/components/module-shell';
import { cancelCopyOf, useDocCancel } from '@/shared/hooks/use-doc-cancel';
import { hapticImpact, hapticSelection } from '@/shared/platform/haptics';
import { popBack } from '@/shared/platform/history';
import { notifySaved } from '@/shared/save-feedback';
import { URL_PARAM, useViewState } from '@/shared/url-state';
import { InboundDocForm } from '../components/inbound-doc-form';
import { InboundMoneyStrip, paymentCaption } from '../components/inbound-money-strip';
import { InboundPaymentSheet } from '../components/inbound-payment-sheet';
import { fetchInboundDocEditor } from '../data/api';
import { isInboundEditable } from '../data/edit';
import { INBOUND_TYPE_META } from '../data/meta';
import { canPayOf, moneyStateOf } from '../data/money';
import { qk, INBOUND_STALE_MS } from '../data/query-keys';
import { useInboundConfirm } from '../data/use-inbound-confirm';
import { INBOUND_VIEW } from './inbound-hub-page';

/**
 * အဝင်စာရင်း → ONE document — the FULL-SCREEN doc page (`/app/inbounds/:id`,
 * reached by tapping an inbound card on ANY kind tab). `?type=` rides in the URL
 * so a cold open/reload still returns to the tab it came from.
 *
 * The document IS its form, prefilled: the very component a NEW receipt is typed
 * into, so a draft that was mis-typed is corrected here instead of cancelled and
 * re-created. Which fields are live is decided by the DOCUMENT, never by this
 * page — a draft edits, and anything already posted OR cancelled renders the
 * identical layout read-only (`isInboundEditable`, the client's mirror of the
 * collection's own `writes.freeze_when`), because the engine would refuse that
 * write anyway.
 *
 * Two blocks stay OUTSIDE the form, on purpose:
 *  - the MONEY — a purchase's derived figures (Paid / Left / bar) come from the
 *    payment ledger, not from a field on the receipt, and the sheet behind them
 *    is the only place an entry is recorded or removed;
 *  - the LIFECYCLE — the status pill and the ONE cancel, plus the draft's confirm, in
 *    the SAME corners the list card puts them: the confirm in the footer, the pill
 *    and the ⋮ at the top (a posted receipt's cancel REVERSES it: the stock it
 *    received comes back out). The pill carries the receipt's KIND joined to its
 *    status (`Purchase · Confirmed`), because the form behind it drops its kind
 *    selector once the receipt is settled — and that badge is the WHOLE statement:
 *    nothing else explains the state, and the form never repeats it. A cancelled
 *    receipt is final and offers no action at all.
 */
export default function InboundDetailPage() {
	const { id = '' } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	// The opening tab — carried in the URL by the list page's link; the app-bar
	// back fallback lands there when there is no history entry to pop.
	const [view] = useViewState(INBOUND_VIEW);
	const { type: typeParam } = view;
	const backTo = `/app/inbounds${typeParam === 'purchase' ? '' : `?${URL_PARAM.type}=${typeParam}`}`;

	// ONE read for the whole page: the receipt's derived facts (money, lifecycle)
	// AND the form's seed (the same document as fields). The form seeds its state
	// once at mount, so it is mounted only after this resolves — a form that came
	// up empty because its lines were still loading would save the doc empty.
	const editorQuery = useQuery({
		queryKey: qk.inboundEditor(id),
		queryFn: () => fetchInboundDocEditor(id),
		enabled: id !== '',
		staleTime: INBOUND_STALE_MS,
	});

	const editor = editorQuery.data ?? null;
	const card = editor?.card ?? null;
	const seed = editor?.seed ?? null;
	// Only a draft can be WRITTEN (`writes.freeze_when doc_status:['confirmed','cancelled']`
	// — the collection's own rule, mirrored by `isInboundEditable`), so the form's
	// editability and the footer's actions hang off the same one rule.
	const isDraft = seed !== null && isInboundEditable(seed.docStatus);
	const isCancelled = seed !== null && seed.docStatus === 'cancelled';

	// Both lifecycle actions are destructive in one direction, so each is gated behind
	// the shared ConfirmSheet; a success closes whichever is open. CANCEL is the shared
	// action (`@/shared/hooks/use-doc-cancel`): for a POSTED receipt it REVERSES the
	// stock, which the sheet says outright.
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [cancelOpen, setCancelOpen] = useState(false);
	const [paymentsOpen, setPaymentsOpen] = useState(false);
	const { busy, error, confirm } = useInboundConfirm(id, () => setConfirmOpen(false));
	const { busy: cancelBusy, error: cancelError, cancel } = useDocCancel({
		kind: 'inbounds',
		docId: id,
		docStatus: seed?.docStatus ?? 'draft',
		listKey: qk.inboundsAll(),
		onCancelled: () => setCancelOpen(false),
	});
	const cancelCopy = cancelCopyOf('inbounds', seed?.docStatus ?? 'draft');

	/** A saved EDIT returns to the list, exactly like the create path: that is
	 *  where the operator came from, and the row they just changed is on it. */
	const handleSaved = useCallback(() => {
		hapticImpact('medium');
		void queryClient.invalidateQueries({ queryKey: qk.inboundsAll(), refetchType: 'active' });
		notifySaved('Receipt saved');
		popBack(navigate, backTo);
	}, [queryClient, navigate, backTo]);

	const openPayments = () => {
		hapticSelection();
		setPaymentsOpen(true);
	};

	if (id === '') {
		return (
			<ModuleShell title="Inbound" backTo={backTo}>
				<EmptyState title="No document selected" hint="Open this screen from an inbound document on the inbounds list." />
			</ModuleShell>
		);
	}

	if (editorQuery.isPending) {
		return (
			<ModuleShell title="Inbound" backTo={backTo}>
				<ListSkeleton variant="store-request" count={3} />
			</ModuleShell>
		);
	}

	if (editorQuery.isError) {
		return (
			<ModuleShell title="Inbound" backTo={backTo}>
				<PageError title="Could not load this document." onRetry={() => void editorQuery.refetch()} />
			</ModuleShell>
		);
	}

	if (!card || !seed) {
		return (
			<ModuleShell title="Inbound" backTo={backTo}>
				<EmptyState title="Inbound not found" hint="This document may have been deleted." />
			</ModuleShell>
		);
	}

	const left = moneyStateOf(card).left;
	// A POSTED purchase has money to answer for; everything else (a draft, an
	// opening balance, a return) owes nobody and gets no money face.
	const showMoney = canPayOf(card);
	// The KIND rides the pill once the form can no longer change it: a settled receipt
	// renders read-only with NO kind selector, so the badge states what the document IS
	// beside where it stands — `Purchase · Confirmed`. A draft keeps its own selector,
	// so its pill stays the bare status and neither surface repeats the other.
	const pillKind = isDraft ? null : INBOUND_TYPE_META[seed.type].label;

	return (
		<ModuleShell title={card.displayNumber ?? 'Inbound'} backTo={backTo}>
			<div className="flex flex-col gap-3 pb-4">
				{/* The document's lifecycle, in the corner the list row it was opened from
				 *  puts it: WHAT this is (the status pill — the receipt's KIND joined to
				 *  its state) and WHAT can still be done (the ONE cancel, plus the
				 *  draft's confirm). The badge is the WHOLE statement: the form behind it
				 *  renders a settled receipt read-only, so the pill names the state and
				 *  the kind it is stuck on, and NOTHING explains it a second time. A
				 *  cancelled receipt is frozen and final: no menu at all. */}
				<div className="flex items-center justify-between gap-2">
					<DocStatusPill status={seed.docStatus} kind={pillKind} />
					{!isCancelled && (
						<DocActionsMenu
							docNumber={card.displayNumber}
							noun="this receipt"
							primary={isDraft ? { label: 'Confirm', onSelect: () => setConfirmOpen(true), disabled: busy } : null}
							cancel={{ label: cancelCopy.label, onSelect: () => setCancelOpen(true), disabled: cancelBusy }}
						/>
					)}
				</div>

				{/* THE FORM — `key` on the id so another document REMOUNTS it (the seed
				 *  is read once at mount, so a reused instance would show the previous
				 *  receipt's values). */}
				<InboundDocForm key={id} seed={seed} onDone={handleSaved} />

				{/* MONEY — the receipt's derived figures, which no field carries. The
				 *  figures are the LEDGER's opener: a tap shows the entries behind them
				 *  (and is the only place a wrong one is removed), so this stays put
				 *  even though the receipt itself can no longer be edited. */}
				{showMoney ? (
					<section className={`${CARD_CLASS} p-2.5`}>
						<button
							type="button"
							onClick={openPayments}
							aria-label={`Payments for ${card.displayNumber ?? 'this receipt'}: ${paymentCaption(card, left)}`}
							className="block w-full rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<InboundMoneyStrip doc={card} />
						</button>
					</section>
				) : null}

				{/* Lifecycle footer — the DRAFT's confirm (a thumb-reachable primary, and the
					SAME hook the list card mounts, so one action is never offered twice in two
					voices) plus whatever a lifecycle call refused, verbatim. A POSTED receipt
					has no action here — its reversal is the ⋮ above, and its reason is stated
					there too; a CANCELLED one gets neither, because it is final. With nothing to
					say the whole block is ABSENT rather than an empty border. */}
				{!isCancelled && (isDraft || error || cancelError) && (
					<div className="flex flex-col gap-2 border-t border-dashed border-border pt-3">
						{isDraft && (
							<button
								type="button"
								disabled={busy}
								onClick={() => setConfirmOpen(true)}
								className="flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
							>
								{busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" strokeWidth={2.2} aria-hidden />}
								{busy ? 'Confirming…' : 'Confirm'}
							</button>
						)}
						{error && <p className="text-center text-xs font-medium leading-myanmar text-destructive">{error}</p>}
						{cancelError && <p className="text-center text-xs font-medium leading-myanmar text-destructive">{cancelError}</p>}
					</div>
				)}
			</div>

			<ConfirmSheet
				open={confirmOpen}
				title="Confirm this receipt?"
				description="Confirming posts these items into stock. A posted receipt can be reversed later by cancelling it — the stock comes back out."
				busy={busy}
				error={error}
				onConfirm={() => void confirm()}
				onClose={() => setConfirmOpen(false)}
			/>
			<ConfirmSheet
				open={cancelOpen}
				title={cancelCopy.title}
				description={cancelCopy.description}
				confirmLabel={cancelCopy.label}
				cancelLabel="Keep it"
				tone="destructive"
				busy={cancelBusy}
				error={cancelError}
				onConfirm={() => void cancel()}
				onClose={() => setCancelOpen(false)}
			/>
			<InboundPaymentSheet doc={card} open={paymentsOpen} onOpenChange={setPaymentsOpen} />
		</ModuleShell>
	);
}
