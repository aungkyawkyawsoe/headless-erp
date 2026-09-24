/**
 * VEH Relink — fleet "current document" pointers kept fresh by lifecycle hooks.
 *
 * The veh_fleets master carries two m2o pointers to the NEWEST document on file
 * (added to the schema by the provision-hr reconcile step, VEH_LASTDOC_ADD):
 *
 *   veh_fleets.last_license   → the veh_permits row with the LATEST issue_date
 *   veh_fleets.last_insurance → the veh_insurances row with the LATEST expiry_date
 *
 * (both tie-break on created_at so two docs dated the same day keep the newest
 * write; undated rows sort last because dates compare as empty strings.)
 *
 * Why real lifecycle hooks and not a declarative server function: hook RULES
 * only mutate the row being written, so a permit create can never update the
 * fleet row. These hooks run compiled TS on the entity-pipeline event spine
 * (plugin-hooks.ts) — they fire on ANY create/update path (tgapp, Studio, CLI,
 * import) and recompute the owning fleet's pointer from its FULL document set,
 * so an edit that changes a doc's date re-ranks it correctly too.
 *
 * Known limits:
 *  - the relink is NOT atomic with the document write — a hook failure only
 *    leaves the pointer one step stale (the document list stays the source of
 *    truth, so nothing is lost or wrong in a dangerous direction). What a hook
 *    DOES guarantee is that the fleets it touches move TOGETHER: they go out in
 *    ONE `db.batch`, so a document that changed hands can never leave its new
 *    owner relinked and its old owner pointing at a foreign document. A failure
 *    is reported structured (`reportDenormFailure`), never swallowed;
 *  - the maintenance route POST /api/mro/veh/relink heals any pre-existing drift
 *    in one pass — batched, so N fleets cost O(N/batch) round trips, not 2N.
 *
 * Moving a document between vehicles is handled on BOTH sides: the after_update
 * hook recomputes the NEW owner from the written row AND the OLD owner from the
 * pre-update row the pipeline hands it as `_existing` (the same sentinel
 * before_update/validate hooks read). Without the old owner the fleet a permit
 * left would keep pointing at a document that now belongs to another truck —
 * its card would show a foreign permit.
 *
 * Deletes and restores ALSO relink: the engine dispatches `after_delete` (soft and
 * hard) and `after_restore` to plugin hooks with the PRE-write row, so a trashed
 * CURRENT document immediately re-points its fleet at the next-newest live one
 * instead of leaving `last_license` aimed at a trashed row (which every reader
 * resolves to null and paints as "no license" — hiding a live permit).
 */

import { invalidateCollectionReads, type D1Client } from '@mmbix/core';
import type { SqlStatement } from '@mmbix/types';
import { pluginHookRegistry } from '@/core/plugin-hooks';
import { collectionTable } from '@/lib/utils/table-name';

/** Statements ONE `db.batch` carries — the unit every maintenance sweep pages by
 *  (each fleet/receipt contributes a fixed handful of statements). A batch costs
 *  ONE round trip (D1 runs it as a single implicit transaction), but every
 *  statement inside it still counts against the per-invocation query budget
 *  ("Queries per Worker invocation", 1000 on Workers Paid), so 100 is a tenth of
 *  that budget: a sweep of any size pages, and no page can blow the invocation. */
export const DENORM_STATEMENTS_PER_BATCH = 100;

/** One doc collection → the fleet pointer it feeds, and how "newest" is ranked. */
interface RelinkSpec {
	/** Document collection whose rows rank a fleet pointer (e.g. veh_permits). */
	docSlug: string;
	/** The m2o field on veh_fleets to rewrite (e.g. last_license). */
	pointerField: string;
	/** ORDER BY clause selecting the newest doc of a vehicle. */
	orderSql: string;
}

/** Shared plugin id — the single "keep veh_fleets fresh" hook group. Both the
 *  doc-pointer relink (permit/insurance → last_license/last_insurance) and the
 *  fleet-care denorm (odo/fills → last_odo/last_*_oil) register under this one
 *  id and share the `writesTo: ['veh_fleets']` Studio contract, so the viewer's
 *  "Keep this collection fresh" panel groups all eight hooks under one heading
 *  instead of two plugins. Exported so veh-care-denorm.ts reuses it. */
export const VEH_FLEET_RELINK_PLUGIN = 'veh-fleet-relink' as const;

const RELINK_SPECS: RelinkSpec[] = [
	// A permit/license is "current" by ISSUE date — a renewal has a newer issue
	// date even when backdated, so expiry is only the tie-break.
	{
		docSlug: 'veh_permits',
		pointerField: 'last_license',
		orderSql: `COALESCE(issue_date,'') DESC, COALESCE(expiry_date,'') DESC, created_at DESC`,
	},
	// veh_insurances has no issue date — the policy in force is the one with the
	// furthest expiry (a renewal rolls it forward), undated rows sort last.
	{
		docSlug: 'veh_insurances',
		pointerField: 'last_insurance',
		orderSql: `COALESCE(expiry_date,'') DESC, created_at DESC`,
	},
];

/** Rewrite ONE fleet pointer from the owning vehicle's newest document — a
 *  single scalar-subquery UPDATE (atomic, and fast enough that the unawaited
 *  after_* hook never lingers into the next request).
 *
 *  The `COALESCE(…) IS NOT COALESCE(…)` guard is the house idempotency rule
 *  (veh-care-denorm.ts): the row is rewritten ONLY when the pointer's value
 *  actually differs. A duplicate fire, a re-run or a repair that finds the fleet
 *  already correct leaves it byte-identical — without the guard `updated_at` would
 *  mean "a hook ran" instead of "the pointer changed", destroying the lineage the
 *  fleet list sorts and audits by. `-1` is the "absent" sentinel (no pointer is
 *  ever the number -1), so document → NULL and NULL → document both count as a
 *  change — including a stored `''` healed into a real NULL. */
function pointerStatement(spec: RelinkSpec, vehicleId: string, stamp: string): SqlStatement {
	const fleetTable = collectionTable('veh_fleets');
	const docTable = collectionTable(spec.docSlug);
	const newest = `(SELECT id FROM ${docTable} WHERE vehicle = ?1 AND deleted_at IS NULL ORDER BY ${spec.orderSql} LIMIT 1)`;
	return {
		sql: `UPDATE ${fleetTable}
			SET ${spec.pointerField} = ${newest},
			updated_at = ?2
			WHERE id = ?1 AND deleted_at IS NULL
				AND COALESCE(${spec.pointerField}, -1) IS NOT COALESCE(${newest}, -1)`,
		bindings: [vehicleId, stamp],
	};
}

/** Every pointer statement for ONE fleet, all sharing ONE timestamp so the row
 *  moves as a single deterministic unit (same rule as veh-care-denorm.ts). */
function pointerStatements(vehicleId: string, stamp: string): SqlStatement[] {
	return RELINK_SPECS.map((spec) => pointerStatement(spec, vehicleId, stamp));
}

/** Raw UPDATEs bypass the entity write pipeline's invalidation seam, so a read of
 *  veh_fleets cached before this relink would keep serving the old pointer (and
 *  the write's `meta.changed` would omit the row). */
function invalidateFleet(vehicleId: string): void {
	invalidateCollectionReads('veh_fleets', vehicleId);
}

/** Recompute BOTH pointers of one fleet row from its document sets — ONE atomic
 *  `db.batch`, so a failure can never leave the row half-relinked and the pair
 *  costs one round trip instead of two. */
export async function relinkFleet(db: D1Client, vehicleId: string): Promise<void> {
	await db.batch(pointerStatements(vehicleId, new Date().toISOString()));
	invalidateFleet(vehicleId);
}

/** Recompute every non-deleted fleet's pointers (admin maintenance). Pages the
 *  fleet ids with a KEYSET (`id > ?`, the primary key — an O(1) seek per page, no
 *  `OFFSET` rescan and no unbounded id list in memory) and sends each page's
 *  statements in ONE `db.batch`, so N fleets cost O(N/DENORM_STATEMENTS_PER_BATCH)
 *  round trips instead of the 2N sequential UPDATEs this used to issue. Per-row
 *  correctness is untouched — every statement is the SAME guarded write the hooks
 *  use, so an already-correct fleet is still left byte-identical (idempotent, and
 *  a repair only bumps the `updated_at` of rows it actually changed). */
export async function relinkAllFleets(db: D1Client): Promise<number> {
	const fleetTable = collectionTable('veh_fleets');
	const perPage = Math.max(1, Math.floor(DENORM_STATEMENTS_PER_BATCH / RELINK_SPECS.length));
	let examined = 0;
	let after = '';
	for (;;) {
		const fleets = await db.all<{ id: string }>({
			sql: `SELECT id FROM ${fleetTable} WHERE deleted_at IS NULL AND id > ?1 ORDER BY id LIMIT ${perPage}`,
			bindings: [after],
		});
		if (fleets.length === 0) break;
		const stamp = new Date().toISOString();
		await db.batch(fleets.flatMap((fleet) => pointerStatements(fleet.id, stamp)));
		for (const fleet of fleets) invalidateFleet(fleet.id);
		examined += fleets.length;
		after = fleets[fleets.length - 1].id;
	}
	return examined;
}

/** One STRUCTURED line per derivation that did not land — never a bare message.
 *  Hooks are fire-and-forget by design (a failure must never fail the user's
 *  write), but a stale master is only diagnosable if the failure says WHICH
 *  derivation, which row, and how to heal it; the edge log indexes these fields,
 *  so one query (`type:"hook_failed"`) lists every master currently known to be
 *  behind. Shared with veh-care-denorm.ts — the two are ONE hook group
 *  (`VEH_FLEET_RELINK_PLUGIN`) and must report in one shape. */
export function reportDenormFailure(
	context: { derivation: string; hook: string; documentId: string | null; targetIds: string[]; repair: string },
	err: unknown,
): void {
	console.error(
		JSON.stringify({
			level: 'error',
			timestamp: new Date().toISOString(),
			type: 'hook_failed',
			plugin: VEH_FLEET_RELINK_PLUGIN,
			derivation: context.derivation,
			hook: context.hook,
			document_id: context.documentId,
			target_ids: context.targetIds,
			repair: context.repair,
			error: err instanceof Error ? err.message : String(err),
		}),
	);
}

/** The row a hook fired for — every event carries it (the pre-write row on
 *  `after_delete`/`after_restore`), so a failure report can always name it. */
export function docIdOf(doc: Record<string, unknown> | undefined): string | null {
	return typeof doc?.id === 'string' && doc.id ? doc.id : null;
}

/** The vehicle a hook must recompute for the OLD owner of a MOVED document —
 *  read from the pre-update row the pipeline passes as `_existing`. Undefined on
 *  every other event (and on an insert), so callers get `undefined` unless the
 *  owner could actually have changed. */
function previousOwnerOf(doc: Record<string, unknown> | undefined, event: RelinkEvent): unknown {
	if (event !== 'after_update') return undefined;
	const previous = doc?._existing;
	if (!previous || typeof previous !== 'object') return undefined;
	return (previous as Record<string, unknown>).vehicle;
}

/** Register one after_* hook: any doc write re-ranks its own vehicle's pointer. */
function registerOne(spec: RelinkSpec, event: RelinkEvent): void {
	// Human purpose for the Studio hook viewer (description) + the collections the
	// hook rewrites (writesTo — the fleet master, not the doc collection it fires
	// on). A viewer can then show "hooks that keep THIS collection fresh".
	const description =
		spec.pointerField === 'last_license'
			? `Recompute the owning vehicle's current license pointer (veh_fleets.last_license) from its newest permit (latest issue date, expiry as tie-break).`
			: `Recompute the owning vehicle's current policy pointer (veh_fleets.last_insurance) from its newest policy (furthest expiry).`;
	pluginHookRegistry.register({
		collection: spec.docSlug,
		event,
		pluginId: VEH_FLEET_RELINK_PLUGIN,
		priority: 10,
		timeoutMs: 5_000,
		description,
		writesTo: ['veh_fleets'],
		handler: async (doc, db) => {
			const vehicle = doc?.vehicle;
			const previous = previousOwnerOf(doc, event);
			// The NEW owner first, then the fleet the document MOVED away from — that
			// fleet still points at a document that is now foreign, so its own newest
			// document is re-ranked. ONE batch over both targets: the pair lands or
			// neither does, and the common single-owner case is still one round trip.
			const targets: string[] = [];
			if (typeof vehicle === 'string' && vehicle) targets.push(vehicle);
			if (typeof previous === 'string' && previous && previous !== vehicle) targets.push(previous);
			if (targets.length === 0) return;
			try {
				const stamp = new Date().toISOString();
				await db.batch(targets.flatMap((id) => pointerStatements(id, stamp)));
				for (const id of targets) invalidateFleet(id);
			} catch (err) {
				// Fire-and-forget hooks never fail the write; report so a drift is
				// diagnosable (POST /api/mro/veh/relink repairs it).
				reportDenormFailure(
					{
						derivation: 'veh_fleets.last_document',
						hook: `${spec.docSlug}.${event}`,
						documentId: docIdOf(doc),
						targetIds: targets,
						repair: 'POST /api/mro/veh/relink',
					},
					err,
				);
			}
		},
	});
}

let registered = false;

/**
 * The lifecycle events a document write can surface. `after_delete`/`
 * `after_restore` carry the row's PRE-write state, so the handler reads its
 * `vehicle` exactly as for insert/update.
 */
const RELINK_EVENTS = ['after_insert', 'after_update', 'after_delete', 'after_restore'] as const;

type RelinkEvent = (typeof RELINK_EVENTS)[number];

/** Boot-time registration — idempotent. Called from mountDomainModules(). */
export function registerVehRelinkHooks(): void {
	if (registered) return;
	registered = true;
	for (const spec of RELINK_SPECS) {
		for (const event of RELINK_EVENTS) registerOne(spec, event);
	}
}
