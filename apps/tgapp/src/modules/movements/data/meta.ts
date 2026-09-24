/**
 * Display metadata for the ပစ္စည်းလှုပ်ရှားမှု (Movement) module — the shared
 * source for the segmented direction tabs, the per-direction chips, the
 * movement-kind tags, the store filter options and the number/date/serial
 * display helpers every movement card + page renders (one lookup so wording
 * and tones never drift between the model cards, the ledger cards and the
 * summary header).
 */
import type { SegTabOption } from '@/shared/components/segmented-tabs';
import { MRO_LOCATIONS, MRO_LOCATION_LABELS } from '@/shared/mro';
import { INBOUND_TYPE_META } from '@/modules/inbounds/data/meta';
import type { InboundType } from '@/modules/inbounds/data/types';
import { OUTBOUND_TYPE_META } from '@/modules/goods-issues/data/meta';
import type { MroOutboundType } from '@/modules/goods-issues/data/types';
import { URL_PARAM, enumParam } from '@/shared/url-state';
import type { MovementDirection, MovementLineDirection, MovementStoreScope, MovementView } from './types';

// ── Direction scope (the segmented tab row on Screen 2 + 3) ─────────────────
/** The three direction pills — IN / OUT / TRF (English labels read like the
 *  kind tabs). There is deliberately NO 'All' pill: the unlabelled `all` state
 *  is the feed's default (every line) and the re-tap-clear target, so the row
 *  acts as a filter — nothing highlighted while `all`, tapping the ACTIVE pill
 *  again clears back to it. */
export const MOVEMENT_DIRECTION_TABS: ReadonlyArray<SegTabOption<MovementDirection>> = [
	{ value: 'in', label: 'IN' },
	{ value: 'out', label: 'OUT' },
	{ value: 'trf', label: 'TRF' },
];

/** The accepted direction values — includes the pill-less `all` (the URL
 *  default when omitted, and the value a re-tap of the active pill restores). */
export const MOVEMENT_DIRECTION_VALUES: MovementDirection[] = ['all', 'in', 'out', 'trf'];

/** The shared `?direction=` parser — default `all`, omitted from the URL. */
export const MOVEMENT_DIRECTION_PARAM = enumParam<MovementDirection>(MOVEMENT_DIRECTION_VALUES, 'all');

// ── Store scope (the bottom-bar store filter — `''` = all stores) ───────────
/** The filter's sheet options — the leading အားလုံး (empty string = ALL stores)
 *  entry first, then every MRO location. */
export const MOVEMENT_STORE_OPTIONS: ReadonlyArray<{ value: MovementStoreScope; label: string }> = [
	{ value: '', label: 'All' },
	...MRO_LOCATIONS.map((location) => ({ value: location.value, label: location.label })),
];

/** The bar pill / center label for the active scope — အားလုံး when no store. */
export function movementStoreLabel(scope: MovementStoreScope): string {
	return scope ? (MRO_LOCATION_LABELS[scope] ?? scope) : 'All';
}

/** The shared `?location=` parser — default `''` (no store = every store),
 *  omitted from the URL while the default is active. */
export const MOVEMENT_LOCATION_PARAM = enumParam<MovementStoreScope>([...MRO_LOCATIONS.map((location) => location.value), ''], '');

// ── Screen 2's list reading (the group's MODELS vs its LINE feed) ───────────
/** The group screen shows the same scope two ways: the SKU register (Models —
 *  the DEFAULT, one row per part that moved) or every confirmed line
 *  (Transactions). Modelled as the screen's `?tab=` view state, so the choice
 *  survives a reload + back/forward and the default stays out of the URL. */
export const MOVEMENT_VIEW_TABS: ReadonlyArray<SegTabOption<MovementView>> = [
	{ value: 'models', label: 'Models' },
	{ value: 'lines', label: 'Transactions' },
];

/** The accepted Screen 2 view values (`models` = the default). */
export const MOVEMENT_VIEW_VALUES: MovementView[] = ['models', 'lines'];

/** The shared `?tab=` parser for Screen 2's reading — default `models`. */
export const MOVEMENT_VIEW_PARAM = enumParam<MovementView>(MOVEMENT_VIEW_VALUES, 'models');

/** The scope part of a Screen 2 → 3 link — only the NON-default values are
 *  serialized (`direction=…` when narrowed, `location=…` when a store is on),
 *  so the target URL parses back to the exact same state. */
export function movementScopeQuery(direction: MovementDirection, location: MovementStoreScope): string {
	const params = new URLSearchParams();
	if (direction !== 'all') params.set(URL_PARAM.direction, direction);
	if (location) params.set(URL_PARAM.location, location);
	const query = params.toString();
	return query ? `?${query}` : '';
}

// ── Per-direction chip + sign meta (IN green +, OUT red −, TRF blue −) ───────
export const MOVEMENT_LINE_META: Record<MovementLineDirection, { label: string; sign: '+' | '−'; chipClass: string; qtyClass: string }> = {
	in: { label: 'IN', sign: '+', chipClass: 'bg-status-success-soft text-status-success', qtyClass: 'text-status-success' },
	out: { label: 'OUT', sign: '−', chipClass: 'bg-status-danger-soft text-status-danger', qtyClass: 'text-status-danger' },
	trf: { label: 'TRF', sign: '−', chipClass: 'bg-status-info-soft text-status-info', qtyClass: 'text-status-info' },
};

// ── Kind tags (a movement line's source doc type) ────────────────────────────
/** Every known doc type → its card tag — the inbound/outbound meta `.tagLabel`s
 *  (Purchase / Opening / Return · Issue / Write-off / Dispose) plus the hardcoded
 *  transfer tag. An unknown kind falls through to its raw value below. */
const MOVEMENT_KIND_TAGS: Record<string, string> = Object.fromEntries([
	...(Object.keys(INBOUND_TYPE_META) as InboundType[]).map((kind) => [kind, INBOUND_TYPE_META[kind].tagLabel]),
	...(Object.keys(OUTBOUND_TYPE_META) as MroOutboundType[]).map((kind) => [kind, OUTBOUND_TYPE_META[kind].tagLabel]),
	['transfer', 'Transfer'],
]);

/** A line's `kind` → the small tag on its card — `null` for a line without one. */
export function movementKindLabel(kind: string | null | undefined): string | null {
	if (!kind) return null;
	return MOVEMENT_KIND_TAGS[kind] ?? kind;
}

// ── Shared display helpers (the same copies every module card keeps) ─────────
/** "1,200" / "1,200.5" — count display, no trailing zeros; '—' when missing. */
export function formatCount(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(value)) return '—';
	return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** "5 Sep 2026" — a `YYYY-MM-DD` date in English, '—' when unset. */
export function dateLabel(date: string | null | undefined): string {
	if (!date) return '—';
	const day = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(day.getTime())) return '—';
	return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(day);
}

/** A `serials` JSON column → how many distinct units it lists (0 = none/empty). */
export function serialUnitCount(serials: string | null | undefined): number {
	if (!serials) return 0;
	try {
		const parsed = JSON.parse(serials) as unknown;
		return Array.isArray(parsed) ? parsed.length : 0;
	} catch {
		return 0;
	}
}
