import { useEffect, useState } from 'react';
import { FIELD_CLASS as fieldClass, FIELD_LABEL_CLASS as labelClass } from '@/shared/components/form-styles';
import { useQueryClient } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { Input } from '@mmbix/design-system/input';
import { Textarea } from '@mmbix/design-system/textarea';
import { DatePicker } from '@mmbix/design-system/datepicker';

import { APP_DATE_FORMAT } from '@/shared/time/myanmar';
import { notifyFailed } from '@/shared/save-feedback';

import { createRequest, updateRequest } from '../data/api';
import { reflectEditedRow } from '../data/request-cache';
import { FormField } from '@/shared/components/form-field';
import { useFormDirty, useFormStateReport, useSubmitGuard, type FormState } from '@/shared/components/form-state';
import { FormError } from '@/shared/components/form-submit';
import { RequiredMark } from '@/shared/components/required-mark';
import { hapticImpact } from '@/shared/platform/haptics';
import type { HrRequest } from '../data/types';

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

/** "17:30" + "20:00" → 2.5 (hours, 2dp); end ≤ start wraps past midnight. */
function hoursBetween(start: string, end: string): number | undefined {
	if (!start || !end) return undefined;
	const [sh, sm] = start.split(':').map(Number);
	const [eh, em] = end.split(':').map(Number);
	if ([sh, sm, eh, em].some(Number.isNaN)) return undefined;
	let minutes = eh * 60 + em - (sh * 60 + sm);
	if (minutes <= 0) minutes += 24 * 60;
	return Math.round((minutes / 60) * 100) / 100;
}

// `format` is the WHATWG "format control" attribute (WebKit/Safari 18.4+,
// ignored elsewhere) — makes the NATIVE picker display 12-hour "h:mm a";
// the input's value stays `HH:MM` (same pattern as the Early Leave form).
const nativeTimeFormat = { format: 'h:mm a' } as const;

/**
 * Native-picker time field — the platform's own `<input type="time">` styled
 * like every other field (clock icon + the native value): ONE visible control,
 * so tapping it opens the PLATFORM picker and the field always renders exactly
 * what the native input shows (the same pattern as the Early Leave form — no
 * stacked overlay that can glitch while the form submits).
 */
function NativeTimeField({
	value,
	onValueChange,
	disabled,
	ariaLabel,
}: {
	value: string;
	onValueChange: (value: string) => void;
	disabled?: boolean;
	ariaLabel: string;
}) {
	return (
		<div className="relative">
			<Clock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
			<Input
				type="time"
				value={value}
				onChange={(e) => onValueChange(e.target.value)}
				disabled={disabled}
				aria-label={ariaLabel}
				className={`${fieldClass} appearance-none pl-9 pr-2`}
				{...nativeTimeFormat}
			/>
		</div>
	);
}

interface RequestFormBodyProps {
	/** The acting employee's `hrm_employees` uuid — the applicant. The SESSION names
	 *  it (`/auth/me.employee_id`), resolving identically for a web and a Telegram
	 *  sign-in; the Telegram id is no longer the identity here because a browser
	 *  session has none. */
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

/**
 * The overtime (Overtime) create form body. Mounted inside the `/+` create page.
 *
 * The OT form (design reference):
 *   1. Overtime Date — the design-system DatePicker (single-date calendar);
 *   2. Start Time / End Time — the platform's native time inputs,
 *      styled to match the other fields (clock icon + native value): tapping
 *      opens the PLATFORM picker (12-hour display where the `format`
 *      attribute is honored; the stored value stays `HH:MM` 24h);
 *   3. Reason — the reason textarea.
 *
 * Submission lives in the page's submit button (Telegram MainButton / browser
 * fallback); this body reports its submit/validity/loading via `onReady` and
 * calls `onDone` after a successful `createRequest`.
 *
 * The created `overtimes` row is `request_type: 'ot'`, `ot_date`, `start_time`
 * / `end_time` (`HH:MM`), and the computed span in `hours_count` +
 * `total_hours` (end ≤ start wraps past midnight).
 */
export function RequestFormBody({ employeeId, employeeName, employeeEid, onReady, onDone, initial }: RequestFormBodyProps) {
	const queryClient = useQueryClient();
	const [reason, setReason] = useState(initial?.reason ?? '');
	const [otDate, setOtDate] = useState<Date | undefined>(initial?.ot_date ? parseDateInput(initial.ot_date) : undefined);
	const [startTime, setStartTime] = useState(initial?.start_time ?? '');
	const [endTime, setEndTime] = useState(initial?.end_time ?? '');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	// Edit mode — re-seed from a fresh row whenever the loaded row's identity
	// changes (TanStack v5 can serve a cached row while revalidating); create
	// mode has no `initial` — the effect stays dormant.
	useEffect(() => {
		if (!initial) return;
		setReason(initial.reason ?? '');
		setOtDate(initial.ot_date ? parseDateInput(initial.ot_date) : undefined);
		setStartTime(initial.start_time ?? '');
		setEndTime(initial.end_time ?? '');
	}, [initial]);

	// Dirty gate — an edit must differ from the loaded row (or, on create, from the
	// blank defaults) before it can be submitted.
	const dirty = useFormDirty(
		{
			reason: initial?.reason ?? '',
			otDate: initial?.ot_date ? parseDateInput(initial.ot_date) : undefined,
			startTime: initial?.start_time ?? '',
			endTime: initial?.end_time ?? '',
		},
		{ reason, otDate, startTime, endTime },
	);

	const hoursCount = hoursBetween(startTime, endTime);
	// Submit requires every fillable field: the reason plus the OT
	// date/start/end — and a change from the baseline.
	const canSubmit =
		employeeId !== null && !submitting && reason.trim() !== '' && otDate !== undefined && startTime !== '' && endTime !== '' && dirty;

	const submit = async () => {
		if (!canSubmit || !submitGuard.begin()) return;
		hapticImpact('medium');
		setSubmitting(true);
		setError(null);
		const input = {
			request_type: 'ot' as const,
			employee_id: employeeId ?? undefined,
			employee_name: employeeName ?? undefined,
			employee_eid: employeeEid ?? undefined,
			reason: reason.trim() || undefined,
			ot_date: otDate ? dateToInputValue(otDate) : undefined,
			start_time: startTime || undefined,
			end_time: endTime || undefined,
			hours_count: hoursCount,
			total_hours: hoursCount,
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
			notifyFailed('Overtime could not be submitted', message);
			setSubmitting(false);
			submitGuard.end();
		}
	};

	useFormStateReport(onReady, submit, canSubmit, submitting, false, dirty);

	return (
		<div className="flex flex-col gap-5 pt-2">
			{/* 1 — OT date — the design-system DatePicker. */}
			<section>
				<FormField label="ရက်စွဲ" required group>
					{() => (
						<DatePicker
							value={otDate}
							onValueChange={setOtDate}
							placeholder="ရက်ရွေးပါ"
							format={APP_DATE_FORMAT}
							disabled={submitting}
							className={fieldClass}
						/>
					)}
				</FormField>
			</section>

			{/* 2 — Start / end time — the platform's native time inputs styled like the
			early-leave field (appearance-none + leading clock icon). Tapping opens
			the PLATFORM picker; `format` shows 12h "h:mm a" where supported and the
			committed value stays `HH:MM` 24h. */}
			<section>
				<div className="grid grid-cols-2 gap-3">
					<div>
						<FormField label="စတင်ချိန်" required group>
							{() => <NativeTimeField value={startTime} onValueChange={setStartTime} disabled={submitting} ariaLabel="စတင်ချိန်" />}
						</FormField>
					</div>
					<div>
						<FormField label="ပြီးဆုံးချိန်" required group>
							{() => <NativeTimeField value={endTime} onValueChange={setEndTime} disabled={submitting} ariaLabel="ပြီးဆုံးချိန်" />}
						</FormField>
					</div>
				</div>
				<p className="mt-2 text-xs tabular-nums text-muted-foreground">{hoursCount != null ? `စုစုပေါင်း ${hoursCount} နာရီ` : null}</p>
			</section>

			{/* 3 — Reason */}
			<section>
				<label htmlFor="request-reason" className={labelClass}>
					အကြောင်းပြချက်
					<RequiredMark />
				</label>
				<Textarea
					id="request-reason"
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					placeholder="အကြောင်းပြချက် ရေးပါ"
					rows={3}
					className="rounded-lg bg-card px-3 text-sm leading-myanmar"
				/>
			</section>

			<FormError error={error} />
		</div>
	);
}
