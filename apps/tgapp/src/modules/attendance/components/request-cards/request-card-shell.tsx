import type { ReactNode } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { CalendarDays, MessageSquare, Pencil, TriangleAlert, User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@mmbix/design-system/avatar';

import type { HrRequest } from '../../data/types';
import { TYPE_ICON, submittedLabel } from './format';
import { Facts, type RequestFact } from './request-facts';
import { RequestStatusBadge } from './status-badge';

/** The visible summary bar's two tokens — the date/period on the left, the
 *  duration/meta on the right (e.g. "17 Sep" · "1 day"). */
export interface RequestSummary {
	primary: string;
	secondary?: string | null;
}

/** What a per-type card builder produces: the summary + the type facts, both
 *  rendered on the card face (the date/duration never repeat in the facts). */
export interface RequestCardData {
	summary: RequestSummary;
	facts: RequestFact[];
}

export interface RequestCardShellProps {
	/** The `hr_requests` row (identity, reason, status, timestamps, edit). */
	request: HrRequest;
	/** The type facts for this request (from the row builders). */
	facts: RequestFact[];
	/** The summary bar — always visible. */
	summary: RequestSummary;
	/** Directory photo — the employee icon when absent. */
	photoUrl?: string | null;
	/** Role/department subtitle from the directory — the eid alone when absent. */
	employeeSummary?: string | null;
	/** Extra decision controls — the approval center's ✓/✗ buttons / the cancel ✗
	 *  (rendered flush right in the actions row, only when present). */
	actions?: ReactNode;
	/**
	 * Edit affordance (the `/:id/edit` page) — PENDING own-request rows only.
	 * Rendered as a pencil button beside the decision controls.
	 */
	onEdit?: () => void;
	/**
	 * WHOSE request this card is.
	 *
	 *  - `'self'` (default) — the "my requests" lists. The applicant IS the signed-in
	 *    user, so the avatar + name/eid header is noise: the card leads with the
	 *    request's TYPE instead, and the whole face is about the request.
	 *  - `'other'` — the approval center and the all-types inbox, where the row may
	 *    belong to anyone. Identity comes BACK as the header (avatar + name + eid).
	 */
	variant?: 'self' | 'other';
}

/**
 * The shared request-card anatomy for every HR request type.
 *
 * The card is FULLY EXPANDED by design — there is no chevron and nothing hides
 * behind a tap:
 *
 *   `variant="other"` (approval center / all-types inbox — the row may be anyone's)
 *     header       avatar + name/subtitle · status pill
 *     summary      date/period + duration
 *     description  the reason
 *     facts        the type facts (e.g. the OT time span) + the submission stamp
 *     comment      the Superior Comment, inline
 *     actions      edit / approve / reject / cancel
 *
 *   `variant="self"` (the Leave / Overtime / Early-Leave lists — the row is the
 *     signed-in user's own)
 *     header       type glyph + summary · status pill
 *     facts        the type facts
 *     description  the reason
 *     comment      the Superior Comment, inline
 *     actions      edit / cancel
 *
 * The card face is deliberately NOT a button: tapping a card used to toggle the
 * (now removed) collapsible body, which made an accidental tap on a card that
 * sits under the decision buttons do nothing useful.
 */
export function RequestCardShell({
	request,
	facts,
	summary,
	photoUrl,
	employeeSummary,
	actions,
	onEdit,
	variant = 'self',
}: RequestCardShellProps) {
	const name = request.employee_name || request.employee_eid || '—';
	const subtitle = employeeSummary ? [request.employee_eid, employeeSummary].filter(Boolean).join(' · ') : (request.employee_eid ?? '—');

	// The approver's note — shown INLINE for every status, not just a rejection.
	// A rejected row styles it as a warning; any other status reads as a quiet note.
	const comment = request.superior_comment?.trim() || request.reject_reason?.trim() || null;
	const rejected = request.status === 'rejected';
	// The submission age: an inline fact on `other` cards (identity is the card's
	// subject there), a quiet face footnote on `self` cards.
	const submitted = request.created_at ? submittedLabel(request.created_at) : null;
	const inlineFacts: RequestFact[] =
		variant === 'other' && submitted ? [...facts, { kind: 'label-value', label: 'Submitted', value: submitted }] : facts;

	// The status pill — no chevron (nothing collapses any more).
	const statusCluster = (
		<div className="flex shrink-0 items-center gap-1.5">
			<RequestStatusBadge status={request.status} />
		</div>
	);

	const commentBlock = comment ? (
		<p
			className={`flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs font-medium leading-myanmar ${
				rejected ? 'bg-status-danger-soft text-status-danger' : 'bg-muted/60 text-muted-foreground'
			}`}
		>
			{rejected ? (
				<TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
			) : (
				<MessageSquare className="mt-0.5 size-3.5 shrink-0" aria-hidden />
			)}
			<span>{comment}</span>
		</p>
	) : null;

	return (
		<li className={`overflow-hidden ${CARD_FRAME} shadow-card`}>
			{variant === 'other' ? (
				<>
					<div className="flex items-center justify-between gap-3 p-3.5 pb-2.5">
						<div className="flex min-w-0 flex-1 items-center gap-3">
							<Avatar className="size-11">
								{photoUrl ? <AvatarImage src={photoUrl} alt="" /> : null}
								<AvatarFallback>
									<User className="size-5" strokeWidth={2} aria-hidden />
								</AvatarFallback>
							</Avatar>
							<div className="min-w-0">
								<p className="truncate text-sm font-semibold leading-myanmar text-foreground">{name}</p>
								<p className="-mt-0.5 truncate text-xs leading-myanmar text-muted-foreground">{subtitle}</p>
							</div>
						</div>
						{statusCluster}
					</div>

					<div className="flex flex-col gap-2 px-3.5 pb-3.5">
						{/* The summary NEVER truncates: on a narrow phone a long range / duration
						    wraps instead of clipping (the whole period must stay readable). */}
						<div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-sub font-semibold leading-myanmar text-foreground">
							<span className="flex min-w-0 items-center gap-1.5">
								<CalendarDays className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
								<span className="break-words">{summary.primary}</span>
							</span>
							{summary.secondary ? <span className="shrink-0 text-muted-foreground">{summary.secondary}</span> : null}
						</div>

						<Facts facts={inlineFacts} />

						{request.reason ? (
							<p className="line-clamp-2 border-l-2 border-border pl-2.5 text-xs leading-myanmar text-muted-foreground">{request.reason}</p>
						) : null}

						{commentBlock}
					</div>
				</>
			) : (
				<>
					<div className="flex items-center justify-between gap-3 px-3.5 pt-3.5">
						<div className="flex min-w-0 flex-1 items-center gap-2.5">
							<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
								{(() => {
									const Icon = TYPE_ICON[request.request_type ?? 'leave'] ?? CalendarDays;
									return <Icon className="size-4.5" strokeWidth={2.2} aria-hidden />;
								})()}
							</span>
							<p className="break-words text-sm font-bold leading-myanmar text-foreground">{summary.primary}</p>
						</div>
						{statusCluster}
					</div>

					<div className="flex flex-col gap-2.5 px-3.5 pb-3.5 pt-2.5">
						<div className="flex items-center justify-between gap-2">
							{summary.secondary ? <span className="text-sub font-semibold leading-myanmar text-primary">{summary.secondary}</span> : null}
							{submitted ? <span className="ml-auto text-meta font-medium text-muted-foreground">{submitted}</span> : null}
						</div>

						<Facts facts={facts} />

						{request.reason ? (
							<p className="line-clamp-2 border-l-2 border-border pl-2.5 text-xs leading-myanmar text-muted-foreground">{request.reason}</p>
						) : null}

						{commentBlock}
					</div>
				</>
			)}

			{/* Actions — only when the row has edit / decision controls. */}
			{actions || onEdit ? (
				<div className="flex items-center justify-end gap-2 border-t border-border/70 px-3.5 py-2.5">
					{onEdit ? (
						<button
							type="button"
							onClick={onEdit}
							aria-label="Edit"
							className="flex size-9 items-center justify-center rounded-full border border-border bg-background text-foreground transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<Pencil className="size-4" strokeWidth={2.2} aria-hidden />
						</button>
					) : null}
					{actions}
				</div>
			) : null}
		</li>
	);
}
