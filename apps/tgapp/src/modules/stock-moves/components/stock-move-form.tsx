import { useMemo, useRef, useState } from 'react';
import { DENSE_CARD_FRAME } from '@/shared/components/card';
import { FIELD_LABEL_CLASS as labelClass, FIELD_CLASS as fieldClass } from '@/shared/components/form-styles';
import { ArrowLeftRight, Check, ChevronDown, Package, Plus, Store, Trash2 } from 'lucide-react';
import { Button } from '@mmbix/design-system/button';
import { Input } from '@mmbix/design-system/input';
import { ScrollArea } from '@mmbix/design-system/scroll-area';
import { SearchBox } from '@mmbix/design-system/search-box';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';
import { Textarea } from '@mmbix/design-system/textarea';
import { DatePicker } from '@mmbix/design-system/datepicker';

import { createTransferDoc, updateTransferDoc } from '../data/api';
import { isTransferEditable } from '../data/edit';
import type { CreateTransferDraft, TransferFormSeed, TransferLineSeed, UpdateTransferDraft } from '../data/types';
import { fetchCurrentEmployee } from '@/modules/attendance/data/api';
import { FormField } from '@/shared/components/form-field';
import { RequiredMark } from '@/shared/components/required-mark';
import { useSubmitGuard } from '@/shared/components/form-state';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';

import { MRO_LOCATIONS, MRO_LOCATION_LABELS, MRO_TRACKING_LABELS } from '@/shared/mro';
import type { MroLocation, MroTracking } from '@/shared/mro';
import {
	useMroItemModels,
	filterMroItemModels,
	mroItemLineLabel,
	mroItemModelLabel,
	type MroItemModelDirectoryRow,
} from '@/shared/hooks/use-mro-item-models';
import { SEARCH_MIN_CHARS } from '@/shared/constants';
import { PickerSearchHint } from '@/shared/components/picker-search-hint';
import { hapticImpact } from '@/shared/platform/haptics';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';
import { APP_DATE_FORMAT, todayMmtDate } from '@/shared/time/myanmar';

/** Calendar `Date` → `YYYY-MM-DD` (local calendar date — no TZ shifting). */
function dateToInputValue(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` → local calendar `Date` — the inverse of `dateToInputValue`. */
function parseDateInput(value: string): Date | undefined {
	const [year, month, day] = value.split('-').map(Number);
	if (!year || !month || !day) return undefined;
	return new Date(year, month - 1, day);
}

/** A parsable number from the qty input — null when blank/unparsable. */
function qtyOf(raw: string): number | null {
	if (raw.trim() === '') return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}

/** The typed serials — split on commas (English/Burmese) or whitespace. */
function serialsListOf(text: string): string[] {
	return text
		.split(/[\s,၊]+/)
		.map((serial) => serial.trim())
		.filter(Boolean);
}

/** A model's tracking policy — anything unknown/missing reads as standard. */
function trackingOf(model: MroItemModelDirectoryRow | undefined): MroTracking {
	return model?.tracking === 'batch' || model?.tracking === 'serial' ? model.tracking : 'standard';
}

/** One row of the dynamic lines editor. */
interface TransferLineDraft {
	/** Local identity — stable across removals (unlike the array index). */
	key: number;
	/** The chosen `mro_item_model` id — null until the picker selects one. */
	modelId: string | null;
	/** EDIT only — the SKU name the stored line carried. The trigger's label reads
	 *  the shared directory first and falls back to this, so an edit never paints a
	 *  bare UUID on a line that plainly HAS an item while the master read is in
	 *  flight. */
	modelName?: string | null;
	/** EDIT only — the policy the stored line was captured under, for the same
	 *  reason: a serial row must keep its serial field (and its qty/serials pairing)
	 *  before the directory lands, or the row would briefly look like a plain
	 *  consumable and the operator could save it without its units. */
	tracking?: MroTracking | null;
	/** The raw qty input (parsed on submit / for the running total). */
	qty: string;
	/** Batch models only — an OPTIONAL restriction; blank lets confirm pick FEFO. */
	batchNo: string;
	/** Serial models only — the units as comma-separated text, parsed on submit. */
	serialsText: string;
}

/**
 * A STORED line → the editor's row. A seed is the only source of `modelName` /
 * `tracking` (a fresh row learns both from the directory instead), and the `key`
 * is local — the wire has no use for it.
 */
function lineDraftOf(line: TransferLineSeed, index: number): TransferLineDraft {
	return {
		key: index + 1,
		modelId: line.modelId,
		modelName: line.modelName,
		tracking: line.tracking,
		qty: line.qty > 0 ? `${line.qty}` : '',
		batchNo: line.batchNo,
		serialsText: line.serials.join(', '),
	};
}

/**
 * The location-transfer create form — the REAL multi-line document form behind
 * the ပြောင်းရွှေ့ screen. A transfer draft is ONE engine-native POST
 * (`mro_transfers` + its child `mro_transfer_lines` in the same body): the
 * engine numbers the doc (TRF-…), stores the lines and — at CONFIRM, never
 * here — moves stock between the two stores:
 *
 *   1. ရက်စွဲ — the DS DatePicker, defaulting to today's MMT calendar day;
 *   2. ပေးပို့စတိုး → လက်ခံစတိုး — two bottom-sheet store pickers (must
 *      differ; the form warns and blocks submit while they are equal);
 *   3. ပစ္စည်းများ — the dynamic LINES editor: one row per SKU, each a
 *      searchable `mro_item_model` picker + a qty input + the TRACKING-aware
 *      extra field:
 *        - batch  → OPTIONAL batch-no (blank = FEFO at the source; expired
 *          lots stay put and batch/expiry identity survives the move);
 *        - serial → the exact units as comma-separated text (the engine 409s
 *          at confirm when the list length ≠ qty or a unit is unknown / not
 *          at the source store / expired);
 *   4. မှတ်ချက် — a free-text note.
 *
 * Submit is enabled once the stores differ, every non-blank line is complete
 * (an item AND qty > 0, serial lines require qty serials) and at least one
 * such line exists. Engine errors render inline and never silently close the
 * form; success calls `onDone`.
 *
 * ONE form, TWO modes — `seed` is the whole difference. Without it the form CREATES a
 * document (`POST`); with it the form EDITS that document (`PUT`, not `POST`). And the
 * mode is not the caller's choice but the DOCUMENT's: `isTransferEditable` mirrors the
 * engine's own freeze (`writes.freeze_when doc_status:['confirmed','cancelled']`), so an
 * already-posted or cancelled move renders the same layout with every field read-only
 * — the screen never offers a write the server would answer with a 403.
 */
export function StockMoveForm({ onDone, seed }: { onDone: () => void; seed?: TransferFormSeed }) {
	// Only a DOCUMENT'S STATUS decides the mode (never a caller flag): a draft
	// accepts a write, and a confirmed / cancelled row is frozen by the
	// collection's `writes.freeze_when`. Read-only is then "every field is disabled
	// and there is nothing to submit".
	const seededStatus = seed?.docStatus;
	const readOnly = seededStatus !== undefined && !isTransferEditable(seededStatus);

	// The SKU directory — the ONE shared master read (see
	// `shared/hooks/use-mro-item-models`), cached for the master freshness window.
	const models = useMroItemModels();

	// Header fields — the transfer date defaults to today in MMT; the source
	// store defaults to the main store, the destination to none yet. An EDIT seed
	// replaces those defaults with the document's own values, so the form opens on
	// the move it was asked to show rather than on a blank one.
	const [transferDate, setTransferDate] = useState<Date | undefined>(() => parseDateInput(seed?.transferDate ?? todayMmtDate()));
	const [fromLocation, setFromLocation] = useState<MroLocation>(seed?.fromLocation ?? 'main_store');
	const [toLocation, setToLocation] = useState<MroLocation | null>(seed?.toLocation ?? null);
	const [note, setNote] = useState(seed?.note ?? '');

	// The dynamic lines editor — seeded from an EXISTING document when there is one,
	// else one blank row. An edit starts the key counter ABOVE the seeded rows so a
	// row added later can never collide with a seeded key (which would make two rows
	// share one identity).
	const nextLineKey = useRef((seed?.lines.length ?? 0) + 1);
	const newLine = (): TransferLineDraft => ({ key: nextLineKey.current++, modelId: null, qty: '', batchNo: '', serialsText: '' });
	const [lines, setLines] = useState<TransferLineDraft[]>(() =>
		seed && seed.lines.length > 0 ? seed.lines.map(lineDraftOf) : [newLine()],
	);
	const [pickerFor, setPickerFor] = useState<number | null>(null);
	const [modelQuery, setModelQuery] = useState('');
	const [fromOpen, setFromOpen] = useState(false);
	const [toOpen, setToOpen] = useState(false);

	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();
	// EVERY interactive control's disabled condition — one expression, so a field can
	// never be forgotten in read-only mode (the mode is a property of the document,
	// not of a handful of inputs).
	const locked = submitting || readOnly;

	const modelById = useMemo(() => new Map((models.data ?? []).map((model) => [model.id, model])), [models.data]);
	const modelOf = (line: TransferLineDraft): MroItemModelDirectoryRow | undefined =>
		line.modelId ? modelById.get(line.modelId) : undefined;

	/**
	 * A row's tracking policy — the DIRECTORY's answer when it has the SKU, else the
	 * policy the STORED line was captured under. The fallback is what keeps an edit's
	 * serial field (and its serials as the quantity) on screen before the master read
	 * lands; it cannot mislabel a fresh row, because those carry no stored policy.
	 */
	const lineTracking = (line: TransferLineDraft): MroTracking => {
		const model = modelOf(line);
		return model ? trackingOf(model) : (line.tracking ?? 'standard');
	};

	/** The picker's candidates — shared client-side name/group/tracking match over
	 *  the cached directory (no per-keystroke request). */
	const modelCandidates = useMemo(() => filterMroItemModels(models.data ?? [], modelQuery), [models.data, modelQuery]);
	// The picker stays blank until the term is long enough — no directory dump on open.
	const pickerReady = modelQuery.trim().length >= SEARCH_MIN_CHARS;

	/** A serial line is complete only when its typed serials exactly match qty. */
	const serialCountMatches = (line: TransferLineDraft): boolean => {
		const qty = qtyOf(line.qty);
		if (qty === null || !Number.isInteger(qty)) return false;
		return serialsListOf(line.serialsText).length === qty;
	};

	/** A row is complete when it can become a submit-payload row. */
	const isValidLine = (line: TransferLineDraft): boolean => {
		if (line.modelId === null) return false;
		const qty = qtyOf(line.qty);
		if (qty === null || qty <= 0) return false;
		if (lineTracking(line) === 'serial') return serialCountMatches(line);
		return true;
	};
	/** A row is blank when nothing was filled in yet (skipped by the payload). */
	const isBlankLine = (line: TransferLineDraft): boolean =>
		line.modelId === null && line.qty.trim() === '' && line.batchNo.trim() === '' && line.serialsText.trim() === '';

	const completeLines = lines.filter(isValidLine);
	const hasIncompleteLine = lines.some((line) => !isBlankLine(line) && !isValidLine(line));
	// "Add another" must not stack empty rows: the last line has to be filled (or
	// partially typed) before another can be added. Removing a line is always
	// available, so this can never trap the user with an unfillable row.
	const lastLineBlank = lines.length > 0 && isBlankLine(lines[lines.length - 1]);
	// The running total readout — every typed positive qty (visible as the user
	// fills rows); the payload itself only carries the complete lines.
	const totalQty = lines.reduce((sum, line) => sum + Math.max(0, qtyOf(line.qty) ?? 0), 0);

	const sameStore = toLocation !== null && fromLocation === toLocation;
	const canSubmit = !submitting && toLocation !== null && !sameStore && completeLines.length > 0 && !hasIncompleteLine;

	const addLine = () => {
		hapticImpact('light');
		setLines((current) => [...current, newLine()]);
	};

	const removeLine = (key: number) => {
		hapticImpact('light');
		setLines((current) => current.filter((line) => line.key !== key));
	};

	const patchLine = (key: number, patch: Partial<TransferLineDraft>) => {
		setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
	};

	const openPicker = (key: number) => {
		hapticImpact('light');
		setModelQuery('');
		setPickerFor(key);
	};

	const pickModel = (key: number, modelId: string) => {
		hapticImpact('light');
		// A new model resets everything that described the OLD one: the
		// tracking-dependent fields (batch no / serials) only make sense for the model
		// they were typed against, and the stored line's name + policy must go too — a
		// row the operator has just re-pointed is no longer the stored line, so keeping
		// its old identity would let a stale fallback answer for the new SKU.
		setLines((current) =>
			current.map((line) =>
				line.key === key ? { ...line, modelId, modelName: null, tracking: null, batchNo: '', serialsText: '' } : line,
			),
		);
		setPickerFor(null);
	};

	const submit = async () => {
		if (!canSubmit || toLocation === null || !submitGuard.begin()) return;
		hapticImpact('medium');
		setSubmitting(true);
		setError(null);
		// The header + lines both verbs share. The NOTE is deliberately not part of it:
		// a create omits it when blank (the engine's default stands) while an edit has to
		// be able to state `null` and CLEAR it — so each branch below adds its own.
		const payload: Omit<CreateTransferDraft, 'note' | 'reported_by'> = {
			from_location: fromLocation,
			to_location: toLocation,
			transfer_date: transferDate ? dateToInputValue(transferDate) : todayMmtDate(),
			lines: completeLines.flatMap((line) => {
				// The row's OWN id is enough — the directory only NAMES the SKU. The fallback
				// matters on an edit: a SKU missing from the cached directory must still be
				// saved as it was, because dropping the line would silently delete stock from
				// the document.
				const modelId = modelOf(line)?.id ?? line.modelId;
				const qty = qtyOf(line.qty);
				if (!modelId || qty === null || qty <= 0) return [];
				const tracking = lineTracking(line);
				return [
					{
						item_model: modelId,
						qty,
						...(tracking === 'batch' && line.batchNo.trim() ? { batch_no: line.batchNo.trim() } : {}),
						...(tracking === 'serial' ? { serials: serialsListOf(line.serialsText) } : {}),
					},
				];
			}),
		};
		try {
			// Same form, same payload shape — only the verb differs: an edit SAVES the
			// document it was seeded with (the engine replaces its child lines with this
			// payload), a create files a new one.
			if (seed) {
				// An EDIT states the note OUTRIGHT — emptying it has to send `null`, where a
				// create simply leaves the field out and keeps the engine's default — and it
				// never carries `reported_by` (`mro_transfers` declares it an `actor_field`:
				// the engine stamps the session on create, so an update could silently
				// REASSIGN the reporter, and the reporter of a report must not change).
				const draft: UpdateTransferDraft = { ...payload, note: note.trim() || null };
				await updateTransferDoc(seed.id, draft);
			} else {
				// Reported by the logged-in operator — the engine needs the reporter's
				// `hrm_employees.id` (m2o) so the same person CAN'T later confirm it (409).
				const actor = await fetchCurrentEmployee();
				if (!actor) throw new Error('No employee account is linked to this session.');
				await createTransferDoc({ ...payload, ...(note.trim() ? { note: note.trim() } : {}), reported_by: actor.id });
			}
			onDone();
		} catch (err) {
			// Engine validation (e.g. a `lines` rule) surfaces its message inline —
			// the form stays open with the user's rows intact for a retry.
			console.error('[stock-moves] save failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Could not save — try again.');
			setSubmitting(false);
			submitGuard.end();
		}
	};

	// The submit affordance: the native MainButton on Android/Desktop Telegram
	// (Apple clients fall back — native iOS clips Burmese labels); the in-page
	// button everywhere else. Never both — same rule as the BackButton pill.
	// Tucked away while a picker sheet is open so it cannot be tapped behind the
	// sheet's backdrop, and ABSENT entirely in read-only mode: there is nothing to
	// save, so a button would be a promise the form cannot keep.
	const isMainButton = useTelegramMainButton({
		text: submitting ? 'Saving…' : 'Save Draft',
		onClick: () => void submit(),
		visible: !readOnly && !fromOpen && !toOpen && pickerFor === null,
		disabled: !canSubmit,
		loading: submitting,
	});

	// WHY nothing can be changed is NOT stated here: the document page's status pill IS
	// that statement (`Confirmed` / `Cancelled`). A second sentence under the pill — or in
	// this form — would print the same fact twice, in two voices free to drift apart.

	return (
		<div className="flex flex-1 flex-col gap-3 pt-2">
			{/* 1 — Transfer date — the DS DatePicker, defaulted to today (MMT). */}
			<section>
				<FormField label="Date" required group>
					{() => (
						<DatePicker
							value={transferDate}
							onValueChange={setTransferDate}
							placeholder="Select date"
							format={APP_DATE_FORMAT}
							disabled={locked}
							className={fieldClass}
						/>
					)}
				</FormField>
			</section>

			{/* 2 — Route — the source + destination stores (bottom-sheet pickers). */}
			<section>
				<FormField label="Route (From store → To store)" required group>
					{() => (
						<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
							<div className="flex min-w-0 flex-col gap-1 sm:flex-1">
								<span className="text-meta font-medium leading-myanmar text-muted-foreground">From</span>
								<Button
									type="button"
									variant="outline"
									disabled={locked}
									onClick={() => {
										hapticImpact('light');
										setFromOpen(true);
									}}
									className={`${fieldClass} justify-between font-normal`}
									aria-label="Select From store"
								>
									<span className="flex min-w-0 items-center gap-2">
										<Store strokeWidth={1.6} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
										<span className="truncate text-foreground">{MRO_LOCATION_LABELS[fromLocation]}</span>
									</span>
									<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
								</Button>
							</div>
							<ArrowLeftRight
								className="mx-auto size-4 shrink-0 rotate-90 text-muted-foreground sm:mx-0 sm:mt-[18px] sm:rotate-0"
								aria-hidden
							/>
							<div className="flex min-w-0 flex-col gap-1 sm:flex-1">
								<span className="text-meta font-medium leading-myanmar text-muted-foreground">To</span>
								<Button
									type="button"
									variant="outline"
									disabled={locked}
									onClick={() => {
										hapticImpact('light');
										setToOpen(true);
									}}
									className={`${fieldClass} justify-between font-normal`}
									aria-label="Select To store"
								>
									<span className="flex min-w-0 items-center gap-2">
										<Store strokeWidth={1.6} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
										<span className="truncate text-foreground">{toLocation ? MRO_LOCATION_LABELS[toLocation] : 'Select To store'}</span>
									</span>
									<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
								</Button>
							</div>
						</div>
					)}
				</FormField>
				{sameStore && (
					<p className="mt-1.5 text-meta font-medium leading-myanmar text-status-warning">From store and To store must be different.</p>
				)}

				{/* The two store sheets — one list of the five MRO stores each. Never open for
				    a settled document. */}
				<Sheet open={fromOpen && !readOnly} onOpenChange={setFromOpen}>
					<SheetContent side="bottom">
						<SheetHeader className="pb-1">
							<SheetTitle>Select From store</SheetTitle>
						</SheetHeader>
						<div className="flex flex-col gap-0.5 px-4 pb-safe">
							{MRO_LOCATIONS.map((option) => {
								const selected = option.value === fromLocation;
								return (
									<button
										key={option.value}
										type="button"
										onClick={() => {
											hapticImpact('light');
											setFromLocation(option.value);
											setFromOpen(false);
										}}
										className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<span className={`text-sm font-medium leading-myanmar ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
											{option.label}
										</span>
										{selected && <Check className="size-4 text-primary" aria-hidden />}
									</button>
								);
							})}
						</div>
					</SheetContent>
				</Sheet>

				<Sheet open={toOpen && !readOnly} onOpenChange={setToOpen}>
					<SheetContent side="bottom">
						<SheetHeader className="pb-1">
							<SheetTitle>Select To store</SheetTitle>
						</SheetHeader>
						<div className="flex flex-col gap-0.5 px-4 pb-safe">
							{MRO_LOCATIONS.map((option) => {
								const selected = option.value === toLocation;
								return (
									<button
										key={option.value}
										type="button"
										onClick={() => {
											hapticImpact('light');
											setToLocation(option.value);
											setToOpen(false);
										}}
										className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<span className={`text-sm font-medium leading-myanmar ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
											{option.label}
										</span>
										{selected && <Check className="size-4 text-primary" aria-hidden />}
									</button>
								);
							})}
						</div>
					</SheetContent>
				</Sheet>
			</section>

			{/* 3 — The dynamic LINES editor — one row per SKU to move. */}
			<section>
				<div className="mb-2 flex items-center justify-between gap-2">
					<div className="flex min-w-0 items-center gap-2">
						<p className={`${labelClass} mb-0`}>
							Items
							<RequiredMark />
						</p>

						{/* The running total — the Items section's OWN figure, read ONCE, on the
						    heading it belongs to rather than as a second bordered block under the
						    list: a total is a property of the lines, not another field. */}
						<span className="flex shrink-0 items-baseline gap-1.5 rounded-full border border-dashed border-border bg-card/60 px-2.5 py-1">
							<span className="text-[10px] font-medium leading-myanmar text-muted-foreground">Total quantity</span>
							<span className="text-xs font-bold tabular-nums leading-myanmar text-foreground">
								{totalQty.toLocaleString('en-US', { maximumFractionDigits: 2 })}
							</span>
						</span>
					</div>

					{/* Adding a row is an ACTION too — the same rule as the row's remove button. */}
					{!readOnly && (
						<button
							type="button"
							disabled={submitting || lastLineBlank}
							title={lastLineBlank ? 'Fill the current item first' : undefined}
							onClick={addLine}
							className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<Plus className="size-3.5" strokeWidth={2.2} aria-hidden />
							Add item
						</button>
					)}
				</div>

				{lines.length > 0 ? (
					<ul className="flex flex-col gap-2">
						{lines.map((line, index) => {
							const model = modelOf(line);
							// The directory's answer, else the policy the STORED line was captured
							// under — so an edit's serial / batch field survives until the master read
							// lands (see `lineTracking`).
							const tracking = lineTracking(line);
							const isSerial = tracking === 'serial';
							const typedSerials = serialsListOf(line.serialsText).length;
							const qty = qtyOf(line.qty);
							const serialCountMismatch = isSerial && qty !== null && Number.isInteger(qty) && typedSerials !== qty;
							return (
								<li key={line.key} className={`${DENSE_CARD_FRAME} p-2.5`}>
									{/* Row label — the line number. */}
									<div className="flex items-center justify-between gap-2">
										<p className="text-xs font-semibold leading-myanmar text-muted-foreground">Item {index + 1}</p>
										{/* Removing a line is an ACTION, not data: read-only mode drops the control. */}
										{!readOnly && (
											<button
												type="button"
												disabled={submitting}
												onClick={() => removeLine(line.key)}
												aria-label="Remove line"
												className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-transform duration-150 active:scale-95 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
											>
												<Trash2 className="size-3.5" strokeWidth={1.8} aria-hidden />
											</button>
										)}
									</div>

									{/* Item-model picker trigger — opens the searchable bottom sheet. */}
									<button
										type="button"
										disabled={locked}
										onClick={() => openPicker(line.key)}
										aria-label="Select item"
										className="mt-2 flex min-h-10 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm leading-myanmar outline-none transition-colors focus:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
									>
										<Package strokeWidth={1.6} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
										<span
											className={`min-w-0 flex-1 truncate ${model || line.modelName ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
										>
											{/* The directory NAMES the SKU when it knows it; the stored line's name is
											    the fallback while that master read is in flight (or when it does not
											    know the SKU at all). A bare UUID is the last resort, never the first. */}
											{mroItemLineLabel({ model, storedName: line.modelName, modelId: line.modelId })}
										</span>
										<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
									</button>

									{/* Qty — the amount to move on this line. */}
									<div className="mt-2">
										<Input
											type="number"
											min={0}
											step="any"
											inputMode={isSerial ? 'numeric' : 'decimal'}
											value={line.qty}
											onChange={(event) => patchLine(line.key, { qty: event.target.value })}
											placeholder="Quantity"
											disabled={locked}
											aria-label="Quantity"
											className="h-10 rounded-lg px-3"
										/>
									</div>

									{/* Batch models — an OPTIONAL batch restriction (blank = FEFO). Gated on the
									    row's POLICY, not on the directory having landed: an edit's stored batch
									    field must stay editable before the master read resolves. */}
									{tracking === 'batch' && (
										<div className="mt-2">
											<label htmlFor={`line-${line.key}-batch`} className={`${labelClass} mb-1`}>
												Batch no.
											</label>
											<Input
												id={`line-${line.key}-batch`}
												value={line.batchNo}
												onChange={(event) => patchLine(line.key, { batchNo: event.target.value })}
												placeholder="Batch no. — blank = FEFO"
												disabled={locked}
												autoCapitalize="characters"
												className="h-10 rounded-lg px-3"
											/>
											<p className="mt-1 text-meta leading-myanmar text-muted-foreground">
												If blank, the closest-to-expiry (FEFO) lot is chosen automatically; expired lots won't be moved.
											</p>
										</div>
									)}

									{/* Serial models — the exact units, comma-separated. Gated on the row's POLICY
									    for the same reason the batch field is. */}
									{isSerial && (
										<div className="mt-2">
											<label htmlFor={`line-${line.key}-serials`} className={`${labelClass} mb-1`}>
												Serial numbers
												<RequiredMark />
											</label>
											<Input
												id={`line-${line.key}-serials`}
												value={line.serialsText}
												onChange={(event) => patchLine(line.key, { serialsText: event.target.value })}
												placeholder="TY-1001, TY-1002, …"
												disabled={locked}
												className="h-10 rounded-lg px-3"
											/>
											{serialCountMismatch ? (
												<p className="mt-1 text-meta font-medium leading-myanmar text-status-warning">
													Serial count ({typedSerials}) must equal the quantity ({qty}).
												</p>
											) : (
												<p className="mt-1 text-meta leading-myanmar text-muted-foreground">
													Enter serials separated by commas — only units in the From store can be moved.
												</p>
											)}
										</div>
									)}
								</li>
							);
						})}
					</ul>
				) : (
					<p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs leading-myanmar text-muted-foreground">
						Add at least one item to move.
					</p>
				)}
			</section>

			{/* 4 — Note — a free-text description. */}
			<section>
				<label htmlFor="transfer-note" className={labelClass}>
					Note
				</label>
				<Textarea
					id="transfer-note"
					value={note}
					onChange={(event) => setNote(event.target.value)}
					placeholder="Write a note (optional)"
					rows={3}
					disabled={locked}
					className="rounded-lg bg-card px-3 text-sm leading-myanmar"
				/>
			</section>

			{/* Local validation hint — a row was started but left incomplete. */}
			{hasIncompleteLine && (
				<p className="rounded-md bg-status-warning-soft px-3 py-2 text-xs font-medium leading-myanmar text-status-warning">
					Incomplete line — fill in the item and quantity (serial items need one serial per unit), or remove the line.
				</p>
			)}

			{/* Engine errors render inline — never silent, never a dead-end. */}
			<FormError error={error} />

			{/* The submit bar is ABSENT in read-only mode, not disabled: there is nothing
			    to save, so a dead button would only suggest the screen is broken. */}
			{!readOnly && (
				<FormSubmitBar
					label="Save Draft"
					isMainButton={isMainButton}
					disabled={!canSubmit}
					submitting={submitting}
					onSubmit={() => void submit()}
				/>
			)}

			{/* The item-model picker sheet — shared by every line row; `pickerFor`
				carries the key of the row it is filling. Never opens for a settled
				document: there is no write behind it. */}
			<Sheet
				open={pickerFor !== null && !readOnly}
				onOpenChange={(open) => {
					if (!open) setPickerFor(null);
				}}
			>
				<SheetContent side="bottom" className="max-h-[85dvh]">
					<SheetHeader className="pb-1">
						<SheetTitle>Select item</SheetTitle>
						<SearchBox
							placeholder="Search item name"
							value={modelQuery}
							onValueChange={setModelQuery}
							className="mt-3"
							inputClassName="h-8.5 text-xs! px-3 rounded-full"
						/>
					</SheetHeader>
					<ScrollArea className="h-[45dvh] px-4 pb-safe">
						{!pickerReady ? (
							<PickerSearchHint noun="search items" />
						) : models.isPending ? (
							<p className="px-3 py-8 text-center text-sm leading-myanmar text-muted-foreground">Loading items…</p>
						) : models.isError ? (
							<div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
								<p className="text-sm leading-myanmar text-status-danger">Couldn't load items.</p>
								<button
									type="button"
									onClick={() => void models.refetch()}
									className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
								>
									Retry
								</button>
							</div>
						) : modelCandidates.length > 0 ? (
							<ul className="flex flex-col gap-0.5">
								{modelCandidates.map((model: MroItemModelDirectoryRow) => {
									const selected = pickerFor !== null && lines.find((line) => line.key === pickerFor)?.modelId === model.id;
									const trackingLabel = MRO_TRACKING_LABELS[model.tracking ?? ''] ?? null;
									return (
										<li key={model.id}>
											<button
												type="button"
												onClick={() => pickModel(pickerFor as number, model.id)}
												className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
											>
												<span className="min-w-0 flex-1">
													<span className="block truncate text-sm font-medium leading-6.5 text-foreground">{mroItemModelLabel(model)}</span>
													{model.name_mm?.trim() && (
														<span className="block truncate text-xs leading-myanmar text-muted-foreground">{model.name_mm}</span>
													)}
												</span>
												{trackingLabel && (
													<span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold leading-myanmar text-muted-foreground">
														{trackingLabel}
													</span>
												)}
												{selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
											</button>
										</li>
									);
								})}
							</ul>
						) : (
							<p className="px-3 py-8 text-center text-sm leading-myanmar text-muted-foreground">No items found</p>
						)}
					</ScrollArea>
				</SheetContent>
			</Sheet>
		</div>
	);
}
