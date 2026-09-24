import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MmbixClient } from '@mmbix/sdk';

import { fetchAllPages } from '@/shared/api/fetch-all';
import { sdk } from '@/shared/api/sdk';
import { MASTER_STALE_MS } from '@/shared/constants';
import { readPersistedMasters, writePersistedMasters } from '@/shared/api/persisted-masters';
import { MRO_TRACKING_LABELS } from '@/shared/mro';

/**
 * The canonical `mro_item_model` SKU directory — ONE cache entry
 * (`['mro','item-models']`, master freshness tier) shared by EVERY module's
 * line pickers (the inbound/outbound/transfer/adjustment doc forms, the
 * requisition and tyre screens). Each module used to declare its OWN fetch under
 * this same key with a slightly DIFFERENT projection — the screen that mounted
 * first then decided which columns every sibling saw for the whole 5-minute
 * window. This fetch is the SUPERSET every consumer reads (the English + Burmese
 * names + tracking for the policy badges/filters, `expiry_alert_days` for the
 * batch lines' expiry hints, `reference_tread_mm` for the serial-tyre boards),
 * so the cached shape
 * can never vary by who mounted first. Consumers filter client-side (tyres take
 * only `tracking === 'serial'` rows).
 *
 * The policy is NOT a SKU column — it lives on the item NAME and arrives nested
 * under the expanded `item_name` relation, flattened back onto `tracking` below
 * so every consumer keeps reading `model.tracking`.
 */
export const MRO_ITEM_MODELS_QUERY_KEY = ['mro', 'item-models'] as const;

/** The directory row every picker reads — a superset of the per-module types. */
export interface MroItemModelDirectoryRow {
	id: string;
	/** The SKU English display name — the picker's label line. */
	name_en?: string | null;
	/** The SKU Burmese display name — the picker's secondary line. */
	name_mm?: string | null;
	/** `standard` | `batch` | `serial` — the policy badge + client filters. Inherited:
	 *  the value is flattened from the SKU's item NAME (`mro_item_name.tracking`). */
	tracking?: string | null;
	/** The PARENT item name the SKU belongs to (`mro_item_name.name_en`) — flattened
	 *  from the expanded `item_name` relation. Lets a caller search a human term
	 *  like "Tyre" (the item name) and land on its size SKUs. */
	group_name_en?: string | null;
	/** The parent item name's Burmese display name (`mro_item_name.name_mm`). */
	group_name_mm?: string | null;
	/** Expiry-alert lead in days — the batch-line hint (null = no alert). */
	expiry_alert_days?: number | null;
	/** New-tread depth baseline (mm) — the serial-tyre boards' reference. */
	reference_tread_mm?: number | null;
	/** The SKU's R2 photo (`mro_item_model.image`, a `/api/media/<key>` URL) — null
	 *  when the model has no picture yet. Carried in the ONE directory read so a
	 *  card fed from it can paint the SKU's picture without a second request. */
	image?: string | null;
}

/** The row the engine returns for a `?fields=…,item_name.tracking` read — the
 *  policy arrives nested under the expanded item-name relation. */
interface MroItemModelRawRow extends Omit<MroItemModelDirectoryRow, 'tracking' | 'group_name_en' | 'group_name_mm'> {
	item_name?: { id?: string; tracking?: string | null; name_en?: string | null; name_mm?: string | null } | string | null;
}

type DirectorySchema = { mro_item_model: MroItemModelRawRow } & Record<string, Record<string, unknown>>;
const directoryOps = sdk as unknown as MmbixClient<DirectorySchema>;

async function fetchMroItemModels(): Promise<MroItemModelDirectoryRow[]> {
	const rows = await fetchAllPages((cursor, pageSize) =>
		directoryOps.items('mro_item_model').list({
			fields: [
				'id',
				'name_en',
				'name_mm',
				'item_name.tracking',
				'item_name.name_en',
				'item_name.name_mm',
				'expiry_alert_days',
				'reference_tread_mm',
				'image',
			],
			sort: 'name_en',
			limit: pageSize,
			cursor,
		}),
	);
	// ONE flattening seam: the policy belongs to the item NAME, so the nested value
	// becomes `tracking` here and every picker/badge keeps its existing read.
	// Missing/unknown → `standard`, the same fallback the engine applies. The parent
	// name is flattened alongside it so callers can search a human term.
	return rows.map((row) => {
		const parent = typeof row.item_name === 'object' && row.item_name ? row.item_name : null;
		return {
			...row,
			tracking: parent?.tracking ?? 'standard',
			group_name_en: parent?.name_en ?? null,
			group_name_mm: parent?.name_mm ?? null,
		};
	});
}

/** The whole-set SKU directory — cached for the app-wide master window. */
export function useMroItemModels() {
	// Device seed — a returning open paints the pickers instantly instead of
	// waiting a round trip; react-query revalidates in the background when the
	// snapshot is older than the master window.
	const seed = useMemo(() => readPersistedMasters<MroItemModelDirectoryRow[]>('mro_item_model'), []);
	return useQuery({
		queryKey: MRO_ITEM_MODELS_QUERY_KEY,
		queryFn: async () => {
			const data = await fetchMroItemModels();
			writePersistedMasters('mro_item_model', data);
			return data;
		},
		staleTime: MASTER_STALE_MS,
		initialData: seed?.data,
		initialDataUpdatedAt: seed?.at,
	});
}

/**
 * The SKU's display LABEL — the parent item NAME over the SKU (“Tyre · 11R 22.5”),
 * which is what an operator recognises (they search by the item name, not by a
 * size code). Falls back to the bare SKU when the master carries no parent name or
 * when the SKU name already repeats it. Returns “—” for a nameless row, never "".
 */
export function mroItemModelLabel(model: {
	name_en?: string | null;
	name_mm?: string | null;
	group_name_en?: string | null;
	group_name_mm?: string | null;
}): string {
	const sku = (model.name_en ?? model.name_mm ?? '').trim() || '—';
	const group = (model.group_name_en ?? model.group_name_mm ?? '').trim();
	if (!group || sku.toLowerCase().includes(group.toLowerCase())) return sku;
	return `${group} · ${sku}`;
}

/**
 * A LINE's item label — the same `item name · SKU` a picker shows, with the fallback
 * chain every document form needs, in ONE place.
 *
 * The directory row is the only source that knows the parent item NAME, so it is
 * preferred; a SEEDED line whose SKU is missing from the cached directory (or a
 * screen reading before that master read lands) still names itself off the row it was
 * stored with — its SKU name, then its id — and an empty line says the placeholder.
 * Written once because the chain was copy-pasted into every form's line card, where
 * one drifting copy would label the same SKU two ways on two screens.
 */
export function mroItemLineLabel(input: {
	/** The cached directory row for the line's SKU — absent while that read is in
	 *  flight, or when the SKU is not in the catalogue at all. */
	model?: {
		name_en?: string | null;
		name_mm?: string | null;
		group_name_en?: string | null;
		group_name_mm?: string | null;
	} | null;
	/** The line's STORED SKU name — what a seeded document carries. */
	storedName?: string | null;
	/** The line's stored SKU id — the last resort, never the first. */
	modelId?: string | null;
	/** What an EMPTY line says. */
	placeholder?: string;
}): string {
	if (input.model) return mroItemModelLabel(input.model);
	return input.storedName?.trim() || input.modelId?.trim() || input.placeholder || 'Select item';
}

/**
 * The picker's client-side match — a SKU is findable by its ENGLISH name, its
 * BURMESE name (`name_mm`), the parent item NAME (`group_name_en`/`_mm`, so
 * typing “Tyre” / “တာယာ” lands on every tyre size), or the tracking policy word
 * (“serial” / “custodial”). Matching stays client-side over the ONE cached
 * directory read, so typing issues NO requests — the shared directory IS the
 * search index for a catalogue this size.
 */
export function mroItemModelMatches(model: MroItemModelDirectoryRow, query: string): boolean {
	const q = query.trim().toLocaleLowerCase();
	if (!q) return true;
	const tracking = model.tracking ? (MRO_TRACKING_LABELS[model.tracking] ?? model.tracking) : null;
	const haystack = [model.name_en, model.name_mm, model.group_name_en, model.group_name_mm, tracking]
		.filter((part): part is string => !!part && part.trim().length > 0)
		.join(' ')
		.toLocaleLowerCase();
	return haystack.includes(q);
}

/**
 * The picker's rendered rows — matched AND capped. The picker sheets / comboboxes
 * are not virtualised, so an UNFILTERED catalogue must never paint every SKU;
 * typing narrows the set back to a handful. One cap for every picker (the sheet
 * list and the requisition combobox alike).
 */
export const MRO_ITEM_PICKER_LIMIT = 60;

export function filterMroItemModels(
	models: readonly MroItemModelDirectoryRow[],
	query: string,
	limit = MRO_ITEM_PICKER_LIMIT,
): MroItemModelDirectoryRow[] {
	return models.filter((model) => mroItemModelMatches(model, query)).slice(0, limit);
}
