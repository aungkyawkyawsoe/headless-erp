/**
 * Shared fleet vocabulary — the vehicle brand enum + its display labels, used by
 * the fleets list and the လိုင်စင် / insurances modules' cards. ONE map
 * for the whole app (previously re-declared in each module, where the copies
 * could drift apart).
 */

/** `fleets.brand` — the verified live enum, mapped to the uppercase display
 *  labels below. `nissan diesel_ud` (spaced) is the legacy master's spelling,
 *  kept so old rows never render blank. */
export type VehicleBrand =
	| 'faw'
	| 'fuso'
	| 'hino'
	| 'isuzu'
	| 'nissan diesel_ud'
	| 'nissan_diesel_ud'
	| 'panus'
	| 'qiang'
	| 'suzuki'
	| 'you'
	| 'volvo'
	| 'mitsubishi'
	| 'man'
	| 'toyota';

/** `brand` value → display label (e.g. `hino` → "HINO"). */
export const VEHICLE_BRAND_LABELS: Record<VehicleBrand, string> = {
	faw: 'FAW',
	fuso: 'FUSO',
	hino: 'HINO',
	isuzu: 'ISUZU',
	'nissan diesel_ud': 'NISSAN UD',
	nissan_diesel_ud: 'NISSAN UD',
	panus: 'PANUS',
	qiang: 'QIANG',
	suzuki: 'SUZUKI',
	you: 'YOU',
	volvo: 'VOLVO',
	mitsubishi: 'MITSUBISHI',
	man: 'MAN',
	toyota: 'TOYOTA',
};

/** `brand` value → display label or `null` when unset/unknown — cards render no
 *  brand chip in that case (a loose string key can't index the enum map directly). */
export function vehicleBrandLabel(brand: string | null | undefined): string | null {
	return brand ? (VEHICLE_BRAND_LABELS[brand as VehicleBrand] ?? null) : null;
}
