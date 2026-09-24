import { DateField } from '@/shared/components/date-field';
import { MMT_OFFSET_MS } from '@/shared/time/myanmar';

/** Today in Myanmar time as `YYYY-MM-DD` — the default (and the ceiling) for every
 *  physical-event date field: a fit or an un-seat already HAPPENED, so it can never
 *  sit in the future. */
export function todayMmt(): string {
	return new Date(Date.now() + MMT_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The PHYSICAL-EVENT date every wheel write carries — the day a tyre went onto a
 * wheel, or came off one. ONE component so no two flows can disagree about
 * the label, the format or the ceiling; the value is a plain `YYYY-MM-DD` the writer
 * sends as `event_date` — the EFFECTIVE day the lifecycle timeline ages, orders and
 * narrates each row by (never the row's `created_at`).
 */
export function EventDateField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
	return (
		<div className="flex flex-col gap-1">
			<span className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Date</span>
			<DateField
				value={value}
				onChange={onChange}
				ariaLabel="Event date"
				className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm font-semibold text-foreground outline-none focus:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring"
			/>
		</div>
	);
}
