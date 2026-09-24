'use client';

import * as React from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { cn } from '@/utils';
import { Button } from '@/button';
import {
	addDays,
	addMonths,
	endOfMonth,
	endOfWeek,
	getMonthGrid,
	getMonthNamesShort,
	getRangeModifier,
	getWeekdayNames,
	isDateDisabled,
	isDayBetweenInclusive,
	isSameDay,
	isSameMonth,
	matchDate,
	rangeContainsDisabledDay,
	reduceRangeSelection,
	resetRangeOnSelect,
	resolveLocale,
	selectSingle,
	startOfDay,
	startOfMonth,
	startOfWeek,
	toggleDateInArray,
} from '@/date';
import type { CalendarLocale, CalendarSelection, DateMatcher, DateRange, RangeModifier } from '@/date';

type CalendarView = 'calendar' | 'month' | 'year';
type CalendarMode = 'single' | 'multiple' | 'range';

// ── Shared props (independent of the selection mode) ────────────────────────

interface CalendarSharedProps {
	className?: string;
	/** Days (or matchers) that cannot be selected. */
	disabled?: DateMatcher | DateMatcher[];
	/** Multiple/range mode: minimum selectable days. */
	min?: number;
	/** Multiple/range mode: maximum selectable days. */
	max?: number;
	/** Range mode: reset the range when it would include a disabled day. */
	excludeDisabled?: boolean;
	/** Range mode: clicking a day starts a new range when none/open exists. */
	resetOnSelect?: boolean;
	/** Earliest month that can be navigated to. */
	startMonth?: Date;
	/** Latest month that can be navigated to. */
	endMonth?: Date;
	month?: Date;
	defaultMonth?: Date;
	onMonthChange?: (month: Date) => void;
	numberOfMonths?: number;
	showOutsideDays?: boolean;
	showWeekNumber?: boolean;
	/** Pads the grid to a stable 6 weeks. */
	fixedWeeks?: boolean;
	/** "label" = clickable month/year caption, "dropdown" = native selects. */
	captionLayout?: 'label' | 'dropdown';
	locale?: Partial<CalendarLocale>;
	/** Custom named matchers, exposed as `data-modifier-<name>` attributes. */
	modifiers?: Record<string, DateMatcher | DateMatcher[]>;
	defaultView?: CalendarView;
	buttonVariant?: React.ComponentProps<typeof Button>['variant'];
	/** When true, the selection can never be cleared. */
	required?: boolean;
}

export type CalendarProps =
	| (CalendarSharedProps & {
			mode?: 'single';
			selected?: Date;
			onSelect?: (value: Date | undefined, day: Date) => void;
	  })
	| (CalendarSharedProps & {
			mode: 'multiple';
			selected?: Date[];
			onSelect?: (value: Date[] | undefined, day: Date) => void;
	  })
	| (CalendarSharedProps & {
			mode: 'range';
			selected?: DateRange;
			onSelect?: (value: DateRange | undefined, day: Date) => void;
	  });

// ── Helpers ────────────────────────────────────────────────────────────────

const MONTHS = Array.from({ length: 12 }, (_, i) => i);

function getYearRangeStart(year: number): number {
	return Math.floor(year / 10) * 10;
}

function isMonthDisabled(monthIndex: number, year: number, startMonth?: Date, endMonth?: Date): boolean {
	const candidate = new Date(year, monthIndex, 1);
	// A month is disabled if it ends before startMonth or starts after endMonth
	const candidateEnd = new Date(year, monthIndex + 1, 0);
	if (startMonth && candidateEnd < startMonth) return true;
	if (endMonth && candidate > endMonth) return true;
	return false;
}

/** Stable `YYYY-MM-DD` key used for data attributes and focus lookup. */
function getDateKey(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

// ── Shared: single nav button ──────────────────────────────────────────────

function CalendarNavButton({
	direction,
	buttonVariant = 'ghost',
	disabled,
	onClick,
}: {
	direction: 'left' | 'right';
	buttonVariant?: React.ComponentProps<typeof Button>['variant'];
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<Button
			variant={buttonVariant}
			size="icon"
			className="pointer-events-auto size-(--cell-size) shrink-0 p-0 select-none"
			disabled={disabled}
			onClick={onClick}
		>
			{direction === 'left' ? <ChevronLeftIcon className="cn-rtl-flip size-4" /> : <ChevronRightIcon className="cn-rtl-flip size-4" />}
		</Button>
	);
}

// ── Shared: nav buttons (fragment) ─────────────────────────────────────────

function CalendarNavButtons({
	buttonVariant = 'ghost',
	prevDisabled,
	nextDisabled,
	onPrev,
	onNext,
}: {
	buttonVariant?: React.ComponentProps<typeof Button>['variant'];
	prevDisabled?: boolean;
	nextDisabled?: boolean;
	onPrev: () => void;
	onNext: () => void;
}) {
	return (
		<>
			<CalendarNavButton direction="left" buttonVariant={buttonVariant} disabled={prevDisabled} onClick={onPrev} />
			<CalendarNavButton direction="right" buttonVariant={buttonVariant} disabled={nextDisabled} onClick={onNext} />
		</>
	);
}

// ── Shared: clickable month/year labels ────────────────────────────────────

function CalendarCaptionLabels({
	month,
	view,
	locale,
	onMonthClick,
	onYearClick,
	yearRangeLabel,
}: {
	month: Date;
	view: CalendarView;
	locale?: Partial<CalendarLocale>;
	onMonthClick: () => void;
	onYearClick: () => void;
	yearRangeLabel?: string;
}) {
	const monthLabel = month.toLocaleString(locale?.code, { month: 'short' });
	const yearLabel = String(month.getFullYear());
	const showMonthButton = view !== 'year';

	return (
		<div className="flex items-center gap-0.5 text-sm font-medium select-none">
			{showMonthButton && (
				<button
					type="button"
					onClick={onMonthClick}
					className={cn(
						'rounded-(--cell-radius) px-1 py-0.5 hover:bg-accent hover:text-accent-foreground',
						view === 'month' && 'bg-accent text-accent-foreground',
					)}
				>
					{monthLabel}
				</button>
			)}
			<button
				type="button"
				onClick={onYearClick}
				className={cn(
					'rounded-(--cell-radius) px-1 py-0.5 hover:bg-accent hover:text-accent-foreground',
					view === 'year' && 'bg-accent text-accent-foreground',
				)}
			>
				{view === 'year' && yearRangeLabel ? yearRangeLabel : yearLabel}
			</button>
		</div>
	);
}

// ── Calendar view: dropdown caption (native selects) ───────────────────────

function CalendarDropdowns({
	month,
	locale,
	startMonth,
	endMonth,
	onMonthChange,
	onYearChange,
}: {
	month: Date;
	locale: CalendarLocale;
	startMonth?: Date;
	endMonth?: Date;
	onMonthChange: (monthIndex: number) => void;
	onYearChange: (year: number) => void;
}) {
	const currentYear = month.getFullYear();
	const currentMonth = month.getMonth();
	const fromYear = startMonth?.getFullYear() ?? currentYear - 100;
	const toYear = endMonth?.getFullYear() ?? currentYear + 50;
	const monthNames = getMonthNamesShort(locale.code);
	const years = Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i);

	return (
		<div className="flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium">
			<select
				aria-label="Month"
				value={currentMonth}
				onChange={(e) => onMonthChange(Number(e.target.value))}
				className="rounded-(--cell-radius) bg-transparent px-1 py-0.5 text-sm font-medium outline-none hover:bg-accent hover:text-accent-foreground"
			>
				{monthNames.map((name, i) => (
					<option key={name} value={i} disabled={isMonthDisabled(i, currentYear, startMonth, endMonth)}>
						{name}
					</option>
				))}
			</select>
			<select
				aria-label="Year"
				value={currentYear}
				onChange={(e) => onYearChange(Number(e.target.value))}
				className="rounded-(--cell-radius) bg-transparent px-1 py-0.5 text-sm font-medium outline-none hover:bg-accent hover:text-accent-foreground"
			>
				{years.map((y) => (
					<option key={y} value={y}>
						{y}
					</option>
				))}
			</select>
		</div>
	);
}

// ── Month/year picker views: full caption bar ──────────────────────────────

function CalendarCaptionBar({
	month,
	view,
	locale,
	buttonVariant = 'ghost',
	prevDisabled,
	nextDisabled,
	onPrev,
	onNext,
	onMonthClick,
	onYearClick,
	yearRangeLabel,
}: {
	month: Date;
	view: CalendarView;
	locale?: Partial<CalendarLocale>;
	buttonVariant?: React.ComponentProps<typeof Button>['variant'];
	prevDisabled?: boolean;
	nextDisabled?: boolean;
	onPrev: () => void;
	onNext: () => void;
	onMonthClick: () => void;
	onYearClick: () => void;
	yearRangeLabel?: string;
}) {
	return (
		<div className="mb-4 flex h-(--cell-size) w-full items-center justify-between">
			<CalendarNavButton direction="left" buttonVariant={buttonVariant} disabled={prevDisabled} onClick={onPrev} />
			<CalendarCaptionLabels
				month={month}
				view={view}
				locale={locale}
				onMonthClick={onMonthClick}
				onYearClick={onYearClick}
				yearRangeLabel={yearRangeLabel}
			/>
			<CalendarNavButton direction="right" buttonVariant={buttonVariant} disabled={nextDisabled} onClick={onNext} />
		</div>
	);
}

// ── CalendarMonthGrid ──────────────────────────────────────────────────────

function CalendarMonthGrid({
	month,
	locale,
	startMonth,
	endMonth,
	onMonthSelect,
}: {
	month: Date;
	locale?: Partial<CalendarLocale>;
	startMonth?: Date;
	endMonth?: Date;
	onMonthSelect: (monthIndex: number) => void;
}) {
	const currentYear = month.getFullYear();
	const currentMonthIndex = month.getMonth();
	const gridRef = React.useRef<HTMLDivElement>(null);

	// Focus the current month button on mount
	React.useEffect(() => {
		const grid = gridRef.current;
		if (!grid) return;
		const currentBtn = grid.querySelector<HTMLButtonElement>(`[data-month-index="${currentMonthIndex}"]`);
		currentBtn?.focus();
	}, [currentMonthIndex]);

	// Keyboard navigation
	const handleKeyDown = (e: React.KeyboardEvent) => {
		const grid = gridRef.current;
		if (!grid) return;
		const buttons = Array.from(grid.querySelectorAll<HTMLButtonElement>('[data-month-index]'));
		const current = document.activeElement as HTMLButtonElement;
		const currentIndex = buttons.indexOf(current);

		let nextIndex: number | undefined;

		switch (e.key) {
			case 'ArrowRight':
				nextIndex = Math.min(currentIndex + 1, buttons.length - 1);
				break;
			case 'ArrowLeft':
				nextIndex = Math.max(currentIndex - 1, 0);
				break;
			case 'ArrowDown':
				nextIndex = Math.min(currentIndex + 3, buttons.length - 1);
				break;
			case 'ArrowUp':
				nextIndex = Math.max(currentIndex - 3, 0);
				break;
			case 'Home':
				nextIndex = 0;
				break;
			case 'End':
				nextIndex = buttons.length - 1;
				break;
			case 'Enter':
			case ' ':
				e.preventDefault();
				current?.click();
				return;
			default:
				return;
		}

		e.preventDefault();
		if (nextIndex !== undefined) {
			buttons[nextIndex]?.focus();
		}
	};

	return (
		<div
			ref={gridRef}
			role="grid"
			aria-label="Month picker"
			className="grid h-[calc(var(--cell-size)*7)] min-w-[calc(var(--cell-size)*7)] auto-rows-fr grid-cols-3 gap-1"
			onKeyDown={handleKeyDown}
		>
			{MONTHS.map((m) => {
				const disabled = isMonthDisabled(m, currentYear, startMonth, endMonth);
				const isCurrent = m === currentMonthIndex;

				return (
					<button
						key={m}
						type="button"
						role="gridcell"
						data-month-index={m}
						disabled={disabled}
						aria-selected={isCurrent}
						aria-label={new Date(2024, m, 1).toLocaleString(locale?.code, {
							month: 'long',
						})}
						tabIndex={isCurrent ? 0 : -1}
						onClick={() => onMonthSelect(m)}
						className={cn(
							'h-full w-full rounded-(--cell-radius) px-1 text-center text-sm font-normal transition-colors',
							'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
							'disabled:cursor-not-allowed disabled:opacity-30',
							isCurrent
								? 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
								: 'hover:bg-accent hover:text-accent-foreground',
						)}
					>
						{new Date(2024, m, 1).toLocaleString(locale?.code, {
							month: 'short',
						})}
					</button>
				);
			})}
		</div>
	);
}

// ── CalendarYearGrid ───────────────────────────────────────────────────────

function CalendarYearGrid({
	month,
	startMonth,
	endMonth,
	onYearSelect,
}: {
	month: Date;
	startMonth?: Date;
	endMonth?: Date;
	onYearSelect: (year: number) => void;
}) {
	const currentYear = month.getFullYear();
	const startYear = getYearRangeStart(currentYear);
	const years = Array.from({ length: 12 }, (_, i) => startYear + i);
	const gridRef = React.useRef<HTMLDivElement>(null);

	// Focus the current year button on mount
	React.useEffect(() => {
		const grid = gridRef.current;
		if (!grid) return;
		const currentBtn = grid.querySelector<HTMLButtonElement>(`[data-year="${currentYear}"]`);
		currentBtn?.focus();
	}, [currentYear]);

	// Keyboard navigation
	const handleKeyDown = (e: React.KeyboardEvent) => {
		const grid = gridRef.current;
		if (!grid) return;
		const buttons = Array.from(grid.querySelectorAll<HTMLButtonElement>('[data-year]'));
		const current = document.activeElement as HTMLButtonElement;
		const currentIndex = buttons.indexOf(current);

		let nextIndex: number | undefined;

		switch (e.key) {
			case 'ArrowRight':
				nextIndex = Math.min(currentIndex + 1, buttons.length - 1);
				break;
			case 'ArrowLeft':
				nextIndex = Math.max(currentIndex - 1, 0);
				break;
			case 'ArrowDown':
				nextIndex = Math.min(currentIndex + 3, buttons.length - 1);
				break;
			case 'ArrowUp':
				nextIndex = Math.max(currentIndex - 3, 0);
				break;
			case 'Home':
				nextIndex = 0;
				break;
			case 'End':
				nextIndex = buttons.length - 1;
				break;
			case 'Enter':
			case ' ':
				e.preventDefault();
				current?.click();
				return;
			default:
				return;
		}

		e.preventDefault();
		if (nextIndex !== undefined) {
			buttons[nextIndex]?.focus();
		}
	};

	return (
		<div
			ref={gridRef}
			role="grid"
			aria-label="Year picker"
			className="grid h-[calc(var(--cell-size)*7)] min-w-[calc(var(--cell-size)*7)] auto-rows-fr grid-cols-3 gap-1"
			onKeyDown={handleKeyDown}
		>
			{years.map((y) => {
				// A year is disabled if all its months are outside the range
				const allMonthsDisabled = MONTHS.every((m) => isMonthDisabled(m, y, startMonth, endMonth));
				const isCurrent = y === currentYear;

				return (
					<button
						key={y}
						type="button"
						role="gridcell"
						data-year={y}
						disabled={allMonthsDisabled}
						aria-selected={isCurrent}
						aria-label={String(y)}
						tabIndex={isCurrent ? 0 : -1}
						onClick={() => onYearSelect(y)}
						className={cn(
							'h-full w-full rounded-(--cell-radius) px-1 text-center text-sm font-normal transition-colors',
							'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
							'disabled:cursor-not-allowed disabled:opacity-30',
							isCurrent
								? 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
								: 'hover:bg-accent hover:text-accent-foreground',
						)}
					>
						{y}
					</button>
				);
			})}
		</div>
	);
}

// ── Calendar day button ────────────────────────────────────────────────────

interface CalendarDayButtonProps {
	date: Date;
	isToday?: boolean;
	isOutside?: boolean;
	isDisabled?: boolean;
	isSelected?: boolean;
	rangeModifier?: RangeModifier;
	/** Whether to round the left/right side of this day. For range mode
	 *  these follow the endpoints and week edges; for multi-select they
	 *  follow adjacency so consecutive days merge into one pill. */
	roundLeft?: boolean;
	roundRight?: boolean;
	/** Named custom modifier flags (from the `modifiers` prop). */
	customModifiers?: Record<string, boolean>;
	focused?: boolean;
	locale?: Partial<CalendarLocale>;
	onClick?: (date: Date) => void;
	onMouseEnter?: (date: Date) => void;
}

function CalendarDayButton({
	date,
	isToday = false,
	isOutside = false,
	isDisabled = false,
	isSelected = false,
	rangeModifier = null,
	roundLeft = true,
	roundRight = true,
	customModifiers,
	focused = false,
	locale,
	onClick,
	onMouseEnter,
}: CalendarDayButtonProps) {
	const ref = React.useRef<HTMLButtonElement>(null);

	// NOTE: Intentionally no auto-focus here. On mount (e.g. a calendar
	// opening inside a popover) `focused` resolves to a default day such as
	// "today", and focusing it immediately — before the popup has been
	// positioned — makes the browser scroll the page to bring the element
	// into view (jumping to the top of the document). Initial focus inside a
	// popover is handled by the popup's focus manager, and keyboard
	// navigation re-focuses the focused day from the Calendar-level effect.

	const modifierAttrs = React.useMemo(() => {
		if (!customModifiers) return {};
		return Object.fromEntries(Object.entries(customModifiers).map(([name, matched]) => [`data-modifier-${name}`, matched]));
	}, [customModifiers]);

	const isRangeStart = rangeModifier === 'start' || rangeModifier === 'both';
	const isRangeEnd = rangeModifier === 'end' || rangeModifier === 'both';
	const isRangeMiddle = rangeModifier === 'middle';
	const isSelectedSingle = isSelected && rangeModifier === null;

	// Corner rounding. Every variant is written out literally so Tailwind
	// can generate it; only the matching data attribute is true on this day.
	const cornerClass = (() => {
		if (isRangeStart) {
			return cn(
				roundLeft ? 'data-[range-start=true]:rounded-l-(--cell-radius)' : 'data-[range-start=true]:rounded-l-none',
				roundRight ? 'data-[range-start=true]:rounded-r-(--cell-radius)' : 'data-[range-start=true]:rounded-r-none',
			);
		}
		if (isRangeEnd) {
			return cn(
				roundLeft ? 'data-[range-end=true]:rounded-l-(--cell-radius)' : 'data-[range-end=true]:rounded-l-none',
				roundRight ? 'data-[range-end=true]:rounded-r-(--cell-radius)' : 'data-[range-end=true]:rounded-r-none',
			);
		}
		if (isRangeMiddle) {
			return cn(
				roundLeft ? 'data-[range-middle=true]:rounded-l-(--cell-radius)' : 'data-[range-middle=true]:rounded-l-none',
				roundRight ? 'data-[range-middle=true]:rounded-r-(--cell-radius)' : 'data-[range-middle=true]:rounded-r-none',
			);
		}
		if (isSelectedSingle) {
			return cn(
				roundLeft ? 'data-[selected-single=true]:rounded-l-(--cell-radius)' : 'data-[selected-single=true]:rounded-l-none',
				roundRight ? 'data-[selected-single=true]:rounded-r-(--cell-radius)' : 'data-[selected-single=true]:rounded-r-none',
			);
		}
		return '';
	})();

	return (
		<Button
			ref={ref}
			type="button"
			variant="ghost"
			size="icon"
			tabIndex={focused ? 0 : -1}
			aria-selected={isSelected}
			aria-disabled={isDisabled}
			disabled={isDisabled}
			data-date={getDateKey(date)}
			data-day={date.toLocaleDateString(locale?.code)}
			data-selected={isSelected}
			data-selected-single={isSelectedSingle}
			data-range-start={isRangeStart}
			data-range-end={isRangeEnd}
			data-range-middle={isRangeMiddle}
			data-today={isToday}
			data-outside={isOutside}
			{...modifierAttrs}
			onMouseEnter={onMouseEnter ? () => onMouseEnter(date) : undefined}
			onClick={onClick ? () => onClick(date) : undefined}
			className={cn(
				'relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 border-0 leading-none font-normal',
				// Range endpoints are primary; their corners come from cornerClass
				// so they connect to the muted bar rendered by the cell wrapper.
				isRangeStart &&
					'data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[range-start=true]:hover:bg-primary data-[range-start=true]:hover:text-primary-foreground',
				isRangeEnd &&
					'data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground data-[range-end=true]:hover:bg-primary data-[range-end=true]:hover:text-primary-foreground',
				// Middle days are flat and transparent — the wrapper bar shows
				// through; only the day number is drawn here.
				isRangeMiddle && 'data-[range-middle=true]:text-foreground',
				cornerClass,
				'data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[selected-single=true]:hover:bg-primary data-[selected-single=true]:hover:text-primary-foreground',
				'dark:hover:text-foreground',
				focused && 'relative z-10 border-ring ring-[3px] ring-ring/50',
				isToday && 'rounded-(--cell-radius) bg-muted text-foreground',
				isOutside && 'text-muted-foreground aria-selected:text-muted-foreground',
				isDisabled && 'text-muted-foreground opacity-50',
				'rounded-(--cell-radius) p-0 text-center select-none',
			)}
		>
			{date.getDate()}
		</Button>
	);
}

// ── Calendar ───────────────────────────────────────────────────────────────

function Calendar(props: CalendarProps) {
	const {
		className,
		disabled,
		min,
		max,
		excludeDisabled,
		resetOnSelect,
		startMonth,
		endMonth,
		month: controlledMonth,
		onMonthChange: controlledOnMonthChange,
		defaultMonth,
		numberOfMonths = 1,
		showOutsideDays = true,
		showWeekNumber = false,
		fixedWeeks = false,
		captionLayout = 'label',
		locale: localeProp,
		modifiers: customModifiers,
		defaultView = 'calendar',
		buttonVariant = 'ghost',
		required = false,
		mode = 'single',
		selected,
		onSelect,
	} = props as CalendarSharedProps & {
		mode: CalendarMode;
		selected?: CalendarSelection;
		onSelect?: (value: CalendarSelection, day: Date) => void;
	};

	const locale = React.useMemo(() => resolveLocale(localeProp), [localeProp]);
	const weekStartsOn = locale.weekStartsOn;
	const firstWeekContainsDate = locale.firstWeekContainsDate;
	const isDropdown = captionLayout === 'dropdown';

	const [view, setView] = React.useState<CalendarView>(defaultView);
	// Reference month for the month/year picker views (null = use currentMonth)
	const [viewMonth, setViewMonth] = React.useState<Date | null>(null);

	// Controlled/uncontrolled month management. A month is controlled only
	// when BOTH `month` and `onMonthChange` are provided — matching
	// react-day-picker, `month` alone acts as the uncontrolled initial month
	// so the prev/next navigation still works.
	const [internalMonth, setInternalMonth] = React.useState<Date>(() => controlledMonth ?? defaultMonth ?? new Date());
	const isMonthControlled = controlledMonth !== undefined && controlledOnMonthChange !== undefined;
	const currentMonth = isMonthControlled ? controlledMonth : internalMonth;
	const pickerMonth = viewMonth ?? currentMonth;

	const changeMonth = React.useCallback(
		(newMonth: Date) => {
			controlledOnMonthChange?.(newMonth);
			if (!isMonthControlled) {
				setInternalMonth(newMonth);
			}
		},
		[controlledOnMonthChange, isMonthControlled],
	);

	// ── Navigation handlers ──────────────────────────────────────────────

	const handlePrev = React.useCallback(() => {
		const d = new Date(view === 'calendar' ? currentMonth : pickerMonth);
		switch (view) {
			case 'calendar':
				d.setMonth(d.getMonth() - 1);
				break;
			case 'month':
				d.setFullYear(d.getFullYear() - 1);
				break;
			case 'year': {
				const start = getYearRangeStart(d.getFullYear());
				d.setFullYear(start - 1);
				break;
			}
		}
		if (view === 'calendar') {
			changeMonth(d);
		} else {
			setViewMonth(d);
		}
	}, [currentMonth, pickerMonth, view, changeMonth]);

	const handleNext = React.useCallback(() => {
		const d = new Date(view === 'calendar' ? currentMonth : pickerMonth);
		switch (view) {
			case 'calendar':
				d.setMonth(d.getMonth() + 1);
				break;
			case 'month':
				d.setFullYear(d.getFullYear() + 1);
				break;
			case 'year': {
				const start = getYearRangeStart(d.getFullYear());
				d.setFullYear(start + 12);
				break;
			}
		}
		if (view === 'calendar') {
			changeMonth(d);
		} else {
			setViewMonth(d);
		}
	}, [currentMonth, pickerMonth, view, changeMonth]);

	const handleMonthSelect = React.useCallback(
		(monthIndex: number) => {
			const newMonth = new Date(pickerMonth.getFullYear(), monthIndex, 1);
			changeMonth(newMonth);
			setView('calendar');
		},
		[pickerMonth, changeMonth],
	);

	const handleYearSelect = React.useCallback(
		(year: number) => {
			const newMonth = new Date(year, pickerMonth.getMonth(), 1);
			changeMonth(newMonth);
			setView('calendar');
		},
		[pickerMonth, changeMonth],
	);

	// ── Disable checks for prev/next ─────────────────────────────────────

	const prevDisabled = React.useMemo(() => {
		if (!startMonth) return false;
		const d = new Date(view === 'calendar' ? currentMonth : pickerMonth);
		switch (view) {
			case 'calendar':
				d.setMonth(d.getMonth() - 1);
				break;
			case 'month':
				d.setFullYear(d.getFullYear() - 1);
				break;
			case 'year':
				d.setFullYear(getYearRangeStart(d.getFullYear()) - 1);
				break;
		}
		// If the resulting month ends before startMonth, disable
		const endOfPrev = endOfMonth(d);
		return endOfPrev < startMonth;
	}, [currentMonth, pickerMonth, view, startMonth]);

	const nextDisabled = React.useMemo(() => {
		if (!endMonth) return false;
		const d = new Date(view === 'calendar' ? currentMonth : pickerMonth);
		switch (view) {
			case 'calendar':
				d.setMonth(d.getMonth() + 1);
				break;
			case 'month':
				d.setFullYear(d.getFullYear() + 1);
				break;
			case 'year':
				d.setFullYear(getYearRangeStart(d.getFullYear()) + 12);
				break;
		}
		return d > endMonth;
	}, [currentMonth, pickerMonth, view, endMonth]);

	// ── Year range label for year view ───────────────────────────────────

	const yearRangeLabel = React.useMemo(() => {
		if (view !== 'year') return undefined;
		const start = getYearRangeStart(pickerMonth.getFullYear());
		return `${start} - ${start + 11}`;
	}, [view, pickerMonth]);

	// ── Common wrapper classes ───────────────────────────────────────────

	const wrapperClassName = cn(
		'group/calendar bg-background p-2 [--cell-radius:var(--radius-sm)] [--cell-size:--spacing(7)] in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent in-data-[slot=sheet-content]:bg-transparent',
		className,
	);

	// ── Custom caption bar (month/year picker views only) ────────────────

	const captionBar = (
		<CalendarCaptionBar
			month={pickerMonth}
			view={view}
			locale={locale}
			buttonVariant={buttonVariant}
			prevDisabled={prevDisabled}
			nextDisabled={nextDisabled}
			onPrev={handlePrev}
			onNext={handleNext}
			onMonthClick={() => setView((v) => (v === 'month' ? 'calendar' : 'month'))}
			onYearClick={() => setView((v) => (v === 'year' ? 'calendar' : 'year'))}
			yearRangeLabel={yearRangeLabel}
		/>
	);

	// ── Toggle helper for the calendar view captions ─────────────────────

	const toggleView = React.useCallback((v: 'month' | 'year', month: Date) => {
		setViewMonth(month);
		setView((cur) => (cur === v ? 'calendar' : v));
	}, []);

	// ── Escape key to return to calendar view ────────────────────────────

	React.useEffect(() => {
		if (view === 'calendar') return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				setView('calendar');
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [view]);

	// ── Day grid computation ─────────────────────────────────────────────

	const visibleMonths = React.useMemo(
		() => Array.from({ length: numberOfMonths }, (_, i) => addMonths(currentMonth, i)),
		[currentMonth, numberOfMonths],
	);

	const grids = React.useMemo(
		() =>
			visibleMonths.map((m) =>
				getMonthGrid(m, {
					weekStartsOn,
					firstWeekContainsDate,
					showOutsideDays,
					showWeekNumber,
					fixedWeeks,
				}),
			),
		[visibleMonths, weekStartsOn, firstWeekContainsDate, showOutsideDays, showWeekNumber, fixedWeeks],
	);

	const dayDisabled = React.useCallback(
		(date: Date) => isDateDisabled(date, disabled, startMonth, endMonth),
		[disabled, startMonth, endMonth],
	);

	const isDaySelected = React.useCallback(
		(date: Date): boolean => {
			if (mode === 'single') {
				return !!selected && isSameDay(selected as Date, date);
			}
			if (mode === 'multiple') {
				return (selected as Date[] | undefined)?.some((d) => isSameDay(d, date)) ?? false;
			}
			const range = selected as DateRange | undefined;
			if (!range?.from) return false;
			if (!range.to) return isSameDay(date, range.from);
			return isDayBetweenInclusive(date, range.from, range.to);
		},
		[mode, selected],
	);

	const customModifierMatches = React.useCallback(
		(date: Date): Record<string, boolean> => {
			if (!customModifiers) return {};
			const result: Record<string, boolean> = {};
			for (const [name, matcher] of Object.entries(customModifiers)) {
				result[name] = matchDate(date, matcher);
			}
			return result;
		},
		[customModifiers],
	);

	// ── Selection handler ────────────────────────────────────────────────

	const handleSelectDay = React.useCallback(
		(day: Date) => {
			if (dayDisabled(day)) return;

			let next: CalendarSelection;
			if (mode === 'range') {
				const current = selected as DateRange | undefined;
				const constraints = {
					min,
					max,
					required,
					resetOnSelect,
				};
				const hasFullRange = !!current?.from && !!current?.to;
				if (resetOnSelect && (!current?.from || hasFullRange)) {
					next = resetRangeOnSelect(current, day, constraints);
				} else {
					next = reduceRangeSelection(current, day, constraints);
				}
				if (
					excludeDisabled &&
					disabled &&
					next &&
					(next as DateRange).from &&
					(next as DateRange).to &&
					rangeContainsDisabledDay(next as DateRange, disabled)
				) {
					next = { from: day, to: undefined };
				}
			} else if (mode === 'multiple') {
				next = toggleDateInArray(selected as Date[] | undefined, day, {
					min,
					max,
					required,
				});
			} else {
				next = selectSingle(selected as Date | undefined, day, required);
			}

			onSelect?.(next, day);
		},
		[dayDisabled, mode, selected, onSelect, min, max, required, resetOnSelect, excludeDisabled, disabled],
	);

	// ── Keyboard navigation for the day grid ─────────────────────────────

	const [focusedDay, setFocusedDay] = React.useState<Date | undefined>(undefined);
	const [hoveredDay, setHoveredDay] = React.useState<Date | undefined>(undefined);
	const gridRef = React.useRef<HTMLDivElement>(null);

	const firstSelectedDate = React.useMemo(() => {
		if (!selected) return undefined;
		if (mode === 'single') return selected as Date;
		if (mode === 'multiple') return (selected as Date[])[0];
		return (selected as DateRange).from;
	}, [selected, mode]);

	const effectiveFocus = React.useMemo(() => {
		if (focusedDay) return focusedDay;
		if (firstSelectedDate && isSameMonth(firstSelectedDate, currentMonth)) {
			return firstSelectedDate;
		}
		const today = new Date();
		if (visibleMonths.some((m) => isSameMonth(m, today))) return today;
		return startOfMonth(currentMonth);
	}, [focusedDay, firstSelectedDate, currentMonth, visibleMonths]);

	// Keep focus on the focused day after it re-renders in the visible grid.
	React.useEffect(() => {
		if (!focusedDay || view !== 'calendar') return;
		const button = gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${getDateKey(focusedDay)}"]`);
		button?.focus();
	}, [focusedDay, view, currentMonth, numberOfMonths]);

	const isOpenRange = mode === 'range' && !!selected && !!(selected as DateRange).from && !(selected as DateRange).to;

	// Adjacent days in the same week row render as one continuous pill.
	// Anything else — non-adjacent start/end, or adjacent days that wrap
	// into the next week row (e.g. Sat → Sun) — uses completely rounded
	// endpoint caps with the muted bar in between.
	const isRoundedCaps = React.useMemo(() => {
		if (mode !== 'range') return false;
		const range = selected as DateRange | undefined;
		if (!range?.from || !range.to) return false;
		const from = startOfDay(range.from);
		const to = startOfDay(range.to);
		const diffDays = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
		if (diffDays >= 2) return true;
		if (diffDays === 1) {
			// Consecutive days that cross a week boundary sit in different
			// rows, so the continuous pill would look cut off.
			const fromCol = (from.getDay() + 7 - weekStartsOn) % 7;
			return fromCol === 6;
		}
		return false;
	}, [mode, selected, weekStartsOn]);

	const handleGridKeyDown = React.useCallback(
		(e: React.KeyboardEvent) => {
			const focused = effectiveFocus;
			if (!focused) return;

			let next: Date | undefined;
			switch (e.key) {
				case 'ArrowRight':
					next = addDays(focused, 1);
					break;
				case 'ArrowLeft':
					next = addDays(focused, -1);
					break;
				case 'ArrowUp':
					next = addDays(focused, -7);
					break;
				case 'ArrowDown':
					next = addDays(focused, 7);
					break;
				case 'Home':
					next = startOfWeek(focused, weekStartsOn);
					break;
				case 'End':
					next = endOfWeek(focused, weekStartsOn);
					break;
				case 'PageUp':
					e.preventDefault();
					next = addMonths(focused, e.shiftKey ? -12 : -1);
					break;
				case 'PageDown':
					e.preventDefault();
					next = addMonths(focused, e.shiftKey ? 12 : 1);
					break;
				case 'Enter':
				case ' ':
					e.preventDefault();
					handleSelectDay(focused);
					return;
				default:
					return;
			}

			e.preventDefault();
			setFocusedDay(next);
			if (!next) return;

			// Keep the focused day inside the visible month window.
			const firstVisible = startOfMonth(currentMonth);
			const lastVisible = addMonths(currentMonth, numberOfMonths - 1);
			if (isSameMonth(next, firstVisible) || isSameMonth(next, lastVisible)) {
				return;
			}
			if (next < firstVisible) {
				changeMonth(startOfMonth(next));
			} else {
				changeMonth(addMonths(startOfMonth(next), -(numberOfMonths - 1)));
			}
		},
		[effectiveFocus, weekStartsOn, handleSelectDay, currentMonth, numberOfMonths, changeMonth],
	);

	// ── Weekday header labels (rotated to weekStartsOn) ──────────────────

	const weekdayLabels = React.useMemo(() => {
		const names = getWeekdayNames(locale.code, 'short');
		return [...names.slice(weekStartsOn), ...names.slice(0, weekStartsOn)].map((name) => name.slice(0, 2));
	}, [locale.code, weekStartsOn]);

	// ── Calendar (day grid) view ────────────────────────────────────────

	if (view === 'calendar') {
		return (
			<div data-slot="calendar" className={wrapperClassName}>
				<div ref={gridRef} className="relative flex flex-col gap-4 md:flex-row">
					<div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex w-full items-center justify-between">
						<CalendarNavButtons
							buttonVariant={buttonVariant}
							prevDisabled={prevDisabled}
							nextDisabled={nextDisabled}
							onPrev={handlePrev}
							onNext={handleNext}
						/>
					</div>

					{visibleMonths.map((monthDate, monthIndex) => {
						const grid = grids[monthIndex];
						return (
							<div key={getDateKey(monthDate)} className="flex w-full flex-col gap-4">
								{/* Caption */}
								<div className="flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)">
									{isDropdown ? (
										<CalendarDropdowns
											month={monthDate}
											locale={locale}
											startMonth={startMonth}
											endMonth={endMonth}
											onMonthChange={(m) => changeMonth(new Date(monthDate.getFullYear(), m, 1))}
											onYearChange={(y) => changeMonth(new Date(y, monthDate.getMonth(), 1))}
										/>
									) : (
										<CalendarCaptionLabels
											month={monthDate}
											view={view}
											locale={locale}
											onMonthClick={() => toggleView('month', monthDate)}
											onYearClick={() => toggleView('year', monthDate)}
										/>
									)}
								</div>

								{/* Weekday header + day grid (tighter gap than caption) */}
								<div className="flex flex-col gap-2">
									<div className="flex" role="row">
										{showWeekNumber && <div className="w-(--cell-size) shrink-0 select-none" role="columnheader" />}
										{weekdayLabels.map((label, i) => (
											<div
												key={i}
												role="columnheader"
												className="flex-1 rounded-(--cell-radius) text-center text-[0.8rem] font-normal text-muted-foreground select-none"
											>
												{label}
											</div>
										))}
									</div>

									{/* Day grid */}
									<div
										role="grid"
										aria-label={monthDate.toLocaleString(locale.code, {
											month: 'long',
											year: 'numeric',
										})}
										className="w-full"
										onKeyDown={handleGridKeyDown}
										onMouseLeave={isOpenRange ? () => setHoveredDay(undefined) : undefined}
									>
										{grid.map((week, weekIndex) => (
											<div key={weekIndex} className="mt-2 flex w-full" role="row">
												{showWeekNumber && (
													<div
														className="flex w-(--cell-size) shrink-0 items-center justify-center text-[0.8rem] text-muted-foreground select-none"
														role="gridcell"
													>
														{week.weekNumber}
													</div>
												)}
												{week.days.map((cell, dayIndex) => {
													const isDisabled = dayDisabled(cell.date);
													const isSelected = isDaySelected(cell.date);
													const rangeValue = mode === 'range' ? (selected as DateRange) : undefined;
													const rangeModifier = getRangeModifier(cell.date, rangeValue, isOpenRange ? hoveredDay : undefined);

													if (cell.isHidden) {
														return <div key={dayIndex} className="invisible flex-1" aria-hidden="true" />;
													}

													// The cell wrapper draws the muted range bar; the
													// button on top renders the primary endpoints and the
													// day numbers. Adjacent days merge into one continuous
													// pill: start/first-column days round the left side,
													// end/last-column days the right, and consecutive
													// multi-select days join each other.
													const isRangeStart = rangeModifier === 'start' || rangeModifier === 'both';
													const isRangeEnd = rangeModifier === 'end' || rangeModifier === 'both';
													const isRangeMiddle = rangeModifier === 'middle';
													const colIndex = (cell.date.getDay() + 7 - weekStartsOn) % 7;
													const barRoundLeft = isRangeStart || (isRangeMiddle && colIndex === 0);
													const barRoundRight = isRangeEnd || (isRangeMiddle && colIndex === 6);

													let roundLeft = true;
													let roundRight = true;
													if (mode === 'range') {
														roundLeft = barRoundLeft;
														roundRight = barRoundRight;
														if (isRoundedCaps) {
															// Non-adjacent ranges: first and last days are
															// completely rounded endpoint caps.
															if (isRangeStart || isRangeEnd) {
																roundLeft = true;
																roundRight = true;
															}
														}
													} else if (mode === 'multiple' && isSelected) {
														// Merge consecutive selected days into one pill —
														// only while they stay within the same week row.
														// Days that wrap to the next row (e.g. Sat → Sun)
														// stay fully rounded instead of joining.
														roundLeft = !(colIndex !== 0 && isDaySelected(addDays(cell.date, -1)));
														roundRight = !(colIndex !== 6 && isDaySelected(addDays(cell.date, 1)));
													}

													return (
														<div
															key={dayIndex}
															className={cn(
																'min-w-0 flex-1',
																rangeModifier !== null && 'bg-muted',
																barRoundLeft && 'rounded-l-(--cell-radius)',
																barRoundRight && 'rounded-r-(--cell-radius)',
															)}
														>
															<CalendarDayButton
																date={cell.date}
																isToday={cell.isToday}
																isOutside={cell.isOutside}
																isDisabled={isDisabled}
																isSelected={isSelected}
																rangeModifier={rangeModifier}
																roundLeft={roundLeft}
																roundRight={roundRight}
																customModifiers={customModifierMatches(cell.date)}
																focused={isSameDay(cell.date, effectiveFocus)}
																locale={locale}
																onClick={handleSelectDay}
																onMouseEnter={isOpenRange ? (d) => setHoveredDay(d) : undefined}
															/>
														</div>
													);
												})}
											</div>
										))}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		);
	}

	// ── Month picker view ────────────────────────────────────────────────

	if (view === 'month') {
		return (
			<div data-slot="calendar" className={cn(wrapperClassName, 'w-fit')}>
				{captionBar}
				<CalendarMonthGrid
					month={pickerMonth}
					locale={locale}
					startMonth={startMonth}
					endMonth={endMonth}
					onMonthSelect={handleMonthSelect}
				/>
			</div>
		);
	}

	// ── Year picker view ─────────────────────────────────────────────────

	return (
		<div data-slot="calendar" className={cn(wrapperClassName, 'w-fit')}>
			{captionBar}
			<CalendarYearGrid month={pickerMonth} startMonth={startMonth} endMonth={endMonth} onYearSelect={handleYearSelect} />
		</div>
	);
}

export { Calendar, CalendarDayButton };
export type { CalendarView };
