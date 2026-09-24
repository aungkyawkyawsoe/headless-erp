import { useMemo, useRef, useState } from 'react';
import { DENSE_CARD_FRAME } from '@/shared/components/card';
import {
	FIELD_LABEL_CLASS as labelClass,
	FIELD_CLASS as fieldClass,
	FIELD_ROW_CLASS as fieldRowClass,
} from '@/shared/components/form-styles';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Package, Plus, Store, Trash2, Truck, User } from 'lucide-react';
import { Button } from '@mmbix/design-system/button';
import { Input } from '@mmbix/design-system/input';
import { ScrollArea } from '@mmbix/design-system/scroll-area';
import { SearchBox } from '@mmbix/design-system/search-box';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';
import { Textarea } from '@mmbix/design-system/textarea';
import { DatePicker } from '@mmbix/design-system/datepicker';

import { createOutboundDoc, updateOutboundDoc } from '../data/api';
import { isOutboundEditable } from '../data/edit';
import { outboundLineIsComplete, outboundLineQty, parseQty } from '../data/line-rules';
import type { CreateOutboundDraft, MroOutboundType, OutboundFormSeed, OutboundLineSeed, UpdateOutboundDraft } from '../data/types';
import { FormField } from '@/shared/components/form-field';
import { PersonnelPickerSheet, type PersonnelOption } from '@/shared/components/personnel-picker-sheet';
import { VehiclePickerSheet } from '@/shared/components/vehicle-picker-sheet';
import { RequiredMark } from '@/shared/components/required-mark';
import { useSubmitGuard } from '@/shared/components/form-state';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import { useVehicleMasters } from '@/shared/lookups/hooks';

import { MRO_LOCATIONS, MRO_LOCATION_LABELS, MRO_TRACKING_LABELS, mroApi, mroStockIndexOf, type MroStockBasis } from '@/shared/mro';
import type { MroLocation, MroTracking } from '@/shared/mro';
import {
	useMroItemModels,
	filterMroItemModels,
	mroItemLineLabel,
	mroItemModelLabel,
	type MroItemModelDirectoryRow,
} from '@/shared/hooks/use-mro-item-models';
import { useOnHandReport } from '@/shared/hooks/use-on-hand-report';
import { SEARCH_MIN_CHARS } from '@/shared/constants';
import { PickerSearchHint } from '@/shared/components/picker-search-hint';
import { hapticImpact } from '@/shared/platform/haptics';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';
import { APP_DATE_FORMAT, burmeseDigits, todayMmtDate } from '@/shared/time/myanmar';

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
interface OutboundLineDraft {
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
	 *  reason: a serial row must keep its unit picker (and its `serials` as its
	 *  quantity) before the directory lands, or the row would briefly look like a
	 *  plain consumable. */
	tracking?: MroTracking | null;
	/** The raw qty input — a STANDARD / BATCH row's quantity (ignored by a serial
	 *  row, whose quantity is its picks — see `outboundLineQty`). */
	qty: string;
	/** The count the SOURCE store request asked for (serial rows only) — an advisory
	 *  target the row shows, never a cap: the row's real quantity is its picks. */
	requestedQty: number | null;
	/** EDIT only — the stored cost basis, or null. NOT a form field: re-stated on save
	 *  because the child table is REPLACED by the payload, so a column the form does
	 *  not collect would otherwise vanish from the row (and `total_amount` with it). */
	unitPrice: number | null;
	/** Serial models only — the EXACT units, chosen from the in-stock list at the
	 *  target store (never typed). This list IS the row's quantity. */
	serials: string[];
}

/**
 * A STORED line → the editor's row. A seed is the only source of `modelName` /
 * `tracking` (a fresh row learns both from the directory instead), and the `key`
 * is local — the wire has no use for it.
 */
function lineDraftOf(line: OutboundLineSeed, index: number): OutboundLineDraft {
	return {
		key: index + 1,
		modelId: line.modelId,
		modelName: line.modelName,
		tracking: line.tracking,
		qty: line.qty > 0 ? `${line.qty}` : '',
		// The request's advisory target is NOT part of a stored document: a saved
		// draft that merely fell short of what was asked is a partial issue the
		// request already knows about, and re-stating the target here would nag the
		// operator with a number the document does not carry.
		requestedQty: null,
		unitPrice: line.unitPrice,
		serials: [...line.serials],
	};
}

/** One pre-filled line — the တောင်းခံလွှာ card's "ထုတ်ပေးမှု" action feeds a confirmed
 *  requisition's lines into the outbound draft so the operator only reviews +
 *  confirms. `qty` is the count the request asked for: a STANDARD / BATCH row is
 *  born with it as its quantity, a SERIAL row keeps it as the advisory target it
 *  shows while the operator picks the exact units. Never the units themselves —
 *  they are picked from what the store holds. */
export interface OutboundPrefillLine {
	modelId: string;
	qty: string;
}

/** The one holder a goods issue may name — a truck's inventory, or a person's
 *  custody. A MODE (not two nullable ids) because the engine accepts ONE
 *  destination: the mode decides which single value the payload carries, so a
 *  document can never leave with both set. */
type DestinationKind = 'fleet' | 'employee';

/**
 * The canonical outbound create form — the REAL multi-line document form shared
 * by the three outbound screens (ထုတ်ပေးမှု / ပယ်ဖျက် / ချို့ယွင်း-စွန့်ပစ်).
 * The screens differ only in `type` + copy; this component IS the flow.
 *
 * A draft outbound is ONE engine-native POST (`mro_outbounds` + its child
 * `mro_outbound_lines` in the same body): the engine numbers the doc, stores
 * the lines and — at CONFIRM, never here — deducts stock:
 *
 *   1. ရက်စွဲ + စတိုး — the DS DatePicker (defaulting to today's MMT calendar day)
 *      and the five MRO stores (`MRO_LOCATIONS`, a bottom-sheet single-select)
 *      SIDE BY SIDE in the header row: WHEN the units leave beside WHERE from;
 *   3. ပစ္စည်းများ — the dynamic LINES editor: one row per SKU, each a
 *      searchable `mro_item_model` picker (bottom sheet + SearchBox over the
 *      whole model directory, then narrowed to what the CHOSEN store can actually
 *      supply — issuable stock for an issue, anything on hand for a write-off /
 *      disposal, since expired stock leaves the store that way) + a qty input + a
 *      remove action, plus the TRACKING-aware extra field:
 *        - batch  → OPTIONAL batch-no (blank = FEFO allocation at confirm);
 *        - serial → the exact units, PICKED from what that store holds (the engine
 *          409s at confirm on a unit that is unknown / elsewhere / expired). A
 *          serial row carries NO qty input — its quantity IS the number of units
 *          picked (`outboundLineQty`), so the two can never disagree and the
 *          picker is not capped at anything;
 *   4. ထုတ်ယူသူ — the DESTINATION (`to_vehicle` XOR `to_employee`), a goods-issue
 *      field only: a truck's inventory, or a person's custody. It is shown only
 *      once a SERIAL-tracked item is on the document and REQUIRED then, because
 *      those are the units a holder can hold — without one they would leave the
 *      store belonging to nobody and never appear on any truck or employee
 *      register. A consumable line has no holder, so the field stays absent
 *      rather than demanding an answer that changes nothing;
 *   5. မှတ်ချက် — a free-text note.
 *
 * Submit is enabled once every non-blank line is complete (an item AND a positive
 * quantity — for a serial row, at least one picked unit) and at least one such line
 * exists, and — for a goods issue whose serial units have a holder to land in — a
 * destination is chosen. Engine errors render inline and never silently close the
 * form; success calls `onDone` (the page invalidates the lists and returns to them).
 *
 * ONE form, TWO modes — `seed` is the whole difference. Without it the form CREATES a
 * document (`POST`); with it the form EDITS that document (`PUT`, not `POST`). And the
 * mode is not the caller's choice but the DOCUMENT's: `isOutboundEditable` mirrors the
 * engine's own freeze (`writes.freeze_when doc_status:['confirmed','cancelled']`), so an
 * already-posted or cancelled issue renders the same layout with every field read-only
 * — the screen never offers a write the server would answer with a 403.
 */
export function OutboundDocForm({
	type: typeProp,
	onDone,
	initialLines,
	initialRequestId,
	requestRefLabel,
	seed,
}: {
	/** The KIND this screen CREATES. Outranked by the document's own kind once
	 *  `seed` is present: the tab an operator came from is navigation state, the
	 *  `type` column is the document. */
	type: MroOutboundType;
	/** Called after a successful save — the page invalidates + navigates back. */
	onDone: () => void;
	/** Pre-filled rows — the store-request card's "Issue" action feeds an approved
	 *  requisition's lines into the draft so the operator only reviews + confirms
	 *  (a serial model's qty is pre-set to the number of serials the request
	 *  asked for — the operator still types the exact serial units). */
	initialLines?: OutboundPrefillLine[];
	/** The source requisition id this GOODS-ISSUE fulfils — set on the OUT header
	 *  (`request`) so the service can advance that request's lifecycle on confirm. */
	initialRequestId?: string;
	/** The source requisition's `REQ-…` number — a best-effort reference line so
	 *  the operator sees WHICH store request this issue fulfils. */
	requestRefLabel?: string | null;
	/** An EXISTING document to edit in place — absent ⇒ create mode. */
	seed?: OutboundFormSeed;
}) {
	// Only a DOCUMENT'S STATUS decides the mode (never a caller flag): a draft
	// accepts a write, and a confirmed / cancelled row is frozen by the
	// collection's `writes.freeze_when`. Read-only is then "every field is disabled
	// and there is nothing to submit".
	const seededStatus = seed?.docStatus;
	const readOnly = seededStatus !== undefined && !isOutboundEditable(seededStatus);
	// The document's OWN kind outranks the route's `?type=`.
	const type = seed?.type ?? typeProp;

	// The SKU directory — the ONE shared master read (see
	// `shared/hooks/use-mro-item-models`), cached for the master freshness window.
	const models = useMroItemModels();

	// The stock basis for this document's KIND, plus the ONE shared on-hand report the
	// picker filters by (the same cached entry the stock dashboard reads — see
	// `useOnHandReport`). The two families of kind want DIFFERENT numbers, and using
	// one for both would silently break a screen:
	//   · an ISSUE draws usable stock, so an expired-only SKU must not be offered;
	//   · a WRITE-OFF / DISPOSAL is exactly how expired stock leaves the store, so
	//     filtering by the issuable number would hide the items those tabs exist for.
	// Both come from the same derivation the confirm-time guard uses, so the picker
	// can never offer a row the confirm would then reject.
	const stockBasis: MroStockBasis = type === 'goods_issue' ? 'available' : 'onHand';
	const onHand = useOnHandReport();

	// Header fields — the effective date defaults to today in MMT, and an EDIT seed
	// replaces that default with the document's own values, so the form opens on the
	// issue it was asked to show rather than on a blank one.
	const [effectiveDate, setEffectiveDate] = useState<Date | undefined>(() => parseDateInput(seed?.effectiveDate ?? todayMmtDate()));
	const [location, setLocation] = useState<MroLocation>(seed?.location ?? 'main_store');
	const [note, setNote] = useState(seed?.note ?? '');

	// The dynamic lines editor — seeded from an EXISTING document when there is one,
	// else from `initialLines` (the တောင်းခံလွှာ card's "Issue" action, which feeds a
	// requisition's lines into a NEW draft), else one blank row. An edit starts the key
	// counter ABOVE the seeded rows so a row added later can never collide with a
	// seeded key (which would make two rows share one identity).
	const nextLineKey = useRef((seed?.lines.length ?? 0) + 1);
	const newLine = (): OutboundLineDraft => ({
		key: nextLineKey.current++,
		modelId: null,
		qty: '',
		requestedQty: null,
		unitPrice: null,
		serials: [],
	});
	const [lines, setLines] = useState<OutboundLineDraft[]>(() => {
		if (seed && seed.lines.length > 0) return seed.lines.map(lineDraftOf);
		return initialLines && initialLines.length > 0
			? initialLines.map((line) => ({
					...newLine(),
					modelId: line.modelId,
					qty: line.qty,
					// The request's count is kept ALONGSIDE the qty: which one a row uses is
					// decided by the model's tracking, which is unknown until the directory
					// resolves (see `outboundLineQty`).
					requestedQty: parseQty(line.qty),
				}))
			: [newLine()];
	});
	const [pickerFor, setPickerFor] = useState<number | null>(null);
	const [serialPickerFor, setSerialPickerFor] = useState<number | null>(null);
	const [modelQuery, setModelQuery] = useState('');
	const [locationOpen, setLocationOpen] = useState(false);

	// The goods-issue DESTINATION — which KIND of holder is being named, and the one
	// value for it. A write-off / disposal never reaches these (the section is gated
	// on `type`), and the backend refuses a destination on anything but a goods
	// issue, so the two halves of the rule agree. An EDIT seeds the mode from the
	// column the document actually set.
	const [destKind, setDestKind] = useState<DestinationKind>(seed?.destinationKind ?? 'fleet');
	const [toVehicle, setToVehicle] = useState<string | null>(seed?.destinationKind === 'fleet' ? seed.destinationId : null);
	const [toEmployee, setToEmployee] = useState<PersonnelOption | null>(() =>
		seed?.destinationKind === 'employee' && seed.destinationId
			? { id: seed.destinationId, name: seed.destinationLabel ?? seed.destinationId, photo: null }
			: null,
	);
	const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
	const [employeePickerOpen, setEmployeePickerOpen] = useState(false);

	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();
	// EVERY interactive control's disabled condition — one expression, so a field can
	// never be forgotten in read-only mode (the mode is a property of the document,
	// not of a handful of inputs).
	const locked = submitting || readOnly;

	const modelById = useMemo(() => new Map((models.data ?? []).map((model) => [model.id, model])), [models.data]);
	const modelOf = (line: OutboundLineDraft): MroItemModelDirectoryRow | undefined =>
		line.modelId ? modelById.get(line.modelId) : undefined;

	// The plate directory — the destination trigger states the truck it will hand the
	// units to, so a plate is resolved for display only (the payload carries the id).
	const vehicles = useVehicleMasters();
	const plateById = useMemo(
		() => new Map((vehicles.data ?? []).map((vehicle) => [vehicle.id, (vehicle.plate_no ?? '').trim()])),
		[vehicles.data],
	);

	/** `${model}|${store}` → the quantity at the basis above — ONE index over the
	 *  cached report, so every lookup below keys it identically. */
	const stockIndex = useMemo(() => mroStockIndexOf(onHand.data ?? [], stockBasis), [onHand.data, stockBasis]);
	/** The quantity this document may draw from a SKU at the chosen store — 0 when the
	 *  SKU holds no balance row there at all. */
	const stockAt = (modelId: string): number => stockIndex.get(`${modelId}|${location}`) ?? 0;

	/** The directory match — shared client-side name/group/tracking search over the
	 *  cached catalogue (no per-keystroke request). */
	const matchedModels = useMemo(
		() => (onHand.isPending || onHand.isError ? [] : filterMroItemModels(models.data ?? [], modelQuery)),
		[models.data, modelQuery, onHand.isPending, onHand.isError],
	);

	/** The picker's rows — the match narrowed to SKUs the CHOSEN store actually holds,
	 *  so an operator can only pick something the confirm would accept. Empty while
	 *  the report is in flight: an unfiltered list would offer 0-stock rows, and
	 *  rendering that as "no matches" would read as an empty catalogue. */
	const modelCandidates = useMemo(
		() => matchedModels.filter((model) => (stockIndex.get(`${model.id}|${location}`) ?? 0) > 0),
		[matchedModels, stockIndex, location],
	);
	// The picker stays blank until the term is long enough — no directory dump on open.
	const pickerReady = modelQuery.trim().length >= SEARCH_MIN_CHARS;

	/**
	 * A row's tracking policy — the DIRECTORY's answer when it has the SKU, else the
	 * policy the STORED line was captured under. The fallback is what keeps an edit's
	 * serial picker (and its `serials` as the quantity) on screen before the master
	 * read lands; it cannot mislabel a fresh row, because those carry no stored
	 * policy.
	 */
	const lineTracking = (line: OutboundLineDraft): MroTracking => {
		const model = modelOf(line);
		return model ? trackingOf(model) : (line.tracking ?? 'standard');
	};

	/** The tracking-aware quantity of one row — the form's ONE binding of the pure
	 *  rule to this form's state (see `outboundLineQty`). */
	const lineQty = (line: OutboundLineDraft): number | null => outboundLineQty(line, lineTracking(line));

	/** A row is complete when it can become a submit-payload row. */
	const isValidLine = (line: OutboundLineDraft): boolean => outboundLineIsComplete(line, lineTracking(line));
	/** A row is blank when nothing was filled in yet (skipped by the payload). */
	const isBlankLine = (line: OutboundLineDraft): boolean => line.modelId === null && line.qty.trim() === '' && line.serials.length === 0;

	const completeLines = lines.filter(isValidLine);
	const hasIncompleteLine = lines.some((line) => !isBlankLine(line) && !isValidLine(line));

	// ── The goods-issue destination ────────────────────────────────────────
	// Shown only once a SERIAL-tracked item is on the document: a serial row is a
	// physical unit, and a physical unit is the only thing a holder can hold. A
	// standard / batch line is a plain store deduction (the engine stamps no holder
	// for it), so the field is ABSENT there rather than present-but-inert.
	const destinationShown = type === 'goods_issue' && lines.some((line) => line.modelId !== null && lineTracking(line) === 'serial');
	// Required once such a row is COMPLETE — i.e. once units are actually about to
	// leave the store. The alternative (leaving it optional) is the silent failure
	// this field exists to close: a unit issued to nobody sits in no truck's and no
	// person's register, and the operator sees it simply disappear.
	const destinationRequired = type === 'goods_issue' && completeLines.some((line) => lineTracking(line) === 'serial');
	const destinationChosen = destKind === 'fleet' ? toVehicle !== null : toEmployee !== null;
	const destinationMissing = destinationRequired && !destinationChosen;
	// The label the trigger states. The stored seed's label is the FALLBACK for the
	// vehicle side: the plate directory is an async master read, so without it a
	// chosen truck would read as unchosen for as long as that read is in flight —
	// on a screen whose whole job is "which document is this?".
	const destinationLabel =
		destKind === 'fleet'
			? toVehicle
				? plateById.get(toVehicle) || (seed?.destinationKind === 'fleet' ? seed.destinationLabel : null)
				: null
			: (toEmployee?.name ?? null);
	// "Add another" must not stack empty rows: the last line has to be filled (or
	// partially typed) before another can be added. Removing a line is always
	// available, so this can never trap the user with an unfillable row.
	const lastLineBlank = lines.length > 0 && isBlankLine(lines[lines.length - 1]);

	const canSubmit = !submitting && completeLines.length > 0 && !hasIncompleteLine && !destinationMissing;

	const addLine = () => {
		hapticImpact('light');
		setLines((current) => [...current, newLine()]);
	};

	const removeLine = (key: number) => {
		hapticImpact('light');
		setLines((current) => current.filter((line) => line.key !== key));
	};

	const patchLine = (key: number, patch: Partial<OutboundLineDraft>) => {
		setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
	};

	const openPicker = (key: number) => {
		hapticImpact('light');
		setModelQuery('');
		setPickerFor(key);
	};

	const openSerialPicker = (key: number) => {
		hapticImpact('light');
		setSerialPickerFor(key);
	};

	/** Toggle one available serial on a line. There is NO cap: a serial row's
	 *  quantity IS its picks (`outboundLineQty`), so no other number exists for a cap
	 *  to protect. Comparison is case-insensitive — `ty-1` and `TY-1` are ONE unit to
	 *  the engine's uniqueness check, so they must be one here too. */
	const toggleSerial = (key: number, serial: string) => {
		const same = (value: string) => value.trim().toUpperCase() === serial.trim().toUpperCase();
		setLines((current) =>
			current.map((line) => {
				if (line.key !== key) return line;
				if (line.serials.some(same)) return { ...line, serials: line.serials.filter((value) => !same(value)) };
				return { ...line, serials: [...line.serials, serial] };
			}),
		);
	};

	const pickModel = (key: number, modelId: string) => {
		hapticImpact('light');
		// A new model resets everything that described the OLD one: the tracking-dependent
		// fields (batch no / serials), the request's target (it was that request's count
		// for THAT item), and the stored line's name + policy — a row the operator has
		// just re-pointed is no longer the stored line, so keeping its old identity would
		// let a stale fallback answer for the new SKU.
		setLines((current) =>
			current.map((line) =>
				line.key === key ? { ...line, modelId, modelName: null, tracking: null, serials: [], requestedQty: null, unitPrice: null } : line,
			),
		);
		setPickerFor(null);
	};

	const submit = async () => {
		if (!canSubmit || !submitGuard.begin()) return;
		hapticImpact('medium');
		setSubmitting(true);
		setError(null);
		// The DESTINATION pair. An EDIT states BOTH columns outright so the one the
		// document no longer uses is EMPTIED: switching a draft from a truck to a person
		// (or dropping the last serial line, which hides the field) must not leave the old
		// holder set beside the new one — the schema allows ONE holder, and a row carrying
		// both would say the units went to two places. A create has nothing to clear, so
		// it simply omits the column it was not given.
		const destinationFields: Pick<UpdateOutboundDraft, 'to_vehicle' | 'to_employee'> = seed
			? {
					to_vehicle: type === 'goods_issue' && destKind === 'fleet' ? toVehicle : null,
					to_employee: type === 'goods_issue' && destKind === 'employee' ? (toEmployee?.id ?? null) : null,
				}
			: {
					...(type === 'goods_issue' && destKind === 'fleet' && toVehicle ? { to_vehicle: toVehicle } : {}),
					...(type === 'goods_issue' && destKind === 'employee' && toEmployee ? { to_employee: toEmployee.id } : {}),
				};
		// The SOURCE REQUEST this issue is tied to — re-stated on an edit, so an edit can
		// neither drop the link nor invent one, and taken from the create context
		// otherwise (a goods-issue opened from a store request, which the service uses to
		// track that request's fulfilment).
		const requestId = seed ? seed.requestId : (initialRequestId ?? null);
		// An EDIT states the note outright — emptying it has to be able to send `null`,
		// where a create simply leaves the field out and keeps the engine's default.
		const noteFields = seed ? { note: note.trim() || null } : note.trim() ? { note: note.trim() } : {};
		const draft: UpdateOutboundDraft = {
			type,
			effective_date: effectiveDate ? dateToInputValue(effectiveDate) : todayMmtDate(),
			location,
			...(type === 'goods_issue' && requestId ? { request: requestId } : {}),
			...destinationFields,
			...noteFields,
			lines: completeLines.flatMap((line) => {
				// The row's OWN id is enough — the directory only NAMES the SKU. The fallback
				// matters on an edit: a SKU missing from the cached directory must still be
				// saved as it was, because dropping the line would silently delete stock from
				// the document.
				const modelId = modelOf(line)?.id ?? line.modelId;
				// The SAME derivation the running total and the submit gate read — the
				// payload can never carry a quantity the form was not showing.
				const qty = lineQty(line);
				if (!modelId || qty === null || qty <= 0) return [];
				const tracking = lineTracking(line);
				return [
					{
						item_model: modelId,
						qty,
						...(tracking === 'serial' ? { serials: line.serials } : {}),
						// The stored cost basis is RE-STATED, never edited — the child table is
						// replaced by this payload, so a column the form does not collect would
						// otherwise be dropped (and the confirm's `total_amount` with it).
						...(line.unitPrice != null ? { unit_price: line.unitPrice } : {}),
					},
				];
			}),
		};
		try {
			// Same form, same payload shape — only the verb differs: an edit SAVES the
			// document it was seeded with (the engine replaces its child lines with this
			// payload), a create files a new one.
			if (seed) await updateOutboundDoc(seed.id, draft);
			else await createOutboundDoc(draft as CreateOutboundDraft);
			onDone();
		} catch (err) {
			// Engine validation (e.g. a `lines` rule) surfaces its message inline —
			// the form stays open with the user's rows intact for a retry.
			console.error('[goods-issues] save failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Could not save the record. Please try again.');
			setSubmitting(false);
			submitGuard.end();
		}
	};

	// The submit affordance: the native MainButton on Android/Desktop Telegram
	// (Apple clients fall back — native iOS clips Burmese labels); the in-page
	// button everywhere else. Never both — same rule as the BackButton pill.
	// Tucked away while ANY sheet is open so it cannot be tapped behind a backdrop,
	// and ABSENT entirely in read-only mode: there is nothing to save, so a button
	// would be a promise the form cannot keep.
	const isMainButton = useTelegramMainButton({
		text: submitting ? 'Saving…' : 'Save Draft',
		onClick: () => void submit(),
		visible: !readOnly && !locationOpen && pickerFor === null && serialPickerFor === null && !vehiclePickerOpen && !employeePickerOpen,
		disabled: !canSubmit,
		loading: submitting,
	});

	// WHY nothing can be changed is NOT stated here: the document page's status pill IS
	// that statement (`Confirmed` / `Cancelled`). A second sentence under the pill — or in
	// this form — would print the same fact twice, in two voices free to drift apart.

	return (
		<div className="flex flex-1 flex-col gap-3 pt-2">
			{/* Source-request reference — a goods-issue opened from a store request
				shows the REQ it fulfils so the operator sees what they are issuing. */}
			{requestRefLabel && (
				<div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card/60 px-3 py-2.5 text-xs leading-myanmar text-muted-foreground">
					<Package strokeWidth={1.6} className="size-4 shrink-0 text-primary" aria-hidden />
					<span className="font-medium">From request</span>
					<span className="font-semibold text-foreground">{requestRefLabel}</span>
					<span className="ml-auto">This issue links back to it.</span>
				</div>
			)}

			{/* 1 — Effective date + store, SIDE BY SIDE — WHEN the units leave beside
			    WHERE they leave from: the two facts an issue header is read for, and
			    neither picker states more than its own value, so neither needs a row of
			    its own. The store's sheet is portal-only, so the row's two cells are
			    exactly the two fields. */}
			<section className={fieldRowClass}>
				<FormField label="Select date" required group>
					{() => (
						<DatePicker
							value={effectiveDate}
							onValueChange={setEffectiveDate}
							placeholder="Select date"
							format={APP_DATE_FORMAT}
							disabled={locked}
							className={fieldClass}
						/>
					)}
				</FormField>

				{/* 2 — Store location — a bottom-sheet single-select over the five
				    MRO stores (the app's select-sheet convention): the OTHER half of the
				    same row. */}
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

			{/* 3 — The dynamic LINES editor — one row per SKU to issue / scrap. */}
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
							Add item
						</button>
					)}
				</div>

				{lines.length > 0 ? (
					<ul className="flex flex-col gap-2">
						{lines.map((line, index) => {
							const model = modelOf(line);
							const tracking = lineTracking(line);
							const isSerial = tracking === 'serial';
							const typedSerials = line.serials.length;
							// The count the source request asked for — an advisory target, never a cap.
							const target = line.requestedQty;
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

									{/* Quantity — a STANDARD / BATCH row's typed amount. A serial row has no
									    qty input: its quantity IS the units picked below, so offering a second
									    place to type it could only create a disagreement the engine refuses at
									    confirm (and capping the picks at it was the "one serial only" bug). */}
									{!isSerial && (
										<div className="mt-1.5">
											<Input
												type="number"
												min={0}
												step="any"
												inputMode="decimal"
												value={line.qty}
												onChange={(event) => patchLine(line.key, { qty: event.target.value })}
												placeholder="Quantity"
												disabled={locked}
												aria-label="Quantity"
												className="h-10 rounded-lg px-3"
											/>
										</div>
									)}

									{/* Serial models — the exact units, PICKED from the in-stock list at
									    this store (never typed: the sheet only offers available units). */}
									{isSerial && (
										<div className="mt-1.5">
											<p className={`${labelClass} mb-1`}>
												Serial numbers
												<RequiredMark />
											</p>
											<button
												type="button"
												disabled={locked}
												onClick={() => openSerialPicker(line.key)}
												aria-label="Select serials"
												className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm leading-myanmar outline-none transition-colors focus:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
											>
												<Package strokeWidth={1.6} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
												<span
													className={`min-w-0 flex-1 truncate ${typedSerials > 0 ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
												>
													{typedSerials > 0 ? `${typedSerials} serial${typedSerials === 1 ? '' : 's'} selected` : 'Select serials'}
												</span>
												{target !== null && target > 0 && (
													<span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
														{typedSerials}/{target}
													</span>
												)}
												<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
											</button>
											{typedSerials > 0 && (
												<div className="mt-1.5 flex flex-wrap gap-1">
													{line.serials.map((serial) => (
														<span key={serial} className="rounded-full bg-secondary/60 px-2 py-0.5 text-meta font-medium text-foreground">
															{serial}
														</span>
													))}
												</div>
											)}
											{/* The target is the SOURCE REQUEST's count — it guides, it never blocks: the
											    row is submittable on one unit, because issuing less than asked is a real
											    outcome (the request tracks it as a partial issue). */}
											{target !== null && typedSerials < target ? (
												<p className="mt-1 text-meta font-medium leading-myanmar text-status-warning">
													The request asked for {target} — {target - typedSerials} still to pick.
												</p>
											) : target !== null && typedSerials > target ? (
												<p className="mt-1 text-meta font-medium leading-myanmar text-status-warning">
													More than the {target} this request asked for.
												</p>
											) : (
												<p className="mt-1 text-meta leading-myanmar text-muted-foreground">
													Pick the exact in-stock units — one unit each, so the quantity is how many you pick.
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

			{/* 4 — The goods-issue DESTINATION — where the item-by-item units go. Present
			    only for a goods issue that carries a serial-tracked item (see
			    `destinationShown`): a consumable line has no holder for a destination to
			    name, so the field is absent rather than present-and-inert. */}
			{destinationShown && (
				<section>
					<p className={`${labelClass} mb-0`}>
						Issue to
						{destinationRequired && <RequiredMark />}
					</p>

					{/* TWO kinds of holder, one choice — a truck's inventory or a person's
					    custody. Selecting a kind CLEARS the other side, so the document can
					    never head out with both (the backend refuses that outright). */}
					<div className="mt-1.5 flex flex-wrap gap-1.5">
						<button
							type="button"
							disabled={locked}
							onClick={() => {
								hapticImpact('light');
								setDestKind('fleet');
							}}
							aria-pressed={destKind === 'fleet'}
							className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-meta font-semibold leading-none disabled:opacity-50 ${
								destKind === 'fleet' ? 'border-ring/60 bg-primary/10 text-primary' : 'border-border/70 bg-muted/30 text-foreground'
							}`}
						>
							<Truck className="size-3.5" aria-hidden />
							Fleet
						</button>
						<button
							type="button"
							disabled={locked}
							onClick={() => {
								hapticImpact('light');
								setDestKind('employee');
							}}
							aria-pressed={destKind === 'employee'}
							className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-meta font-semibold leading-none disabled:opacity-50 ${
								destKind === 'employee' ? 'border-ring/60 bg-primary/10 text-primary' : 'border-border/70 bg-muted/30 text-foreground'
							}`}
						>
							<User className="size-3.5" aria-hidden />
							Employee
						</button>
					</div>

					{/* The chosen holder — the plate / the person's name, so the operator can
					    read back WHO is about to take the units before saving. */}
					<button
						type="button"
						disabled={locked}
						onClick={() => {
							hapticImpact('light');
							if (destKind === 'fleet') setVehiclePickerOpen(true);
							else setEmployeePickerOpen(true);
						}}
						aria-label={destKind === 'fleet' ? 'Select a truck' : 'Select an employee'}
						className="mt-2 flex min-h-10 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm leading-myanmar outline-none transition-colors focus:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
					>
						{destKind === 'fleet' ? (
							<Truck strokeWidth={1.6} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
						) : (
							<User strokeWidth={1.6} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
						)}
						<span className={`min-w-0 flex-1 truncate ${destinationLabel ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
							{destinationLabel ?? (destKind === 'fleet' ? 'Select a truck' : 'Select an employee')}
						</span>
						<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
					</button>

					<p className="mt-1 text-meta leading-myanmar text-muted-foreground">
						{destKind === 'fleet'
							? 'The item-by-item units land in this truck’s inventory — its wheel board fits them from there.'
							: 'The item-by-item units go into this person’s custody.'}{' '}
						Consumables are a plain store deduction either way.
					</p>

					{/* The submit gate states its own reason instead of leaving a disabled button
					    unexplained (a serial unit issued to nobody would appear on no register). */}
					{destinationMissing && (
						<p className="mt-1 text-meta font-medium leading-myanmar text-status-warning">
							Choose where the serial units go — a truck or an employee.
						</p>
					)}
				</section>
			)}

			{/* 5 — Note — a free-text description. */}
			<section>
				<label htmlFor="outbound-note" className={labelClass}>
					Note
				</label>
				<Textarea
					id="outbound-note"
					value={note}
					onChange={(event) => setNote(event.target.value)}
					placeholder="Add a note (optional)"
					rows={3}
					disabled={locked}
					className="rounded-lg bg-card px-3 text-sm leading-myanmar"
				/>
			</section>

			{/* Local validation hint — a row was started but left incomplete. */}
			{hasIncompleteLine && (
				<p className="rounded-md bg-status-warning-soft px-3 py-2 text-xs font-medium leading-myanmar text-status-warning">
					There are incomplete lines — fill in the item and quantity (a serial item is complete once you pick its units), or remove the
					line.
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
							placeholder="Search items…"
							value={modelQuery}
							onValueChange={setModelQuery}
							className="mt-3"
							inputClassName="h-8.5 text-xs! px-3 rounded-full"
						/>
					</SheetHeader>
					<ScrollArea className="h-[45dvh] px-4 pb-safe">
						{!pickerReady ? (
							<PickerSearchHint noun="search items" />
						) : models.isPending || onHand.isPending ? (
							<p className="px-3 py-8 text-center text-sm leading-myanmar text-muted-foreground">Loading items…</p>
						) : models.isError || onHand.isError ? (
							<div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
								<p className="text-sm leading-myanmar text-status-danger">Couldn't load the items.</p>
								<button
									type="button"
									onClick={() => {
										if (models.isError) void models.refetch();
										if (onHand.isError) void onHand.refetch();
									}}
									className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
								>
									Retry
								</button>
							</div>
						) : modelCandidates.length > 0 ? (
							<ul className="flex flex-col gap-0.5">
								{modelCandidates.map((model) => {
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
												{/* How much is there to draw on — the figure the row was filtered by,
												    so the list never hides why an entry is absent. */}
												<span className="shrink-0 text-xs font-semibold tabular-nums leading-myanmar text-muted-foreground">
													{burmeseDigits(stockAt(model.id))}
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
							<p className="px-3 py-8 text-center text-sm leading-myanmar text-muted-foreground">
								{/* The two empty states are different answers, so they read differently:
								    a catalogue miss is not the same as "nothing here is in stock". */}
								{matchedModels.length > 0 ? `Nothing in stock at ${MRO_LOCATION_LABELS[location] ?? location}` : 'No items found'}
							</p>
						)}
					</ScrollArea>
				</SheetContent>
			</Sheet>

			{/* The destination pickers — the shared vehicle / personnel sheets, so this
			    form's holder choice has the same anatomy as every other place that names one.
			    Closed outright in read-only mode: a sheet the trigger cannot reach is a
			    surface with no reason to exist. */}
			<VehiclePickerSheet
				open={vehiclePickerOpen && !readOnly}
				onOpenChange={setVehiclePickerOpen}
				selectedId={toVehicle}
				onSelect={(vehicleId) => {
					setToVehicle(vehicleId);
					setVehiclePickerOpen(false);
				}}
			/>
			<PersonnelPickerSheet
				open={employeePickerOpen && !readOnly}
				onOpenChange={setEmployeePickerOpen}
				value={toEmployee ? [toEmployee] : []}
				onToggle={(person) => setToEmployee(person)}
				singleSelect
				title="Select an employee"
			/>

			{/* The serial-availability picker — the in-stock units at the target store,
			    picked instead of typed (so an unknown / elsewhere / expired unit can
			    never be entered). */}
			<SerialPickerSheet
				line={lines.find((line) => line.key === serialPickerFor) ?? null}
				location={location}
				onToggle={(serial) => {
					if (serialPickerFor !== null) toggleSerial(serialPickerFor, serial);
				}}
				onClose={() => setSerialPickerFor(null)}
			/>
		</div>
	);
}

/**
 * The serial-availability bottom sheet — ONE serial row's exact units, read from
 * `GET /api/mro/stock/items/:modelId?location=` (in-stock units at THIS store,
 * server-scoped). Rows toggle on/off and there is NO cap: the picks ARE the row's
 * quantity (see `outboundLineQty`), so the operator may select as many as the store
 * holds — a count the row is still short of is stated, not enforced. An expired unit
 * is refused by the server at confirm, so it is filtered out here too — the operator
 * only ever sees what can actually be issued.
 */
function SerialPickerSheet({
	line,
	location,
	onToggle,
	onClose,
}: {
	line: OutboundLineDraft | null;
	location: MroLocation;
	onToggle: (serial: string) => void;
	onClose: () => void;
}) {
	const [query, setQuery] = useState('');
	const modelId = line?.modelId ?? null;
	const selected = line?.serials ?? [];
	/** The count the source request asked for — the sheet's header reads it, nothing
	 *  in here is capped by it. */
	const target = line?.requestedQty ?? null;

	const stock = useQuery({
		queryKey: ['mro', 'item-stock', modelId, location],
		queryFn: () => mroApi.itemStock(modelId as string, location),
		enabled: modelId !== null,
		staleTime: 15_000,
	});

	const q = query.trim().toLowerCase();
	const rows = (stock.data?.serials ?? [])
		.filter((unit) => !unit.expired)
		.filter((unit) => !q || (unit.serial_no ?? '').toLowerCase().includes(q));

	return (
		<Sheet
			open={line !== null}
			onOpenChange={(open) => {
				if (!open) {
					setQuery('');
					onClose();
				}
			}}
		>
			<SheetContent side="bottom" className="max-h-[85dvh]">
				<SheetHeader className="pb-1">
					<SheetTitle>
						Select serials
						<span className="ml-2 text-sm font-medium tabular-nums text-muted-foreground">
							{selected.length}
							{target !== null && target > 0 ? `/${target}` : ''}
						</span>
					</SheetTitle>
					<SearchBox
						placeholder="Search serial number"
						value={query}
						onValueChange={setQuery}
						className="mt-3"
						inputClassName="h-8.5 text-xs! px-3 rounded-full"
					/>
				</SheetHeader>
				<ScrollArea className="h-[45dvh] px-4 pb-safe">
					{stock.isPending ? (
						<p className="px-3 py-8 text-center text-sm leading-myanmar text-muted-foreground">Loading units…</p>
					) : stock.isError ? (
						<div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
							<p className="text-sm leading-myanmar text-status-danger">Couldn't load the in-stock units.</p>
							<button
								type="button"
								onClick={() => void stock.refetch()}
								className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
							>
								Retry
							</button>
						</div>
					) : rows.length > 0 ? (
						<ul className="flex flex-col gap-0.5">
							{rows.map((unit) => {
								const serial = unit.serial_no ?? unit.id;
								const isSelected = selected.some((value) => value.trim().toUpperCase() === serial.trim().toUpperCase());
								return (
									<li key={unit.id}>
										<button
											type="button"
											onClick={() => onToggle(serial)}
											className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										>
											<span className="flex min-w-0 flex-1 flex-col">
												<span className="truncate text-sm font-medium text-foreground">{serial}</span>
												{unit.days_left != null && (
													<span
														className={`text-xs leading-myanmar ${unit.days_left <= 30 ? 'text-status-warning' : 'text-muted-foreground'}`}
													>
														Expires in {unit.days_left} day{unit.days_left === 1 ? '' : 's'}
													</span>
												)}
											</span>
											<span
												className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
													isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
												}`}
											>
												{isSelected && <Check className="size-3" strokeWidth={3} aria-hidden />}
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					) : (
						<p className="px-3 py-8 text-center text-sm leading-myanmar text-muted-foreground">No in-stock serials at this store.</p>
					)}
				</ScrollArea>
			</SheetContent>
		</Sheet>
	);
}
