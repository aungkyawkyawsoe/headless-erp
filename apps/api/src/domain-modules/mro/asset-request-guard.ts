/**
 * Asset-request KIND guard — a WRITE-OFF names no destination, and a request that
 * names a destination is not a write-off. Both directions, at every create AND
 * update path.
 *
 * `mro_asset_requests` carries all three governed shapes (`write_off` ⇒ a
 * write-off, `to_location` ⇒ a return, `to_vehicle`/`to_employee` ⇒ a transfer),
 * and the execute dispatches on that derivation. The dangerous combination is a
 * row that says BOTH: a `write_off` carrying a destination would scrap a unit the
 * requester believed was being moved, and a destination added to a write-off
 * would turn an owner decision into a relocation. Neither is expressible as a
 * declarative field rule (the contradiction spans several columns), so it is a
 * compiled lifecycle hook on the entity-pipeline event spine (`plugin-hooks.ts`)
 * — the same pattern as the MRO requisition guard and the MRO denorm hooks — so
 * it fires on EVERY writer (tgapp, Studio, CLI, import), not just the mini app.
 *
 * Semantics:
 *   - the flag may be TRUE or absent/false; only a truthy `write_off` is judged
 *     (D1 booleans arrive as 1/0 or true/false — both are read);
 *   - on update the check runs against the MERGED row (`doc._existing` + patch),
 *     so adding `write_off: true` to a request that already names a destination is
 *     refused just like filing both at once;
 *   - a row with NO destination and NO write-off stays a malformed transfer, which
 *     the move writer refuses at execute — deliberately NOT reinterpreted as a
 *     write-off (a missing field must never become a destructive default).
 *
 * A violation surfaces as a 400 `VALIDATION_ERROR` with the message below, so a
 * client can show it verbatim.
 */

import { pluginHookRegistry } from '@/core/plugin-hooks';

/** One shared plugin id — the Studio hook viewer lists the guard as one rule. */
export const ASSET_REQUEST_KIND_GUARD_PLUGIN = 'mro-asset-request-kind-guard' as const;

const ASSET_REQUEST = 'mro_asset_requests';

/** Every destination column — a write-off must leave ALL of them empty. */
const DESTINATIONS = ['to_vehicle', 'to_slot', 'to_employee', 'to_location'] as const;

/** The message a client shows when it tried to file both shapes at once. */
export const ASSET_REQUEST_WRITE_OFF_CONFLICT_MESSAGE =
	'A write-off request names no destination — it ends the unit’s life where it sits. File it either as a write-off or with a destination (a transfer/return), never both.';

/** D1 booleans arrive as 1/0 or true/false (`'false'`/`''` are false). */
function isFlagSet(value: unknown): boolean {
	if (value === true || value === 1) return true;
	if (typeof value === 'string') return value.trim() !== '' && value.trim() !== '0' && value.trim().toLowerCase() !== 'false';
	return false;
}

/** A column that carries a value (null/undefined/blank = not named). */
function isNamed(value: unknown): boolean {
	if (value == null) return false;
	return typeof value === 'string' ? value.trim() !== '' : true;
}

let registered = false;

/** Register the guard — idempotent, called once at boot from `mountDomainModules`. */
export function registerAssetRequestKindGuard(): void {
	if (registered) return;
	registered = true;

	for (const event of ['before_insert', 'before_update'] as const) {
		pluginHookRegistry.register({
			collection: ASSET_REQUEST,
			event,
			pluginId: ASSET_REQUEST_KIND_GUARD_PLUGIN,
			priority: 20,
			timeoutMs: 5_000,
			description: 'Refuse a write-off request that also names a destination (and a destination added to a write-off).',
			handler: async (doc) => {
				// The MERGED row: an update carries only the patch (+ `_existing`, the pre-image).
				const previous = doc?._existing;
				const effective = previous && typeof previous === 'object' ? { ...(previous as Record<string, unknown>), ...doc } : doc;
				if (!isFlagSet(effective.write_off)) return;
				const conflict = DESTINATIONS.find((column) => isNamed(effective[column]));
				if (conflict) return { abort: true, error: ASSET_REQUEST_WRITE_OFF_CONFLICT_MESSAGE, field: conflict };
			},
		});
	}
}
