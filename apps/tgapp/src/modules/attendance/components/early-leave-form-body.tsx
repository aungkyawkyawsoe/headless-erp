import { lazy, Suspense, useEffect, useState } from 'react';
import { DENSE_CARD_FRAME } from '@/shared/components/card';
import { SpinnerGlyph } from '@/shared/components/page-spinner';
import { FIELD_LABEL_CLASS as labelClass, FIELD_CLASS as fieldClass } from '@/shared/components/form-styles';
import { useQueryClient } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { Input } from '@mmbix/design-system/input';
import { Textarea } from '@mmbix/design-system/textarea';
import { notifyFailed } from '@/shared/save-feedback';

import { createRequest, updateRequest } from '../data/api';
import { reflectEditedRow } from '../data/request-cache';
import { usePreciseLocation } from '../hooks/useTelegramLocation';
import { FormField } from '@/shared/components/form-field';
import { useFormDirty, useFormStateReport, useSubmitGuard, type FormState } from '@/shared/components/form-state';
import { FormError } from '@/shared/components/form-submit';
import { RequiredMark } from '@/shared/components/required-mark';
import { hapticImpact } from '@/shared/platform/haptics';
import { todayMmtDate } from '@/shared/time/myanmar';
import type { HrRequest } from '../data/types';

// The map (Leaflet ~150KB) is its own lazy chunk — loaded only when a fix is
// available and this form actually renders the map (see punch-dialog for the
// same pattern).
const AttendanceMap = lazy(() => import('./attendance-map').then((module) => ({ default: module.AttendanceMap })));

/**
 * Early Leave Request form body — mounted inside the `/+` create page
 * (`RequestCreatePage`):
 *
 *   1. Exit Time — the native time picker (`<input type="time">`, forced to a
 *      12-hour "h:mm A" display via the `format` attribute; the submitted value
 *      stays `HH:MM`), windowed to office hours 09:00–17:00;
 *   2. Current Location — the Leaflet map + raw coordinates (same map the punch
 *      dialog uses, driven by a freshly-acquired location);
 *   3. Reason — the reason textarea.
 *
 * Submission lives in the page's submit button (Telegram MainButton / browser
 * fallback); this body reports its submit/validity/loading via `onReady` and
 * calls `onDone` after a successful `createRequest` (the page invalidates the
 * request lists + navigates back to the list).
 *
 * NOTE: the location request fires on MOUNT — the body only mounts when the
 * user actually opens the create page, never with the list page underneath.
 *
 * The created `hr_requests` row is `request_type: 'early'`, `early_date` =
 * today (MMT), `leave_time` = the chosen time.
 */

// `format` is the WHATWG "format control" attribute (WebKit/Safari 18.4+,
// ignored elsewhere) — it makes the native picker display "h:mm A" (12-hour)
// regardless of the device's 24-hour setting. The input's value stays `HH:MM`.
const nativeTimeFormat = { format: 'h:mm a' } as const;

interface EarlyLeaveFormBodyProps {
	/** The acting employee's `hrm_employees` uuid — the applicant (see
	 *  `RequestFormBody`). */
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

export function EarlyLeaveFormBody({ employeeId, employeeName, employeeEid, onReady, onDone, initial }: EarlyLeaveFormBodyProps) {
	const queryClient = useQueryClient();
	const [leaveTime, setLeaveTime] = useState(initial?.leave_time ?? '');
	const [reason, setReason] = useState(initial?.reason ?? '');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	// Edit mode — re-seed from a fresh row whenever the loaded row's identity
	// changes (TanStack v5 can serve a cached row while revalidating); create
	// mode has no `initial` — the effect stays dormant.
	useEffect(() => {
		if (!initial) return;
		setLeaveTime(initial.leave_time ?? '');
		setReason(initial.reason ?? '');
	}, [initial]);

	// Fresh-on-open precise location (WebView GPS first, Telegram-native fallback)
	// — one hook instance.
	const { state: locationState, retry: retryLocation } = usePreciseLocation();
	const locationAvailable = locationState.status === 'available';
	const locationBlocked = locationState.status === 'denied' || locationState.status === 'unavailable';

	// Submit requires the exit time AND a reason — every fillable field ready
	// before the native MainButton / fallback button enables. `early_leaves`
	// stores a REQUIRED `location` (the geo fix the map reports), so the submit
	// stays disabled until a fix is available.
	// Dirty gate — an edit must differ from the loaded row (or, on create, from the
	// blank defaults) before it can be submitted.
	const dirty = useFormDirty({ leaveTime: initial?.leave_time ?? '', reason: initial?.reason ?? '' }, { leaveTime, reason });

	const canSubmit =
		leaveTime !== '' && employeeId !== null && !submitting && reason.trim() !== '' && locationState.status === 'available' && dirty;

	const submit = async () => {
		if (!canSubmit || !submitGuard.begin()) return;
		hapticImpact('medium');
		setSubmitting(true);
		setError(null);
		const loc = locationState.location;
		const input = {
			request_type: 'early' as const,
			employee_id: employeeId ?? undefined,
			employee_name: employeeName ?? undefined,
			employee_eid: employeeEid ?? undefined,
			early_date: todayMmtDate(),
			leave_time: leaveTime,
			// `early_leaves.location` is a required column — persist the geo fix.
			location: loc ? `${loc.lat.toFixed(6)},${loc.lng.toFixed(6)}` : undefined,
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
			// Surface the engine's own message when there is one — the day guard's
			// "already exists for this employee on this date" is the whole point of
			// the check, and a generic line would hide it. Falls back to the generic
			// copy for a transport failure (SDK errors carry the envelope's `error`).
			const message = err instanceof Error && err.message ? err.message : 'Could not submit the request. Please try again.';
			setError(message);
			// The inline error sits at the BOTTOM of a long form (exit time + map +
			// reason), so on a phone it can be off-screen when the native MainButton
			// fails — a toast makes the refusal visible wherever the user is. Without
			// it the day-guard rejection read as "Submit did nothing".
			notifyFailed('Early Leave could not be submitted', message);
			setSubmitting(false);
			submitGuard.end();
		}
	};

	useFormStateReport(onReady, submit, canSubmit, submitting, false, dirty);

	return (
		<div className="flex flex-col gap-5 pt-2">
			{/* 1 — Exit time — the platform native time picker. The `format`
				attribute (WebKit/Safari 18.4+, ignored elsewhere) forces the
				12-hour "h:mm A" display; the value stays `HH:MM` either way.
				`appearance-none` makes iOS/WebKit honor `w-full` — the native
				picker still opens on tap. */}
			<section>
				<label htmlFor="early-slot" className={labelClass}>
					ထွက်ချိန်
					<RequiredMark />
				</label>
				<div className="relative">
					<Clock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
					<Input
						type="time"
						id="early-slot"
						value={leaveTime}
						onChange={(e) => setLeaveTime(e.target.value)}
						className={`${fieldClass} appearance-none pl-9 pr-2`}
						{...nativeTimeFormat}
					/>
				</div>
			</section>

			{/* 2 — Location */}
			<section>
				<FormField label="လက်ရှိတည်နေရာ" group>
					{() => (
						<>
							{locationAvailable ? (
								<Suspense
									fallback={
										<div className={`flex h-55 items-center justify-center ${DENSE_CARD_FRAME}`}>
											<SpinnerGlyph className="size-5" />
										</div>
									}
								>
									<AttendanceMap location={locationState.location} height="220px" />
								</Suspense>
							) : locationBlocked ? (
								<div className={`flex flex-col items-center gap-2 ${DENSE_CARD_FRAME} px-4 py-6 text-center`}>
									<p className="text-xs font-medium leading-myanmar text-status-danger">No precise location available</p>
									<button
										type="button"
										onClick={retryLocation}
										className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
									>
										Try Again
									</button>
								</div>
							) : (
								<div className={`flex h-55 flex-col items-center justify-center gap-2 ${DENSE_CARD_FRAME}`}>
									<SpinnerGlyph className="size-6" />
									<p className="text-xs leading-myanmar text-muted-foreground">Searching…</p>
								</div>
							)}
						</>
					)}
				</FormField>
				{/* The design's 16.8278, 96.2101 line — contextual (hr_requests has
					no location column; only punches persist coordinates). */}
				<p className="mt-2 text-xs tabular-nums text-muted-foreground">
					{locationAvailable ? `${locationState.location.lat.toFixed(4)} , ${locationState.location.lng.toFixed(4)}` : ''}
				</p>
			</section>

			{/* 3 — Reason */}
			<section>
				<label htmlFor="early-reason" className={labelClass}>
					အကြောင်းပြချက်
					<RequiredMark />
				</label>
				<Textarea
					id="early-reason"
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
