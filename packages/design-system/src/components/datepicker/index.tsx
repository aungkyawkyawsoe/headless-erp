'use client';

import * as React from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';

import { cn } from '@/utils';
import { formatDate, isSameDay, resolveLocale } from '@/date';
import type { DateRange } from '@/date';
import { Button } from '@/button';
import { Calendar } from '@/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/popover';
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/sheet';
import { useIsMobile } from '@/hooks/use-mobile';

/**
 * Props shared by both pickers — everything except the Calendar's
 * selection props (`mode`, `selected`, `onSelect`) flows through
 * to the underlying Calendar (e.g. `startMonth`, `endMonth`, `locale`,
 * `showOutsideDays`, `disabled`, `month`, `onMonthChange`).
 */
type CalendarFieldProps = Omit<React.ComponentProps<typeof Calendar>, 'mode' | 'selected' | 'onSelect' | 'className'>;

/**
 * Shared surface for the two pickers.
 *
 * On desktop the calendar opens in a small anchored `Popover` next to the
 * trigger. On mobile (below `md`) that anchor is too fiddly and easily pushed
 * off-screen, so the SAME trigger instead opens a full-width bottom `Sheet`
 * (a dialog) that slides up over the page — the native mobile date-picker
 * pattern. Both surfaces share one `open` state and the same button.
 */
function PickerSurface({
	open,
	onOpenChange,
	isMobile,
	disabled,
	dataEmpty,
	className,
	triggerContent,
	calendar,
	title,
	confirmLabel,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	isMobile: boolean;
	disabled?: boolean;
	dataEmpty?: boolean;
	className?: string;
	triggerContent: React.ReactNode;
	calendar: React.ReactNode;
	title: string;
	/** When set, the mobile bottom sheet shows a confirm footer (e.g. ranges,
	 *  which need an explicit “done”). `DatePicker` omits it — a single tap
	 *  already confirms + closes the sheet. */
	confirmLabel?: string;
}) {
	// On mobile the button opens the sheet via onClick (there is no anchor);
	// on desktop the PopoverTrigger manages opening, so leave onClick undefined
	// to avoid fighting Base UI's own trigger handling.
	//
	// The trigger is a FIELD, not a button: it must sit in a form at exactly the
	// same height and width as the sibling `Input`s and must never spill out of
	// its card. Size comes from `className` (apps pass their field vocabulary,
	// e.g. `h-11 w-full rounded-lg border-input bg-card`) — the base Button sizes
	// in via `min-h-11` rather than `h-*`, which the app class then overrides.
	// The label is the flexible child: it wraps in a `min-w-0` span that truncates,
	// so a long localized date can't stretch the field past its container (the
	// `w-full` + `min-w-0` pair is what stops the overflow reported on date fields).
	const triggerButton = (
		<Button
			variant="outline"
			disabled={disabled}
			data-empty={dataEmpty}
			onClick={isMobile ? () => onOpenChange(true) : undefined}
			className={cn(
				'w-full min-w-0 max-w-full justify-start overflow-hidden px-2 text-left font-normal data-[empty=true]:text-muted-foreground',
				className,
			)}
		/>
	);

	if (isMobile) {
		return (
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetTrigger render={triggerButton}>{triggerContent}</SheetTrigger>
				<SheetContent side="bottom" className="max-h-[88dvh] gap-4 overflow-y-auto">
					<SheetHeader>
						<SheetTitle>{title}</SheetTitle>
					</SheetHeader>
					<div className="overflow-x-auto px-1 pb-2">{calendar}</div>
					{confirmLabel && (
						<SheetFooter style={{ paddingBottom: 'calc(1rem + var(--safe-area-bottom))' }}>
							<SheetClose
								render={
									<Button variant="outline" className="w-full sm:w-auto">
										{confirmLabel}
									</Button>
								}
							/>
						</SheetFooter>
					)}
				</SheetContent>
			</Sheet>
		);
	}

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger render={triggerButton}>{triggerContent}</PopoverTrigger>
			<PopoverContent className="w-auto p-0">{calendar}</PopoverContent>
		</Popover>
	);
}

// ── DatePicker (single date) ────────────────────────────────────────────────

function DatePicker({
	value,
	onValueChange,
	placeholder = 'Pick a date',
	/**
	 * The TRIGGER's date format — any date-fns token string. Defaults to the long
	 * localized form (`PPP`: “September 20, 2026”); an app whose fields are narrow
	 * passes its own (`d MMM y`: “20 Sep 2026”), which is what actually fits beside
	 * another picker in a half-width cell.
	 */
	format = 'PPP',
	disabled,
	className,
	...calendarProps
}: CalendarFieldProps & {
	value?: Date;
	onValueChange?: (date: Date | undefined) => void;
	placeholder?: string;
	format?: string;
	disabled?: boolean;
	className?: string;
}) {
	const [internalValue, setInternalValue] = React.useState<Date | undefined>(value);
	const [open, setOpen] = React.useState(false);
	const isMobile = useIsMobile();
	const selected = value ?? internalValue;
	const locale = resolveLocale(calendarProps.locale);

	const handleSelect = React.useCallback(
		(date: Date | undefined) => {
			setInternalValue(date);
			onValueChange?.(date);
			setOpen(false);
		},
		[onValueChange],
	);

	return (
		<PickerSurface
			open={open}
			onOpenChange={setOpen}
			isMobile={isMobile}
			disabled={disabled}
			dataEmpty={!selected}
			className={className}
			title="Select a date"
			triggerContent={
				<>
					<CalendarIcon strokeWidth={1.6} className="shrink-0" />
					{selected ? (
						<span className="min-w-0 flex-1 truncate">{formatDate(selected, format, locale.code)}</span>
					) : (
						<span className="min-w-0 flex-1 truncate">{placeholder}</span>
					)}
				</>
			}
			calendar={
				<Calendar
					mode="single"
					selected={selected}
					onSelect={handleSelect}
					// Mobile touch targets: the default --cell-size (28px) is too small
					// on phones — raise it to 38px below `sm` (cells, weekday labels,
					// and nav buttons all scale from the same variable); desktop keeps
					// the compact default.
					className="max-sm:[--cell-size:--spacing(9.5)]"
					{...calendarProps}
				/>
			}
		/>
	);
}

// ── DateRangePicker ─────────────────────────────────────────────────────────

function DateRangePicker({
	value,
	onValueChange,
	placeholder = 'Pick a date range',
	disabled,
	className,
	numberOfMonths = 2,
	...calendarProps
}: CalendarFieldProps & {
	value?: DateRange;
	onValueChange?: (range: DateRange | undefined) => void;
	placeholder?: string;
	disabled?: boolean;
	className?: string;
	numberOfMonths?: number;
}) {
	const [internalValue, setInternalValue] = React.useState<DateRange | undefined>(value);
	const [open, setOpen] = React.useState(false);
	const isMobile = useIsMobile();
	const selected = value ?? internalValue;
	const locale = resolveLocale(calendarProps.locale);

	const handleSelect = React.useCallback(
		(range: DateRange | undefined) => {
			setInternalValue(range);
			onValueChange?.(range);
			// Deliberately leave the surface open: a range needs two endpoints and
			// the calendar's range reducer can emit a completed same-day range on a
			// single tap. On mobile users tap the “Done” footer (or the backdrop) to
			// dismiss after finishing; desktop popover matches by staying open too, on
			// top of closing on outside-click. Matches the pre-existing single-mode
			// behavior of keeping the picker open until the user dismisses it.
		},
		[onValueChange],
	);

	return (
		<PickerSurface
			open={open}
			onOpenChange={setOpen}
			isMobile={isMobile}
			disabled={disabled}
			dataEmpty={!selected?.from}
			className={className}
			title="Select a date range"
			confirmLabel="Done"
			triggerContent={
				<>
					<CalendarIcon strokeWidth={1.6} className="shrink-0" />
					{selected?.from ? (
						<span className="min-w-0 flex-1 truncate">
							{selected.to && !isSameDay(selected.from, selected.to)
								? `${formatDate(selected.from, 'LLL dd, y', locale.code)} – ${formatDate(selected.to, 'LLL dd, y', locale.code)}`
								: formatDate(selected.from, 'LLL dd, y', locale.code)}
						</span>
					) : (
						<span className="min-w-0 flex-1 truncate">{placeholder}</span>
					)}
				</>
			}
			calendar={
				// On mobile force a single month so the bottom sheet doesn't demand
				// horizontal scrolling or a very tall dialog; desktop keeps the
				// requested multi-month layout.
				<Calendar
					mode="range"
					selected={selected}
					onSelect={handleSelect}
					numberOfMonths={isMobile ? 1 : numberOfMonths}
					className="max-sm:[--cell-size:--spacing(9.5)]"
					{...calendarProps}
				/>
			}
		/>
	);
}

export { DatePicker, DateRangePicker };
export type { CalendarFieldProps };
