import { dateLabel, money } from '../data/display';
import { barTone, moneyStateOf } from '../data/money';
import type { InboundCardModel } from '../data/types';

/** The payment block's one-line state — the preattentive summary under the bar. */
export function paymentCaption(doc: InboundCardModel, left: number | null): string {
	if (doc.paymentStatus === 'paid') return doc.fullyPaidOn ? `Fully paid on ${dateLabel(doc.fullyPaidOn)}` : 'Fully paid';
	if (doc.paymentStatus === 'partial') return `Partially paid · ${money(left)} left`;
	return 'Unpaid — nothing paid yet';
}

/**
 * The money FACE of a receipt — the progress bar, the Paid/Left pair and the
 * caption, with the figure that must read identically wherever the receipt is
 * shown:
 *
 *   ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░
 *   ┌──────────────────┬─────────────────────┐
 *   │ Paid             │ Left                │
 *   │ 1,000,000 Ks     │ 500,000 Ks          │
 *   └──────────────────┴─────────────────────┘
 *   Partially paid · 500,000 Ks left
 *
 * ONE component because a receipt is read in two places — the list row that
 * raised it and the detail page it opens onto — and both mount THIS, off the ONE
 * derivation (`moneyStateOf`) the payment sheet uses as well, so the row, the
 * page and the sheet can never disagree about what is left or how full the bar
 * is. The Total is deliberately ABSENT: the card's own headline states it a few
 * pixels above, and a number read twice is ink without information.
 */
export function InboundMoneyStrip({ doc }: { doc: InboundCardModel }) {
	const { paid, left, percent } = moneyStateOf(doc);
	const captionTone =
		doc.paymentStatus === 'paid'
			? 'text-status-success'
			: doc.paymentStatus === 'partial'
				? 'text-status-warning'
				: 'text-muted-foreground';

	return (
		<>
			<span className="block h-2 w-full overflow-hidden rounded-full bg-muted">
				<span className={`block h-2 rounded-full ${barTone(doc.paymentStatus)}`} style={{ width: `${percent}%` }} />
			</span>

			<span className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/40 p-2.5 text-center">
				<span>
					<span className="block text-[10px] font-medium leading-myanmar text-muted-foreground">Paid</span>
					<span className="block truncate text-xs font-bold text-status-success">{money(paid)}</span>
				</span>
				<span>
					<span className="block text-[10px] font-medium leading-myanmar text-muted-foreground">Left</span>
					<span className={`block truncate text-xs font-bold ${left === 0 ? 'text-status-success' : 'text-status-danger'}`}>
						{money(left)}
					</span>
				</span>
			</span>

			<span className={`mt-1.5 block text-meta leading-myanmar ${captionTone}`}>{paymentCaption(doc, left)}</span>
		</>
	);
}
