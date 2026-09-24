/**
 * Serial-unit lifecycle for the တာယာ (tyres) register.
 *
 * The tyre card no longer models a mutable-mounting row with a "tread
 * condition"; it reads real `mro_stock_serials` units whose lifecycle is the
 * engine's serial status — `in_stock` / `issued` / `scrapped`. The pill tints
 * reuse the established MRO doc-status tone family (In Stock reads like the
 * green "go", Issued like the in-flight info tone, Scrapped like the terminal
 * danger), all theme tokens so the pair re-tunes between light and dark.
 */

/** The engine's serial-unit lifecycle — the register card's status. */
export type TyreStatus = 'in_stock' | 'issued' | 'scrapped';

/** Every live value — the union's membership list (used by the mapper + filter). */
export const TYRE_STATUS_VALUES: readonly TyreStatus[] = ['in_stock', 'issued', 'scrapped'];

/** Status → pill copy + tint (English-first technical labels; tone family of the
 *  shared `MRO_DOC_STATUS_META`). */
export const TYRE_STATUS_META: Record<TyreStatus, { label: string; className: string }> = {
	in_stock: { label: 'In Stock', className: 'bg-status-success-soft text-status-success' },
	issued: { label: 'Issued', className: 'bg-status-info-soft text-status-info' },
	scrapped: { label: 'Scrapped', className: 'bg-status-danger-soft text-status-danger' },
};

/** Coerce a row's raw `status` to a known lifecycle — rows written before the
 *  column, or with an unknown value, fall back to `in_stock` (the engine
 *  default) so the register never renders a bare unknown. */
export function tyreStatusOf(value: string | null | undefined): TyreStatus {
	return value && (TYRE_STATUS_VALUES as readonly string[]).includes(value) ? (value as TyreStatus) : 'in_stock';
}
