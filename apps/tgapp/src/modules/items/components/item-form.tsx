import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FIELD_LABEL_CLASS as labelClass, FIELD_CLASS as fieldClass } from '@/shared/components/form-styles';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ImagePlus, Loader2, Package, Plus, X } from 'lucide-react';
import { Button } from '@mmbix/design-system/button';
import { Input } from '@mmbix/design-system/input';
import { ScrollArea } from '@mmbix/design-system/scroll-area';
import { SearchBox } from '@mmbix/design-system/search-box';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';

import { createItemNameMaster, fetchItemNameById, uploadItemImage } from '../data/api';
import type { ItemModelCreateInput } from '../data/api';
import type { MasterPick } from '../data/types';
import { qk } from '../data/query-keys';
import { MRO_ITEM_NAMES_QUERY_KEY, upsertMasterDirectory, useMroItemNames, type MroItemNameRow } from '@/shared/hooks/use-mro-masters';
import { ImageCropSheet } from '@/shared/components/image-crop-sheet';
import { FormField } from '@/shared/components/form-field';
import { RequiredMark } from '@/shared/components/required-mark';
import { useFormDirty, useSubmitGuard } from '@/shared/components/form-state';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import { MASTER_STALE_MS, SEARCH_MIN_CHARS } from '@/shared/constants';
import { PickerSearchHint } from '@/shared/components/picker-search-hint';
import { MRO_TRACKING, MRO_TRACKING_LABELS, stockItemPath, type MroTracking } from '@/shared/mro';
import { hapticImpact } from '@/shared/platform/haptics';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';

const policyChipClass = (active: boolean) =>
	`flex-1 rounded-full border px-2 py-1 text-meta font-semibold leading-myanmar transition-colors ${
		active ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card text-muted-foreground'
	}`;

const POLICY_HINTS: Record<MroTracking, string> = {
	standard: 'No batch/serial — tracks stock quantity only',
	batch: 'Each lot tracked with its own expiry',
	serial: 'Each unit tracked separately by serial number',
};

/** '' → null (no alert); a whole non-negative number → that many days; anything
 *  else (fractions / garbage) → 'invalid' so the form can show an inline error. */
function parseAlertDays(raw: string): number | null | 'invalid' {
	const value = raw.trim();
	if (value === '') return null;
	const days = Number(value);
	if (!Number.isFinite(days) || !Number.isInteger(days) || days < 0) return 'invalid';
	return days;
}

/**
 * A user-facing upload failure message — distinguishes the causes the media
 * route actually reports so the operator knows what to do: a too-large photo
 * (413) or a file the server won't accept (400/415/422) needs a different
 * picture, anything else is worth a retry. Reads the SDK error's `status`.
 */
function uploadErrorMessage(err: unknown): string {
	const status = err && typeof err === 'object' && 'status' in err ? (err as { status?: unknown }).status : undefined;
	if (status === 413) return 'Image is too large — choose a smaller one.';
	if (status === 400 || status === 415 || status === 422) return 'Unsupported image file — choose a new PNG/JPEG.';
	return 'Image upload failed — please try again.';
}

/** A loaded row's editable state — what the edit page hands the form. */
export interface ItemFormInitial {
	/** English display name (`name_en`). */
	name_en: string;
	/** Burmese display name (`name_mm`) — empty when no translation is set. */
	nameMm: string;
	/** The policy the row ALREADY inherits from its item name — read off the row's
	 *  expanded `item_name.tracking` by the edit page, and used as the display
	 *  fallback until the shared master directory resolves. */
	tracking: MroTracking;
	expiryAlertDays: number | null;
	/** The stored photo — an R2 media URL (`/api/media/<key>`) or null. */
	image: string | null;
	itemName: MasterPick | null;
}

interface ItemFormProps {
	/** create / edit — the field set is identical; only the submit wording +
	 *  the auto-composed display name differ. */
	mode: 'create' | 'edit';
	/** Edit only — the row's current values (rendered after the row loads). */
	initial?: ItemFormInitial;
	/** Edit only — the row's own `mro_item_model` id, for the Balance sheet
	 *  (a create has no stored stock to look up). */
	modelId?: string;
	/** Create only — `?item_name=` preselect (the groups deep link). */
	itemNameParam?: string | null;
	/** Persist the payload — the page wires create vs update + list invalidation + back-nav. */
	save: (input: ItemModelCreateInput) => Promise<void>;
	/** The submit affordances' wording (varies create vs edit). */
	submitLabel: string;
	savingLabel: string;
	/** The failure banner's wording (mode-specific). */
	errorMessage: string;
}

/** The shared ပစ္စည်းအသစ် / ပစ္စည်း ပြင်ဆင်မည် form — one implementation for both
 *  the create and the edit page, so the two can never drift:
 *
 *   1. ပစ္စည်းအုပ်စု — a searchable `mro_item_name` bottom-sheet picker whose
 *      sheet also carries a quick-add row (create the master inline when the
 *      typed name matches nothing) PLUS the policy choice the new master must
 *      declare — a master without a policy cannot be created;
 *   2. ပစ္စည်းအမည် — required English display name; in CREATE mode it
 *      auto-composes from the picked အုပ်စု until the user edits it by hand; in
 *      EDIT mode the stored name is kept untouched (a hand-written display must
 *      never be silently rewritten). Written to the indexed `name_en`;
 *   3. မြန်မာအမည် — the optional Burmese name (`name_mm`);
 *   4. စာရင်းသွင်းနည်း (Tracking) — READ-ONLY, inherited from the item name;
 *   5. သက်တမ်း သတိပေးရက် — shown only for a batch/serial master.
 *
 * Submit goes through the Telegram MainButton (in-page fallback on Apple
 * clients). Every pick/selection is confirmed with a light haptic, matching the
 * rest of the app.
 */

/** A searchable master picker sheet with an inline quick-add row —
 *  `quickAddExtra` is the slot the item-name picker uses for the policy the new
 *  master must declare (a `mro_item_name` carries its SKUs' tracking policy). */
function MasterPickerSheet({
	open,
	onOpenChange,
	title,
	searchPlaceholder,
	query,
	onQueryChange,
	pending,
	isError,
	onRetry,
	candidates,
	selectedId,
	onPick,
	quickAddLabel,
	onQuickAdd,
	quickAdding,
	quickAddExtra,
	addError,
	emptyText,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	searchPlaceholder: string;
	query: string;
	onQueryChange: (value: string) => void;
	pending: boolean;
	isError: boolean;
	onRetry: () => void;
	candidates: Array<{ id: string; name?: string | null }>;
	selectedId: string | null;
	onPick: (master: { id: string; name?: string | null }) => void;
	quickAddLabel: string | null;
	onQuickAdd: () => void;
	quickAdding: boolean;
	/** Rendered under the quick-add row — extra input the new master needs. */
	quickAddExtra?: ReactNode;
	addError: string | null;
	emptyText: string;
}) {
	// The list waits for a searchable term — opening must never dump the directory.
	const ready = query.trim().length >= SEARCH_MIN_CHARS;
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="bottom" className="max-h-[85dvh]">
				<SheetHeader className="pb-1">
					<SheetTitle>{title}</SheetTitle>
					<SearchBox
						placeholder={searchPlaceholder}
						value={query}
						onValueChange={onQueryChange}
						className="mt-3"
						inputClassName="h-8.5 text-xs! px-3 rounded-full"
					/>
				</SheetHeader>
				<ScrollArea className="h-[45dvh] px-4 pb-safe">
					{/* Quick-add is a CREATE action, not a search — it stays available as
						soon as a name is typed (a new master can be short, e.g. "BP"). The
						LIST below waits for a searchable term. */}
					{quickAddLabel ? (
						<button
							type="button"
							disabled={quickAdding}
							onClick={() => {
								hapticImpact('light');
								onQuickAdd();
							}}
							className="mb-1 flex w-full items-center gap-2 rounded-md bg-primary/5 px-3 py-2.5 text-left transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
						>
							<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
								<Plus className="size-3.5" strokeWidth={2.4} aria-hidden />
							</span>
							<span className="min-w-0 flex-1 truncate text-sm font-semibold leading-6.5 text-foreground">
								{quickAdding ? 'Adding…' : quickAddLabel}
							</span>
						</button>
					) : null}

					{quickAddExtra}

					{addError ? <p className="mb-1 px-1 text-xs font-medium leading-myanmar text-destructive">{addError}</p> : null}

					{!ready ? (
						<PickerSearchHint />
					) : pending ? (
						<p className="px-3 py-8 text-center text-sm leading-myanmar text-muted-foreground">Loading…</p>
					) : isError ? (
						<div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
							<p className="text-sm leading-myanmar text-status-danger">Could not load the list.</p>
							<button
								type="button"
								onClick={onRetry}
								className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
							>
								Try Again
							</button>
						</div>
					) : candidates.length > 0 ? (
						<ul className="flex flex-col gap-0.5">
							{candidates.map((master) => {
								const selected = master.id === selectedId;
								return (
									<li key={master.id}>
										<button
											type="button"
											onClick={() => {
												hapticImpact('light');
												onPick(master);
											}}
											className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										>
											<span className="min-w-0 flex-1 truncate text-sm font-medium leading-6.5 text-foreground">
												{master.name?.trim() || '—'}
											</span>
											{selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
										</button>
									</li>
								);
							})}
						</ul>
					) : (
						<p className="px-3 py-8 text-center text-sm leading-myanmar text-muted-foreground">{emptyText}</p>
					)}
				</ScrollArea>
			</SheetContent>
		</Sheet>
	);
}

export default function ItemForm({ mode, initial, modelId, itemNameParam, save, submitLabel, savingLabel, errorMessage }: ItemFormProps) {
	const queryClient = useQueryClient();

	const [itemName, setItemName] = useState<MasterPick | null>(() => initial?.itemName ?? null);
	const [nameMm, setNameMm] = useState(() => initial?.nameMm ?? '');
	const [name, setName] = useState(() => initial?.name_en ?? '');
	// The policy a NEW item-name master should declare (the quick-add row inside
	// the ပစ္စည်းအုပ်စု sheet) — the SKU form itself never picks one.
	const [newGroupPolicy, setNewGroupPolicy] = useState<MroTracking>('standard');
	const [alertDays, setAlertDays] = useState(() => (initial?.expiryAlertDays == null ? '' : String(initial.expiryAlertDays)));
	// The model's photo — an R2 media URL. Starts from the loaded row (edit) or
	// clear; assigning a URL after a successful upload is the single source of
	// truth (a half-uploaded local blob is only ever a transient preview.
	const [image, setImage] = useState<string | null>(() => initial?.image ?? null);
	const [imageBusy, setImageBusy] = useState(false);
	const [imageError, setImageError] = useState<string | null>(null);
	// What the `<img>` shows — the stored URL, or a transient object-URL preview
	// of the freshly-edited file while the upload to R2 is still in flight.
	const [preview, setPreview] = useState<string | null>(() => initial?.image ?? null);
	// A just-picked photo awaiting crop — non-null opens the full-screen editor.
	const [editorFile, setEditorFile] = useState<File | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [itemNameSheetOpen, setItemNameSheetOpen] = useState(false);
	const [itemNameQuery, setItemNameQuery] = useState('');
	const [itemNameAddError, setItemNameAddError] = useState<string | null>(null);
	const [quickAddingItemName, setQuickAddingItemName] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	// Edit mode — the page's `useQuery` can hand the form a CACHED row first and
	// deliver the FRESH row a moment later (TanStack v5 serves stale-cache data
	// while revalidating in the background by default). Seeding state only in
	// `useState` would freeze the form on the stale row forever — so re-seed
	// every field whenever the loaded-row input changes identity. Create mode
	// has no `initial` (undefined) — the effect never runs, leaving the
	// auto-compose behaviour untouched.
	useEffect(() => {
		if (mode !== 'edit' || !initial) return;
		setItemName(initial.itemName ?? null);
		setNameMm(initial.nameMm ?? '');
		setName(initial.name_en ?? '');
		setAlertDays(initial.expiryAlertDays == null ? '' : String(initial.expiryAlertDays));
		setImage(initial.image ?? null);
		setPreview(initial.image ?? null);
		setImageError(null);
		setEditorFile(null);
		// `initial`'s identity IS the change signal the effect must follow.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [initial]);

	// In create mode the display name mirrors the picked အုပ်စု until the user
	// types one by hand; in edit mode the stored name is the operator's
	// hand-written display and is NEVER auto-rewritten.
	const nameEdited = useRef(mode === 'edit');

	const alertDaysValue = parseAlertDays(alertDays);
	const trimmedName = name.trim();
	// Dirty gate — an edit must differ from the loaded row; a create from the blank
	// defaults. The picker / add-sheet UI state is excluded — it is not a field.
	const dirty = useFormDirty(
		{
			itemName: initial?.itemName ?? null,
			nameMm: initial?.nameMm ?? '',
			name: initial?.name_en ?? '',
			alertDays: initial?.expiryAlertDays == null ? '' : String(initial.expiryAlertDays),
			image: initial?.image ?? null,
		},
		{ itemName, nameMm, name, alertDays, image },
	);
	// The SKU is only complete with an item name: the master is where the stock
	// tracking policy lives, so an unclassified SKU would have no policy at all.
	const canSubmit =
		trimmedName !== '' &&
		itemName !== null &&
		alertDaysValue !== 'invalid' &&
		!imageBusy &&
		!editorFile &&
		!submitting &&
		!imageError &&
		dirty;

	// The picker's rows — the SHARED whole-set master directory (see
	// `shared/hooks/use-mro-masters`): the masters-hub tabs + the inbound form's
	// supplier picker read the SAME cache entries, and every writer invalidates
	// the same key, so a master added on another screen shows here on the next
	// picker open (master freshness window).
	const itemNameMasters = useMroItemNames();

	// The stock policy INHERITED from the picked item name (`mro_item_name.tracking`)
	// — the SKU has no policy of its own. On the edit page the row's own resolution
	// is the fallback while the shared master directory is still loading.
	const inheritedTracking: MroTracking = useMemo(() => {
		const master = (itemNameMasters.data ?? []).find((candidate) => candidate.id === itemName?.id);
		const raw = master?.tracking ?? (mode === 'edit' ? initial?.tracking : null);
		return MRO_TRACKING.some((tracking) => tracking.value === raw) ? (raw as MroTracking) : 'standard';
	}, [itemNameMasters.data, itemName, mode, initial]);

	// သက်တမ်း သတိပေးရက် only means something when the model can carry an
	// expiry — the backend expiry feed reads batch lots AND serial units, never
	// plain qty (standard). So the field is hidden for standard and shown (with
	// different emphasis) for batch/serial.
	const trackingHasExpiry = inheritedTracking === 'batch' || inheritedTracking === 'serial';

	// Create only — the `?item_name=` preselect's display name. Fetched by id
	// (not from the whole-set query): the sheet may never have been opened, so
	// its cache may be empty.
	const preselectedItemName = useQuery({
		queryKey: qk.preselectedItemName(itemNameParam ?? ''),
		queryFn: () => fetchItemNameById(itemNameParam ?? ''),
		enabled: mode === 'create' && itemNameParam != null && itemName === null,
		staleTime: MASTER_STALE_MS,
	});

	useEffect(() => {
		if (mode !== 'create' || itemNameParam == null || itemName !== null || !preselectedItemName.data) return;
		const master = preselectedItemName.data;
		setItemName({ id: master.id, name: master.name?.trim() || null });
	}, [mode, itemNameParam, itemName, preselectedItemName.data]);

	// Client-side name search over the loaded rows (identical to the supplier
	// picker in the inbound form).
	const itemNameCandidates = useMemo(() => {
		const query = itemNameQuery.trim().toLowerCase();
		if (!query) return itemNameMasters.data ?? [];
		return (itemNameMasters.data ?? []).filter((master) => `${master.name ?? ''}`.toLowerCase().includes(query));
	}, [itemNameMasters.data, itemNameQuery]);

	// Quick-add shows only when the typed name is NEW (no exact match) — an
	// existing master must be picked, never duplicated.
	const quickAddItemNameLabel = useMemo(() => {
		const query = itemNameQuery.trim();
		if (!query) return null;
		const duplicate = (itemNameMasters.data ?? []).some((master) => `${master.name ?? ''}`.trim().toLowerCase() === query.toLowerCase());
		return duplicate ? null : `Add new group "${query}"`;
	}, [itemNameQuery, itemNameMasters.data]);

	// Create mode only — auto-compose the display name from the parts.
	useEffect(() => {
		if (mode !== 'create' || nameEdited.current) return;
		const parts = [itemName?.name?.trim()].filter((part): part is string => !!part);
		setName(parts.join(' '));
	}, [mode, itemName]);

	const quickAddItemName = async () => {
		const label = itemNameQuery.trim();
		if (!label || quickAddingItemName) return;
		setQuickAddingItemName(true);
		setItemNameAddError(null);
		try {
			const row: MroItemNameRow = await createItemNameMaster(label, newGroupPolicy);
			setItemName({ id: row.id, name: row.name?.trim() || label });
			setItemNameSheetOpen(false);
			// Write-through — the new master (and the policy it declared) must show in
			// every picker reading the SHARED whole-set directory, not just this form.
			// The server response is the truth, so folding it in costs no extra refetch.
			upsertMasterDirectory(queryClient, MRO_ITEM_NAMES_QUERY_KEY, row);
		} catch {
			setItemNameAddError('Could not add — please try again.');
		} finally {
			setQuickAddingItemName(false);
		}
	};

	const pickItemName = useCallback((master: { id: string; name?: string | null }) => {
		setItemName({ id: master.id, name: master.name?.trim() || null });
		setItemNameSheetOpen(false);
	}, []);

	// ── Image pick → crop → upload ─────────────────────────────────────────
	// A picked photo opens the full-screen crop editor first; only the edited
	// result (the editor's Apply) is uploaded and swapped in. Upload failures
	// leave the current picture untouched.
	const pickForCrop = (file: File | null) => {
		if (!file || imageBusy || submitting) return;
		// Reject only a KNOWN non-image type. Mobile gallery/camera pickers
		// commonly omit `file.type` (empty string) for a perfectly valid photo,
		// and hard-rejecting on missing metadata is the "I picked a photo but
		// nothing uploaded" bug. The crop editor's decoder is the real gate: a
		// file that isn't an image fails to open there.
		if (file.size === 0 || (file.type && !file.type.startsWith('image/'))) {
			setImageError('Choose an image file — PNG/JPEG.');
			return;
		}
		hapticImpact('light');
		setEditorFile(file);
		setImageError(null);
	};

	const uploadEditedImage = async (file: File) => {
		setEditorFile(null); // close the editor the moment Apply is tapped
		setImageBusy(true);
		setImageError(null);
		// Everything — including the local preview URL — lives inside the try, so a
		// `createObjectURL` failure can never strand `imageBusy` true (a spinner that
		// never stops is the silent "nothing happened" this path must never show).
		const previous = image;
		let objectUrl: string | null = null;
		try {
			objectUrl = URL.createObjectURL(file);
			setPreview(objectUrl); // show the edited frame while the upload round-trips
			const uploaded = await uploadItemImage(file);
			URL.revokeObjectURL(objectUrl); // the preview now points at the stored URL
			objectUrl = null;
			setPreview(uploaded.url);
			setImage(uploaded.url);
		} catch (err) {
			if (objectUrl) URL.revokeObjectURL(objectUrl);
			setPreview(previous);
			setImageError(uploadErrorMessage(err));
		} finally {
			setImageBusy(false);
		}
	};

	const closeEditor = () => {
		if (imageBusy || submitting) return;
		setEditorFile(null);
	};

	const clearImage = () => {
		if (imageBusy || submitting) return;
		setImage(null);
		setPreview(null);
		setImageError(null);
	};

	const submit = async () => {
		// Re-parse inside the guard so TS narrows past the 'invalid' branch.
		const finalName = trimmedName;
		const days = parseAlertDays(alertDays);
		// Re-check the image state INSIDE the guard too: the native MainButton mirrors
		// `canSubmit` asynchronously, so a tap in the frame before that lands could
		// otherwise save the OLD photo and navigate away — the silent "image did not
		// change" path.
		if (finalName === '' || days === 'invalid' || submitting || imageBusy || editorFile || imageError || !submitGuard.begin()) return;
		hapticImpact('medium');
		setSubmitting(true);
		setError(null);
		try {
			await save({
				name_en: finalName,
				name_mm: nameMm.trim() || null,
				expiry_alert_days: trackingHasExpiry ? days : null,
				image,
				item_name: itemName?.id ?? '',
			});
			// Success navigation lives in the page's `save` (create → back to the
			// list, edit → back to the list) — this component unmounts with it.
		} catch {
			setError(errorMessage);
			setSubmitting(false);
			submitGuard.end();
		}
	};

	// The submit affordance: the native MainButton on Android/Desktop Telegram
	// (Apple clients fall back — native iOS clips Burmese labels); the in-page
	// button everywhere else. Never both — same rule as the BackButton pill.
	const isMainButton = useTelegramMainButton({
		text: submitting ? savingLabel : submitLabel,
		onClick: () => void submit(),
		disabled: !canSubmit,
		loading: submitting,
		// The crop editor is a full-screen overlay: tuck the native Save button away
		// while it is open so it cannot cover the editor's footer (and cannot be
		// tapped mid-edit).
		visible: editorFile === null,
	});

	// The policy chip a NEW item-name master declares (the sheet's quick-add row).
	const onNewGroupPolicyChange = useCallback((value: MroTracking) => {
		hapticImpact('light');
		setNewGroupPolicy(value);
	}, []);

	return (
		<div className="flex flex-1 flex-col gap-5 pt-2">
			{/* 0 — Photo — optional; pick uploads to R2, swap happens on the returned URL.
			    In EDIT mode the caption's right edge carries Balance, which opens the
			    SKU's stock page — image + totals up top, then every line by the item's
			    OWN tracking method (per-store balances / FEFO lots / serial units). */}
			<section>
				<FormField
					label="Photo"
					group
					action={
						mode === 'edit' && modelId ? (
							<Link
								to={stockItemPath(modelId)}
								state={{ name: initial?.name_en, image: initial?.image }}
								onClick={() => hapticImpact('light')}
								className="shrink-0 rounded-sm text-sub font-semibold leading-myanmar text-primary outline-none transition-opacity active:opacity-60 focus-visible:ring-2 focus-visible:ring-ring"
							>
								Balance
							</Link>
						) : undefined
					}
				>
					{() => (
						<>
							<input
								ref={fileInputRef}
								type="file"
								accept="image/*"
								className="hidden"
								onChange={(e) => {
									const file = e.target.files?.[0] ?? null;
									pickForCrop(file);
									e.target.value = ''; // allow re-picking the same file
								}}
								aria-hidden
							/>
							<button
								type="button"
								disabled={imageBusy || submitting}
								onClick={() => fileInputRef.current?.click()}
								className="relative block aspect-square w-full overflow-hidden rounded-2xl border border-border bg-muted/40 text-center transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
								aria-label={preview ? 'Change photo — tap' : 'Add photo — tap'}
							>
								{imageBusy ? (
									<div className="flex h-full flex-col items-center justify-center gap-2">
										<Loader2 className="size-6 animate-spin text-muted-foreground" strokeWidth={2} aria-hidden />
										<span className="text-xs leading-myanmar text-muted-foreground">Uploading…</span>
									</div>
								) : preview ? (
									<img src={preview} alt={trimmedName || 'Item photo'} className="h-full w-full object-cover" />
								) : (
									<div className="flex h-full flex-col items-center justify-center gap-2">
										<ImagePlus className="size-7 text-muted-foreground" strokeWidth={1.6} aria-hidden />
										<span className="text-xs leading-myanmar text-muted-foreground">Tap to add a photo</span>
									</div>
								)}
							</button>
							{preview && !imageBusy ? (
								<button
									type="button"
									disabled={submitting}
									onClick={clearImage}
									className="mt-2 flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold leading-myanmar text-destructive transition-colors active:scale-95 disabled:opacity-40"
								>
									<X className="size-3.5" strokeWidth={2.2} aria-hidden />
									Remove Photo
								</button>
							) : null}
						</>
					)}
				</FormField>
				{imageError ? (
					<p className="mt-1.5 text-xs font-medium leading-myanmar text-destructive">{imageError}</p>
				) : (
					<p className="mt-1.5 text-xs leading-myanmar text-muted-foreground">The item photo — choose a PNG/JPEG file.</p>
				)}
			</section>

			{/* 1 — ပစ္စည်းအုပ်စု (item_name → mro_item_name) — optional master picker
				with inline quick-add. */}
			<section>
				<FormField label="Item Group">
					{(f) => (
						<Button
							{...f}
							type="button"
							variant="outline"
							disabled={submitting}
							onClick={() => {
								hapticImpact('light');
								setItemNameQuery('');
								setItemNameAddError(null);
								setItemNameSheetOpen(true);
							}}
							className={`${fieldClass} justify-between font-normal`}
						>
							<span className="flex min-w-0 items-center gap-2">
								<Package strokeWidth={1.6} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
								<span className={`truncate ${itemName ? 'text-foreground' : 'text-muted-foreground'}`}>
									{itemName ? itemName.name?.trim() || '—' : 'Select'}
								</span>
							</span>
							<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
						</Button>
					)}
				</FormField>

				<MasterPickerSheet
					open={itemNameSheetOpen}
					onOpenChange={setItemNameSheetOpen}
					title="Select item group"
					searchPlaceholder="Search item group — type a new name to add it"
					query={itemNameQuery}
					onQueryChange={setItemNameQuery}
					pending={itemNameMasters.isPending}
					isError={itemNameMasters.isError}
					onRetry={() => void itemNameMasters.refetch()}
					candidates={itemNameCandidates}
					selectedId={itemName?.id ?? null}
					onPick={pickItemName}
					quickAddLabel={quickAddItemNameLabel}
					onQuickAdd={() => void quickAddItemName()}
					quickAdding={quickAddingItemName}
					quickAddExtra={
						quickAddItemNameLabel ? (
							<div className="mb-1 rounded-md bg-primary/5 px-3 pb-2.5">
								<p className="mb-1.5 text-meta font-semibold leading-myanmar text-muted-foreground">
									Tyre registration — a new group is defined in one step
								</p>
								<div className="flex gap-1.5">
									{MRO_TRACKING.map((tracking) => (
										<button
											key={tracking.value}
											type="button"
											aria-pressed={newGroupPolicy === tracking.value}
											onClick={() => onNewGroupPolicyChange(tracking.value)}
											className={policyChipClass(newGroupPolicy === tracking.value)}
										>
											{MRO_TRACKING_LABELS[tracking.value]}
										</button>
									))}
								</div>
							</div>
						) : null
					}
					addError={itemNameAddError}
					emptyText={itemNameQuery.trim() ? 'No item group found' : 'No item groups yet — type a name to add one'}
				/>
			</section>

			{/* 2 — အမည် (required) — auto-composed from the picked အုပ်စု in create
				mode until edited by hand; edit mode keeps the stored name. Written to
				the indexed `name_en`. */}
			<section>
				<label htmlFor="item-model-name" className={labelClass}>
					Item Name
					<RequiredMark />
				</label>
				<Input
					id="item-model-name"
					value={name}
					onChange={(e) => {
						nameEdited.current = true;
						setName(e.target.value);
					}}
					placeholder={mode === 'create' ? 'e.g. Bolt M8x30' : undefined}
					autoComplete="off"
					maxLength={120}
					disabled={submitting}
					className={fieldClass}
				/>
			</section>

			{/* 4 — မြန်မာအမည် — optional Burmese display name (`name_mm`). */}
			<section>
				<label htmlFor="item-model-name-mm" className={labelClass}>
					Burmese Name
				</label>
				<Input
					id="item-model-name-mm"
					value={nameMm}
					onChange={(e) => setNameMm(e.target.value)}
					placeholder="e.g. ဘော့လ် M8x30"
					autoComplete="off"
					maxLength={120}
					disabled={submitting}
					className={fieldClass}
				/>
			</section>

			{/* 5 — စာရင်းသွင်းနည်း (Tracking) — INHERITED from the item name, never picked
				per SKU: the master declares the policy ONCE ("အုပ်စုတစ်ခုစီ — တစ်ချက်တည်း"),
				so a Tyre SKU is serial forever and the stock rows + confirm engine can
				never disagree with the master. */}
			<section>
				<FormField label="Tracking" group>
					{() => (
						<div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
							<span className="inline-flex rounded-full bg-card px-2 py-0.5 text-meta font-semibold leading-myanmar text-foreground ring-1 ring-border">
								{MRO_TRACKING_LABELS[inheritedTracking]}
							</span>
							<p className="mt-1.5 text-xs leading-myanmar text-muted-foreground">
								{itemName
									? `${itemName.name?.trim() || 'Group'} sets this automatically — ${POLICY_HINTS[inheritedTracking]}`
									: 'Select an item group to see its tracking policy — tracking is set once per group.'}
							</p>
						</div>
					)}
				</FormField>
			</section>

			{/* 6 — Expiry alert days — shown only when the policy can carry expiry
				(batch lots / serial units); hidden for standard (qty-only). */}
			{trackingHasExpiry ? (
				<section>
					<label htmlFor="item-model-alert-days" className={labelClass}>
						Expiry Alert Days
					</label>
					<Input
						id="item-model-alert-days"
						type="number"
						inputMode="numeric"
						min={0}
						step={1}
						value={alertDays}
						onChange={(e) => setAlertDays(e.target.value)}
						placeholder="e.g. 30"
						disabled={submitting}
						className={fieldClass}
					/>
					{alertDaysValue === 'invalid' ? (
						<p className="mt-1.5 text-xs font-medium leading-myanmar text-destructive">Enter a whole number of days (e.g. 30)</p>
					) : (
						<p className="mt-1.5 text-xs leading-myanmar text-muted-foreground">
							{inheritedTracking === 'batch'
								? 'For batch items — alerts N days before each lot expires. '
								: 'For serial items — alerts N days before each unit expires.'}
						</p>
					)}
				</section>
			) : null}

			<FormError error={error} />

			<FormSubmitBar
				label={submitLabel}
				isMainButton={isMainButton}
				disabled={!canSubmit}
				submitting={submitting}
				submittingLabel={savingLabel}
				onSubmit={() => void submit()}
			/>

			{/* Full-screen crop/zoom/rotate editor — opened when a photo is picked. */}
			{editorFile ? <ImageCropSheet file={editorFile} onClose={closeEditor} onApply={(edited) => void uploadEditedImage(edited)} /> : null}
		</div>
	);
}
