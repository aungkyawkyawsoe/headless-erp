import { memo, type ReactNode } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@mmbix/design-system/avatar';

import { REQUISITION_STATUS_META } from '../data/status';
import type { MroRequisitionCardModel } from '../data/types';
import { ErpRow, type ErpRowMeta } from '@/shared/components/erp-row';

/** "1,200" / "1,200.5" — count display, no trailing zeros. */
function formatCount(value: number | null): string {
	if (value == null || !Number.isFinite(value)) return '—';
	return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

interface StoreRequestCardProps {
	request: MroRequisitionCardModel;
	/** Tap → the request's detail page (`/app/store-requests/:id`) — the store
	 *  keeper approves / issues / rejects there, and reads the requested line
	 *  items (the card itself is HEADER ONLY). Absent renders a static row —
	 *  e.g. the same card reused as a detail page's header. */
	onOpen?: () => void;
	/** Inline operational actions (Approve / Reject) — reserved for the Approval
	 *  Center, where deciding IS the job. The list itself passes none. */
	actions?: ReactNode;
	/** Optional override for the status badge label (e.g. "Rejected" in the
	 *  Rejected tab where cancelled items are displayed). */
	statusLabel?: string;
}

/**
 * Store-request row — ONE `mro_requisitions` record in the dense ERP grid.
 *
 * The retired card led with a 44px chip, a hero number and a dotted-leader meta
 * block, i.e. ~150px per record (≈4 on a phone screen). This row keeps the same
 * facts in the shared 3-scale shape (~64px collapsed, hairline-separated):
 *
 *   [avatar] REQ-00004        ← L1 anchor (bold, high contrast)     12 ← total
 *            Main Store · TRK  ← L2 identity                [Requested] ← status
 *            Aung · 12 Jan      ← L3 meta
 *
 * The requester's AVATAR leads the row (WHO asked) and the requested TOTAL rides
 * the top-right (the document value); store · truck and the requester/date sit on
 * the face. The approver / close reason / description render ALWAYS OPEN below the
 * face (`metaAlwaysVisible` — no expand/collapse toggle). Decide actions
 * deliberately do NOT live here: the file's contract with the Approval Center is
 * that the list is navigation, the decision is an explicit screen.
 */
export const StoreRequestCard = memo(function StoreRequestCard({ request, onOpen, actions, statusLabel }: StoreRequestCardProps) {
	const meta = REQUISITION_STATUS_META[request.requisitionStatus] ?? REQUISITION_STATUS_META.requested;
	const displayLabel = statusLabel ?? meta.label;

	// The requested total — the row's document VALUE, shown bold at the top-right.
	// Before approval the engine has not computed the header totals, so a draft
	// simply shows none (never a misleading 0).
	const totalLabel = request.requestedQty != null && Number.isFinite(request.requestedQty) ? formatCount(request.requestedQty) : null;

	const requester = request.requestedBy;

	// The approver appears only once the request has been approved.
	const approver =
		request.requisitionStatus === 'approved' ||
		request.requisitionStatus === 'partially_issued' ||
		request.requisitionStatus === 'fulfilled'
			? request.approvedBy
			: null;

	// L2 — the store, plus the TRUCK when the request is bound to one (a decision
	// needs to know what the stock is for, so the plate rides the face rather than
	// hiding behind the disclosure).
	const secondary = [request.locationLabel, request.vehiclePlate].filter(Boolean).join(' · ') || '—';

	// L3 — the one tertiary line kept on the collapsed face.
	const tertiary = [requester.name, request.requestDateLabel].filter(Boolean).join(' · ') || null;

	// Everything else is revealed on demand (progressive disclosure).
	const closeLabel =
		request.requisitionStatus === 'cancelled'
			? request.closeReason === 'stock_low'
				? 'Stock too low'
				: request.closeReason === 'cancelled'
					? 'No longer needed'
					: 'Closed'
			: null;

	// Behind the disclosure: the approver (once decided), the close reason, and the
	// requester's description. The requester + date already ride the face (L3), so
	// they are NOT repeated here.
	const details: ErpRowMeta[] = [
		...(approver ? [{ label: 'Approved By', value: approver.name ?? '—' }] : []),
		...(closeLabel ? [{ label: 'Reason', value: closeLabel }] : []),
		// The requester's description — a full-width, wrapping entry so the whole
		// note stays readable (a truncated one-liner would hide the need).
		...(request.note ? [{ label: 'Description', value: request.note, wide: true }] : []),
	];

	return (
		<ErpRow
			className={`${CARD_FRAME} shadow-card`}
			anchor={request.displayNumber ?? '—'}
			secondary={secondary}
			tertiary={tertiary}
			status={{ label: displayLabel, className: meta.className }}
			trailing={totalLabel}
			leading={
				/* WHO asked — the requester's avatar leads the row (the employee icon
				   until a photo is on file), so a decision sees the person at a glance. */
				<Avatar variant="square" className="size-9">
					{requester.avatar ? <AvatarImage src={requester.avatar} alt={requester.name ?? ''} /> : null}
					<AvatarFallback>
						<User className="size-4" aria-hidden />
					</AvatarFallback>
				</Avatar>
			}
			meta={details}
			metaAlwaysVisible
			onOpen={onOpen}
			actions={actions}
		/>
	);
});
