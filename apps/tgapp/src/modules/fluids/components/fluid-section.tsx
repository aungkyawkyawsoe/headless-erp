import { useState } from 'react';
import { FIELD_CLASS as fieldClass, NOTE_CLASS as noteClass } from '@/shared/components/form-styles';
import { Check } from 'lucide-react';
import { Input } from '@mmbix/design-system/input';
import { Textarea } from '@mmbix/design-system/textarea';

import { createFluidFill, updateFluidFill } from '../data/api';
import type { FluidKind } from '../data/types';
import { DateField } from '@/shared/components/date-field';
import { FormField } from '@/shared/components/form-field';
import { useFormDirty, useSubmitGuard } from '@/shared/components/form-state';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import { FLUID_KIND_LABELS } from '@/modules/fleets/data/status';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';
import { todayMmtDate } from '@/shared/time/myanmar';

/**
 * ONE fluid kind's record form — the FULL-PAGE fields on the RECORD page
 * (`/app/fluid/+?vehicle=&type=`): Effective Date · Odo at fill · Next due (km) ·
 * Qty · Note. The native Telegram MainButton is the save action. No care-facts
 * header and no km-left badges here — the kind tabs above already say which fluid
 * is being serviced, and the full history lives on the vehicle's Fluid page.
 *
 * New service model (no fixed per-vehicle interval): each fill records the odo
 * the service happened at PLUS the per-fill "next due" interval (km) the
 * operator chooses — so service frequency can change per need. The absolute next
 * due odo is derived there (`odo_at_fill` + interval) and stored on that fill.
 */

/** The note field style — the same vocabulary, grown to a multi-line block. */

/**
 * ONE kind's in-progress fill, as the form's raw string fields. Held by the PAGE
 * (one entry per fluid kind), NOT by the form: the kind tabs remount the form on
 * every switch, so anything owned by the form would be discarded mid-typing.
 * Lifting it here keeps each kind's draft — switch to Gear oil and back and the
 * Engine oil values are still there, uncrossed between the two kinds.
 */
export interface FluidDraft {
	date: string;
	odo: string;
	nextInterval: string;
	qty: string;
	note: string;
}

/** A blank draft — today (MMT calendar) + the vehicle's current odo as the
 *  prefill, with the operator-chosen fields empty. */
export function emptyFluidDraft(currentOdo: number | null): FluidDraft {
	return {
		date: todayMmtDate(),
		odo: currentOdo != null ? String(currentOdo) : '',
		nextInterval: '',
		qty: '',
		note: '',
	};
}

/** The record-fill form — Effective Date (defaults to today, MMT calendar) · the
 *  fill odo (the vehicle's current reading prefilled) · the per-fill "Next due
 *  (km)" interval · Qty · Note, with a LIVE absolute next-due preview. Every save
 *  stores `next_due_odo = odo_at_fill + interval` on the row alongside the
 *  effective `date`. */
export function FluidFillForm({
	vehicleId,
	kind,
	currentOdo,
	previousIntervalKm,
	draft,
	onDraftChange,
	onSaved,
	editingId,
	baselineDraft,
}: {
	vehicleId: string;
	kind: FluidKind;
	currentOdo: number | null;
	/** The interval the previous service of this kind chose (km) — shown as the
	 *  input's placeholder hint so the operator can repeat it or type a new one. */
	previousIntervalKm: number | null;
	/** The kind's draft — OWNED BY THE PAGE so a tab switch can't discard it. */
	draft: FluidDraft;
	onDraftChange: (next: FluidDraft) => void;
	onSaved: () => void;
	/** Set to CORRECT this fill (the newest of its kind) instead of recording. */
	editingId?: string;
	/**
	 * The draft a CORRECTION started from — the dirty baseline. Absent on create
	 * (any draft is new), so the empty-vs-draft compare below reads dirty.
	 */
	baselineDraft?: FluidDraft;
}) {
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();
	const { date, odo, nextInterval, qty, note } = draft;
	const patch = (changes: Partial<FluidDraft>) => onDraftChange({ ...draft, ...changes });

	const odoNum = Number(odo);
	const intervalNum = Number(nextInterval);
	const qtyNum = qty !== '' ? Number(qty) : undefined;
	const odoOk = odo !== '' && !Number.isNaN(odoNum) && odoNum >= 0 && !(currentOdo != null && odoNum > currentOdo);
	const intervalOk = nextInterval !== '' && !Number.isNaN(intervalNum) && intervalNum > 0;
	// Dirty gate — a correction must differ from the fill it corrects. On create
	// `baselineDraft` is absent, so the compare reads the (empty) baseline against
	// the draft as dirty and the create path is unaffected.
	const dirty = useFormDirty(baselineDraft, draft);
	const canSave = !saving && odoOk && intervalOk && date !== '' && dirty;

	const previewDue = canSave ? odoNum + intervalNum : null;

	const submit = async () => {
		if (!canSave || !submitGuard.begin()) return;
		setSaving(true);
		setError(null);
		try {
			if (editingId) {
				await updateFluidFill(editingId, {
					date: date || null,
					odo_at_fill: odoNum,
					next_due_odo: odoNum + intervalNum,
					qty_liters: qtyNum ?? null,
					note: note.trim() || null,
				});
				onSaved();
				setSaving(false);
				return;
			}
			await createFluidFill(vehicleId, {
				fluid_kind: kind,
				date,
				odo_at_fill: odoNum,
				nextDueIntervalKm: intervalNum,
				qty_liters: qtyNum,
				note: note.trim() || undefined,
			});
			onSaved();
			onDraftChange(emptyFluidDraft(currentOdo));
			setSaving(false);
		} catch (err) {
			console.error('[fluids] fill save failed', err);
			setError(err instanceof Error && err.message ? err.message : "Couldn't save this fill — try again.");
			setSaving(false);
			submitGuard.end();
		}
	};

	// The submit affordance: the native MainButton on Android/Desktop Telegram
	// (Apple clients fall back — native iOS clips Burmese labels); the in-page
	// button everywhere else. Never both — same rule as the BackButton pill.
	const isMainButton = useTelegramMainButton({
		text: saving ? 'Saving…' : `Save ${FLUID_KIND_LABELS[kind].toLowerCase()} fill`,
		onClick: () => void submit(),
		visible: true,
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
			<div className="flex flex-col gap-4">
				<FormField label="Effective Date">
					{(_f, h) => <DateField value={date} onChange={(next) => patch({ date: next })} ariaLabel={h.ariaLabel} className={fieldClass} />}
				</FormField>
				<FormField label="Qty (Liters)">
					{(f) => (
						<Input
							{...f}
							type="number"
							inputMode="decimal"
							min={0}
							step="any"
							value={qty}
							onChange={(e) => patch({ qty: e.target.value })}
							placeholder="e.g. 18"
							className={fieldClass}
						/>
					)}
				</FormField>
			</div>

			<div className="flex flex-col gap-4">
				<FormField
					label="Odo at fill (km)"
					error={
						currentOdo != null && odo !== '' && !Number.isNaN(odoNum) && odoNum > currentOdo
							? `Can't exceed the current reading (${currentOdo.toLocaleString()} km).`
							: null
					}
				>
					{(f) => (
						<Input
							{...f}
							type="number"
							inputMode="numeric"
							min={0}
							value={odo}
							onChange={(e) => patch({ odo: e.target.value })}
							placeholder={currentOdo != null ? `${currentOdo.toLocaleString()}` : 'e.g. 120000'}
							className={fieldClass}
						/>
					)}
				</FormField>
				<FormField label="Next due (km)">
					{(f) => (
						<Input
							{...f}
							type="number"
							inputMode="numeric"
							min={1}
							value={nextInterval}
							onChange={(e) => patch({ nextInterval: e.target.value })}
							placeholder={previousIntervalKm != null ? `e.g. ${previousIntervalKm.toLocaleString()}` : 'e.g. 15000'}
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
						onChange={(e) => patch({ note: e.target.value })}
						placeholder="Add a note..."
						className={noteClass}
					/>
				)}
			</FormField>

			{previewDue != null && (
				<p className="text-2xs font-medium tabular-nums leading-myanmar text-muted-foreground">
					{odoNum.toLocaleString()} → {previewDue.toLocaleString()} km{qtyNum != null ? ` · ${qtyNum} L` : ''}
				</p>
			)}
			<FormError error={error} />
			<FormSubmitBar
				label={`Save ${FLUID_KIND_LABELS[kind].toLowerCase()} fill`}
				type="submit"
				isMainButton={isMainButton}
				disabled={!canSave}
				submitting={saving}
				icon={<Check className="size-4" aria-hidden />}
			/>
		</form>
	);
}
