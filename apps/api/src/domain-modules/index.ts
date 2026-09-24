/**
 * Domain Modules — business-specific endpoints mounted on the factory worker.
 *
 * The factory core (`routes/`, `plugins/`, `lib/`, `services/`) is domain-agnostic
 * and NEVER references these modules. Each folder here is a self-contained
 * business vertical (e.g. HR meeting tasks, MRO stock) that speaks
 * only the generic engine API (`@mmbix/core`, entity routes, `@/lib/*`).
 *
 * Mounting is config-gated (`DOMAIN_MODULES=hr,mro` — see `@mmbix/config`
 * `isModuleEnabled`): a disabled module is a 404, never dead code paths.
 *
 * Scaffolding a new business vertical = copy a folder, rename the routes and
 * collections, add it to `domainModules` below. (The CLI's `module create`
 * templates in `packages/cli/templates` are the no-copy path.)
 */

import type { Context, Hono } from 'hono';
import { isModuleEnabled } from '@mmbix/config';
import { fail } from '@/lib/api/response';
import { hrRoutes } from './hr/routes';
import { registerEarlyLeaveGuardHooks } from './hr/early-leave-guard';
import { registerAttendanceTimeLockHooks } from './hr/attendance-time-lock';
import { registerHrRequestNotifyHooks } from './hr/request-notify';
import { idpRoutes } from './idp/routes';
import { mroRoutes } from './mro/routes';
import { registerVehRelinkHooks } from './mro/veh-relink';
import { registerVehCareDenormHooks } from './mro/veh-care-denorm';
import { registerRequisitionDuplicateGuard } from './mro/requisition-guard';
import { registerAssetRequestKindGuard } from './mro/asset-request-guard';
import { registerMroAssetRequestNotifyHooks } from './mro/asset-request-notify';
import { registerMroRequisitionNotifyHooks } from './mro/requisition-notify';
import { registerInboundPaymentDenormHooks } from './mro/inbound-payments';

export interface DomainModule {
	/** Config key matched against DOMAIN_MODULES (e.g. 'hr', 'mro'). */
	id: string;
	/** The Hono app mounted at `path`. */
	routes: Hono;
	/** URL prefix the module is mounted at. */
	path: string;
}

/**
 * Business modules shipped in this worker. Each one is gated by
 * `isModuleEnabled(env, id)` and returns 404 when disabled — the factory core
 * stays clean, the module set stays configurable per deployment.
 */
export const domainModules: DomainModule[] = [
	{ id: 'hr', path: '/api/hr', routes: hrRoutes as unknown as Hono },
	{ id: 'idp', path: '/api/idp', routes: idpRoutes as unknown as Hono },
	{ id: 'mro', path: '/api/mro', routes: mroRoutes as unknown as Hono },
];

/** Mount every enabled domain module; a disabled one answers 404 (not-found). */
export function mountDomainModules(app: Hono<{ Bindings: Record<string, unknown> }>): void {
	// Boot-time lifecycle hooks that keep veh_fleets fresh from its child
	// documents, whichever client path writes them (tgapp, Studio, CLI, import):
	//   • registerVehRelinkHooks  → last_license / last_insurance from permit/policy
	//   • registerVehCareDenormHooks → last_odo + last_engine/gear_oil from
	//     odo-month / fluid-fill writes (single-fetch km-left cards).
	// Both register under ONE shared plugin id (VEH_FLEET_RELINK_PLUGIN) so the
	// Studio hook viewer groups them as the single "keep veh_fleets fresh" panel.
	// Registered unconditionally — they fire on engine collections and must stay
	// correct even when the MRO module gate would 404 its routes.
	registerVehRelinkHooks();
	registerVehCareDenormHooks();
	// One early-leave request per employee per day — a cross-row rule the
	// declarative field/validation systems cannot express (see the module).
	registerEarlyLeaveGuardHooks();
	// A punch's TIME is server-owned: a client-supplied check_in/check_out is
	// re-stamped on every write (see the module).
	registerAttendanceTimeLockHooks();
	// A leave / overtime / early-leave request submitted for review tells the
	// requester's recorded superior(s); the decision tells the requester. Both
	// are server-owned, so every writer notifies (see the module).
	registerHrRequestNotifyHooks();
	// One same-day requisition per requester for the SAME basket (same items and
	// quantities) — another cross-row rule the field/validation systems cannot
	// express, since the basket lives in the child lines (see the module).
	registerRequisitionDuplicateGuard();
	// A write-off request names no destination; a request that names one is not a
	// write-off. The contradiction spans columns, so it is a compiled guard on the
	// request table — the shape that would otherwise scrap a unit somebody believed
	// they were moving (see the module).
	registerAssetRequestKindGuard();
	// An asset transfer/return/write-off request tells the requester's recorded
	// superior(s) when it is filed; the decision tells the requester. Same shape
	// as the HR request flow (see the module).
	registerMroAssetRequestNotifyHooks();
	// A stock requisition tells the requester's recorded superior(s) when it is
	// filed; the approve/close/issue tells the requester. Same shape again.
	registerMroRequisitionNotifyHooks();
	// A purchase receipt's paid state is a FUNCTION of its payment ledger: the
	// mirror columns (paid_amount / payment_status / fully_paid_on) are re-derived
	// from the live ledger on every payment write, and a recorded payment's amount /
	// date / method is refused on edit (remove + re-file instead). Both rules live
	// with the collection, so ANY writer — tgapp, Studio, CLI, import — keeps the
	// receipt's money figures true.
	registerInboundPaymentDenormHooks();
	for (const mod of domainModules) {
		app.use(`${mod.path}/*`, async (c: Context, next) => {
			if (!isModuleEnabled(c.env, mod.id)) {
				return fail(c, `Route not found: ${c.req.method} ${c.req.path}`, 404, 'NOT_FOUND');
			}
			await next();
		});
		app.route(mod.path, mod.routes);
	}
}
