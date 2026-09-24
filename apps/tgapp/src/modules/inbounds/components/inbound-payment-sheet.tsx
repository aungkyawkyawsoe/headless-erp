import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';
import { ScrollArea } from '@mmbix/design-system/scroll-area';
import { Input } from '@mmbix/design-system/input';
import { DatePicker } from '@mmbix/design-system/datepicker';
import { Loader2, Trash2, Wallet } from 'lucide-react';

import { ConfirmSheet } from '@/shared/components/confirm-sheet';
import { hapticImpact } from '@/shared/platform/haptics';
import { APP_DATE_FORMAT, todayMmtDate } from '@/shared/time/myanmar';
import { createInboundPayment, deleteInboundPayment, fetchInboundPayments } from '../data/api';
import { dateLabel, money, paidOnLabel } from '../data/display';
import { moneyStateOf, expectsPaymentOf } from '../data/money';
import type { MoneyState } from '../data/money';
import type { InboundPaymentModel } from '../data/payments';
import { qk } from '../data/query-keys';
import type { InboundCardModel } from '../data/types';

/** `YYYY-MM-DD` → the DatePicker's local calendar date (no TZ shifting). */
function parseDay(value: string): Date | undefined {
	const [y, m, d] = value.split('-').map(Number);
	return y && m && d ? new Date(y, m - 1, d) : undefined;
}

/** A calendar date → `YYYY-MM-DD` (the wire shape `paid_on` is stored as). */
function toDayInput(value: Date): string {
	return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

/**
 * The ONE sentence the sheet says about where the money stands — the block's
 * right-hand figure. Same wording rules as the card's caption, shorter: the
 * compact block has room for a figure, not a paragraph.
 */
function outstandingLabel(doc: InboundCardModel, state: MoneyState): string {
	if (state.settled) return doc.fullyPaidOn ? `Fully paid on ${dateLabel(doc.fullyPaidOn)}` : 'Fully paid';
	if (state.left == null) return 'No total yet';
	return state.left === state.total ? 'Nothing paid yet' : `${money(state.left)} left`;
}

/**
 * ONE ledger row — WHEN it was paid, how much, and who booked it.
 *
 * The date is a full dated stamp (never a bare "Today"), because a payment record
 * outlives the word: `paidOnLabel` reads "Today, Sep 20, 2026" now and
 * "Sat, Sep 20, 2026" next week — the day itself never moves. Nothing else competes
 * for the row: the mini app files a payment with a day and an amount, so the model
 * it renders carries exactly those (plus the recorder the engine stamped).
 */
function PaymentRow({ payment, today, onRemove }: { payment: InboundPaymentModel; today: string; onRemove: () => void }) {
	const stamp = paidOnLabel(payment.paidOn, today);
	return (
		<li className="flex items-center gap-3 py-2">
			<span className="min-w-0 flex-1">
				<span className="block text-sub font-bold leading-myanmar text-foreground">{money(payment.amount)}</span>
				<span className="block truncate text-meta leading-myanmar text-muted-foreground">
					{stamp}
					{payment.recordedByName ? ` · ${payment.recordedByName}` : ''}
				</span>
				{payment.note ? <span className="block truncate text-meta leading-myanmar text-muted-foreground">{payment.note}</span> : null}
			</span>
			{/* The removal is quiet at rest (an idle row must not shout "delete") and
			 *  only firms up on hover/press — never tinted, like the rest of the
			 *  sheet: the figure is the signal, not a hue. */}
			<button
				type="button"
				onClick={onRemove}
				aria-label={`Remove the ${money(payment.amount)} payment of ${stamp}`}
				className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<Trash2 className="size-3.5" strokeWidth={1.8} aria-hidden />
			</button>
		</li>
	);
}

/**
 * The receipt's PAYMENT SHEET — the one surface where a purchase's money is asked
 * and answered, in three compact blocks and nothing else:
 *
 *  1. **where the money stands** — ONE row: `Paid: X / Y` on the left, what is
 *     still owed (or the day it settled) on the right, over a slim bar;
 *  2. **payment history** — the ledger, newest first, under its entry count; each
 *     row is day-stamped, and a wrong entry is REMOVED here (the money columns are
 *     frozen upstream, so a correction is remove-then-re-file, never a silent rewrite);
 *  3. **record new payment** — TWO fields side by side (the amount, prefilled with
 *     the remainder, and the day), the remainder one tap away, the submit at the
 *     foot. No method, no reference, no note: an operator knows when the money
 *     left and how much of it did, and every extra control is a question the
 *     screen cannot answer for them (the engine fills the collection's declared
 *     `method` default instead).
 *
 * Deliberately UNTINTED: the figures carry the state, so paid / owed / settled are
 * plain foreground text and the bar is neutral. The LIST card keeps its tones —
 * there the money state is a scanning cue among dozens of rows; here the reader
 * has already opened the one receipt and asked about it, so a hue next to the
 * number would only repeat it. (A FAILURE still tints: an error is not decoration.)
 *
 * Query-side only: the engine stamps the recorder from the session
 * (`policies.actor_fields`) and its denorm hook re-derives the receipt's
 * `paid_amount` / `payment_status` / `fully_paid_on` from the live ledger, so a
 * write here just invalidates the receipt lists + this ledger and the card follows.
 */
export function InboundPaymentSheet({
	doc,
	open,
	onOpenChange,
}: {
	doc: InboundCardModel;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const queryClient = useQueryClient();
	// The SAME derived money state the card's strip shows (one shared rule), so the
	// sheet can never contradict the row that opened it.
	const state = moneyStateOf(doc);
	const { total, left, percent } = state;
	// Whether the sheet still ASKS for a payment: a settled receipt keeps its money
	// face and its ledger (review / remove), but no form.
	const expectsPayment = expectsPaymentOf(doc);
	// The store's calendar day — the stamp every ledger row is written against.
	const today = todayMmtDate();

	const ledger = useQuery({
		queryKey: qk.inboundPayments(doc.id),
		queryFn: () => fetchInboundPayments(doc.id),
		enabled: open,
		staleTime: 0,
	});

	// The form — re-seeded from the CURRENT remainder every time the sheet opens,
	// so the prefill is never a stale figure someone then under- or over-pays.
	const [day, setDay] = useState<Date | undefined>(() => parseDay(todayMmtDate()));
	const [amount, setAmount] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [pendingRemoval, setPendingRemoval] = useState<InboundPaymentModel | null>(null);

	useEffect(() => {
		if (!open) return;
		setDay(parseDay(todayMmtDate()));
		setAmount(left != null && left > 0 ? String(left) : '');
		setError(null);
		// `left` is deliberately NOT a dependency: it changes after every write, and
		// re-seeding mid-typing would overwrite what the operator is entering.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, doc.id]);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: qk.inboundsAll(), refetchType: 'active' });
		void queryClient.invalidateQueries({ queryKey: qk.inboundPayments(doc.id), refetchType: 'active' });
	};

	const save = useMutation({
		mutationFn: (input: { paidOn: string; amount: number }) =>
			createInboundPayment({ parentId: doc.id, paidOn: input.paidOn, amount: input.amount }),
		onSuccess: () => {
			hapticImpact('medium');
			setError(null);
			invalidate();
		},
		onError: (err) => {
			hapticImpact('light');
			setError(err instanceof Error && err.message.trim() ? err.message : 'Could not record the payment — try again.');
		},
	});

	const remove = useMutation({
		mutationFn: (paymentId: string) => deleteInboundPayment(doc.id, paymentId),
		onSuccess: () => {
			hapticImpact('medium');
			setPendingRemoval(null);
			invalidate();
		},
		onError: (err) => {
			hapticImpact('light');
			setError(err instanceof Error && err.message.trim() ? err.message : 'Could not remove the entry — try again.');
			setPendingRemoval(null);
		},
	});

	const parsed = Number(amount);
	const canSubmit = Number.isFinite(parsed) && parsed > 0 && day !== undefined && !save.isPending;

	const submit = () => {
		if (!canSubmit || !day) return;
		hapticImpact('medium');
		save.mutate({ paidOn: toDayInput(day), amount: Math.round(parsed * 100) / 100 });
	};

	const ledgerRows = ledger.data ?? [];

	return (
		<>
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent side="bottom" className="max-h-[88dvh]">
					<SheetHeader className="pb-2">
						<SheetTitle className="flex items-center gap-2 text-key font-bold leading-myanmar">
							<Wallet className="size-4 text-foreground" aria-hidden />
							Payments · {doc.displayNumber ?? 'receipt'}
						</SheetTitle>
					</SheetHeader>

					<ScrollArea className="px-4 pb-safe">
						{/* 1. Where the money stands — ONE compact row + a slim bar, deliberately
						 *  UNTINTED: the figures carry the state (paid off the total on the
						 *  left, what is still owed on the right), so a hue would only repeat
						 *  what the numbers already say. */}
						<div className="rounded-xl border border-border bg-muted/40 p-2.5">
							<div className="flex items-center justify-between gap-3 text-sub leading-myanmar">
								<span className="min-w-0 truncate text-muted-foreground">
									Paid: <span className="font-bold text-foreground">{money(state.paid)}</span> / {money(total)}
								</span>
								<span className="shrink-0 font-bold text-foreground">{outstandingLabel(doc, state)}</span>
							</div>

							<div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background">
								<div className="h-1.5 rounded-full bg-foreground" style={{ width: `${percent}%` }} />
							</div>
						</div>

						{/* 2. The ledger — newest first, every row day-stamped, in one framed
						 *  list with its own count so an empty ledger is never ambiguous. */}
						<div className="mt-3.5 flex items-center justify-between gap-2">
							<span className="text-meta font-semibold uppercase tracking-wider text-muted-foreground">Payment history</span>
							{ledgerRows.length > 0 && (
								<span className="text-meta leading-myanmar text-muted-foreground">
									{ledgerRows.length} {ledgerRows.length === 1 ? 'entry' : 'entries'}
								</span>
							)}
						</div>
						{ledger.isPending ? (
							<p className="mt-1.5 rounded-xl border border-dashed border-border px-3 py-4 text-center text-sub leading-myanmar text-muted-foreground">
								Loading payments…
							</p>
						) : ledger.isError ? (
							<div className="mt-1.5 rounded-xl border border-dashed border-border px-3 py-3 text-center">
								<p className="text-sub font-semibold leading-myanmar text-status-danger">Couldn’t load the ledger.</p>
								<button
									type="button"
									onClick={() => void ledger.refetch()}
									className="mt-1 text-meta font-semibold leading-myanmar text-foreground underline"
								>
									Try again
								</button>
							</div>
						) : ledgerRows.length === 0 ? (
							<p className="mt-1.5 rounded-xl border border-dashed border-border px-3 py-4 text-center text-sub leading-myanmar text-muted-foreground">
								No payment recorded yet — this receipt is fully unpaid.
							</p>
						) : (
							<ul className="mt-1.5 divide-y divide-border/60 rounded-xl border border-border px-3">
								{ledgerRows.map((payment) => (
									<PaymentRow
										key={payment.id}
										payment={payment}
										today={today}
										onRemove={() => {
											hapticImpact('light');
											setPendingRemoval(payment);
										}}
									/>
								))}
							</ul>
						)}

						{/* 3. Record a payment — offered only while something is still OWED
						 *  (`expectsPaymentOf`): the amount and the day side by side, the
						 *  remainder one tap away, the submit at the foot. A settled receipt
						 *  gets no form — its story is the history above. */}
						{expectsPayment && (
							<>
								<span className="mt-3.5 block text-meta font-semibold uppercase tracking-wider text-muted-foreground">
									Record new payment
								</span>
								<div className="mt-1.5 grid grid-cols-2 gap-2">
									<div>
										<label htmlFor="payment-amount" className="mb-0.5 block text-meta leading-myanmar text-muted-foreground">
											Amount (Ks)
										</label>
										<Input
											id="payment-amount"
											value={amount}
											onChange={(e) => setAmount(e.target.value)}
											inputMode="decimal"
											placeholder="0"
											className="h-10 w-full rounded-lg border-input bg-muted/40 px-3 text-sub font-bold leading-myanmar text-foreground outline-none placeholder:font-medium placeholder:text-muted-foreground focus:border-ring/60"
										/>
									</div>
									<div>
										<span className="mb-0.5 block text-meta leading-myanmar text-muted-foreground">Date</span>
										<DatePicker
											value={day}
											onValueChange={setDay}
											placeholder="Select a date"
											format={APP_DATE_FORMAT}
											className="h-10 w-full justify-start rounded-lg border-input bg-muted/40 px-2 text-sub font-medium leading-myanmar"
										/>
									</div>
								</div>

								{left != null && left > 0 && (
									<button
										type="button"
										onClick={() => setAmount(String(left))}
										className="mt-1.5 flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-left text-meta font-medium leading-myanmar text-foreground transition-colors hover:bg-muted active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<span>Pay remaining balance</span>
										<span className="font-bold">{money(left)}</span>
									</button>
								)}
							</>
						)}

						{/* The failure alert stays OUTSIDE the gate: REMOVING an entry can fail on a
						 *  settled receipt too, and a failure the reader cannot see is the worst
						 *  outcome. (Above the submit, where a failed save belongs.) */}
						{error && (
							<p
								role="alert"
								className="mt-2 rounded-lg bg-status-danger-soft px-3 py-2 text-meta font-medium leading-myanmar text-status-danger"
							>
								{error}
							</p>
						)}

						{expectsPayment && (
							<button
								type="button"
								disabled={!canSubmit}
								aria-busy={save.isPending}
								onClick={submit}
								className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 py-2.5 text-sub font-bold leading-myanmar text-background shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-40"
							>
								{save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
								{save.isPending ? 'Saving…' : 'Record payment'}
							</button>
						)}
					</ScrollArea>
				</SheetContent>
			</Sheet>

			<ConfirmSheet
				open={pendingRemoval !== null}
				title="Remove this payment entry?"
				description={`${money(pendingRemoval?.amount)} recorded on ${dateLabel(pendingRemoval?.paidOn ?? null)} leaves the ledger and the receipt’s paid figure. Record the correct payment again afterwards.`}
				confirmLabel="Remove entry"
				tone="destructive"
				busy={remove.isPending}
				error={error}
				onConfirm={() => pendingRemoval && remove.mutate(pendingRemoval.id)}
				onClose={() => setPendingRemoval(null)}
			/>
		</>
	);
}
