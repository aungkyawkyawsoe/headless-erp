import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DENSE_CARD_FRAME } from '@/shared/components/card';
import { FIELD_LABEL_CLASS as labelClass, FIELD_CLASS as fieldClass } from '@/shared/components/form-styles';
import { Check, ChevronDown, Minus, Plus, Trash2, Truck, X } from 'lucide-react';
import { ScrollArea } from '@mmbix/design-system/scroll-area';
import { SearchBox } from '@mmbix/design-system/search-box';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';
import { Textarea } from '@mmbix/design-system/textarea';
import { DatePicker } from '@mmbix/design-system/datepicker';

import { useVehicleMasters } from '@/shared/lookups/hooks';
import { ConfirmSheet } from '@/shared/components/confirm-sheet';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import { FormField } from '@/shared/components/form-field';
import { RequiredMark } from '@/shared/components/required-mark';
import { useSubmitGuard } from '@/shared/components/form-state';
import { VehiclePickerSheet } from '@/shared/components/vehicle-picker-sheet';
import { mroStockIndexOf } from '@/shared/mro';
import type { MroLocation } from '@/shared/mro';
import {
	useMroItemModels,
	filterMroItemModels,
	mroItemModelLabel,
	type MroItemModelDirectoryRow,
} from '@/shared/hooks/use-mro-item-models';
import { SEARCH_MIN_CHARS } from '@/shared/constants';
import { useOnHandReport } from '@/shared/hooks/use-on-hand-report';
import { PickerSearchHint } from '@/shared/components/picker-search-hint';
import { hapticImpact } from '@/shared/platform/haptics';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';
import { APP_DATE_FORMAT, todayMmtDate } from '@/shared/time/myanmar';

/** Calendar `Date` → `YYYY-MM-DD` (local calendar date — no TZ shifting). */
export function dateToInputValue(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` → local calendar `Date` — the inverse of `dateToInputValue`. */
export function parseDateInput(value: string): Date | undefined {
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

/** "1,200" / "1,200.5" — count display, no trailing zeros. */
function formatQty(value: number | null): string {
	if (value == null || !Number.isFinite(value)) return '—';
	return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** One row of the dynamic lines editor. */
interface LineDraft {
	/** Local identity — stable across removals (unlike the array index). */
	key: number;
	/** The chosen `mro_item_model` id — null until the combobox picks one. */
	itemModelId: string | null;
	/** The raw qty input (parsed on submit / for the running total). */
	qty: string;
}

/** The item picker's target — an existing line's key, or `'new'` when the
 *  header's “Add item” opened it. A `'new'` pick appends the line only once a SKU
 *  is chosen, so dismissing the sheet never leaves an empty row behind. */
type ItemPickerTarget = number | 'new';

/** The catalog scope a deep link may pre-open the request with. `tyre` = the
 *  serial-tracked register; `equipment` = everything else (loose tools/gear). */
export type RequestScope = 'tyre' | 'equipment';

/** The form's OWN value shape — header + lines, WITHOUT the requester/workflow
 *  columns. `create` maps it onto `CreateRequisitionInput`; `edit` onto
 *  `UpdateRequisitionInput`, so the two write paths stay structurally separate. */
export interface RequisitionFormValue {
	request_date: string;
	location: MroLocation;
	vehicle?: string;
	note: string;
	lines: Array<{ item_model: string; qty: number }>;
}

/** Pre-fill for the form (edit mode) — the existing header + line values. */
export interface RequisitionFormInitial {
	requestDate: string;
	note: string;
	vehicleId: string | null;
	lines: Array<{ itemModelId: string; qty: number }>;
}

/** ONE line's item TRIGGER — plain small TEXT (the chosen SKU's name) that re-opens
 *  the shared searchable "Select item" bottom sheet. No icon and no badge: the row
 *  already sits inside a card, so only the qty stepper beside it carries chrome. The
 *  name WRAPS (a tyre/part name is routinely longer than one phone line, and
 *  truncating it hides which item was picked). The `Add item` state is a recovery
 *  path only — a line is normally created FROM the picker, already carrying its SKU. */
function LineItemButton({
	model,
	disabled = false,
	onOpen,
}: {
	model: MroItemModelDirectoryRow | null;
	disabled?: boolean;
	onOpen: () => void;
}) {
	const label = model ? mroItemModelLabel(model) : null;
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onOpen}
			aria-label={label ? `Change item — ${label}` : 'Add item'}
			className="flex min-w-0 w-full items-start rounded-lg py-1 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
		>
			{/* No `truncate`: the name wraps to as many lines as it needs. */}
			<span className={`min-w-0 flex-1 text-xs leading-snug font-medium ${label ? 'text-foreground' : 'text-primary'}`}>
				{label ?? 'Add item'}
			</span>
		</button>
	);
}

/** The per-line quantity control — collapsed to a round “count” avatar (the bare
 *  number, no label) until tapped, then it expands into a stepper with a
 *  typeable middle field. The leading control is a TRASH at qty 1 (removes the
 *  line) and a − MINUS above it; the trailing + is unbounded (a requisition is a
 *  REQUEST — asking for more than the store currently holds is legitimate, the
 *  store procures or partially issues). Qty is the lighter half of the line: the
 *  compact avatar never pushes the item selector off the row, and typing stays
 *  optional (pick an item and the qty defaults to 1). */
function QtyField({
	open,
	value,
	disabled = false,
	onOpenChange,
	onChange,
	onRemove,
}: {
	open: boolean;
	value: string;
	disabled?: boolean;
	onOpenChange: (open: boolean) => void;
	onChange: (raw: string) => void;
	/** Called when the qty becomes < 1 — the row's removal gesture. */
	onRemove: () => void;
}) {
	const wrapRef = useRef<HTMLDivElement | null>(null);
	const amount = qtyOf(value) ?? 0;
	const count = amount > 0 ? amount : 0;

	/** Keep the middle field numeric-only — digits with a single decimal point.
	 *  A blank field is a mid-edit state (backspacing to retype) and keeps the row;
	 *  any committed value below 1 removes the line instead of clamping to 0. */
	const sanitize = (raw: string) => {
		if (!/^\d*\.?\d*$/.test(raw)) return;
		if (raw.trim() === '') {
			onChange(raw);
			return;
		}
		const next = qtyOf(raw);
		if (next === null) return; // a stray `.` — not yet a number
		if (next < 1) {
			onRemove();
			return;
		}
		onChange(raw);
	};

	/** Nudge the qty up by one whole unit (the trailing + button). */
	const increment = () => {
		onChange(String((qtyOf(value) ?? 0) + 1));
	};

	/** Step the qty down by one whole unit (the leading − button, shown once the
	 *  count is above 1; at 1 the control becomes the remove/trash button). */
	const decrement = () => {
		const next = (qtyOf(value) ?? 0) - 1;
		if (next < 1) {
			onRemove();
			return;
		}
		onChange(String(next));
	};

	// A tap ANYWHERE outside the stepper collapses it (another row's control, the
	// item text, the page background). The `onBlur` below only covers keyboard/tab
	// focus: tapping the collapsed avatar UNMOUNTS the button that held focus, so no
	// blur ever fires for a pointer user and the stepper would otherwise stay open.
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) onOpenChange(false);
		};
		document.addEventListener('pointerdown', onPointerDown);
		return () => document.removeEventListener('pointerdown', onPointerDown);
	}, [open, onOpenChange]);

	if (!open) {
		const has = count > 0;
		return (
			<button
				type="button"
				disabled={disabled}
				onClick={() => onOpenChange(true)}
				aria-label={has ? `Quantity — ${count}, tap to change` : 'Quantity — tap to set'}
				className={`flex size-10 shrink-0 items-center justify-center rounded-full border transition-transform duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:opacity-40 ${
					has ? 'border-primary/25 bg-primary/10 text-primary' : 'border-border/80 bg-muted/30 text-muted-foreground'
				}`}
			>
				<span className="text-sm leading-none font-extrabold tabular-nums">{has ? count : 0}</span>
			</button>
		);
	}

	return (
		<div
			ref={wrapRef}
			role="group"
			aria-label="Quantity stepper"
			onBlur={(event) => {
				// Keyboard/tab-out dismissal — a POINTER tap outside is caught by the
				// document listener above (see the note there).
				if (wrapRef.current && !wrapRef.current.contains(event.relatedTarget as Node | null)) onOpenChange(false);
			}}
			className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-card p-1 shadow-sm"
		>
			<button
				type="button"
				disabled={disabled}
				onClick={count <= 1 ? onRemove : decrement}
				aria-label={count <= 1 ? 'Remove line' : 'Decrease quantity'}
				className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted/60 text-foreground transition-transform duration-150 active:scale-95 disabled:opacity-35 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				{count <= 1 ? <Trash2 className="size-4" aria-hidden /> : <Minus className="size-4" aria-hidden />}
			</button>
			<input
				value={value}
				onChange={(event) => sanitize(event.target.value)}
				onFocus={(event) => event.target.select()}
				inputMode="decimal"
				placeholder="0"
				disabled={disabled}
				aria-label="Quantity"
				className="h-8 w-11 rounded-md bg-transparent text-center text-sm leading-none font-extrabold tabular-nums text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-40"
			/>
			<button
				type="button"
				disabled={disabled}
				onClick={increment}
				aria-label="Increase quantity"
				className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-150 active:scale-95 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<Plus className="size-4" aria-hidden />
			</button>
		</div>
	);
}

/** The store a new request is filed against when the caller passes none. The
 *  requester no longer picks a store — a request is filed against the MAIN store,
 *  which is also the store the availability hint is read from. `location` is a
 *  REQUIRED engine column and it is what the detail page issues the stock from. */
export const DEFAULT_STORE: MroLocation = 'main_store';

/**
 * A guard WARNING the caller detected for a value about to be submitted — the
 * engine is willing to accept the write, but only after the user confirms. The
 * form shows `message` verbatim and re-submits with `ack` when confirmed, so the
 * warning text and the token both stay server-owned.
 */
export interface RequisitionWarning {
	message: string;
	ack: string;
}

interface RequisitionFormProps {
	/** `create` submits “Submit for approval”; `edit` submits “Update request”. */
	mode: 'create' | 'edit';
	/** Pre-fill (edit mode) — the existing header + line values. */
	initial?: RequisitionFormInitial;
	/** A one-shot catalog scope (create deep link). Null = the whole directory. */
	scope?: RequestScope | null;
	/** A truck bound by a deep link — hides the picker and submits it silently. */
	boundVehicleId?: string | null;
	/** The store the availability hint is read from — defaults to `DEFAULT_STORE`
	 *  (create); edit passes the request's own store. */
	store?: MroLocation;
	/**
	 * Optional pre-flight for the value about to be filed: return a warning to
	 * hold the submit behind a confirmation, `null` to proceed. The caller owns it
	 * because the check needs the RESOLVED requester (the create page's session
	 * employee) — the form only renders the decision.
	 */
	onPreflight?: (value: RequisitionFormValue) => Promise<RequisitionWarning | null>;
	/** Persist the value. `ack` confirms a warning `onPreflight` reported. Throw
	 *  to keep the form open with the message inline. */
	onSubmit: (value: RequisitionFormValue, options?: { ack?: string }) => Promise<void>;
}

/**
 * The MRO requisition form — ONE implementation shared by the create page and the
 * detail page's amend view. It owns the header fields (date / vehicle / note), the
 * dynamic LINES editor and the shared “Select item” picker sheet, and renders the
 * native MainButton on Android/Desktop. It does NOT own persistence: `onSubmit`
 * receives the value and the caller maps it onto create vs update and navigates.
 */
export function RequisitionForm({
	mode,
	initial,
	scope = null,
	boundVehicleId = null,
	store = DEFAULT_STORE,
	onPreflight,
	onSubmit,
}: RequisitionFormProps) {
	const models = useMroItemModels();
	const onHand = useOnHandReport();
	const vehicles = useVehicleMasters();

	const vehicleOptions = useMemo(
		() =>
			(vehicles.data ?? [])
				.filter((vehicle) => vehicle.plate_no?.trim())
				.sort((a, b) => (a.plate_no as string).localeCompare(b.plate_no as string)),
		[vehicles.data],
	);
	const vehicleById = useMemo(() => new Map(vehicleOptions.map((vehicle) => [vehicle.id, vehicle.plate_no as string])), [vehicleOptions]);

	// Header fields — create defaults the date to today in MMT; edit uses the row's.
	const [requestDate, setRequestDate] = useState<Date | undefined>(() =>
		initial ? parseDateInput(initial.requestDate) : parseDateInput(todayMmtDate()),
	);
	const [note, setNote] = useState(initial?.note ?? '');
	const [vehicleId, setVehicleId] = useState<string | null>(() => boundVehicleId ?? initial?.vehicleId ?? null);
	const [vehicleOpen, setVehicleOpen] = useState(false);

	// A deep-linked `?vehicle=` can't be validated until the fleet directory has
	// loaded — once it has, drop a stale prefill so a request is never bound to
	// an unknown truck (the user clearing the field is never re-applied).
	const prefillApplied = useRef(false);
	useEffect(() => {
		if (prefillApplied.current || !boundVehicleId || vehicles.isPending) return;
		prefillApplied.current = true;
		if (!vehicleById.has(boundVehicleId)) {
			setVehicleId((current) => (current === boundVehicleId ? null : current));
		}
	}, [boundVehicleId, vehicles.isPending, vehicleById]);

	// The dynamic lines editor — a row exists only once its SKU is picked.
	const nextLineKey = useRef(1);
	const newLine = (): LineDraft => ({ key: nextLineKey.current++, itemModelId: null, qty: '' });
	const [lines, setLines] = useState<LineDraft[]>(() =>
		(initial?.lines ?? []).map((line) => ({ key: nextLineKey.current++, itemModelId: line.itemModelId, qty: String(line.qty) })),
	);
	const [qtyOpenKey, setQtyOpenKey] = useState<number | null>(null);
	const [itemPickerTarget, setItemPickerTarget] = useState<ItemPickerTarget | null>(null);
	const [itemQuery, setItemQuery] = useState('');

	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/**
	 * A guard warning awaiting the user's decision, WITH the value it belongs to —
	 * the form is still being edited while the sheet is up, so the confirmed
	 * submit must file the value that was checked, not whatever is on screen now.
	 */
	const [warning, setWarning] = useState<{ value: RequisitionFormValue; message: string; ack: string } | null>(null);
	const [confirmBusy, setConfirmBusy] = useState(false);
	const [confirmError, setConfirmError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	/** The SKU directory, pre-filtered by a `?scope=` deep link (create only). */
	const modelOptions = useMemo(() => {
		return (models.data ?? []).filter((model) => {
			if (scope === 'tyre') return model.tracking === 'serial';
			if (scope === 'equipment') return model.tracking !== 'serial';
			return true;
		});
	}, [models.data, scope]);
	const modelById = useMemo(() => new Map(modelOptions.map((model) => [model.id, model])), [modelOptions]);

	/** `${model}|${store}` → the issuable qty (derived balance minus expired slice),
	 *  from the ONE shared rule in `@/shared/mro`. */
	const availableByKey = useMemo(() => mroStockIndexOf(onHand.data ?? [], 'available'), [onHand.data]);

	/** The available qty for a SKU at the filing store — null while loading / no SKU. */
	const availableAt = useCallback(
		(modelId: string | null): number | null => {
			if (!modelId || !onHand.data) return null;
			return availableByKey.get(`${modelId}|${store}`) ?? 0;
		},
		[availableByKey, onHand.data, store],
	);

	const scopeHint = scope === 'tyre' ? 'Tyre serials only' : scope === 'equipment' ? 'Tools & equipment only' : null;

	// The picker's gated search — NOTHING is listed until the term is long enough.
	const itemPickerReady = itemQuery.trim().length >= SEARCH_MIN_CHARS;
	const itemCandidates = useMemo(
		() => (itemPickerReady ? filterMroItemModels(modelOptions, itemQuery) : []),
		[itemPickerReady, modelOptions, itemQuery],
	);

	const isValidLine = (line: LineDraft): boolean => line.itemModelId !== null && (qtyOf(line.qty) ?? 0) > 0;
	const isBlankLine = (line: LineDraft): boolean => line.itemModelId === null && line.qty.trim() === '';

	const completeLines = lines.filter(isValidLine);
	const hasIncompleteLine = lines.some((line) => !isBlankLine(line) && !isValidLine(line));

	const canSubmit = !submitting && completeLines.length > 0 && !hasIncompleteLine && note.trim() !== '';

	const addLineWithItem = (itemModelId: string) => {
		hapticImpact('light');
		setLines((current) => [...current, { ...newLine(), itemModelId, qty: '1' }]);
	};

	const removeLine = (key: number) => {
		hapticImpact('light');
		setLines((current) => current.filter((line) => line.key !== key));
		setQtyOpenKey((current) => (current === key ? null : current));
	};

	const setLineQty = (key: number, qty: string) => {
		setLines((current) => current.map((line) => (line.key === key ? { ...line, qty } : line)));
	};

	const setLineModel = (key: number, itemModelId: string) => {
		hapticImpact('light');
		setLines((current) =>
			current.map((line) => (line.key === key ? { ...line, itemModelId, qty: line.qty.trim() === '' ? '1' : line.qty } : line)),
		);
	};

	const openItemPicker = (target: ItemPickerTarget) => {
		hapticImpact('light');
		setItemQuery('');
		setItemPickerTarget(target);
	};

	const chooseItem = (itemModelId: string) => {
		if (itemPickerTarget === 'new') addLineWithItem(itemModelId);
		else if (itemPickerTarget !== null) setLineModel(itemPickerTarget, itemModelId);
		setItemPickerTarget(null);
	};

	/** The value this form is about to file — header + the COMPLETE lines only. */
	const valueOf = (): RequisitionFormValue => ({
		request_date: requestDate ? dateToInputValue(requestDate) : todayMmtDate(),
		location: store,
		...(vehicleId ? { vehicle: vehicleId } : {}),
		note: note.trim(),
		lines: completeLines.map((line) => ({ item_model: line.itemModelId as string, qty: qtyOf(line.qty) as number })),
	});

	const submit = async () => {
		if (!canSubmit || !submitGuard.begin()) return;
		hapticImpact('medium');
		setSubmitting(true);
		setError(null);
		const value = valueOf();
		try {
			// A pre-flight warning is NOT a refusal: hold the value behind a
			// confirmation instead of showing an error, and let the user decide.
			// The submit latch is released while the sheet is open — the decision
			// itself is latched by `confirmBusy`.
			if (onPreflight) {
				const warned = await onPreflight(value);
				if (warned) {
					setWarning({ value, ...warned });
					setConfirmError(null);
					setSubmitting(false);
					submitGuard.end();
					return;
				}
			}
			await onSubmit(value);
		} catch (err) {
			// Engine validation (e.g. a `lines` rule) surfaces its message inline —
			// the form stays open for a retry.
			console.error('[store-requests] submit failed', err);
			setError(err instanceof Error && err.message ? err.message : "Couldn't save this requisition — try again.");
			setSubmitting(false);
			submitGuard.end();
		}
	};

	/** File the warned value anyway — the user has seen the warning and agreed. */
	const confirmWarning = async () => {
		if (!warning || confirmBusy || !submitGuard.begin()) return;
		setConfirmBusy(true);
		setConfirmError(null);
		try {
			await onSubmit(warning.value, { ack: warning.ack });
		} catch (err) {
			// Keep the sheet open on the confirmed value so a retry needs no re-entry.
			console.error('[store-requests] confirmed submit failed', err);
			setConfirmError(err instanceof Error && err.message ? err.message : "Couldn't save this requisition — try again.");
			setConfirmBusy(false);
			submitGuard.end();
		}
	};

	const isMainButton = useTelegramMainButton({
		text: submitting ? 'Saving…' : mode === 'create' ? 'Submit for approval' : 'Update request',
		onClick: () => void submit(),
		// A bottom sheet (vehicle / item picker / the warning) owns the affordance
		// while it is up — the native button would otherwise submit behind it.
		visible: !vehicleOpen && itemPickerTarget === null && warning === null,
		disabled: !canSubmit,
		loading: submitting,
	});

	return (
		<div className="flex flex-1 flex-col gap-5 pt-2">
			{/* 1 — Request date. */}
			<section>
				<FormField label="Select date" required group>
					{() => (
						<DatePicker
							value={requestDate}
							onValueChange={setRequestDate}
							placeholder="Select date"
							format={APP_DATE_FORMAT}
							disabled={submitting}
							className={fieldClass}
						/>
					)}
				</FormField>
			</section>

			{/* 2 — For vehicle (plate) — hidden when a deep link already bound one. */}
			{!boundVehicleId && (
				<section>
					<FormField label="For vehicle (plate)">
						{(f) => (
							<div className="flex items-center gap-2">
								<button
									{...f}
									type="button"
									disabled={submitting}
									onClick={() => {
										hapticImpact('light');
										setVehicleOpen(true);
									}}
									className={`flex w-full items-center justify-between gap-2 ${fieldClass} text-left`}
								>
									{vehicleId ? (
										<span className="flex min-w-0 items-center gap-2">
											<Truck strokeWidth={1.6} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
											<span className="truncate text-foreground">{vehicleById.get(vehicleId) ?? vehicleId}</span>
										</span>
									) : (
										<span className="flex min-w-0 items-center gap-2">
											<Truck strokeWidth={1.6} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
											<span className="truncate text-muted-foreground">No vehicle</span>
										</span>
									)}
									<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
								</button>
								{vehicleId && (
									<button
										type="button"
										disabled={submitting}
										aria-label="Clear vehicle"
										onClick={() => {
											hapticImpact('light');
											setVehicleId(null);
										}}
										className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-transform duration-150 active:scale-95 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<X className="size-4" strokeWidth={1.8} aria-hidden />
									</button>
								)}
							</div>
						)}
					</FormField>

					<VehiclePickerSheet
						open={vehicleOpen}
						onOpenChange={setVehicleOpen}
						selectedId={vehicleId}
						onSelect={(id) => {
							hapticImpact('light');
							setVehicleId(id);
							setVehicleOpen(false);
						}}
					/>
				</section>
			)}

			{/* 3 — Note (required). */}
			<section>
				<label htmlFor="requisition-note" className={labelClass}>
					Note
					<RequiredMark />
				</label>
				<Textarea
					id="requisition-note"
					value={note}
					onChange={(event) => setNote(event.target.value)}
					placeholder="Add a note"
					rows={3}
					disabled={submitting}
					className="rounded-lg bg-card px-3 text-sm leading-myanmar"
				/>
			</section>

			{/* 4 — The dynamic LINES editor. */}
			<section>
				<div className="mb-2 flex items-center justify-between gap-2">
					<p className={`${labelClass} mb-0`}>
						Items
						<RequiredMark />
					</p>
					<button
						type="button"
						disabled={submitting}
						onClick={() => openItemPicker('new')}
						className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<Plus className="size-3.5" strokeWidth={2.2} aria-hidden />
						Add item
					</button>
				</div>

				{scopeHint && <p className="mb-2 text-meta leading-none font-semibold text-muted-foreground">{scopeHint}</p>}

				{lines.length > 0 ? (
					<ul className="flex flex-col gap-2.5">
						{lines.map((line) => (
							<li key={line.key} className={`flex items-center gap-2 ${DENSE_CARD_FRAME} p-2.5`}>
								<div className="min-w-0 flex-1">
									<LineItemButton
										model={line.itemModelId ? (modelById.get(line.itemModelId) ?? null) : null}
										disabled={submitting}
										onOpen={() => openItemPicker(line.key)}
									/>
									{(() => {
										const available = availableAt(line.itemModelId);
										if (available == null) return null;
										return (
											<p className="text-[11px] font-medium tabular-nums leading-myanmar text-muted-foreground">
												{available > 0 ? `${formatQty(available)} available` : 'No stock right now'}
											</p>
										);
									})()}
								</div>

								<QtyField
									open={qtyOpenKey === line.key}
									value={line.qty}
									disabled={submitting}
									onOpenChange={(open) => setQtyOpenKey(open ? line.key : null)}
									onChange={(raw) => setLineQty(line.key, raw)}
									onRemove={() => removeLine(line.key)}
								/>
							</li>
						))}
					</ul>
				) : (
					<p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs leading-myanmar text-muted-foreground">
						Add at least one item.
					</p>
				)}
			</section>

			{/* The item-model picker sheet — shared by every line row AND “Add item”. */}
			<Sheet
				open={itemPickerTarget !== null}
				onOpenChange={(open) => {
					if (!open) setItemPickerTarget(null);
				}}
			>
				<SheetContent side="bottom" className="max-h-[85dvh]">
					<SheetHeader className="pb-1">
						<SheetTitle>Select item</SheetTitle>
						<SearchBox
							placeholder="Search item name"
							value={itemQuery}
							onValueChange={setItemQuery}
							className="mt-3"
							inputClassName="h-8.5 text-xs! px-3 rounded-full"
						/>
					</SheetHeader>
					<ScrollArea className="h-[45dvh] px-4 pb-safe">
						{!itemPickerReady ? (
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
						) : itemCandidates.length > 0 ? (
							<ul className="flex flex-col gap-0.5">
								{itemCandidates.map((model) => {
									const selected =
										typeof itemPickerTarget === 'number' && lines.find((line) => line.key === itemPickerTarget)?.itemModelId === model.id;
									const available = availableAt(model.id);
									return (
										<li key={model.id}>
											<button
												type="button"
												onClick={() => chooseItem(model.id)}
												className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
											>
												<span className="min-w-0 flex-1">
													<span className="block truncate text-sm font-medium leading-6.5 text-foreground">{mroItemModelLabel(model)}</span>
													{model.name_mm?.trim() && (
														<span className="block truncate text-xs leading-myanmar text-muted-foreground">{model.name_mm}</span>
													)}
												</span>
												{available != null && (
													<span
														className={`shrink-0 text-[11px] font-semibold tabular-nums leading-myanmar ${
															available === 0 ? 'text-status-warning' : 'text-muted-foreground'
														}`}
													>
														{available > 0 ? `${formatQty(available)} available` : 'No stock'}
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

			{hasIncompleteLine && (
				<p className="rounded-md bg-status-warning-soft px-3 py-2 text-xs font-medium leading-myanmar text-status-warning">
					There are incomplete lines — fill in the item and quantity for every row, or remove the line.
				</p>
			)}

			<FormError error={error} />

			<p className="text-meta leading-myanmar text-muted-foreground">
				{mode === 'create'
					? 'Submitting sends this request to the store for approval — it is not issued until a keeper approves it.'
					: 'Saving updates this request for the store — it stays editable until a keeper approves it.'}
			</p>

			<FormSubmitBar
				label={mode === 'create' ? 'Submit for approval' : 'Update request'}
				isMainButton={isMainButton}
				disabled={!canSubmit}
				submitting={submitting}
				submittingLabel="Saving…"
				onSubmit={() => void submit()}
			/>

			{/* The duplicate warning the pre-flight reported: filing the same basket
			    twice in a day is allowed, but only after the user confirms it — the
			    confirm re-submits the SAME value with the server's ack token. */}
			<ConfirmSheet
				open={warning !== null}
				title="Already requested today?"
				description={warning?.message ?? ''}
				confirmLabel="Submit anyway"
				busy={confirmBusy}
				error={confirmError}
				onConfirm={() => void confirmWarning()}
				onClose={() => {
					setWarning(null);
					setConfirmError(null);
				}}
			/>
		</div>
	);
}
