/**
 * VEH Care Denorm — fleet "current care state" maintained by lifecycle hooks.
 *
 * The veh_fleets master carries three DENORMALIZED scalar care columns (added to
 * the schema by the provision-hr reconcile step):
 *
 *   veh_fleets.last_odo          → the vehicle's current odometer (km)
 *   veh_fleets.last_engine_oil   → the engine-oil newest fill's stored next due (km)
 *   veh_fleets.last_gear_oil     → the gear-oil newest fill's stored next due (km)
 *
 * These mirror the last_license / last_insurance m2o pointers in veh-relink.ts,
 * but carry the VALUE a fleet-card needs so a list can be served from ONE
 * `veh_fleets` fetch — km-left chips compute as:
 *
 *   engineOilKmLeft = last_engine_oil − last_odo
 *   gearOilKmLeft   = last_gear_oil   − last_odo
 *
 * Why lifecycle hooks (not client-side writes): an odo reading or a fluid fill
 * can be written by ANY client (tgapp, Studio, CLI, import) through the generic
 * entity API — a client-side update would silently drift when another path
 * writes. Hooks keep the master correct no matter the writer.
 *
 * Hooks:
 *  - veh_odo_months after_insert/after_update → last_odo = the EXACT max of the
 *    vehicle's remaining readings. A backdated/lower APPEND leaves the max
 *    unchanged (so it never regresses, as before); a CORRECTION that lowers the
 *    current reading (or a delete) brings it down with the true max.
 *  - veh_fluid_fills after_insert/after_update → the owning truck's
 *    last_engine_oil / last_gear_oil = its NEWEST fill of that kind's stored
 *    next_due_odo (recomputed from the FULL fill set, so editing an OLDER fill's
 *    due never wrongly demotes a newer one — same re-rank rule as insurance).
 *  - a row MOVED to another vehicle fires after_update with the pre-update row as
 *    `_existing`; the OLD vehicle's scalars are then recomputed EXACTLY (the
 *    write-path advance only moves the NEW owner forward, so the truck a
 *    reading/fill left would otherwise keep a due its live set no longer implies).
 *  - ALL FOUR collections fire on after_delete/after_restore too → the EXACT
 *    recompute (`relinkCareFleet`), because a row that LEFT or RE-ENTERED the live
 *    set must re-derive the scalars from what REMAINS; the maintenance route
 *    POST /api/mro/veh/care/relink is now a repair tool for pre-existing drift,
 *    not a step any delete depends on.
 *
 * Write-path invariants (determinism, idempotency, no phantom writes, TRUE
 * updated_at lineage): every hook and the maintenance recompute re-derives the
 * target scalar FROM ITS FULL SOURCE SET and issues a guarded UPDATE that lands
 * ONLY when the derived value actually differs from the stored value — a re-run
 * or a duplicate fire on an already-correct fleet is a strict no-op (no write
 * amplification, no `updated_at` churn). The per-write odo hook recomputes the
 * EXACT max of the remaining readings (so a backdated/lower append never
 * regresses it, while a correction that lowers the current reading does); the
 * maintenance recompute applies the same exact rule for drift. The "newest fill"
 * rule lives in ONE correlated subquery reused verbatim by the after-write hook
 * and the maintenance recompute, so the two paths cannot drift (single source of
 * truth).
 */

import { D1Client, invalidateCollectionReads } from '@mmbix/core';
import type { SqlStatement } from '@mmbix/types';
import { pluginHookRegistry } from '@/core/plugin-hooks';
import { collectionTable } from '@/lib/utils/table-name';
import { DENORM_STATEMENTS_PER_BATCH, VEH_FLEET_RELINK_PLUGIN, docIdOf, reportDenormFailure } from './veh-relink';

const FLEET_TABLE = () => collectionTable('veh_fleets');
const ODO_TABLE = () => collectionTable('veh_odo_months');
const FILL_TABLE = () => collectionTable('veh_fluid_fills');

/** The two km-serviced fluid kinds mapped to their denormalized master column. */
const KIND_COLUMN: Record<'engine_oil' | 'gear_oil', 'last_engine_oil' | 'last_gear_oil'> = {
	engine_oil: 'last_engine_oil',
	gear_oil: 'last_gear_oil',
};
const FLUID_KINDS = Object.keys(KIND_COLUMN) as Array<'engine_oil' | 'gear_oil'>;

/** The vehicle's EXACT current odometer as a correlated SQL expr — the max `odo`
 *  across ALL its month buckets, scanned with SQLite's JSON1 (`json_each`) over
 *  each bucket's `readings`. Numeric entries only (`typeof`) so a corrupt/string
 *  odo never pollutes the max, and `json_valid`-guarded so a malformed blob
 *  contributes nothing instead of erroring. No reading at all → NULL. */
function odoMaxExpr(fleetTable: string): string {
	return (
		`(SELECT MAX(json_extract(e.value, '$.odo')) FROM ${ODO_TABLE()} m, ` +
		`json_each(CASE WHEN json_valid(m.readings) THEN m.readings ELSE '[]' END) e ` +
		`WHERE m.vehicle = ${fleetTable}.id AND m.deleted_at IS NULL ` +
		`AND typeof(json_extract(e.value, '$.odo')) IN ('integer', 'real'))`
	);
}

/** Set `last_odo` to the vehicle's exact max (see `odoMaxExpr`) only when it
 *  differs — ONE atomic statement, so it is race-free (no read-modify-write
 *  window, unlike a JS recompute) and idempotent (no phantom `updated_at`),
 *  exactly like the fluid kind pointers. A backdated/lower APPEND leaves the max
 *  unchanged (never regresses); a CORRECTION that lowers the current reading
 *  flows the new max through. Reused by the after-write hook and the maintenance
 *  recompute (single source of truth for the rule and the write). */
function guardedOdoStatement(fleetTable: string, vehicleId: string, stamp: string) {
	const max = odoMaxExpr(fleetTable);
	return {
		sql: `UPDATE ${fleetTable} SET last_odo = ${max}, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL AND COALESCE(last_odo, -1) IS NOT COALESCE(${max}, -1)`,
		bindings: [vehicleId, stamp],
	};
}

/** The current due for ONE kind of a truck — its NEWEST fill's stored
 *  `next_due_odo` (highest `odo_at_fill`, write-time as tie-break), or null when
 *  the truck has no non-deleted fill of that kind. `?1` = vehicle, `?2` = kind. */
function newestFillDueExpr(): string {
	return `(SELECT next_due_odo FROM ${FILL_TABLE()} WHERE vehicle = ?1 AND fluid_kind = ?2 AND deleted_at IS NULL ORDER BY odo_at_fill DESC, created_at DESC LIMIT 1)`;
}

/** ONE guarded UPDATE that points `last_<kind>_oil` at the truck's newest fill of
 *  that kind's stored next-due — idempotent and atomic in a single statement:
 *  the subquery is evaluated once, and the row is rewritten ONLY when the target
 *  differs from the stored scalar (so a no-op never bumps `updated_at` / never
 *  loops). Reused by the after-write hook and the maintenance recompute (single
 *  source of truth for the rule and for the write). */
function guardedKindPointerStatement(table: string, column: string, vehicleId: string, kind: 'engine_oil' | 'gear_oil', stamp: string) {
	const target = newestFillDueExpr(); // fresh correlated expr each build, bound ?1 ?2
	return {
		sql: `UPDATE ${table} SET ${column} = ${target}, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL AND COALESCE(${target}, -1) IS NOT COALESCE(${column}, -1)`,
		bindings: [vehicleId, kind, stamp],
	};
}

/** The three guarded scalar statements of ONE fleet — the odometer plus a kind
 *  pointer per fluid — all sharing ONE timestamp so the row moves as a single
 *  deterministic unit. ONE place builds them, so the per-write hook, the moved-owner
 *  repair and the maintenance sweep can never write a different shape. */
function careStatements(vehicleId: string, stamp: string): SqlStatement[] {
	const fleetTable = FLEET_TABLE();
	const statements = [guardedOdoStatement(fleetTable, vehicleId, stamp)];
	for (const kind of FLUID_KINDS) statements.push(guardedKindPointerStatement(fleetTable, KIND_COLUMN[kind], vehicleId, kind, stamp));
	return statements;
}

/** Recompute every non-deleted fleet's care columns (admin maintenance).
 *  Idempotent: each fleet that is already correct is left byte-identical (the
 *  guarded writes no-op), so re-running to heal drift touches only what moved.
 *
 *  Pages the fleet ids with a KEYSET (`id > ?`, the primary key — an O(1) seek per
 *  page, no `OFFSET` rescan and no unbounded id list in memory) and sends each
 *  page's THREE statements per fleet in ONE `db.batch`, so N fleets cost
 *  O(N/batch) round trips instead of the 3N sequential ones this used to issue —
 *  each fleet's three scalars still land atomically, one shared timestamp
 *  included. */
export async function relinkCareAllFleets(db: D1Client): Promise<number> {
	const perPage = Math.max(1, Math.floor(DENORM_STATEMENTS_PER_BATCH / (1 + FLUID_KINDS.length)));
	let examined = 0;
	let after = '';
	for (;;) {
		const fleets = await db.all<{ id: string }>({
			sql: `SELECT id FROM ${FLEET_TABLE()} WHERE deleted_at IS NULL AND id > ?1 ORDER BY id LIMIT ${perPage}`,
			bindings: [after],
		});
		if (fleets.length === 0) break;
		const stamp = new Date().toISOString();
		await db.batch(fleets.flatMap((fleet) => careStatements(fleet.id, stamp)));
		for (const fleet of fleets) invalidateCollectionReads('veh_fleets', fleet.id);
		examined += fleets.length;
		after = fleets[fleets.length - 1].id;
	}
	return examined;
}

/** Recompute ONE fleet's THREE care scalars from its own source rows (odo months
 *  + fluid fills) — the maintenance healing path. It must land on the EXACT
 *  current values (soft-deleting or re-homing a reading/fill legitimately LOWERS
 *  what the set implies), so it uses the exact-set guarded writes: re-running on
 *  an already-correct fleet is a strict no-op (no `updated_at` churn), making it
 *  idempotent. All three scalars share ONE timestamp so the fleet row moves as a
 *  single deterministic unit. */
async function relinkCareFleet(db: D1Client, vehicleId: string): Promise<void> {
	await db.batch(careStatements(vehicleId, new Date().toISOString()));
	// Raw batch — the entity write pipeline's invalidation seam never sees these
	// fleet scalar writes, so cached veh_fleets reads would stay stale.
	invalidateCollectionReads('veh_fleets', vehicleId);
}

/** One vehicle's `last_odo` after a Daily ODO row write — the EXACT max of the
 *  readings that REMAIN, written through `guardedOdoStatement` (ONE atomic
 *  statement, exactly the maintenance path's rule — the two cannot drift).
 *
 *  Why exact, not `GREATER-of`: the odometer is cumulative, so appending a
 *  backdated/lower reading leaves the max unchanged and never regresses the
 *  master — the old monotonic guard's only guarantee. But a CORRECTION that
 *  lowers the current reading (the record-edit path, or a delete) must be able
 *  to bring `last_odo` DOWN with it, which the guard forbade. The exact max
 *  gives both behaviours from one atomic rule. */
async function relinkOdoAfterWrite(db: D1Client, vehicleId: string): Promise<void> {
	await db.run(guardedOdoStatement(FLEET_TABLE(), vehicleId, new Date().toISOString()));
	invalidateCollectionReads('veh_fleets', vehicleId);
}

/** Recompute ONE truck's newest-fill due column for `kind` after a fill write.
 *  Reuses the SAME atomic single-statement rule as the maintenance recompute
 *  (`guardedKindPointerStatement`) — no separate read+write, no drift. Idempotent:
 *  a lowest-priority duplicate hook or a re-fire writes only when the newest fill's
 *  due actually differs from the stored scalar. */
async function relinkFillAfterWrite(db: D1Client, vehicleId: string, kind: 'engine_oil' | 'gear_oil'): Promise<void> {
	await db.run(guardedKindPointerStatement(FLEET_TABLE(), KIND_COLUMN[kind], vehicleId, kind, new Date().toISOString()));
	invalidateCollectionReads('veh_fleets', vehicleId);
}

/* The events where the WRITTEN row itself drives the pointer (the monotonic odo
 * advance / the newest-fill rank). */
const CARE_WRITE_EVENTS = ['after_insert', 'after_update'] as const;

/* The events where the row LEFT or RE-ENTERED the live set — the pointer must be
 * recomputed from the REMAINING rows (an exact-set recompute), never advanced
 * from this one, or a trashed fill would keep its due on the master and a trashed
 * odometer reading would keep a regressed value. */
const CARE_LIFECYCLE_EVENTS = ['after_delete', 'after_restore'] as const;

/** Register the lifecycle hooks (odo + the fluid-fill kinds) on every event.
 *  Idempotent — callers mount modules once per isolate; the registry appends. */
export function registerVehCareDenormHooks(): void {
	if (registered) return;
	registered = true;

	const odoDescription =
		"Update the owning vehicle's current odometer (veh_fleets.last_odo) to the highest reading just written — a MAX guard so a backdated or lower log entry never regresses a cumulative odometer.";
	const fillDescription =
		"Update the owning vehicle's newest engine/gear-oil due (veh_fleets.last_engine_oil / last_gear_oil) from its newest fill's next_due_odo.";
	const odoLifecycleDescription =
		"Recompute the owning vehicle's care pointers (veh_fleets.last_odo / last_engine_oil / last_gear_oil) from the REMAINING rows after a Daily ODO row is trashed or restored.";
	const fillLifecycleDescription =
		"Recompute the owning vehicle's care pointers (veh_fleets.last_odo / last_engine_oil / last_gear_oil) from the REMAINING rows after a fluid fill is trashed or restored.";

	// The vehicle id a hook must recompute — the PRE-write row carries it on every
	// event (writes, `after_delete`, `after_restore`).
	const vehicleOf = (doc: Record<string, unknown>): string | null => {
		const vehicle = doc?.vehicle;
		return typeof vehicle === 'string' && vehicle ? vehicle : null;
	};

	// The vehicle a MOVED row LEFT — read from the pre-update row the pipeline
	// hands after_update hooks as `_existing`. Null on every other event (and on an
	// insert), so the moved-owner repair below costs nothing when nothing moved.
	const previousVehicleOf = (doc: Record<string, unknown> | undefined, ev: string): string | null => {
		if (ev !== 'after_update') return null;
		const previous = doc?._existing;
		return previous && typeof previous === 'object' ? vehicleOf(previous as Record<string, unknown>) : null;
	};

	for (const event of CARE_WRITE_EVENTS) {
		pluginHookRegistry.register({
			collection: 'veh_odo_months',
			event,
			pluginId: VEH_FLEET_RELINK_PLUGIN,
			priority: 10,
			timeoutMs: 5_000,
			description: odoDescription,
			writesTo: ['veh_fleets'],
			handler: async (doc, db) => {
				const vehicle = vehicleOf(doc);
				const previous = previousVehicleOf(doc, event);
				try {
					if (vehicle) await relinkOdoAfterWrite(db, vehicle);
					// The reading MOVED away from another vehicle: re-derive that fleet's
					// care scalars from the rows it still has (an exact recompute — the
					// moved row is gone from its source set now).
					if (previous && previous !== vehicle) await relinkCareFleet(db, previous);
				} catch (err) {
					// Fire-and-forget hooks never fail the write; report so the fleet left
					// behind is diagnosable (POST /api/mro/veh/care/relink repairs it).
					reportDenormFailure(
						{
							derivation: 'veh_fleets.care_scalars',
							hook: `veh_odo_months.${event}`,
							documentId: docIdOf(doc),
							targetIds: [...new Set([vehicle, previous])].filter((id): id is string => !!id),
							repair: 'POST /api/mro/veh/care/relink',
						},
						err,
					);
				}
			},
		});
		pluginHookRegistry.register({
			collection: 'veh_fluid_fills',
			event,
			pluginId: VEH_FLEET_RELINK_PLUGIN,
			priority: 10,
			timeoutMs: 5_000,
			description: fillDescription,
			writesTo: ['veh_fleets'],
			handler: async (doc, db) => {
				const vehicle = vehicleOf(doc);
				const wroteKind = doc?.fluid_kind;
				const previous = previousVehicleOf(doc, event);
				try {
					if (vehicle && (wroteKind === 'engine_oil' || wroteKind === 'gear_oil')) {
						await relinkFillAfterWrite(db, vehicle, wroteKind);
					}
					// A fill MOVED to another truck: the old truck's newest-fill due must be
					// re-derived from what it still has (exact recompute of all care scalars).
					if (previous && previous !== vehicle) await relinkCareFleet(db, previous);
				} catch (err) {
					// Fire-and-forget hooks never fail the write; report so the fleet left
					// behind is diagnosable (POST /api/mro/veh/care/relink repairs it).
					reportDenormFailure(
						{
							derivation: 'veh_fleets.care_scalars',
							hook: `veh_fluid_fills(${String(wroteKind)}).${event}`,
							documentId: docIdOf(doc),
							targetIds: [...new Set([vehicle, previous])].filter((id): id is string => !!id),
							repair: 'POST /api/mro/veh/care/relink',
						},
						err,
					);
				}
			},
		});
	}

	// Trash / restore of a source row → the EXACT recompute of all three scalars
	// (`relinkCareFleet` is the same idempotent, guarded path the maintenance route
	// uses), so a deleted fill or reading can never leave a due/odo the live set no
	// longer implies.
	for (const event of CARE_LIFECYCLE_EVENTS) {
		for (const [collection, description] of [
			['veh_odo_months', odoLifecycleDescription],
			['veh_fluid_fills', fillLifecycleDescription],
		] as const) {
			pluginHookRegistry.register({
				collection,
				event,
				pluginId: VEH_FLEET_RELINK_PLUGIN,
				priority: 10,
				timeoutMs: 5_000,
				description,
				writesTo: ['veh_fleets'],
				handler: async (doc, db) => {
					const vehicle = vehicleOf(doc);
					if (!vehicle) return;
					try {
						await relinkCareFleet(db, vehicle);
					} catch (err) {
						// Fire-and-forget hooks never fail the write; report so the stale
						// scalars are diagnosable (POST /api/mro/veh/care/relink repairs it).
						reportDenormFailure(
							{
								derivation: 'veh_fleets.care_scalars',
								hook: `${collection}.${event}`,
								documentId: docIdOf(doc),
								targetIds: [vehicle],
								repair: 'POST /api/mro/veh/care/relink',
							},
							err,
						);
					}
				},
			});
		}
	}
}

let registered = false;
