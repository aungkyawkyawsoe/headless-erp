/**
 * Mini-app grant coverage — the "Couldn't load the ledger." class of bug.
 *
 * The mini app reads entity collections through the SIGNED-IN user's role, and
 * `PermissionEvaluator.checkBusiness` DENIES any collection that has no
 * `_role_permissions` row for that role — a non-admin is never implicitly
 * allowed. So shipping a tgapp screen that `.items(...)`-reads a NEW collection
 * without also adding that slug to the Telegram role's grant list turns the
 * screen into an error/empty state plus a console 403. That is exactly what
 * happened to `mro_inbound_payments`: the payment sheet opened and read
 * "Couldn't load the ledger." while the receipt list (on `mro_inbounds`) worked.
 *
 * This pins the inventory. The desired-state SSOT is
 * `config.telegram.roleCollections` (`packages/config`, env-overridable via
 * `TELEGRAM_ROLE_COLLECTIONS`), which `lib/services/telegram-role.service.ts`
 * reconciles onto the live role rows on every `/auth/me`; the two role scripts
 * (`reconcile-tgapp-role-permissions.mjs`, `reconcile-storekeeper-role.mjs`) carry
 * the same inventory as the operational repair path. When a new tgapp screen reads
 * a new collection, add the slug here AND to the config list — the test is the
 * tripwire, the config is the fix.
 */
import { buildConfig } from '@mmbix/config';
import { describe, expect, it } from 'vitest';

/** Collections the mini app reads directly through the entity API (`.items(...)`). */
const TGAPP_READ_COLLECTIONS = [
	// MRO masters + the movement documents and their child lines.
	'mro_item_categories',
	'mro_item_name',
	'mro_item_model',
	'mro_suppliers',
	'mro_inbounds',
	'mro_inbound_lines',
	'mro_inbound_payments',
	'mro_outbounds',
	'mro_outbound_lines',
	'mro_transfers',
	'mro_transfer_lines',
	'mro_adjustments',
	'mro_adjustment_lines',
	'mro_requisitions',
	'mro_requisition_lines',
	'mro_asset_requests',
	// Stock trace + the stock kiosk.
	'mro_inventory',
	'mro_stock_serials',
	// Fleet + care + workshop.
	'veh_fleets',
	'veh_incidents',
	'veh_permits',
	'veh_insurances',
	'veh_odo_months',
	'veh_fluid_fills',
	'veh_issue_types',
	'veh_maintenance_logs',
	// People directory.
	'hrm_employees',
];

describe('telegram role grant coverage (mini-app reads)', () => {
	it('grants every collection the mini app reads through the entity API', () => {
		const granted = new Set(buildConfig({ IS_DEV: 'true' }).telegram.roleCollections);
		const missing = TGAPP_READ_COLLECTIONS.filter((slug) => !granted.has(slug));
		// The message names the fix, so a failure is actionable without reading this file.
		expect(missing, `add to packages/config telegram.roleCollections: ${missing.join(', ')}`).toEqual([]);
	});
});
