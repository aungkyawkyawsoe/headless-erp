import { useEffect, useState } from 'react';
import { FIELD_LABEL_CLASS as labelClass, FIELD_CLASS as fieldClass } from '@/shared/components/form-styles';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, UserPlus } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@mmbix/design-system/avatar';
import { Button } from '@mmbix/design-system/button';
import { FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@mmbix/design-system/field';
import { RadioGroup, RadioGroupItem } from '@mmbix/design-system/radio-group';
import { ScrollArea } from '@mmbix/design-system/scroll-area';
import { SearchBox } from '@mmbix/design-system/search-box';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';
import { Textarea } from '@mmbix/design-system/textarea';
import { ToggleGroup, ToggleGroupItem } from '@mmbix/design-system/toggle-group';
import { DateRangePicker } from '@mmbix/design-system/datepicker';
import { notifyFailed } from '@/shared/save-feedback';

import { createRequest, updateRequest } from '../data/api';
import { reflectEditedRow } from '../data/request-cache';
import { FormField } from '@/shared/components/form-field';
import { useFormDirty, useFormStateReport, useSubmitGuard, type FormState } from '@/shared/components/form-state';
import { useEmployeeMasters } from '@/shared/lookups/hooks';
import { Shimmer } from '@/shared/components/skeletons';
import { PickerSearchHint } from '@/shared/components/picker-search-hint';
import { SEARCH_MIN_CHARS } from '@/shared/constants';
import { hapticImpact } from '@/shared/platform/haptics';
import type { HrRequest } from '../data/types';

/**
 * Leave (leave) request form body — the design-reference form, mounted inside
 * the `/+` create page (`RequestCreatePage`):
 *
 *   1. Select Dates — the design-system DateRangePicker (single-month calendar);
 *   2. Leave Type — a single selected day reveals the half-day/full-day
 *      card radio (right-side radio, DS `FieldLabel` pattern); Half Day
 *      reveals the [Morning | Afternoon] period toggle;
 *   3. Work Period — a multi-day RANGE instead reveals start/end
 *      [Morning | Afternoon] period toggles + a summary card with the computed
 *      leave duration (e.g. 1.5 days);
 *   4. Reliever Name — the reliever bottom sheet: searchable employee
 *      list (avatar + name + role), the current user excluded;
 *   5. Reason — the reason textarea.
 *
 * Submission lives in the page's submit button (Telegram MainButton / browser
 * fallback); this body reports its submit/validity/loading via `onReady` and
 * calls `onDone` after a successful `createRequest` (the page invalidates the
 * request lists + navigates back to the list).
 *
 * The created `hr_requests` row is `request_type: 'leave'`, `from_date` /
 * `to_date` = the chosen range, `leave_type`/`disposition` (single-day type) +
 * `days_count` (type or start/end-period computation), `reliever_name`.
 */

// A leave date range — mirrors the DS `DateRange` shape (`from` is always present).
type LeaveDateRange = { from: Date | undefined; to?: Date | undefined };

// Leave type — the card-radio choice (single-day leaves only) plus the
// half-day period. Encoded onto the verified `hr_requests` enums at submit time.
type LeaveType = 'half_day' | 'full_day';
type HalfDayPeriod = 'morning' | 'afternoon';

// Work Period — the start/end period for multi-day RANGES.
type DayPeriod = 'morning' | 'evening';

/** `leave_type` value per half-day period (verified hr_requests enum). */
const HALF_DAY_LEAVE_TYPE: Record<HalfDayPeriod, string> = {
	morning: 'half_day_morning',
	afternoon: 'half_day_afternoon',
};

// Selected period toggle = primary fill + its foreground text (the DS default
// is a muted gray). Overrides land last via tailwind-merge.
const periodSelectedClass =
	'aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:border-primary';

// Leave Type card — theme card background in both states; the SELECTED
// card keeps a primary border highlight (overrides the DS default primary tint).
const leaveTypeCardClass =
	'flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 transition-colors has-data-checked:border-primary has-data-checked:bg-card dark:has-data-checked:bg-card';

/** Canonical `hr_requests.leave_type` — undefined unless a single-day type is fully chosen. */
function leaveTypeOf(type: LeaveType | null, period: HalfDayPeriod | null, singleDate: boolean): string | undefined {
	if (!singleDate || !type) return undefined;
	if (type === 'full_day') return 'full_day';
	return period ? HALF_DAY_LEAVE_TYPE[period] : undefined;
}

/** Inclusive calendar-day count between two local dates. */
function calendarDaysBetween(from: Date, to: Date): number {
	const dayMs = 86_400_000;
	return (
		Math.round(
			(Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / dayMs,
		) + 1
	);
}

/**
 * Work Period day count: the first day counts 1 (Morning) or 0.5 (Afternoon),
 * the last day counts 1 (Afternoon) or 0.5 (Morning), middle days count 1 each.
 * Returns null when a period is missing (or the same-day Afternoon→Morning
 * combo — invalid).
 */
function workDays(from: Date, to: Date, start: DayPeriod | null, end: DayPeriod | null): number | null {
	if (!start || !end) return null;
	const days = calendarDaysBetween(from, to);
	if (days === 1) {
		if (start === 'evening' && end === 'morning') return null;
		return start === end ? 0.5 : 1;
	}
	return (start === 'morning' ? 1 : 0.5) + Math.max(0, days - 2) + (end === 'evening' ? 1 : 0.5);
}

/** The range summary — "2 days" / "1.5 days" (the same wording the card's
 *  `leaveDaysLabel` uses, so the form and the saved row read alike). */
function workDaysLabel(days: number): string {
	return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** "Aug 31, 2026" — same format as the DateRangePicker trigger label. */
function formatRangeDate(date: Date): string {
	return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: '2-digit' }).format(date);
}

/** Calendar `Date` → `YYYY-MM-DD` (local calendar date — no TZ shifting). */
function dateToInputValue(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` → local calendar `Date` — the inverse of `dateToInputValue` (edit-mode prefill). */
function parseDateInput(value: string): Date | undefined {
	const [year, month, day] = value.split('-').map(Number);
	if (!year || !month || !day) return undefined;
	return new Date(year, month - 1, day);
}

/** "U Maung Maung" → "UM" — the avatar fallback initials. */
function initialsOf(name: string): string {
	return name
		.trim()
		.split(/\s+/)
		.slice(0, 2)
		.map((word) => word[0] ?? '')
		.join('')
		.toUpperCase();
}

// The field look shared with the Early Leave page — h-11 rounded-lg card fields.

interface LeaveFormBodyProps {
	/** The acting employee's `hrm_employees` uuid — the applicant (see
	 *  `RequestFormBody`). The session names it, so a web sign-in files as the same
	 *  employee a Telegram one does. */
	employeeId: string | null;
	employeeName: string | null;
	employeeEid: string | null;
	/** Reports submit/validity/loading to the sheet header (✓). */
	onReady: (state: FormState) => void;
	/** Called after a successful create — the sheet invalidates + closes. */
	onDone: () => void;
	/**
	 * EDIT mode — the pending row to pre-fill. The body updates this row (via
	 * `updateRequest`) instead of creating a new one; absent = create mode.
	 */
	initial?: HrRequest | null;
}

export function LeaveFormBody({ employeeId, employeeName, employeeEid, onReady, onDone, initial }: LeaveFormBodyProps) {
	const queryClient = useQueryClient();
	// Edit-mode prefill — the row's stored encoding mapped back to form state:
	// `leave_type` full_day / half_day_morning / half_day_afternoon picks the
	// single-date type + period; a range row carries start/end periods instead.
	const initialFrom = initial?.from_date ? parseDateInput(initial.from_date) : undefined;
	const initialTo = initial?.to_date ? parseDateInput(initial.to_date) : undefined;
	const initialLeaveType: LeaveType | undefined =
		initial?.leave_type == null ? undefined : initial.leave_type === 'full_day' ? 'full_day' : 'half_day';
	const initialPeriod: HalfDayPeriod | undefined =
		initial?.leave_type === 'half_day_morning' ? 'morning' : initial?.leave_type === 'half_day_afternoon' ? 'afternoon' : undefined;

	const [dateRange, setDateRange] = useState<LeaveDateRange | undefined>(
		initial ? { from: initialFrom, to: initialTo ?? initialFrom } : undefined,
	);
	const [leaveType, setLeaveType] = useState<LeaveType>(initialLeaveType ?? 'half_day');
	const [halfDayPeriod, setHalfDayPeriod] = useState<HalfDayPeriod>(initialPeriod ?? 'morning');
	// Range start/end periods — default to full days (Morning → Afternoon).
	const [startPeriod, setStartPeriod] = useState<DayPeriod>(initial?.start_period === 'evening' ? 'evening' : 'morning');
	const [endPeriod, setEndPeriod] = useState<DayPeriod>(initial?.end_period === 'morning' ? 'morning' : 'evening');
	const [relieverName, setRelieverName] = useState(initial?.reliever_name ?? '');
	// The picked reliever's `hrm_employees` uuid — carried on submit so the native
	// `reliever_to` m2o is set WITHOUT a name→id directory lookup (see `api.ts`).
	const [relieverId, setRelieverId] = useState<string | null>(initial?.reliever_id ?? null);
	// The picked reliever's avatar (`/api/media/...`) — captured at tap time so the
	// field's small avatar renders without re-opening the directory.
	const [pickedRelieverPhoto, setPickedRelieverPhoto] = useState<string | null>(null);
	const [relieverOpen, setRelieverOpen] = useState(false);
	// The directory walk starts on the FIRST tap of the reliever field and stays
	// enabled for this form session — closing the sheet mid-walk must not discard
	// the fetch, and the shared 5-min master cache keeps later reopens instant.
	const [directoryEnabled, setDirectoryEnabled] = useState(false);
	const [employeeQuery, setEmployeeQuery] = useState('');
	const [reason, setReason] = useState(initial?.reason ?? '');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	// Edit mode — the request-edit page can serve a CACHED row before the fresh
	// fetch lands (TanStack v5 background revalidation); re-seed the fields
	// whenever the loaded row's identity changes so the form never freezes on
	// stale data. Create mode has no `initial` — the effect stays dormant.
	useEffect(() => {
		if (!initial) return;
		const from = initial.from_date ? parseDateInput(initial.from_date) : undefined;
		const to = initial.to_date ? parseDateInput(initial.to_date) : undefined;
		setDateRange(initial.from_date || initial.to_date ? { from, to: to ?? from } : undefined);
		setLeaveType(initial.leave_type == null ? 'half_day' : initial.leave_type === 'full_day' ? 'full_day' : 'half_day');
		setHalfDayPeriod(
			initial.leave_type === 'half_day_morning' ? 'morning' : initial.leave_type === 'half_day_afternoon' ? 'afternoon' : 'morning',
		);
		setStartPeriod(initial.start_period === 'evening' ? 'evening' : 'morning');
		setEndPeriod(initial.end_period === 'morning' ? 'morning' : 'evening');
		setRelieverName(initial.reliever_name ?? '');
		setRelieverId(initial.reliever_id ?? null);
		setPickedRelieverPhoto(null);
		setReason(initial.reason ?? '');
	}, [initial]);

	// The reliever directory — the SHARED hrm_employees master read (whole-set,
	// one cache for every module that joins it), not a per-module truncated fetch.
	// Gated: a plain page visit must NOT pay for the whole directory walk — the
	// fetch starts only when the reliever field is first tapped (the sheet shows
	// shimmer rows until it lands).
	const employees = useEmployeeMasters(directoryEnabled);

	// The selected reliever's avatar — the picker row's photo is remembered at tap
	// time; when the form is PRE-FILLED (edit mode) the shared directory supplies
	// it once loaded (the picker sheet enables that fetch). Absent photo → the
	// initials fallback in the field's avatar.
	const relieverPhoto =
		pickedRelieverPhoto ?? (relieverId ? (employees.data?.find((candidate) => candidate.id === relieverId)?.photo_url ?? null) : null);

	// Searchable reliever list — the current user can't hand over to themself.
	const relieverCandidates = (employees.data ?? [])
		.filter((candidate) => !employeeId || candidate.id !== employeeId)
		.filter((candidate) => {
			const q = employeeQuery.trim().toLowerCase();
			if (!q) return true;
			return `${candidate.name_mm ?? ''} ${candidate.name_en ?? ''} ${candidate.eid ?? ''}`.toLowerCase().includes(q);
		});
	// The picker stays blank until the term is long enough — no directory dump on open.
	const relieverReady = employeeQuery.trim().length >= SEARCH_MIN_CHARS;

	// While the reliever sheet is open the submit affordance is tucked away — the
	// MainButton is hidden (hideMainButton) and the browser fallback is disabled
	// (its overlay covers the page) — same rule as the old page tucking the
	// native MainButton away.
	// Dirty gate — an edit must differ from the loaded row (or, on create, from the
	// blank defaults) before it can be submitted. UI-only state (the reliever
	// sheet, its search term, the captured photo) is excluded — it is not a field.
	const dirty = useFormDirty(
		{
			dateRange: initial ? { from: initialFrom, to: initialTo ?? initialFrom } : undefined,
			leaveType: initialLeaveType ?? 'half_day',
			halfDayPeriod: initialPeriod ?? 'morning',
			startPeriod: initial?.start_period === 'evening' ? 'evening' : 'morning',
			endPeriod: initial?.end_period === 'morning' ? 'morning' : 'evening',
			relieverName: initial?.reliever_name ?? '',
			relieverId: initial?.reliever_id ?? null,
			reason: initial?.reason ?? '',
		},
		{ dateRange, leaveType, halfDayPeriod, startPeriod, endPeriod, relieverName, relieverId, reason },
	);

	const canSubmit = dateRange?.from !== undefined && employeeId !== null && !submitting && !relieverOpen && dirty;

	// Single selected day (from only, or from === to) — the leave-type cards show
	// only then; a multi-day range is implicitly full-day.
	const isSingleDate =
		dateRange?.from != null && (dateRange.to == null || dateToInputValue(dateRange.from) === dateToInputValue(dateRange.to));

	// A real multi-day range — the Work Period section shows only then.
	const isDateRange = dateRange?.from != null && dateRange.to != null && !isSingleDate;

	// Computed range days from the start/end periods (null = missing/invalid combo).
	const rangeDayCount =
		isDateRange && dateRange.from && dateRange.to ? workDays(dateRange.from, dateRange.to, startPeriod, endPeriod) : null;

	// Canonical hr_requests encoding for the chosen type (all undefined for ranges).
	const leaveTypeValue = leaveTypeOf(leaveType, halfDayPeriod, isSingleDate);
	const disposition = isSingleDate && leaveType ? (leaveType === 'half_day' ? 'half_day' : 'full_day') : undefined;
	// days_count: ranges use the start/end-period computation; single days use
	// the chosen type (0.5 half / 1 full).
	const daysCount = isDateRange
		? (rangeDayCount ?? undefined)
		: isSingleDate && leaveType
			? leaveType === 'half_day'
				? 0.5
				: 1
			: undefined;

	const submit = async () => {
		if (!canSubmit || !submitGuard.begin()) return;
		hapticImpact('medium');
		setSubmitting(true);
		setError(null);
		const input = {
			request_type: 'leave' as const,
			employee_id: employeeId ?? undefined,
			employee_name: employeeName ?? undefined,
			employee_eid: employeeEid ?? undefined,
			from_date: dateRange?.from ? dateToInputValue(dateRange.from) : undefined,
			to_date: dateRange?.to ? dateToInputValue(dateRange.to) : undefined,
			leave_type: leaveTypeValue,
			disposition,
			days_count: daysCount,
			reliever_name: relieverName || undefined,
			reliever_id: relieverId ?? undefined,
			reason: reason.trim() || undefined,
		};
		try {
			// Edit mode keeps the row's identity + `pending` status (optimistic
			// concurrency on `updated_at`); create mode makes a fresh pending row.
			if (initial) {
				const updated = await updateRequest(initial.id, input, initial.updated_at, initial);
				// Patch the freshly-updated row into every cached request list so back-
				// navigation shows the new value immediately (see `reflectEditedRow`).
				reflectEditedRow(queryClient, updated);
			} else {
				await createRequest(input);
			}
			onDone();
		} catch (err) {
			// Prefer the engine's own message (validation / workflow) over the generic
			// line; mirror it as a toast so a failure from the native MainButton is
			// visible even when the inline error is scrolled out of view.
			const message = err instanceof Error && err.message ? err.message : 'Could not submit the request. Please try again.';
			setError(message);
			notifyFailed('Leave could not be submitted', message);
			setSubmitting(false);
			submitGuard.end();
		}
	};

	useFormStateReport(onReady, submit, canSubmit, submitting, relieverOpen, dirty);

	return (
		<div className="flex flex-col gap-5 pt-2">
			{/* 1 — Date range */}
			<section>
				<FormField label="ခွင့်ရက်" required group>
					{() => (
						<DateRangePicker
							value={dateRange}
							onValueChange={setDateRange}
							placeholder="ရက်ရွေးပါ"
							numberOfMonths={1}
							className={fieldClass}
						/>
					)}
				</FormField>
				{isSingleDate && (
					<div className="flex flex-col mt-2">
						<FormField label="ခွင့်အမျိုးအစား" group>
							{() => (
								<RadioGroup
									value={leaveType}
									onValueChange={(value) => {
										hapticImpact('light');
										setLeaveType((value as LeaveType | undefined) ?? 'half_day');
										setHalfDayPeriod('morning');
									}}
								>
									<FieldLabel className={leaveTypeCardClass}>
										<FieldContent className="min-w-0 flex-1">
											<FieldTitle className="text-sm leading-6">နေ့တစ်ဝက်</FieldTitle>
											<FieldDescription className="text-xs leading-5">မနက် သို့မဟုတ် ညနေ တစ်ဝက်သာ</FieldDescription>
										</FieldContent>
										<RadioGroupItem value="half_day" id="leave-type-half-day" />
									</FieldLabel>
									<FieldLabel className={leaveTypeCardClass}>
										<FieldContent className="min-w-0 flex-1">
											<FieldTitle className="text-sm leading-6">တစ်နေ့လုံး</FieldTitle>
											<FieldDescription className="text-xs leading-5">မနက်မှ ညနေအထိ တစ်နေ့လုံး</FieldDescription>
										</FieldContent>
										<RadioGroupItem value="full_day" id="leave-type-full-day" />
									</FieldLabel>
								</RadioGroup>
							)}
						</FormField>

						{leaveType === 'half_day' && (
							<ToggleGroup
								variant="outline"
								size="lg"
								value={[halfDayPeriod]}
								onValueChange={(value) => setHalfDayPeriod((value[0] as HalfDayPeriod | undefined) ?? 'morning')}
								className="w-full mt-3"
							>
								<ToggleGroupItem value="morning" className={`flex-1 rounded-lg leading-myanmar ${periodSelectedClass}`}>
									မနက်
								</ToggleGroupItem>
								<ToggleGroupItem value="afternoon" className={`flex-1 rounded-lg leading-myanmar ${periodSelectedClass}`}>
									ညနေ
								</ToggleGroupItem>
							</ToggleGroup>
						)}
					</div>
				)}

				{/* Work Period — only for multi-day ranges: start/end period
					 toggles + a summary card with the computed leave duration. */}
				{isDateRange && (
					<div className="flex flex-col mt-3">
						<FormField label="အလုပ်ကာလ" group>
							{() => (
								<div className="grid grid-cols-2 gap-3 mb-4">
									<div className="flex flex-col gap-1.5">
										<span className="text-xs font-medium text-muted-foreground">
											{dateRange?.from ? formatRangeDate(dateRange.from) : '—'}
										</span>
										<ToggleGroup
											variant="outline"
											size="lg"
											value={[startPeriod]}
											onValueChange={(value) => setStartPeriod((value[0] as DayPeriod | undefined) ?? 'morning')}
											className="w-full"
										>
											<ToggleGroupItem value="morning" className={`flex-1 rounded-lg leading-myanmar ${periodSelectedClass}`}>
												မနက်
											</ToggleGroupItem>
											<ToggleGroupItem value="evening" className={`flex-1 rounded-lg leading-myanmar ${periodSelectedClass}`}>
												ညနေ
											</ToggleGroupItem>
										</ToggleGroup>
									</div>
									<div className="flex flex-col gap-1.5">
										<span className="text-xs font-medium text-muted-foreground">{dateRange?.to ? formatRangeDate(dateRange.to) : '—'}</span>
										<ToggleGroup
											variant="outline"
											size="lg"
											value={[endPeriod]}
											onValueChange={(value) => setEndPeriod((value[0] as DayPeriod | undefined) ?? 'evening')}
											className="w-full"
										>
											<ToggleGroupItem value="morning" className={`flex-1 rounded-lg leading-myanmar ${periodSelectedClass}`}>
												မနက်
											</ToggleGroupItem>
											<ToggleGroupItem value="evening" className={`flex-1 rounded-lg leading-myanmar ${periodSelectedClass}`}>
												ညနေ
											</ToggleGroupItem>
										</ToggleGroup>
									</div>
								</div>
							)}
						</FormField>

						{/* Summary card — calendar icon + the computed leave duration (e.g. 1.5 days). */}
						<div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
							<CalendarDays strokeWidth={1.6} className="size-5 shrink-0 text-muted-foreground" aria-hidden />
							<span className="text-sm font-semibold leading-myanmar text-foreground">
								{rangeDayCount != null ? workDaysLabel(rangeDayCount) : '—'}
							</span>
						</div>
					</div>
				)}
			</section>

			{/* 2 — Reliever — bottom sheet + search + employee list. */}
			<section>
				<FormField label="အစားထိုးသူ">
					{(f) => (
						<Button
							{...f}
							type="button"
							variant="outline"
							onClick={() => {
								hapticImpact('light');
								setEmployeeQuery('');
								setDirectoryEnabled(true);
								setRelieverOpen(true);
							}}
							className={`${fieldClass} justify-start font-normal`}
						>
							{relieverName ? (
								<>
									{/* Selected reliever's small avatar — the same photo the sheet rows
									 * show; initials until the photo (or directory) is available. */}
									<Avatar size="sm" className="shrink-0">
										{relieverPhoto ? <AvatarImage src={relieverPhoto} alt={relieverName} /> : null}
										<AvatarFallback>{initialsOf(relieverName)}</AvatarFallback>
									</Avatar>
									<span className="truncate text-foreground">{relieverName}</span>
								</>
							) : (
								<>
									<UserPlus strokeWidth={1.6} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
									<span className="text-muted-foreground">အစားထိုးသူ ရွေးပါ</span>
								</>
							)}
						</Button>
					)}
				</FormField>

				<Sheet open={relieverOpen} onOpenChange={setRelieverOpen}>
					<SheetContent side="bottom" className="max-h-[85dvh]">
						<SheetHeader className="pb-1">
							<SheetTitle>အစားထိုးသူ</SheetTitle>
							<SearchBox
								placeholder="အမည် / ID ရှာပါ"
								value={employeeQuery}
								onValueChange={setEmployeeQuery}
								className="mt-3"
								inputClassName="h-8.5 text-xs! px-3 rounded-full"
							/>
						</SheetHeader>
						<ScrollArea className="h-[45dvh] px-4 pb-safe">
							{!relieverReady ? (
								<PickerSearchHint noun="search an employee" />
							) : employees.isPending ? (
								// First open (nothing cached yet) — shimmer rows mirror the picker
								// rows (avatar circle + two text lines) while the walk lands.
								<ul className="flex flex-col gap-0.5" aria-hidden>
									{Array.from({ length: 8 }, (_, i) => (
										<li key={i} className="flex items-center gap-3 rounded-md px-3 py-2.5">
											<Shimmer className="size-10 shrink-0 rounded-full" />
											<div className="min-w-0 flex-1">
												<Shimmer className="h-4 w-32 rounded" />
												<Shimmer className="mt-1.5 h-3 w-20 rounded" />
											</div>
										</li>
									))}
								</ul>
							) : relieverCandidates.length > 0 ? (
								<ul className="flex flex-col gap-0.5">
									{relieverCandidates.map((candidate) => {
										const name = candidate.name_mm ?? candidate.name_en ?? candidate.eid ?? '—';
										const subtitle = candidate.summary ?? candidate.eid ?? '';
										return (
											<li key={candidate.id}>
												<button
													type="button"
													onClick={() => {
														hapticImpact('light');
														setRelieverName(name);
														setRelieverId(candidate.id);
														setPickedRelieverPhoto(candidate.photo_url ?? null);
														setRelieverOpen(false);
													}}
													className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
												>
													<Avatar size="lg">
														{candidate.photo_url ? <AvatarImage src={candidate.photo_url} alt={name} /> : null}
														<AvatarFallback>{initialsOf(name)}</AvatarFallback>
													</Avatar>
													<span className="min-w-0 flex-1">
														<span className="block truncate text-sm font-medium leading-6.5 text-foreground">{name}</span>
														{subtitle ? <span className="block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
													</span>
												</button>
											</li>
										);
									})}
								</ul>
							) : (
								<p className="px-3 py-8 text-center text-sm text-muted-foreground">ဝန်ထမ်း မတွေ့ပါ</p>
							)}
						</ScrollArea>
					</SheetContent>
				</Sheet>
			</section>

			{/* 3 — Reason */}
			<section>
				<label htmlFor="leave-reason" className={labelClass}>
					အကြောင်းပြချက်
				</label>
				<Textarea
					id="leave-reason"
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					placeholder="အကြောင်းပြချက် ရေးပါ"
					rows={3}
					className="rounded-lg bg-card px-3 text-sm leading-myanmar"
				/>
			</section>

			{error && <p className="text-xs font-medium leading-myanmar text-destructive">{error}</p>}
		</div>
	);
}
