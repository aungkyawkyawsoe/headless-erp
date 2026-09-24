import { useEffect, useMemo, useRef, useState } from 'react';
import { DENSE_CARD_FRAME } from '@/shared/components/card';
import { FIELD_LABEL_CLASS as labelClass, FIELD_CLASS as fieldClass } from '@/shared/components/form-styles';
import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronDown, Package, Plus, Store, Trash2, User } from 'lucide-react';
import { Button } from '@mmbix/design-system/button';
import { Input } from '@mmbix/design-system/input';
import { ScrollArea } from '@mmbix/design-system/scroll-area';
import { SearchBox } from '@mmbix/design-system/search-box';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';
import { Textarea } from '@mmbix/design-system/textarea';
import { DatePicker } from '@mmbix/design-system/datepicker';

import { createAdjustmentDoc, updateAdjustmentDoc } from '../data/api';
import { isAdjustmentEditable } from '../data/edit';
import type {
	AdjustmentFormSeed,
	AdjustmentLineDraft,
	AdjustmentLineSeed,
	CreateAdjustmentDraft,
	UpdateAdjustmentDraft,
} from '../data/types';
import { fetchCurrentEmployee } from '@/modules/attendance/data/api';
import { FormField } from '@/shared/components/form-field';
import { RequiredMark } from '@/shared/components/required-mark';
import { DateField } from '@/shared/components/date-field';
import { useSubmitGuard } from '@/shared/components/form-state';
import { FormSubmitBar } from '@/shared/components/form-submit';

import { MRO_LOCATIONS, MRO_LOCATION_LABELS, MRO_TRACKING_LABELS } from '@/shared/mro';
import type { MroLocation, MroTracking } from '@/shared/mro';
import { hapticImpact } from '@/shared/platform/haptics';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';
import { APP_DATE_FORMAT, todayMmtDate } from '@/shared/time/myanmar';
import {
	useMroItemModels,
	filterMroItemModels,
	mroItemLineLabel,
	mroItemModelLabel,
	type MroItemModelDirectoryRow,
} from '@/shared/hooks/use-mro-item-models';
import { SEARCH_MIN_CHARS } from '@/shared/constants';
import { PickerSearchHint } from '@/shared/components/picker-search-hint';

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

/** A positive-int parsable from the qty input — null when blank/unparsable. */
function positiveQty(raw: string): number | null {
	const trimmed = raw.trim();
	if (trimmed === '') return null;
	if (!/^\d+$/.test(trimmed)) return null;
	const value = Number(trimmed);
	return Number.isSafeInteger(value) && value > 0 ? value : null;
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

/** The direction an adjustment line takes — Add raises stock, Remove lowers it. */
type Direction = 'add' | 'remove';

/** One row of the dynamic lines editor. */
interface LineEditorRow {
	/** Local identity — stable across removals (unlike the array index). */
	key: number;
	/** The chosen `mro_item_model.id` — null until the picker selects one. */
	modelId: string | null;
	/** EDIT only — the SKU name the stored line carried. The trigger's label reads
	 *  the shared directory first and falls back to this, so an edit never paints a
	 *  bare UUID on a line that plainly HAS an item while the master read is in
	 *  flight. */
	modelName?: string | null;
	/** EDIT only — the policy the stored line was captured under, for the same
	 *  reason: a serial row must keep its unit list visible before the directory
	 *  lands, or the row would briefly look like a plain consumable. */
	tracking?: MroTracking | null;
	/** `add` raises the store balance; `remove` lowers it. */
	direction: Direction;
	/** The raw qty input (parsed on submit). */
	qty: string;
	/** Batch models on an `add` ONLY — the lot the line CREATES. A `remove` draws
	 *  FEFO and records the lots it took in `mro_adjustment_lots`, so it has no lot
	 *  number of its own to type: the field is shown for `add` only, and switching a
	 *  row to `remove` CLEARS it (`setDirection`). */
	batchNo: string;
	/** Batch models on an `add` ONLY — `YYYY-MM-DD`, optional. */
	expiryDate: string;
	/** Serial models being REMOVED — the units as comma-separated text. */
	serialsText: string;
	/** EDIT only — the stored per-unit cost, or null. NOT a form field: the create
	 *  form never collects it, so an edit re-states what the row carries instead of
	 *  letting the child-table replace silently drop it. */
	unitCost: number | null;
}

/**
 * A STORED line → the editor's row. A seed is the only source of `modelName` /
 * `tracking` (a fresh row learns both from the directory instead), and the `key`
 * is local — the wire has no use for it.
 */
function lineRowOf(line: AdjustmentLineSeed, index: number): LineEditorRow {
	return {
		key: index + 1,
		modelId: line.modelId,
		modelName: line.modelName,
		tracking: line.tracking,
		direction: line.direction,
		qty: line.qty > 0 ? `${line.qty}` : '',
		batchNo: line.batchNo,
		expiryDate: line.expiryDate,
		serialsText: line.serials.join(', '),
		unitCost: line.unitCost,
	};
}

/** A resolved "current employee" bound for this session. */
interface ReporterState {
	id: string;
	name: string;
}

/**
 * The MRO stock ADJUSTMENT form — the multi-line report form behind the
 * Adjustments `/+` destination AND the full-screen document page, so ONE component
 * serves create AND edit. An adjustment is an operator-reported stock correction to
 * ONE store: each line either ADDS or REMOVES `qty` of a model. Submit writes a
 * DRAFT (header + nested `lines` in one `POST /api/entities/mro_adjustments`)
 * attributing the report to the CURRENT employee (`reported_by` — an m2o to
 * `hrm_employees`, auto-resolved + read-only, sent as the id). Stock does NOT move
 * here — a DIFFERENT employee later approves the draft from the list ("Approve"),
 * and the engine then applies the signed per-line deltas.
 *
 * A `seed` turns the SAME form into an edit of an existing document:
 *
 *   - the DOCUMENT's status decides whether it writes or merely reads
 *     (`isAdjustmentEditable` — a draft saves, an applied / cancelled row is frozen
 *     by the collection's own `writes.freeze_when`), and read-only mode disables
 *     every control, ABSENTs every action (add / remove a line, the submit bar, both
 *     picker sheets) and states the reason;
 *   - an edit SAVES via `PUT` (the `lines` child table is REPLACED by the payload,
 *     so a removed line really leaves the draft);
 *   - an edit states what a create leaves to the engine — `description` outright,
 *     because emptying it has to be able to send `null` — and NEVER `reported_by`:
 *     the report's author is history, and the two-person rule is built on it.
 *
 *   1. adjustment date — the DS DatePicker, defaulted to today's MMT day;
 *   2. Store          — the location whose balances are corrected
 *      (`MRO_LOCATIONS`, bottom-sheet single select);
 *   3. Items          — the dynamic LINES editor: one row per SKU, each a
 *      searchable `mro_item_model` picker + an Add/Remove direction + qty, plus
 *      the tracking-aware extras: a batch line takes its lot no / expiry on an ADD
 *      (that is the lot it CREATES, and the confirm requires it), and a serial line
 *      is a REQUIRE only-removable unit list (the engine refuses serial ADDs through
 *      an adjustment — those go via an inbound);
 *   4. Description    — a free-text reason for the correction;
 *   5. Reported by    — the current employee, resolved + read-only (create only: the
 *      edit payload cannot carry a reporter, so claiming one would be a lie).
 *
 * Submit is enabled once the current employee is resolved (a create only) and
 * exactly one complete non-blank line exists (an item + a valid Add/Remove qty; a
 * batch ADD needs its lot no, which the confirm would otherwise refuse; a serial-
 * removal needs qty matching serials). Engine errors render inline; success calls
 * `onDone` (the page invalidates the list and returns).
 */
export function AdjustmentForm({ onDone, seed }: { onDone: () => void; seed?: AdjustmentFormSeed }) {
	// Only a DOCUMENT'S STATUS decides the mode (never a caller flag): a draft accepts
	// a write, and an approved / cancelled row is frozen by the collection's
	// `writes.freeze_when`. Read-only is then "every field is disabled and there is
	// nothing to submit".
	const seededStatus = seed?.docStatus;
	const readOnly = seededStatus !== undefined && !isAdjustmentEditable(seededStatus);

	// The item-model master — the ONE shared SKU-directory cache (see
	// `shared/hooks/use-mro-item-models`), cached for the master freshness window.
	const models = useMroItemModels();

	// The reporter — the current logged-in employee, resolved once (auto-prefill).
	const [reporter, setReporter] = useState<ReporterState | null>(null);
	const [reporterLoading, setReporterLoading] = useState(true);
	const [reporterError, setReporterError] = useState<string | null>(null);
	const resolveReporter = async () => {
		setReporterLoading(true);
		setReporterError(null);
		try {
			const me = await fetchCurrentEmployee();
			setReporter(me ? { id: me.id, name: me.name } : null);
			if (!me) setReporterError('No employee account is linked to this session — ask your admin to link it.');
		} catch (err) {
			console.error('[adjustments] current-employee resolve failed', err);
			setReporterError(err instanceof Error && err.message ? err.message : "Couldn't resolve your account.");
		} finally {
			setReporterLoading(false);
		}
	};
	const reporterFired = useRef(false);
	useEffect(() => {
		// An EDIT never re-states the reporter — it is an engine-bound `actor_fields`
		// column the update payload cannot carry at all (see `UpdateAdjustmentDraft`) —
		// so resolving the session employee there would be a request with no reader.
		if (seed || reporterFired.current) return;
		reporterFired.current = true;
		void resolveReporter();
	}, []);

	// Header fields — the correction date defaults to today in MMT, and an EDIT seed
	// replaces that default with the document's own values, so the form opens on the
	// correction it was asked to show rather than on a blank one.
	const [adjustmentDate, setAdjustmentDate] = useState<Date | undefined>(() => parseDateInput(seed?.adjustmentDate ?? todayMmtDate()));
	const [location, setLocation] = useState<MroLocation>(seed?.location ?? 'main_store');
	const [locationOpen, setLocationOpen] = useState(false);
	const [description, setDescription] = useState(seed?.description ?? '');

	// The dynamic lines editor — seeded from an EXISTING document when there is one,
	// else one blank row. An edit starts the key counter ABOVE the seeded rows so a
	// row added later can never collide with a seeded key (which would make two rows
	// share one identity).
	const nextLineKey = useRef((seed?.lines.length ?? 0) + 1);
	const newLine = (): LineEditorRow => ({
		key: nextLineKey.current++,
		modelId: null,
		direction: 'add',
		qty: '',
		batchNo: '',
		expiryDate: '',
		serialsText: '',
		unitCost: null,
	});
	const [lines, setLines] = useState<LineEditorRow[]>(() => (seed && seed.lines.length > 0 ? seed.lines.map(lineRowOf) : [newLine()]));
	const [pickerFor, setPickerFor] = useState<number | null>(null);
	const [modelQuery, setModelQuery] = useState('');

	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();
	// EVERY interactive control's disabled condition — one expression, so a field can
	// never be forgotten in read-only mode (the mode is a property of the document,
	// not of a handful of inputs).
	const locked = submitting || readOnly;

	const modelById = useMemo(() => new Map((models.data ?? []).map((model) => [model.id, model])), [models.data]);
	const modelOf = (line: LineEditorRow): MroItemModelDirectoryRow | undefined => (line.modelId ? modelById.get(line.modelId) : undefined);

	/** The picker's candidates — shared client-side name/group/tracking match over
	 *  the cached directory (no per-keystroke request). */
	const modelCandidates = useMemo(() => filterMroItemModels(models.data ?? [], modelQuery), [models.data, modelQuery]);
	// The picker stays blank until the term is long enough — no directory dump on open.
	const pickerReady = modelQuery.trim().length >= SEARCH_MIN_CHARS;

	/**
	 * A row's tracking policy — the DIRECTORY's answer when it has the SKU, else the
	 * policy the STORED line was captured under. The fallback is what keeps an edit's
	 * serial row (and its unit list) on screen before the master read lands; it
	 * cannot mislabel a fresh row, because those carry no stored policy.
	 */
	const lineTracking = (line: LineEditorRow): MroTracking => {
		const model = modelOf(line);
		return model ? trackingOf(model) : (line.tracking ?? 'standard');
	};

	/** A serial line's typed serials must exactly match its (integer) qty. */
	const serialCountMatches = (line: LineEditorRow): boolean => {
		const qty = positiveQty(line.qty);
		if (qty === null) return false;
		return serialsListOf(line.serialsText).length === qty;
	};

	/**
	 * A row is complete when it can become a submit-payload row.
	 *
	 * A batch ADD additionally needs its lot number HERE, not at the server: the
	 * confirm service refuses `adding batch stock needs a batch_no` with a 400, and a
	 * draft that can never be authorized is a trap the form can see coming. Same rule,
	 * enforced earlier — where the operator can still fix it.
	 */
	const isValidLine = (line: LineEditorRow): boolean => {
		if (line.modelId === null) return false;
		const tracking = lineTracking(line);
		// A serial model can only be REMOVED through an adjustment (the engine
		// refuses serial ADDs — receiving units goes via an inbound).
		if (tracking === 'serial' && line.direction !== 'remove') return false;
		if (positiveQty(line.qty) === null) return false;
		if (tracking === 'serial') return serialCountMatches(line);
		if (tracking === 'batch' && line.direction === 'add' && line.batchNo.trim() === '') return false;
		return true;
	};
	/** A row is blank when nothing was filled in yet (skipped by the payload). */
	const isBlankLine = (line: LineEditorRow): boolean =>
		line.modelId === null &&
		line.qty.trim() === '' &&
		line.batchNo.trim() === '' &&
		line.expiryDate.trim() === '' &&
		line.serialsText.trim() === '';

	const completeLines = lines.filter(isValidLine);
	const hasIncompleteLine = lines.some((line) => !isBlankLine(line) && !isValidLine(line));
	// "Add another" must not stack empty rows: the last line has to be filled (or
	// partially typed) before another can be added. Removing a line is always
	// available, so this can never trap the user with an unfillable row.
	const lastLineBlank = lines.length > 0 && isBlankLine(lines[lines.length - 1]);
	const totalQty = lines.reduce((sum, line) => sum + Math.max(0, positiveQty(line.qty) ?? 0), 0);

	// An EDIT needs no reporter resolved: the document already HAS one, and the engine
	// will not let this form speak for it — so requiring the session employee here
	// would block an edit for a reason that has nothing to do with the document.
	const reporterReady = seed !== undefined || reporter !== null;
	const canSubmit = !submitting && reporterReady && completeLines.length > 0 && !hasIncompleteLine;

	const addLine = () => {
		hapticImpact('light');
		setLines((current) => [...current, newLine()]);
	};

	const removeLine = (key: number) => {
		hapticImpact('light');
		setLines((current) => current.filter((line) => line.key !== key));
	};

	const patchLine = (key: number, patch: Partial<LineEditorRow>) => {
		setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
	};

	const openPicker = (key: number) => {
		hapticImpact('light');
		setModelQuery('');
		setPickerFor(key);
	};

	/**
	 * Switch a row's direction — and CLEAR its lot identity when it becomes a
	 * `remove`. A removal draws FEFO (the confirm never reads `batch_no` on one), so a
	 * value left behind would be a lot the engine ignores, that the operator can no
	 * longer see once the field has gone, and that the payload would still carry: the
	 * row would claim a lot the stock ledger never took.
	 */
	const setDirection = (key: number, direction: Direction) => {
		hapticImpact('light');
		setLines((current) =>
			current.map((line) =>
				line.key === key ? (direction === 'add' ? { ...line, direction } : { ...line, direction, batchNo: '', expiryDate: '' }) : line,
			),
		);
	};

	const pickModel = (key: number, modelId: string) => {
		hapticImpact('light');
		// A new model resets everything that described the OLD one: the
		// tracking-dependent fields (batch no / expiry / serials), the stored cost, and
		// the stored line's name + policy — a row the operator has just re-pointed is
		// no longer the stored line, so keeping its old identity would let a stale
		// fallback (or a stale cost) answer for the new SKU.
		setLines((current) =>
			current.map((line) =>
				line.key === key
					? { ...line, modelId, modelName: null, tracking: null, batchNo: '', expiryDate: '', serialsText: '', unitCost: null }
					: line,
			),
		);
		setPickerFor(null);
	};

	const submit = async () => {
		// A create IS the report's author, so it needs the resolved reporter; an edit
		// never sends one (the payload cannot express it, see `UpdateAdjustmentDraft`),
		// so it must not wait on the session employee to exist.
		if (!canSubmit || !submitGuard.begin()) return;
		if (seed === undefined && reporter === null) return;
		hapticImpact('medium');
		setSubmitting(true);
		setError(null);
		// Exactly one ready-to-send lines[] builds the nested body (blank/partial
		// rows never reach the payload — the canSubmit gate already excludes them).
		const readyLines = lines.filter(isValidLine).flatMap((line): AdjustmentLineDraft[] => {
			const qty = positiveQty(line.qty);
			// The row's OWN id is enough — the directory only NAMES the SKU. The fallback
			// matters on an edit: a SKU missing from the cached directory must still be saved
			// as it was, because dropping the line would silently delete stock from the
			// document (the same rule the stock-move form states).
			const modelId = modelOf(line)?.id ?? line.modelId;
			if (!modelId || qty === null) return [];
			const tracking = lineTracking(line);
			// The lot identity belongs to an ADD only — a removal allocates FEFO and the
			// confirm ignores these two columns on it. Sending them would store a lot
			// number the stock ledger never honoured.
			const namesLot = tracking === 'batch' && line.direction === 'add';
			return [
				{
					item_model: modelId,
					direction: line.direction,
					qty,
					...(namesLot && line.batchNo.trim() ? { batch_no: line.batchNo.trim() } : {}),
					...(namesLot && line.expiryDate.trim() ? { expiry_date: line.expiryDate.trim() } : {}),
					...(tracking === 'serial' ? { serials: serialsListOf(line.serialsText) } : {}),
					// The stored cost is RE-STATED, never edited: the child table is REPLACED by
					// this payload, so a column the form does not collect would otherwise
					// vanish from the row on every save.
					...(line.unitCost != null ? { unit_cost: line.unitCost } : {}),
				},
			];
		});
		const header = {
			location,
			adjustment_date: adjustmentDate ? dateToInputValue(adjustmentDate) : todayMmtDate(),
			lines: readyLines,
		};
		try {
			// Same form, same shape — only the verb differs. An EDIT states `description`
			// outright (so it can be EMPTIED) and never `reported_by` (the report's author
			// is history the payload cannot express).
			if (seed) {
				const payload: UpdateAdjustmentDraft = { ...header, description: description.trim() || null };
				await updateAdjustmentDoc(seed.id, payload);
			} else {
				if (reporter === null) throw new Error('No employee account is linked to this session.');
				const payload: CreateAdjustmentDraft = {
					...header,
					...(description.trim() ? { description: description.trim() } : {}),
					reported_by: reporter.id,
				};
				await createAdjustmentDoc(payload);
			}
			onDone();
		} catch (err) {
			// Engine validation (e.g. a nested `lines` rule) surfaces its message
			// inline — the form stays open with the user's rows intact for a retry.
			console.error('[adjustments] save failed', err);
			setError(err instanceof Error && err.message ? err.message : "Couldn't save the record. Please try again.");
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
		visible: !readOnly && !locationOpen && pickerFor === null,
		disabled: !canSubmit,
		loading: submitting,
	});

	// WHY nothing can be changed — stated once, in the document's own words (the
	// status pill's label), because a form of dead inputs without a reason reads as a
	// broken screen rather than a settled document. A CANCELLED draft was never
	// applied, so the two cases say different things.
	// WHY nothing can be changed is NOT stated here: the document page's status pill IS
	// that statement (`Confirmed` / `Cancelled`). A second sentence under the pill — or in
	// this form — would print the same fact twice, in two voices free to drift apart.

	return (
		<div className="flex flex-1 flex-col gap-3 pt-2">
			{/* 1 — Date — the DS DatePicker, defaulted to today (MMT). */}
			<section>
				<FormField label="Adjustment date" required group>
					{() => (
						<DatePicker
							value={adjustmentDate}
							onValueChange={setAdjustmentDate}
							placeholder="Select a date"
							format={APP_DATE_FORMAT}
							disabled={locked}
							className={fieldClass}
						/>
					)}
				</FormField>
			</section>

			{/* 2 — Store — the location whose stock is corrected (bottom-sheet). */}
			<section>
				<FormField label="Store" required>
					{(f) => (
						<Button
							{...f}
							type="button"
							variant="outline"
							disabled={locked}
							onClick={() => {
								hapticImpact('light');
								setLocationOpen(true);
							}}
							className={`${fieldClass} justify-between font-normal`}
						>
							<span className="flex min-w-0 items-center gap-2">
								<Store strokeWidth={1.6} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
								<span className="truncate text-foreground">{MRO_LOCATION_LABELS[location]}</span>
							</span>
							<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
						</Button>
					)}
				</FormField>

				<Sheet open={locationOpen && !readOnly} onOpenChange={setLocationOpen}>
					<SheetContent side="bottom">
						<SheetHeader className="pb-1">
							<SheetTitle>Select store</SheetTitle>
						</SheetHeader>
						<div className="flex flex-col gap-0.5 px-4 pb-safe">
							{MRO_LOCATIONS.map((option) => {
								const selected = option.value === location;
								return (
									<button
										key={option.value}
										type="button"
										onClick={() => {
											hapticImpact('light');
											setLocation(option.value);
											setLocationOpen(false);
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

			{/* 3 — The dynamic LINES editor — one row per SKU to add/remove. */}
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
							<span className="text-xs font-bold tabular-nums leading-myanmar text-foreground">{String(totalQty)}</span>
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
							Add another
						</button>
					)}
				</div>

				{lines.length > 0 ? (
					<ul className="flex flex-col gap-2.5">
						{lines.map((line, index) => {
							const model = modelOf(line);
							const tracking = lineTracking(line);
							// A serial item is only removable through an adjustment.
							const serialAddBlocked = tracking === 'serial' && line.direction !== 'remove';
							const isSerialRemoval = tracking === 'serial' && line.direction === 'remove';
							const typedSerials = serialsListOf(line.serialsText).length;
							const qty = positiveQty(line.qty);
							const serialCountMismatch = isSerialRemoval && qty !== null && typedSerials !== qty;
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
										<span className={`min-w-0 flex-1 truncate ${model ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
											{mroItemLineLabel({ model, storedName: line.modelName, modelId: line.modelId })}
										</span>
										<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
									</button>

									{/* Direction (Add/Remove) segmented control. */}
									<div className="mt-2">
										<span className="mb-1 block text-meta font-semibold leading-myanmar text-muted-foreground">Direction</span>
										<div
											role="group"
											aria-label="Direction"
											className="grid grid-cols-2 gap-1.5 rounded-xl border border-border bg-background p-1"
										>
											{(['add', 'remove'] as const).map((d) => {
												const active = line.direction === d;
												return (
													<button
														key={d}
														type="button"
														disabled={locked}
														onClick={() => setDirection(line.key, d)}
														aria-pressed={active}
														className={`flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold capitalize leading-myanmar transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
															active ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground hover:bg-muted/60'
														}`}
													>
														{d === 'add' ? (
															<ArrowUpFromLine className="size-3.5" strokeWidth={2.2} aria-hidden />
														) : (
															<ArrowDownToLine className="size-3.5" strokeWidth={2.2} aria-hidden />
														)}
														{d}
													</button>
												);
											})}
										</div>
									</div>

									{/* Quantity — positive integer. */}
									<div className="mt-2">
										<Input
											type="number"
											min={1}
											step={1}
											inputMode="numeric"
											value={line.qty}
											onChange={(event) => patchLine(line.key, { qty: event.target.value })}
											placeholder="Quantity"
											disabled={locked}
											aria-label="Quantity"
											className="h-10 rounded-lg px-3"
										/>
									</div>

									{/* A serial item chosen as an ADD is invalid — serial ADDs go via an inbound. */}
									{serialAddBlocked && (
										<p className="mt-1.5 text-meta font-medium leading-myanmar text-status-warning">
											Serial items can only be removed through an adjustment — receive new units via an inbound instead.
										</p>
									)}

									{/* Batch models on an ADD — the lot this line CREATES. Required, and
									    enforced up front by `isValidLine` because the confirm refuses an add
									    with no batch_no. A REMOVE takes FEFO and the server records the lots it
									    actually drew from in `mro_adjustment_lots`, so it has no lot of its
									    own to name and the whole block is ABSENT there: the engine ignores
									    these columns on a removal, so offering them could only mislead. */}
									{tracking === 'batch' && line.direction === 'add' && (
										<div className="mt-2 grid grid-cols-2 gap-2">
											<div>
												<label htmlFor={`line-${line.key}-batch`} className={`${labelClass} mb-1`}>
													Batch No
												</label>
												<Input
													id={`line-${line.key}-batch`}
													value={line.batchNo}
													onChange={(event) => patchLine(line.key, { batchNo: event.target.value })}
													placeholder="Required — the lot this add creates"
													disabled={locked}
													autoCapitalize="characters"
													className="h-10 rounded-lg px-3"
												/>
											</div>
											<div className="min-w-0">
												<label htmlFor={`line-${line.key}-expiry`} className={`${labelClass} mb-1`}>
													Expiry
												</label>
												<DateField
													value={line.expiryDate}
													onChange={(next) => patchLine(line.key, { expiryDate: next })}
													disabled={locked}
													ariaLabel="Batch expiry date"
													className="h-10 w-full rounded-lg px-3"
												/>
											</div>
										</div>
									)}

									{/* Serial models being removed — the exact units, comma-separated. */}
									{isSerialRemoval && (
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
													Serial count ({typedSerials}) must match quantity ({qty}).
												</p>
											) : (
												<p className="mt-1 text-meta leading-myanmar text-muted-foreground">
													Only in-stock serials of this item may be removed — separated by commas, the count must match the quantity.
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
						Add at least one item.
					</p>
				)}
			</section>

			{/* 4 — Description — a free-text reason for the correction. */}
			<section>
				<label htmlFor="adjustment-description" className={labelClass}>
					Description
				</label>
				<Textarea
					id="adjustment-description"
					value={description}
					onChange={(event) => setDescription(event.target.value)}
					placeholder="Why is this stock being corrected? (optional)"
					rows={3}
					disabled={locked}
					className="rounded-lg bg-card px-3 text-sm leading-myanmar"
				/>
			</section>

			{/* 5 — Reported by — the current employee, auto-resolved + read-only. ABSENT on
			    an EDIT: the document already HAS a reporter, and the update payload cannot
			    re-state one (see `UpdateAdjustmentDraft`), so naming the current user here
			    would claim they filed somebody else's report. A document's reporter and
			    approver are read off the list card. */}
			{seed === undefined && (
				<section>
					<FormField label="Reported by" required>
						{(f) => (
							<Button
								{...f}
								type="button"
								variant="outline"
								disabled
								className={`${fieldClass} justify-between bg-background font-normal opacity-100`}
							>
								<span className="flex min-w-0 items-center gap-2">
									<User strokeWidth={1.6} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
									<span className="truncate text-foreground">
										{reporterLoading ? 'Loading your account…' : reporter ? `${reporter.name || reporter.id} (you)` : '—'}
									</span>
								</span>
								{reporterLoading || reporter === null ? null : <Check className="size-4 shrink-0 text-primary" aria-hidden />}
							</Button>
						)}
					</FormField>
					<p className="mt-1.5 text-meta leading-myanmar text-muted-foreground">
						You report the correction — a different employee must authorize it before stock moves.
					</p>
				</section>
			)}

			{/* Local validation hint — a row was started but left incomplete. */}
			{hasIncompleteLine && (
				<p className="rounded-md bg-status-warning-soft px-3 py-2 text-xs font-medium leading-myanmar text-status-warning">
					Amendment required — a line was started but left incomplete. Pick an item + a direction and quantity (a serial removal needs a
					matching serial count), or remove the line.
				</p>
			)}

			{/* Meta errors render inline. */}
			{(reporterError || error) && (
				<div className="flex flex-col gap-2">
					{reporterError && (
						<div className="flex items-center justify-between gap-2 rounded-md bg-status-danger-soft px-3 py-2 text-xs font-medium leading-myanmar text-status-danger">
							<span>{reporterError}</span>
							{reporter === null && (
								<button
									type="button"
									onClick={() => void resolveReporter()}
									className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-meta font-semibold leading-myanmar text-primary-foreground"
								>
									Retry
								</button>
							)}
						</div>
					)}
					{error && (
						<p className="rounded-md bg-status-danger-soft px-3 py-2 text-xs font-medium leading-myanmar text-status-danger">{error}</p>
					)}
				</div>
			)}

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
				carries the key of the row it is filling. */}
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
							<p className="px-3 py-8 text-center text-sm leading-myanmar text-muted-foreground">No item found</p>
						)}
					</ScrollArea>
				</SheetContent>
			</Sheet>
		</div>
	);
}
