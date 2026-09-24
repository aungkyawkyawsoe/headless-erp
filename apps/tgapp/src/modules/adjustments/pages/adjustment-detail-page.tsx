import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';

import { ConfirmSheet } from '@/shared/components/confirm-sheet';
import { DocActionsMenu } from '@/shared/components/doc-actions-menu';
import { DocStatusPill } from '@/shared/components/doc-status-pill';
import { EmptyState } from '@/shared/components/empty-state';
import { PageError } from '@/shared/components/page-error';
import { ListSkeleton } from '@/shared/components/skeletons';
import { ModuleShell } from '@/shared/components/module-shell';
import { cancelCopyOf, useDocCancel } from '@/shared/hooks/use-doc-cancel';
import { hapticImpact } from '@/shared/platform/haptics';
import { popBack } from '@/shared/platform/history';
import { notifySaved } from '@/shared/save-feedback';
import { URL_PARAM, useViewState } from '@/shared/url-state';
import { AdjustmentForm } from '../components/adjustment-form';
import { fetchAdjustmentDocEditor } from '../data/api';
import { isAdjustmentEditable } from '../data/edit';
import { ADJUSTMENT_STALE_MS, qk } from '../data/query-keys';
import { useAdjustmentApprove } from '../data/use-adjustment-approve';
import { ADJUSTMENT_VIEW } from './adjustments-page';

/**
 * Adjustment → ONE document — the FULL-SCREEN doc page (`/app/adjustments/:id`,
 * reached by tapping an adjustment card on the list OR an AJT line on the
 * movement ledger). `?status=` rides in the URL so a cold open/reload still
 * returns to the filter the doc came from.
 *
 * The document IS its form, prefilled: the very component a NEW correction is
 * typed into, so a draft that was mis-typed is corrected here instead of
 * cancelled and re-created. Which fields are live is decided by the DOCUMENT,
 * never by this page — a draft edits, and anything already applied OR cancelled
 * renders the identical layout read-only (`isAdjustmentEditable`, the client's
 * mirror of the collection's own `writes.freeze_when`), because the engine would
 * refuse that write anyway.
 *
 * The LIFECYCLE stays OUTSIDE the form, on purpose, in the SAME two places the
 * list card puts it: the status pill and the ⋮ at the top-right, and the draft's
 * approve in the footer. The pill IS the statement — the correction's status, and
 * nothing written under it to explain a read-only form that the pill already
 * explains. The ⋮ holds the ONE cancel — for an APPLIED correction
 * that REVERSES it (added stock comes back out, removed stock goes back). A
 * cancelled adjustment is final and offers no action at all.
 */
export default function AdjustmentDetailPage() {
	const { id = '' } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [view] = useViewState(ADJUSTMENT_VIEW);
	const { status: statusParam } = view;
	const backTo = `/app/adjustments?${URL_PARAM.status}=${statusParam}`;

	// ONE read for the whole page: the correction's display facts AND the form's
	// seed (the same document as fields). The form seeds its state once at mount, so
	// it is mounted only after this resolves — a form that came up empty because its
	// lines were still loading would save the doc empty.
	const editorQuery = useQuery({
		queryKey: qk.adjustmentEditor(id),
		queryFn: () => fetchAdjustmentDocEditor(id),
		enabled: id !== '',
		staleTime: ADJUSTMENT_STALE_MS,
	});

	const editor = editorQuery.data ?? null;
	const card = editor?.card ?? null;
	const seed = editor?.seed ?? null;
	// Only a draft can be WRITTEN (`writes.freeze_when doc_status:['confirmed','cancelled']`
	// — the collection's own rule, mirrored by `isAdjustmentEditable`), so the form's
	// editability and the footer's actions hang off the same one rule.
	const isDraft = seed !== null && isAdjustmentEditable(seed.docStatus);
	const isCancelled = seed !== null && seed.docStatus === 'cancelled';

	// Both lifecycle actions are destructive in one direction, so each is gated behind
	// the shared ConfirmSheet; a success closes whichever is open. CANCEL is the shared
	// action (`@/shared/hooks/use-doc-cancel`): for an APPLIED correction it REVERSES it.
	const [approveOpen, setApproveOpen] = useState(false);
	const [cancelOpen, setCancelOpen] = useState(false);
	const { busy, error, approve } = useAdjustmentApprove(id, () => setApproveOpen(false));
	const { busy: cancelBusy, error: cancelError, cancel } = useDocCancel({
		kind: 'adjustments',
		docId: id,
		docStatus: seed?.docStatus ?? 'draft',
		listKey: qk.adjustmentsAll(),
		onCancelled: () => setCancelOpen(false),
	});
	const cancelCopy = cancelCopyOf('adjustments', seed?.docStatus ?? 'draft');

	/** A saved EDIT returns to the list, exactly like the create path: that is
	 *  where the operator came from, and the row they just changed is on it. */
	const handleSaved = useCallback(() => {
		hapticImpact('medium');
		void queryClient.invalidateQueries({ queryKey: qk.adjustmentsAll(), refetchType: 'active' });
		notifySaved('Adjustment saved');
		popBack(navigate, backTo);
	}, [queryClient, navigate, backTo]);

	if (id === '') {
		return (
			<ModuleShell title="Adjustment" backTo={backTo}>
				<EmptyState title="No document selected" hint="Open this screen from an adjustment on the list." />
			</ModuleShell>
		);
	}

	if (editorQuery.isPending) {
		return (
			<ModuleShell title="Adjustment" backTo={backTo}>
				<ListSkeleton variant="store-request" count={3} />
			</ModuleShell>
		);
	}

	if (editorQuery.isError) {
		return (
			<ModuleShell title="Adjustment" backTo={backTo}>
				<PageError title="Could not load this document." onRetry={() => void editorQuery.refetch()} />
			</ModuleShell>
		);
	}

	if (!card || !seed) {
		return (
			<ModuleShell title="Adjustment" backTo={backTo}>
				<EmptyState title="Adjustment not found" hint="This document may have been deleted." />
			</ModuleShell>
		);
	}

	return (
		<ModuleShell title={card.displayNumber ?? 'Adjustment'} backTo={backTo}>
			<div className="flex flex-col gap-3 pb-4">
				{/* The document's lifecycle, in the corner the list row it was opened from
				 *  puts it: WHAT this is (the status pill) and WHAT can still be done (the
				 *  ONE cancel, plus the draft's approve). The badge is the WHOLE statement:
				 *  the form behind it renders a settled correction read-only, and a
				 *  sentence under the pill would say that fact a second time. A cancelled
				 *  correction is frozen and final: no menu at all. */}
				<div className="flex items-center justify-between gap-2">
					<DocStatusPill status={seed.docStatus} />
					{!isCancelled && (
						<DocActionsMenu
							docNumber={card.displayNumber}
							noun="this adjustment"
							primary={isDraft ? { label: 'Approve', onSelect: () => setApproveOpen(true), disabled: busy } : null}
							cancel={{ label: cancelCopy.label, onSelect: () => setCancelOpen(true), disabled: cancelBusy }}
						/>
					)}
				</div>

				{/* THE FORM — the SAME component the `/+` create screen hosts, seeded with
				    this document. `key` on the id so another document REMOUNTS it (the seed
				    is read once at mount, so a reused instance would show the previous
				    correction's values). */}
				<AdjustmentForm key={id} seed={seed} onDone={handleSaved} />

				{/* Lifecycle footer — the DRAFT's approve (a thumb-reachable primary, and the
					SAME hook the list card mounts, so one action is never offered twice in two
					voices) plus whatever a lifecycle call refused, verbatim. An APPLIED
					correction has no action here — its reversal is the ⋮ above, and its reason is
					stated there too; a CANCELLED one gets neither, because it is final. With
					nothing to say the block is ABSENT, not an empty border. */}
				{!isCancelled && (isDraft || error || cancelError) && (
					<div className="flex flex-col gap-2 border-t border-dashed border-border pt-3">
						{isDraft && (
							<button
								type="button"
								disabled={busy}
								onClick={() => setApproveOpen(true)}
								className="flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
							>
								{busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" strokeWidth={2.2} aria-hidden />}
								{busy ? 'Approving…' : 'Approve'}
							</button>
						)}
						{error && <p className="text-center text-xs font-medium leading-myanmar text-destructive">{error}</p>}
						{cancelError && <p className="text-center text-xs font-medium leading-myanmar text-destructive">{cancelError}</p>}
					</div>
				)}
			</div>

			<ConfirmSheet
				open={approveOpen}
				title="Approve this adjustment?"
				description="Approving applies the ± corrections to stock. An approved adjustment can be reversed later by cancelling it."
				confirmLabel="Approve"
				busy={busy}
				error={error}
				onConfirm={() => void approve()}
				onClose={() => setApproveOpen(false)}
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
		</ModuleShell>
	);
}
