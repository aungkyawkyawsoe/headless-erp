import { useCallback, useMemo, useRef, useState } from 'react';
import { DENSE_CARD_FRAME } from '@/shared/components/card';
import {
	FIELD_LABEL_CLASS as labelClass,
	FIELD_CLASS as fieldClass,
	FIELD_ROW_CLASS as fieldRowClass,
} from '@/shared/components/form-styles';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, ChevronDown, ChevronLeft, Hash, Package, Plus, Store, Trash2, User } from 'lucide-react';
import { Button } from '@mmbix/design-system/button';
import { Input } from '@mmbix/design-system/input';
import { ScrollArea } from '@mmbix/design-system/scroll-area';
import { SearchBox } from '@mmbix/design-system/search-box';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';
import { Textarea } from '@mmbix/design-system/textarea';
import { DatePicker } from '@mmbix/design-system/datepicker';

import { createInboundDoc, updateInboundDoc } from '../data/api';
import { dateLabel, money } from '../data/display';
import { isInboundEditable } from '../data/edit';
import { inboundLineIsComplete, parseQty, parseSerials } from '../data/line-rules';
import { qk } from '../data/query-keys';
import { INBOUND_TYPE_META, INBOUND_TYPE_VALUES } from '../data/meta';
import type { CreateInboundDraft, InboundFormSeed, InboundLineSeed, InboundType, MroSupplierRow, UpdateInboundDraft } from '../data/types';
import { SerialEditorSheet } from './serial-editor-sheet';
import { FormField } from '@/shared/components/form-field';
import { RequiredMark } from '@/shared/components/required-mark';
import { useSubmitGuard } from '@/shared/components/form-state';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import { DateField } from '@/shared/components/date-field';

import { MASTER_STALE_MS, SEARCH_MIN_CHARS } from '@/shared/constants';
import { PickerSearchHint } from '@/shared/components/picker-search-hint';
import { MRO_LOCATIONS, MRO_LOCATION_LABELS, MRO_TRACKING_LABELS } from '@/shared/mro';
import type { MroLocation, MroTracking } from '@/shared/mro';
import {
	useMroItemModels,
	filterMroItemModels,
	mroItemLineLabel,
	mroItemModelLabel,
	type MroItemModelDirectoryRow,
} from '@/shared/hooks/use-mro-item-models';
import { createMroSupplier, fetchMroSuppliers, upsertMasterDirectory } from '@/shared/hooks/use-mro-masters';
import { SupplierMasterForm } from '@/shared/components/supplier-master-form';
import { PersonnelPickerSheet, type PersonnelOption } from '@/shared/components/personnel-picker-sheet';
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

/** A model's tracking policy — anything unknown/missing reads as standard. */
function trackingOf(model: MroItemModelDirectoryRow | undefined): MroTracking {
	return model?.tracking === 'batch' || model?.tracking === 'serial' ? model.tracking : 'standard';
}

/** One row of the dynamic lines editor. */
interface InboundLineDraft {
	/** Local identity — stable across removals (unlike the array index). */
	key: number;
	/** The chosen `mro_item_model` id — null until the picker selects one. */
	modelId: string | null;
	/** EDIT only — the SKU name the stored line carried. The trigger's label reads
	 *  the shared directory first and falls back to this, so an edit never paints
	 *  `Select item` on a line that HAS an item while the master read is in flight. */
	modelName?: string | null;
	/** EDIT only — the policy the stored line was captured under (same reason:
	 *  a batch row keeps its lot/expiry inputs before the directory lands). */
	tracking?: MroTracking | null;
	/** The raw qty input (parsed on submit / for the running total). */
	qty: string;
	/** Optional per-unit cost — any policy. */
	unitPrice: string;
	/** Batch models only — the lot no (blank = engine auto-names it). */
	batchNo: string;
	/** Batch models only — `YYYY-MM-DD` via a native date input, optional. */
	expiryDate: string;
	/** Serial models only — the units as comma-separated text, parsed on submit. */
	serialsText: string;
}

/**
 * A STORED line → the editor's row. A seed is the only source of `modelName` /
 * `tracking` (a fresh row learns both from the directory instead), and the
 * `key` is local — the wire has no use for it.
 */
function lineDraftOf(line: InboundLineSeed, index: number): InboundLineDraft {
	return {
		key: index + 1,
		modelId: line.modelId,
		modelName: line.modelName,
		tracking: line.tracking,
		qty: line.qty > 0 ? `${line.qty}` : '',
		unitPrice: line.unitPrice != null ? `${line.unitPrice}` : '',
		batchNo: line.batchNo,
		expiryDate: line.expiryDate,
		serialsText: line.serials.join(', '),
	};
}

/**
 * The inbound (GRN) create form — the REAL multi-line document form behind the
 * အဝင်စာရင်း screen. An inbound draft is ONE engine-native POST
 * (`mro_inbounds` + its child `mro_inbound_lines` in the same body): the engine
 * numbers the doc (INB-…), stores the lines and — at CONFIRM, never here —
 * lands stock:
 *
 *   1. ရက်စွဲ — the DS DatePicker, defaulting to today's MMT calendar day;
 *   2. အမျိုးအစား — ဝယ်ယူမှု / ရှေးစာရင်း / ပြန်အမ်း (the per-kind semantics +
 *      hint line updates; `return` re-instocks previously-issued serials) — the
 *      selector is a DRAFT's control and is absent on a settled document, which
 *      states its kind in the page's own pill instead;
 *   3. ရောင်းချသူ + စတိုး — WHO the goods come from (a searchable `mro_suppliers`
 *      bottom-sheet picker, or the personnel search for a vendor-less kind) and the
 *      receiving store (`MRO_LOCATIONS`, bottom-sheet select) SIDE BY SIDE in one
 *      header row, the pair a receipt is read for — the field NAMES carry what each
 *      is, so no hint line sits under either;
 *   4. ပစ္စည်းများ — the dynamic LINES editor: one row per SKU, each a
 *      searchable `mro_item_model` picker + qty + optional unit price + the
 *      TRACKING-aware extra fields:
 *        - batch  → batch no (blank = auto-named at confirm) + expiry date;
 *        - serial → the exact units as comma-separated text (the engine 409s
 *          at confirm when the list length ≠ qty or a unit is already used /
 *          — for `return` — not an issued unit of this model);
 *   5. မှတ်ချက် — a free-text note.
 *
 * Submit is enabled once every non-blank line is complete (an item AND qty > 0,
 * serial lines require qty serials) and at least one such line exists. Engine
 * errors render inline and never silently close the form; success calls
 * `onDone` (the page invalidates the lists and returns to them).
 *
 * ONE form, TWO modes — `seed` is the whole difference. Without it the form
 * creates a document; with it the form EDITS that document (`PUT`, not `POST`).
 * And the mode is not the caller's choice but the DOCUMENT's: `isInboundEditable`
 * mirrors the engine's own freeze (`writes.freeze_when doc_status:confirmed` +
 * the core draft→cancelled rule), so an already-posted receipt renders the same
 * layout with every field read-only and no submit — the screen never offers a
 * write the server would answer with a 403.
 */
export function InboundDocForm({
	onDone,
	initialType = 'purchase',
	seed,
}: {
	onDone: () => void;
	initialType?: InboundType;
	/** An EXISTING document to edit in place — absent ⇒ create mode. */
	seed?: InboundFormSeed;
}) {
	const queryClient = useQueryClient();

	// Only a DOCUMENT'S STATUS decides the mode (never a caller flag): a draft
	// accepts a write, a confirmed row is frozen by the collection's
	// `writes.freeze_when`, and a cancelled one is terminal. Read-only is then
	// "every field is disabled and there is nothing to submit".
	const seededStatus = seed?.docStatus;
	const readOnly = seededStatus !== undefined && !isInboundEditable(seededStatus);

	// The KIND decides the counterparty: a purchase names its VENDOR, a return the
	// EMPLOYEE the goods came back from, an opening balance the employee handing the
	// stock over. `party` is that decision (copy + which picker + which column), and
	// the engine enforces the same split with `required_if` rules — so the form can
	// never ask for one while the server demands the other. Declared FIRST because
	// the master reads below depend on it.
	const [type, setType] = useState<InboundType>(seed?.type ?? initialType);
	const typeMeta = INBOUND_TYPE_META[type];
	const party = typeMeta.party;
	const needsSupplier = party.kind === 'supplier';

	// The SKU directory — the ONE shared master read (see
	// `shared/hooks/use-mro-item-models`), cached for the master freshness window;
	// the supplier directory is the OTHER shared master read (`['mro','suppliers']`
	// in shared/hooks/use-mro-masters) — same masters-hub cache, same window.
	const models = useMroItemModels();
	const suppliers = useQuery({
		queryKey: qk.suppliers(),
		queryFn: fetchMroSuppliers,
		staleTime: MASTER_STALE_MS,
		// The vendor directory is read for a PURCHASE only — a return / opening
		// balance never names a vendor, so it costs no read at all.
		enabled: needsSupplier,
	});

	// Header fields — the receipt date defaults to today in MMT; an EDIT seed
	// replaces that with the document's own values, so the form opens on the
	// receipt it was asked to show rather than on a blank one.
	const [purchaseDate, setPurchaseDate] = useState<Date | undefined>(() => parseDateInput(seed?.purchaseDate ?? todayMmtDate()));
	const [supplierId, setSupplierId] = useState<string | null>(seed && seed.type === 'purchase' ? seed.partyId : null);
	const [location, setLocation] = useState<MroLocation>(seed?.location ?? 'main_store');
	const [note, setNote] = useState(seed?.note ?? '');
	/** "The money came with the goods" — a purchase-only draft flag (see `markPaid`). */
	const [paidAtReceipt, setPaidAtReceipt] = useState(seed?.paidAtReceipt ?? false);
	const [handedBy, setHandedBy] = useState<PersonnelOption | null>(() =>
		seed && seed.type !== 'purchase' && seed.partyId ? { id: seed.partyId, name: seed.partyName ?? seed.partyId, photo: null } : null,
	);
	const [partyOpen, setPartyOpen] = useState(false);

	// The dynamic lines editor. An EDIT seeds the rows from the stored lines and
	// starts the key counter ABOVE them, so a row added later can never collide
	// with a seeded key (which would make two rows share one identity).
	const nextLineKey = useRef((seed?.lines.length ?? 0) + 1);
	const newLine = (): InboundLineDraft => ({
		key: nextLineKey.current++,
		modelId: null,
		qty: '',
		unitPrice: '',
		batchNo: '',
		expiryDate: '',
		serialsText: '',
	});
	const [lines, setLines] = useState<InboundLineDraft[]>(() => (seed && seed.lines.length > 0 ? seed.lines.map(lineDraftOf) : [newLine()]));
	const [pickerFor, setPickerFor] = useState<number | null>(null);
	/** The row whose SERIALS are being edited (null ⇒ the sheet is closed). */
	const [serialFor, setSerialFor] = useState<number | null>(null);
	const [modelQuery, setModelQuery] = useState('');
	const [supplierOpen, setSupplierOpen] = useState(false);
	const [supplierQuery, setSupplierQuery] = useState('');
	const [locationOpen, setLocationOpen] = useState(false);

	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();
	// EVERY interactive control's disabled condition — one expression, so a field
	// can never be forgotten in read-only mode (the mode is a property of the
	// document, not of a handful of inputs).
	const locked = submitting || readOnly;
	// The supplier picker's TWO panes: the search list, and the ADD layout the
	// “Add new supplier” row opens (the shared `SupplierMasterForm`). Adding
	// in-sheet — rather than navigating to the masters hub — keeps the receipt
	// draft the operator has already typed: leaving this form would unmount it.
	const [supplierPane, setSupplierPane] = useState<'pick' | 'add'>('pick');

	/** Add a supplier master from the picker and SELECT it — the ONE writer the
	 *  masters hub also uses. The returned row is folded into the shared
	 *  directory (write-through, no refetch) so this sheet, the field's label and
	 *  every other supplier picker see it immediately. Rejects loudly: the form
	 *  renders its own inline error, so a failed add never closes the layout. */
	const addSupplier = useCallback(
		async (input: { name: string; mobile?: string; address?: string }) => {
			const row = await createMroSupplier(input);
			upsertMasterDirectory(queryClient, qk.suppliers(), row);
			setSupplierId(row.id);
			setSupplierQuery('');
			setSupplierPane('pick');
			setSupplierOpen(false);
		},
		[queryClient],
	);

	const modelById = useMemo(() => new Map((models.data ?? []).map((model) => [model.id, model])), [models.data]);
	const supplierById = useMemo(() => new Map((suppliers.data ?? []).map((supplier) => [supplier.id, supplier])), [suppliers.data]);
	const modelOf = (line: InboundLineDraft): MroItemModelDirectoryRow | undefined =>
		line.modelId ? modelById.get(line.modelId) : undefined;

	/** A row's tracking policy — the DIRECTORY's answer when it has the SKU, else
	 *  the policy the STORED line was captured under. The fallback is what keeps an
	 *  edit's batch/serial inputs on screen before the master read lands, and it
	 *  cannot mislabel a fresh row (those carry no stored policy). */
	const lineTracking = (line: InboundLineDraft): MroTracking => {
		const model = modelOf(line);
		return model ? trackingOf(model) : (line.tracking ?? 'standard');
	};

	/** The party trigger's label — the directory name, else the stored line's own
	 *  name, and only then the bare id (an edit must not show “sup-9f2…” to a human). */
	const partyLabelText = supplierById.get(supplierId ?? '')?.name?.trim() || seed?.partyName?.trim() || supplierId;

	/** The picker's candidates — shared client-side name/group/tracking match over
	 *  the cached directory (no per-keystroke request). */
	const modelCandidates = useMemo(() => filterMroItemModels(models.data ?? [], modelQuery), [models.data, modelQuery]);
	// A picker stays blank until its term is long enough — no directory dump on open.
	const pickerReady = modelQuery.trim().length >= SEARCH_MIN_CHARS;
	const supplierReady = supplierQuery.trim().length >= SEARCH_MIN_CHARS;

	/** The supplier picker's candidates — client-side name search. */
	const supplierCandidates = useMemo(() => {
		const query = supplierQuery.trim().toLowerCase();
		if (!query) return suppliers.data ?? [];
		return (suppliers.data ?? []).filter((supplier) => `${supplier.name ?? ''}`.toLowerCase().includes(query));
	}, [suppliers.data, supplierQuery]);

	/** A row is complete when it can become a submit-payload row — the rule is
	 *  PURE and unit-tested in `data/line-rules` (a tracked row without a maker is
	 *  incomplete, so the round trip can never 400 on the maker). */
	const isValidLine = (line: InboundLineDraft): boolean => inboundLineIsComplete(line, lineTracking(line));
	/** A row is blank when nothing was filled in yet (skipped by the payload). */
	const isBlankLine = (line: InboundLineDraft): boolean =>
		line.modelId === null &&
		line.qty.trim() === '' &&
		line.unitPrice.trim() === '' &&
		line.batchNo.trim() === '' &&
		line.expiryDate.trim() === '' &&
		line.serialsText.trim() === '';

	const completeLines = lines.filter(isValidLine);
	const hasIncompleteLine = lines.some((line) => !isBlankLine(line) && !isValidLine(line));
	// "Add another" must not stack empty rows: the last line has to be filled (or
	// partially typed) before another can be added. Removing a line is always
	// available, so this can never trap the user with an unfillable row.
	const lastLineBlank = lines.length > 0 && isBlankLine(lines[lines.length - 1]);
	// The money the COMPLETE lines add up to — the same sum the confirm computes
	// (`Σ qty × unit_price`), so the "paid in full" hint quotes the figure the server
	// will actually file rather than a client-side guess. Zero while prices are unset.
	const totalAmount = completeLines.reduce((sum, line) => {
		const qty = parseQty(line.qty) ?? 0;
		const unitPrice = parseQty(line.unitPrice) ?? 0;
		return sum + qty * Math.max(0, unitPrice);
	}, 0);

	// Whether this draft is being filed as ALREADY PAID. `paid_at_receipt` is a
	// purchase-only, draft-only decision (the confirm refuses the other kinds, and
	// `writes.freeze_when` freezes it at confirm) and it needs a total to settle —
	// so the flag is offered, and sent, exactly when all three hold.
	const canMarkPaid = totalAmount > 0;
	const markPaid = type === 'purchase' && canMarkPaid && paidAtReceipt;
	const receiptDay = dateLabel(dateToInputValue(purchaseDate ?? new Date()));

	// The counterparty id this KIND records — a vendor for a purchase, the picked
	// employee otherwise. Exactly one of the two is ever sent.
	const partyId = needsSupplier ? supplierId : (handedBy?.id ?? null);

	const canSubmit = !submitting && partyId !== null && completeLines.length > 0 && !hasIncompleteLine;

	const addLine = () => {
		hapticImpact('light');
		setLines((current) => [...current, newLine()]);
	};

	const removeLine = (key: number) => {
		hapticImpact('light');
		setLines((current) => current.filter((line) => line.key !== key));
	};

	const patchLine = (key: number, patch: Partial<InboundLineDraft>) => {
		setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
	};

	const openPicker = (key: number) => {
		hapticImpact('light');
		setModelQuery('');
		setPickerFor(key);
	};

	const openSerials = (key: number) => {
		hapticImpact('light');
		setSerialFor(key);
	};

	// The serial editor's subject — the row `serialFor` names (null ⇒ closed), the
	// units already on it, and the units the OTHER rows carry: a serial number names
	// one physical unit, so it can never be entered twice on one receipt (the
	// confirm would 409 that, long after the typing is done).
	const serialLine = lines.find((line) => line.key === serialFor) ?? null;
	const serialModel = serialLine ? modelOf(serialLine) : undefined;
	const serialValue = serialLine ? parseSerials(serialLine.serialsText) : [];
	const serialQty = serialLine ? parseQty(serialLine.qty) : null;
	const serialOthers = lines.flatMap((line, index) =>
		line.key === serialFor ? [] : parseSerials(line.serialsText).map((serial) => ({ serial, where: `item ${index + 1}` })),
	);
	// The sheet's title says WHICH line it opens — the row's label (the item NAME over
	// its SKU, the same label the picker and the line itself show), off the directory
	// when it knows the SKU and off the stored line while that read is in flight.
	const serialTitle = mroItemLineLabel({ model: serialModel, storedName: serialLine?.modelName, placeholder: 'Serial numbers' });

	const pickModel = (key: number, modelId: string) => {
		hapticImpact('light');
		// A new model resets the tracking-dependent fields (batch no / expiry /
		// serials) — they only make sense for the model they were typed against.
		setLines((current) =>
			current.map((line) => (line.key === key ? { ...line, modelId, batchNo: '', expiryDate: '', serialsText: '' } : line)),
		);
		setPickerFor(null);
	};

	const submit = async () => {
		if (!canSubmit || partyId === null || !submitGuard.begin()) return;
		hapticImpact('medium');
		setSubmitting(true);
		setError(null);
		// The counterparty the KIND records — a purchase its vendor, everything else
		// the employee. An EDIT also CLEARS the column the kind does not use: the
		// schema enforces “a supplier OR an employee” per field, so changing a draft
		// from purchase to return would otherwise keep the old vendor set beside the
		// new employee. A create has nothing to clear, so it simply omits it.
		const partyFields = seed
			? party.field === 'supplier'
				? { supplier: partyId, handed_by: null }
				: { supplier: null, handed_by: partyId }
			: party.field === 'supplier'
				? { supplier: partyId }
				: { handed_by: partyId };
		const draft: UpdateInboundDraft = {
			...partyFields,
			purchase_date: purchaseDate ? dateToInputValue(purchaseDate) : todayMmtDate(),
			type,
			location,
			// An EDIT states the clearable fields outright — unchecking “paid in full”
			// or emptying the note has to be able to send `false` / `null`, where a
			// create simply leaves the field out and keeps the engine's default.
			...(seed
				? { note: note.trim() || null, paid_at_receipt: markPaid }
				: {
						...(note.trim() ? { note: note.trim() } : {}),
						// The money came with the goods — the CONFIRM files the one payment
						// this flag asks for (amount = the line total, day = the receipt date).
						...(markPaid ? { paid_at_receipt: true } : {}),
					}),
			lines: completeLines.flatMap((line) => {
				const qty = parseQty(line.qty);
				// The row's OWN id is enough — the directory only NAMES the SKU. The
				// fallback matters on an edit: a SKU missing from the cached directory
				// must still be saved as it was, because dropping the line would
				// silently delete stock from the document.
				const modelId = modelOf(line)?.id ?? line.modelId;
				if (qty === null || !modelId) return [];
				const tracking = lineTracking(line);
				const unitPrice = parseQty(line.unitPrice);
				return [
					{
						item_model: modelId,
						qty,
						...(unitPrice !== null && unitPrice >= 0 ? { unit_price: unitPrice } : {}),
						...(tracking === 'batch' && line.batchNo.trim() ? { batch_no: line.batchNo.trim() } : {}),
						...(tracking === 'batch' && line.expiryDate.trim() ? { expiry_date: line.expiryDate.trim() } : {}),
						...(tracking === 'serial' ? { serials: parseSerials(line.serialsText) } : {}),
					},
				];
			}),
		};
		try {
			// Same form, same payload shape — only the verb differs: an edit SAVES the
			// document it was seeded with (the engine replaces its child lines with
			// this payload), a create files a new one.
			if (seed) await updateInboundDoc(seed.id, draft);
			else await createInboundDoc(draft as CreateInboundDraft);
			onDone();
		} catch (err) {
			// Engine validation (e.g. a `lines` rule) surfaces its message inline —
			// the form stays open with the user's rows intact for a retry.
			console.error('[inbounds] save failed', err);
			setError(err instanceof Error && err.message ? err.message : "Couldn't save the record. Please try again.");
			setSubmitting(false);
			submitGuard.end();
		}
	};

	// The submit affordance: the native MainButton on Android/Desktop Telegram
	// (Apple clients fall back — native iOS clips Burmese labels); the in-page
	// button everywhere else. Never both — same rule as the BackButton pill.
	// Tucked away while a picker sheet is open so it cannot be tapped behind the
	// sheet's backdrop, and absent entirely in read-only mode: there is nothing to
	// save, so a button would be a promise the form cannot keep.
	const isMainButton = useTelegramMainButton({
		text: submitting ? 'Saving…' : 'Save Draft',
		onClick: () => void submit(),
		visible: !readOnly && !locationOpen && !supplierOpen && !partyOpen && pickerFor === null && serialFor === null,
		disabled: !canSubmit,
		loading: submitting,
	});

	// WHY nothing can be changed is NOT stated here: the document page's status pill IS
	// that statement (`Confirmed` / `Cancelled`), with the kind it is stuck on riding the
	// same badge. A second sentence — in this form or under the pill — would print the
	// same fact twice, in two voices that are free to drift apart.

	return (
		<div className="flex flex-1 flex-col gap-3 pt-2">
			{/* 1 — Receipt date — the DS DatePicker, defaulted to today (MMT). */}
			<section>
				<FormField label="Select a date" required group>
					{() => (
						<DatePicker
							value={purchaseDate}
							onValueChange={setPurchaseDate}
							placeholder="Select a date"
							format={APP_DATE_FORMAT}
							disabled={locked}
							className={fieldClass}
						/>
					)}
				</FormField>
			</section>

			{/* 2 — Inbound kind — the three types as a segmented control; the
				per-kind hint line under the selector explains the difference. Choosing a
				kind IS a write (it decides the counterparty column the engine requires), so
				a settled receipt renders NO selector at all rather than three dead tabs:
				the page's status pill carries the kind it is stuck on (`Purchase ·
				Confirmed`), stated once, and this form never repeats it. */}
			{!readOnly && (
				<section>
					<FormField label="Type" required group>
						{() => (
							<div className={`grid grid-cols-3 gap-1.5 ${DENSE_CARD_FRAME} p-1`}>
								{INBOUND_TYPE_VALUES.map((value) => {
									const selected = value === type;
									return (
										<button
											key={value}
											type="button"
											disabled={locked}
											onClick={() => {
												hapticImpact('light');
												setType(value);
											}}
											aria-pressed={selected}
											className={`rounded-lg px-2 py-2 text-xs font-semibold leading-myanmar transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
												selected ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground hover:bg-muted/60'
											}`}
										>
											{INBOUND_TYPE_META[value].label}
										</button>
									);
								})}
							</div>
						)}
					</FormField>
					<p className="mt-1.5 text-meta leading-myanmar text-muted-foreground">{typeMeta.hint}</p>
				</section>
			)}

			{/* 3 — Counterparty + store, SIDE BY SIDE — the two facts a receipt header
			    is read for: WHO the goods come from, which the KIND decides (a purchase
			    names its vendor in the supplier directory, a return the EMPLOYEE who
			    handed the goods back, an opening balance the employee handing the stock
			    over — the engine's `required_if` rules demand exactly the same one), and
			    WHERE they land. Neither picker states more than its own value, so
			    neither needs a row of its own; the counterparty's hint line stays under
			    the field it explains, and every sheet below is portal-only, so the row's
			    two cells are exactly the two fields. */}
			<section className={fieldRowClass}>
				<FormField label={party.label} required>
					{(f) =>
						party.kind === 'supplier' ? (
							<Button
								{...f}
								type="button"
								variant="outline"
								disabled={locked}
								onClick={() => {
									hapticImpact('light');
									setSupplierQuery('');
									setSupplierPane('pick');
									setSupplierOpen(true);
								}}
								className={`${fieldClass} justify-between font-normal`}
							>
								<span className="flex min-w-0 items-center gap-2">
									<Building2 strokeWidth={1.6} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
									<span className="truncate text-foreground">{partyLabelText ?? party.placeholder}</span>
								</span>
								<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
							</Button>
						) : (
							<Button
								{...f}
								type="button"
								variant="outline"
								disabled={locked}
								onClick={() => {
									hapticImpact('light');
									setPartyOpen(true);
								}}
								className={`${fieldClass} justify-between font-normal`}
							>
								<span className="flex min-w-0 items-center gap-2">
									<User strokeWidth={1.6} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
									<span className="truncate text-foreground">{handedBy?.name ?? party.placeholder}</span>
								</span>
								<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
							</Button>
						)
					}
				</FormField>

				{/* 4 — Store location — the receiving store (bottom-sheet single-select),
				    the OTHER half of the same row: WHO it came from beside WHERE it
				    landed. */}
				<FormField label="Select store" required>
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

				{party.kind === 'employee' && (
					<PersonnelPickerSheet
						open={partyOpen && !readOnly}
						onOpenChange={setPartyOpen}
						value={handedBy ? [handedBy] : []}
						onToggle={(person) => setHandedBy(person)}
						title={party.label}
						singleSelect
					/>
				)}

				{/* The VENDOR picker is only meaningful for a purchase — an employee
				    kind renders the personnel sheet instead (above). */}
				{needsSupplier && (
					<Sheet
						open={supplierOpen && !readOnly}
						onOpenChange={(open) => {
							setSupplierOpen(open);
							// Leaving the sheet always returns it to the search pane, so
							// the next open never lands mid-add.
							if (!open) setSupplierPane('pick');
						}}
					>
						<SheetContent side="bottom" className="max-h-[85dvh]">
							{supplierPane === 'add' ? (
								<>
									<SheetHeader className="pb-1">
										<button
											type="button"
											onClick={() => {
												hapticImpact('light');
												setSupplierPane('pick');
											}}
											className="-ml-1 flex items-center gap-1 self-start rounded-full px-1 py-0.5 text-xs font-medium leading-myanmar text-muted-foreground transition-colors active:text-foreground"
										>
											<ChevronLeft className="size-4" aria-hidden />
											Back to search
										</button>
										<SheetTitle className="mt-2">Add supplier</SheetTitle>
									</SheetHeader>
									{/* The SAME layout the masters hub adds a supplier with —
								    seeded with whatever the operator typed in the search box,
								    so the name carries over. Its submit is in-page
								    (`inSheet`): the sheet covers the native MainButton. */}
									<div className="px-5 pb-safe pt-2">
										<SupplierMasterForm
											inSheet
											prefill={{ name: supplierQuery.trim() }}
											submitLabel="Add supplier"
											savingLabel="Adding…"
											errorMessage="Couldn't add the new supplier. Please try again."
											save={addSupplier}
										/>
									</div>
								</>
							) : (
								<>
									<SheetHeader className="pb-1">
										<SheetTitle>Select supplier</SheetTitle>
										<SearchBox
											placeholder="Search supplier name"
											value={supplierQuery}
											onValueChange={setSupplierQuery}
											className="mt-3"
											inputClassName="h-8.5 text-xs! px-3 rounded-full"
										/>
									</SheetHeader>
									{/* Add — ALWAYS pressable: opens the supplier layout seeded with
								    the typed name (the previous quick-add silently created a
								    name-only master, and was disabled until you typed, so a tap
								    on the empty form did nothing at all). */}
									<button
										type="button"
										onClick={() => {
											hapticImpact('light');
											setSupplierPane('add');
										}}
										className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<Plus className="size-4 shrink-0 text-primary" strokeWidth={2.2} aria-hidden />
										<span className="text-sm font-semibold leading-myanmar text-primary">
											{supplierQuery.trim() ? `Add “${supplierQuery.trim()}”` : 'Add new supplier'}
										</span>
										<span className="text-meta leading-myanmar text-muted-foreground">
											{supplierQuery.trim() ? '— with contact details' : '— name, mobile, address'}
										</span>
									</button>
									<ScrollArea className="h-[45dvh] px-4 pb-safe">
										{!supplierReady ? (
											<PickerSearchHint noun="search suppliers" />
										) : suppliers.isPending ? (
											<p className="px-3 py-8 text-center text-sm leading-myanmar text-muted-foreground">Loading suppliers…</p>
										) : suppliers.isError ? (
											<div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
												<p className="text-sm leading-myanmar text-status-danger">Couldn't load suppliers.</p>
												<button
													type="button"
													onClick={() => void suppliers.refetch()}
													className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
												>
													Retry
												</button>
											</div>
										) : supplierCandidates.length > 0 ? (
											<ul className="flex flex-col gap-0.5">
												{supplierCandidates.map((supplier: MroSupplierRow) => {
													const selected = supplier.id === supplierId;
													return (
														<li key={supplier.id}>
															<button
																type="button"
																onClick={() => {
																	hapticImpact('light');
																	setSupplierId(supplier.id);
																	setSupplierOpen(false);
																}}
																className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
															>
																<span className="min-w-0 flex-1 truncate text-sm font-medium leading-6.5 text-foreground">
																	{supplier.name?.trim() || '—'}
																</span>
																{selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
															</button>
														</li>
													);
												})}
											</ul>
										) : (
											<p className="px-3 py-8 text-center text-sm leading-myanmar text-muted-foreground">No supplier found</p>
										)}
									</ScrollArea>
								</>
							)}
						</SheetContent>
					</Sheet>
				)}
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

			{/* 4 — The dynamic LINES editor — one row per SKU to receive. */}
			<section>
				<div className="mb-2 flex items-center justify-between gap-2">
					<p className={`${labelClass} mb-0`}>
						Items
						<RequiredMark />
					</p>

					{/* Adding a row is an ACTION too — the same rule as the row’s remove button. */}
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
					<ul className="flex flex-col gap-2">
						{lines.map((line, index) => {
							const model = modelOf(line);
							const tracking = lineTracking(line);
							const isSerial = tracking === 'serial';
							const typedSerials = parseSerials(line.serialsText).length;
							const qty = parseQty(line.qty);
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
										className="mt-1.5 flex min-h-10 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm leading-myanmar outline-none transition-colors focus:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
									>
										<Package strokeWidth={1.6} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
										<span className={`min-w-0 flex-1 truncate ${model ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
											{mroItemLineLabel({ model, storedName: line.modelName, modelId: line.modelId })}
										</span>
										<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
									</button>

									{/* Qty + optional unit price — side by side. */}
									<div className="mt-1.5 grid grid-cols-2 gap-2">
										<div>
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
										<div>
											<Input
												type="number"
												min={0}
												step="any"
												inputMode="decimal"
												value={line.unitPrice}
												onChange={(event) => patchLine(line.key, { unitPrice: event.target.value })}
												placeholder="Ks/unit"
												disabled={locked}
												aria-label="Unit price"
												className="h-10 rounded-lg px-3"
											/>
										</div>
									</div>

									{/* Batch models — lot no + optional expiry (both needed for
										future FEFO; blank lot no = engine auto-names it). */}
									{tracking === 'batch' && (
										<div className="mt-1.5 grid grid-cols-2 gap-2">
											<div>
												<label htmlFor={`line-${line.key}-batch`} className={`${labelClass} mb-1`}>
													Batch No
												</label>
												<Input
													id={`line-${line.key}-batch`}
													value={line.batchNo}
													onChange={(event) => patchLine(line.key, { batchNo: event.target.value })}
													placeholder="Auto if left blank"
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

									{/* Serial models — the exact units, entered in a SHEET rather than a
									    comma-separated text field: a serial number is a per-unit
									    identity that is unique forever, and a free-text field hides
									    the two mistakes that cost a rejected confirm (a mistyped
									    unit, one entered twice). The field itself states what is on
									    the line, in order, and it OPENS on a settled receipt too:
									    the sheet becomes a VIEWER there (no entry box, no delete),
									    because reading the units a posted receipt received is not
									    a write — only an in-flight save holds it back. */}
									{isSerial && (
										<div className="mt-1.5">
											<label htmlFor={`line-${line.key}-serials`} className={`${labelClass} mb-1`}>
												Serial numbers
												<RequiredMark />
											</label>
											<button
												id={`line-${line.key}-serials`}
												type="button"
												disabled={submitting}
												onClick={() => openSerials(line.key)}
												aria-label={readOnly ? 'View serials' : 'Select serials'}
												className="flex min-h-10 w-full items-start gap-2 rounded-lg border border-input bg-background px-3 py-2 text-left text-sm leading-myanmar outline-none transition-colors focus:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
											>
												<Hash strokeWidth={1.6} className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
												<span className={`min-w-0 flex-1 ${typedSerials > 0 ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
													{typedSerials > 0 ? parseSerials(line.serialsText).join(', ') : 'Add serial numbers'}
												</span>
												<ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
											</button>
											{/* The count hint is an instruction to TYPE, so a settled receipt (read-only)
											    states nothing here: the units it carries are already recorded. */}
											{!readOnly && serialCountMismatch && (
												<p className="mt-1 text-meta font-medium leading-myanmar text-status-warning">
													Serial count ({typedSerials}) must match quantity ({qty}).
												</p>
											)}
											{!readOnly && !serialCountMismatch && (
												<p className="mt-1 text-meta leading-myanmar text-muted-foreground">
													{type === 'return'
														? 'Only previously-issued serials may return.'
														: 'Add one serial number per unit — the count must match the quantity.'}
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

				{/* Paid in full — a purchase's money fact, declared while it is still a
				    draft: the confirm then files the ONE ledger payment that settles it.
				    Offered only for a purchase WITH a total, because the server refuses
				    anything else — the option never exists as a state the confirm would
				    reject. The hint quotes the exact figure and day that will be filed.
				    A SETTLED receipt renders none of it: the flag is a DRAFT's
				    declaration (its sentence speaks of what CONFIRMING will file), and
				    once the money is on the ledger the receipt's own money face states
				    it — a dead checkbox beside a stale sentence would be a second, worse
				    teller of a fact the ledger already carries. */}
				{!readOnly && type === 'purchase' && (
					<label
						htmlFor="inbound-paid-at-receipt"
						className={`mt-2 flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
							markPaid ? 'border-foreground/30 bg-muted/60' : 'border-border bg-card/60'
						} ${locked || !canMarkPaid ? 'opacity-60' : 'cursor-pointer'}`}
					>
						{/* A NATIVE checkbox on purpose: it carries exactly the semantics this
						    asks for (role=checkbox, label association, space to toggle), and
						    the design system's Checkbox is not an exported subpath of
						    `@mmbix/design-system` — pulling it in would mean a DS export +
						    build for one control. Styled with the app's own tokens
						    (`accent-primary` tints the native check). */}
						<input
							id="inbound-paid-at-receipt"
							type="checkbox"
							checked={markPaid}
							disabled={locked || !canMarkPaid}
							onChange={(event) => {
								hapticImpact('light');
								setPaidAtReceipt(event.target.checked);
							}}
							className="mt-0.5 size-4 shrink-0 rounded-sm border border-input accent-primary disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
						<span className="min-w-0 flex-1">
							<span className="block text-xs font-semibold leading-myanmar text-foreground">Paid in full</span>
							<span className="mt-0.5 block text-meta leading-myanmar text-muted-foreground">
								{canMarkPaid
									? `Confirming records one payment of ${money(totalAmount)} dated ${receiptDay} — nothing left to pay.`
									: 'Add a unit price on the lines to mark this receipt paid.'}
							</span>
						</span>
					</label>
				)}
			</section>

			{/* 5 — Note — a free-text description. */}
			<section>
				<label htmlFor="inbound-note" className={labelClass}>
					Note
				</label>
				<Textarea
					id="inbound-note"
					value={note}
					onChange={(event) => setNote(event.target.value)}
					placeholder="Write a note (optional)"
					rows={3}
					disabled={locked}
					className="rounded-lg bg-card px-3 text-sm leading-myanmar"
				/>
			</section>

			{/* Local validation hint — a row was started but left incomplete. */}
			{!readOnly && hasIncompleteLine && (
				<p className="rounded-md bg-status-warning-soft px-3 py-2 text-xs font-medium leading-myanmar text-status-warning">
					Amendment required — a line was started but left incomplete. Fill in the item and quantity (for a serial item, the serial count
					must match the quantity) or remove the line.
				</p>
			)}

			{/* Engine errors render inline — never silent, never a dead-end. */}
			<FormError error={error} />

			{/* Nothing to save on a posted receipt, so the bar is absent rather than disabled. */}
			{!readOnly && (
				<FormSubmitBar
					label="Save Draft"
					isMainButton={isMainButton}
					disabled={!canSubmit}
					submitting={submitting}
					onSubmit={() => void submit()}
				/>
			)}

			{/* The serial editor — ONE sheet, driven by `serialFor` (the row's key).
			    It writes back the normalised comma list, so the row state stays the
			    single source `parseSerials` reads everywhere else. A settled receipt
			    opens the SAME sheet as a VIEWER (`readOnly`): the units stay readable,
			    with no entry box, no Add and no delete. */}
			<SerialEditorSheet
				open={serialFor !== null}
				title={serialTitle}
				value={serialValue}
				qty={serialQty}
				others={serialOthers}
				readOnly={readOnly}
				onOpenChange={(open) => {
					if (!open) setSerialFor(null);
				}}
				onChange={(next) => {
					if (serialFor !== null) patchLine(serialFor, { serialsText: next.join(', ') });
				}}
			/>

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
