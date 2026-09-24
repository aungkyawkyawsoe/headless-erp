import { useEffect, useState } from 'react';
import { FIELD_CLASS as fieldClass, NOTE_CLASS as noteClass } from '@/shared/components/form-styles';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Input } from '@mmbix/design-system/input';
import { Textarea } from '@mmbix/design-system/textarea';

import { createPermit, updatePermit } from '../data/api';
import { qk } from '../data/query-keys';
import { DateField } from '@/shared/components/date-field';
import { FormField } from '@/shared/components/form-field';
import { useFormDirty, useSubmitGuard } from '@/shared/components/form-state';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';
import { todayMmtDate } from '@/shared/time/myanmar';

/** The input field style — the license create-page vocabulary. */

/** Parse a money input — undefined when blank, so an untouched fee is never
 *  sent; non-numeric / negative text (impossible via `type=number`) is dropped. */
function moneyOf(raw: string): number | undefined {
	const t = raw.trim();
	if (t === '') return undefined;
	const n = Number(t);
	return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** The raw field values the form starts from when CORRECTING an existing permit
 *  (the create form starts blank / carries the current number over). `id` is the
 *  row being updated. */
export interface LicenseFormInitial {
	id: string;
	licenseNo: string;
	place: string;
	issueDate: string;
	expiryDate: string;
	licenseFee: string;
	agent: string;
	mobile: string;
	note: string;
}

/**
 * ONE truck's renewal form — the per-truck page's form-first view (`/app/licenses/:id`):
 * a NEW permit for THAT truck (the vehicle is fixed — it never rides the picker
 * the standalone `+` page uses). The license number is NOT collected here — the
 * truck's CURRENT permit number is already on file and carries over to the new
 * record (`currentLicenseNo`; a different number is issued through the standalone
 * `+` page). Fields: Issued place · License fee · Issue date (defaults to today,
 * MMT calendar) · Expiry date · Agent · Mobile · Note. Every save writes a
 * `veh_permits` row bound to the truck, then invalidates the truck's history
 * feed AND the licenses overview (the truck card's current line + pill refresh
 * the moment the user returns) before handing back to the page.
 *
 * When `initial` is set the SAME form corrects that permit in place
 * (`updatePermit`) — the license number becomes an editable field (a correction
 * must be able to fix a wrong number), so edit and create share one field set.
 */
export function LicenseRecordForm({
	vehicleId,
	currentLicenseNo,
	initial,
	onSaved,
	nativeSubmit = true,
}: {
	vehicleId: string;
	/** The truck's current permit number — carried onto the new record (null when
	 *  the truck has no permit on file yet; the record then saves without one). */
	currentLicenseNo?: string | null;
	/** Set to CORRECT this permit (the vehicle's newest record) instead of creating. */
	initial?: LicenseFormInitial;
	onSaved: () => void;
	/** Use the Telegram native MainButton as the submit affordance. Default true;
	 *  the per-truck page passes false — its own BottomActionBar owns the bottom
	 *  edge, so a native button would overlap it. */
	nativeSubmit?: boolean;
}) {
	const queryClient = useQueryClient();
	const editing = initial != null;

	const [licenseNo, setLicenseNo] = useState(initial?.licenseNo ?? '');
	const [place, setPlace] = useState(initial?.place ?? '');
	const [issueDate, setIssueDate] = useState<string>(initial?.issueDate ?? todayMmtDate());
	const [expiryDate, setExpiryDate] = useState(initial?.expiryDate ?? '');
	const [licenseFee, setLicenseFee] = useState(initial?.licenseFee ?? '');
	const [agent, setAgent] = useState(initial?.agent ?? '');
	const [mobile, setMobile] = useState(initial?.mobile ?? '');
	const [note, setNote] = useState(initial?.note ?? '');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	// Edit mode — re-seed from a fresh row whenever the loaded row's identity
	// changes (TanStack v5 can serve a cached row while revalidating); create
	// mode has no `initial` — the effect stays dormant.
	useEffect(() => {
		if (!editing || !initial) return;
		setLicenseNo(initial.licenseNo ?? '');
		setPlace(initial.place ?? '');
		setIssueDate(initial.issueDate ?? todayMmtDate());
		setExpiryDate(initial.expiryDate ?? '');
		setLicenseFee(initial.licenseFee ?? '');
		setAgent(initial.agent ?? '');
		setMobile(initial.mobile ?? '');
		setNote(initial.note ?? '');
		setError(null);
	}, [initial]);

	// Dirty gate — baseline mirrors the `useState` initializers above (a create
	// starts at today's issue date), so an untouched form cannot be submitted.
	const dirty = useFormDirty(
		{
			licenseNo: initial?.licenseNo ?? '',
			place: initial?.place ?? '',
			issueDate: initial?.issueDate ?? todayMmtDate(),
			expiryDate: initial?.expiryDate ?? '',
			licenseFee: initial?.licenseFee ?? '',
			agent: initial?.agent ?? '',
			mobile: initial?.mobile ?? '',
			note: initial?.note ?? '',
		},
		{ licenseNo, place, issueDate, expiryDate, licenseFee, agent, mobile, note },
	);

	const canSave = !saving && dirty;

	const submit = async () => {
		if (!canSave || !submitGuard.begin()) return;
		setSaving(true);
		setError(null);
		try {
			const fee = moneyOf(licenseFee);
			if (editing && initial) {
				await updatePermit(initial.id, {
					license_no: licenseNo.trim() || null,
					place: place.trim() || null,
					issue_date: issueDate || null,
					expiry_date: expiryDate || null,
					license_fee: fee ?? null,
					agent: agent.trim() || null,
					mobile: mobile.trim() || null,
					note: note.trim() || null,
				});
			} else {
				await createPermit({
					vehicle: vehicleId,
					// The current license number rides onto the renewal — the operator
					// never types it here (a new number is issued via the + page).
					...(currentLicenseNo?.trim() ? { license_no: currentLicenseNo.trim() } : {}),
					...(place.trim() ? { place: place.trim() } : {}),
					...(issueDate ? { issue_date: issueDate } : {}),
					...(expiryDate ? { expiry_date: expiryDate } : {}),
					...(fee != null ? { license_fee: fee } : {}),
					...(agent.trim() ? { agent: agent.trim() } : {}),
					...(mobile.trim() ? { mobile: mobile.trim() } : {}),
					...(note.trim() ? { note: note.trim() } : {}),
				});
			}
			// The truck's history feed (new permit on top) + the licenses overview
			// (the truck card's current line + pill must flip to the new record).
			void queryClient.invalidateQueries({ queryKey: qk.truck(vehicleId), refetchType: 'active' });
			void queryClient.invalidateQueries({ queryKey: qk.current(vehicleId), refetchType: 'active' });
			void queryClient.invalidateQueries({ queryKey: qk.licenses(), refetchType: 'active' });
			if (initial) void queryClient.invalidateQueries({ queryKey: qk.record(initial.id), refetchType: 'active' });
			if (!editing) {
				setPlace('');
				setIssueDate(todayMmtDate());
				setExpiryDate('');
				setLicenseFee('');
				setAgent('');
				setMobile('');
				setNote('');
			}
			setSaving(false);
			onSaved();
		} catch (err) {
			console.error('[licenses] truck record failed', err);
			setError(err instanceof Error && err.message ? err.message : "Couldn't save this license — try again.");
			setSaving(false);
			submitGuard.end();
		}
	};

	// The submit affordance: the native MainButton on Android/Desktop Telegram
	// (Apple clients fall back — native iOS clips Burmese labels); the in-page
	// button everywhere else. Never both — same rule as the BackButton pill.
	const isMainButton = useTelegramMainButton({
		text: saving ? 'Saving…' : 'Save license',
		onClick: () => void submit(),
		visible: nativeSubmit,
		disabled: !canSave,
		loading: saving,
	});

	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(e) => {
				e.preventDefault();
				void submit();
			}}
		>
			{/* The license number is editable ONLY when correcting — the create form
				carries the current number over instead (a new number uses the + page). */}
			{editing && (
				<FormField label="License no">
					{(f) => (
						<Input
							{...f}
							value={licenseNo}
							onChange={(e) => setLicenseNo(e.target.value)}
							placeholder="e.g. YGN-12345"
							className={fieldClass}
						/>
					)}
				</FormField>
			)}

			<FormField label="Issued place">
				{(f) => <Input {...f} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Yangon" className={fieldClass} />}
			</FormField>

			<FormField label="License fee">
				{(f) => (
					<Input
						{...f}
						type="number"
						inputMode="numeric"
						min={0}
						step="any"
						value={licenseFee}
						onChange={(e) => setLicenseFee(e.target.value)}
						placeholder="Ks"
						className={fieldClass}
					/>
				)}
			</FormField>

			<div className="grid grid-cols-2 gap-3">
				<FormField label="Issue date">
					{(_f, h) => (
						<DateField value={issueDate} onChange={setIssueDate} disabled={saving} ariaLabel={h.ariaLabel} className={fieldClass} />
					)}
				</FormField>
				<FormField label="Expiry date">
					{(_f, h) => (
						<DateField value={expiryDate} onChange={setExpiryDate} disabled={saving} ariaLabel={h.ariaLabel} className={fieldClass} />
					)}
				</FormField>
			</div>

			<div className="grid grid-cols-2 gap-3">
				<FormField label="Agent">
					{(f) => <Input {...f} value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="e.g. U Mya" className={fieldClass} />}
				</FormField>
				<FormField label="Mobile">
					{(f) => (
						<Input
							{...f}
							type="tel"
							inputMode="tel"
							value={mobile}
							onChange={(e) => setMobile(e.target.value)}
							placeholder="e.g. 09 123 456 789"
							className={fieldClass}
						/>
					)}
				</FormField>
			</div>

			<FormField label="Note">
				{(f) => (
					<Textarea
						{...f}
						rows={3}
						value={note}
						onChange={(e) => setNote(e.target.value)}
						placeholder="Add a note..."
						className={noteClass}
					/>
				)}
			</FormField>

			<FormError error={error} />

			<FormSubmitBar
				label="Save license"
				type="submit"
				isMainButton={isMainButton}
				disabled={!canSave}
				submitting={saving}
				icon={<Check className="size-4" aria-hidden />}
			/>
		</form>
	);
}
