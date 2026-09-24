/**
 * Early-leave day guard — ONE early-leave request per employee per calendar day.
 *
 * `hrm_early_leaves` has no way to express this declaratively: field validation
 * sees only the current row, `unique` is single-column, and `date_time` stores a
 * full timestamp (so a per-column unique could never mean "per day"). The rule is
 * therefore a compiled lifecycle hook on the entity-pipeline event spine
 * (`plugin-hooks.ts`) — the same pattern as the MRO veh_fleets relink hooks — so
 * it fires on EVERY create/update path (tgapp, Studio, CLI, import) rather than
 * only in the mini-app form.
 *
 * Semantics:
 *   - an existing row for the SAME employee on the SAME day (first 10 chars of
 *     `date_time`, i.e. the stored `YYYY-MM-DD`) blocks a new one;
 *   - `cancelled` / `rejected` rows DO NOT block — the slot is free again;
 *   - `before_update` runs the same check (a date-moving edit must not create a
 *     second request for the target day) and excludes the row being edited;
 *   - soft-deleted rows (`deleted_at IS NOT NULL`) never block.
 *
 * The abort surfaces as a 400 `VALIDATION_ERROR` carrying the message below, so
 * the mini-app form can show it verbatim.
 */

import type { D1Client } from '@mmbix/core';
import { pluginHookRegistry } from '@/core/plugin-hooks';
import { collectionTable } from '@/lib/utils/table-name';
import { dayOf } from '@mmbix/utils';

/** One shared plugin id — the Studio hook viewer groups the two events as one rule. */
export const EARLY_LEAVE_GUARD_PLUGIN = 'hr-early-leave-guard' as const;

const COLLECTION = 'hrm_early_leaves';

/** Lifecycle values that leave the day free again. */
const NON_BLOCKING_STATUS = "('cancelled','rejected')";

/** The message the mini-app form shows when a second same-day request is refused. */
export const EARLY_LEAVE_DUPLICATE_MESSAGE = 'An early-leave request already exists for this employee on this date.';

/**
 * Does a blocking early-leave row already exist for `employeeId` on `day`?
 * `excludeId` omits the row currently being updated from the search.
 */
async function duplicateExists(db: D1Client, employeeId: string, day: string, excludeId?: string | null): Promise<boolean> {
	const row = await db.first<{ id: string }>({
		sql: `SELECT id FROM ${collectionTable(COLLECTION)}
			WHERE employee = ?1
				AND substr(date_time, 1, 10) = ?2
				AND deleted_at IS NULL
				AND COALESCE(doc_status, '') NOT IN ${NON_BLOCKING_STATUS}
				AND (?3 IS NULL OR id <> ?3)
			LIMIT 1`,
		bindings: [employeeId, day, excludeId ?? null],
	});
	return row !== null;
}

let registered = false;

/** Register the guard — idempotent, called once at boot from `mountDomainModules`. */
export function registerEarlyLeaveGuardHooks(): void {
	if (registered) return;
	registered = true;

	// Create: the new row must not double up its employee's day.
	pluginHookRegistry.register({
		collection: COLLECTION,
		event: 'before_insert',
		pluginId: EARLY_LEAVE_GUARD_PLUGIN,
		priority: 20,
		timeoutMs: 5_000,
		description: 'Refuse a second early-leave request for the same employee on the same calendar day.',
		handler: async (doc, db) => {
			const employee = typeof doc.employee === 'string' ? doc.employee : '';
			const day = dayOf(doc.date_time);
			if (!employee || !day) return; // missing identity/date — required-field validation owns that
			if (await duplicateExists(db, employee, day)) {
				return { abort: true, error: EARLY_LEAVE_DUPLICATE_MESSAGE, field: 'date_time' };
			}
		},
	});

	// Update: a date-moving edit must not land on a day that already has one. The
	// target day is the payload's `date_time` when present, else the stored one;
	// the row being edited is excluded so an unrelated edit never self-blocks.
	pluginHookRegistry.register({
		collection: COLLECTION,
		event: 'before_update',
		pluginId: EARLY_LEAVE_GUARD_PLUGIN,
		priority: 20,
		timeoutMs: 5_000,
		description: 'Refuse moving an early-leave request onto a day that already has one for the same employee.',
		handler: async (doc, db) => {
			const existing = (doc._existing ?? null) as Record<string, unknown> | null;
			const employee = typeof doc.employee === 'string' ? doc.employee : typeof existing?.employee === 'string' ? existing.employee : '';
			const dateTime = doc.date_time ?? existing?.date_time;
			const day = dayOf(dateTime);
			const excludeId = typeof existing?.id === 'string' ? existing.id : null;
			if (!employee || !day) return;
			if (await duplicateExists(db, employee, day, excludeId)) {
				return { abort: true, error: EARLY_LEAVE_DUPLICATE_MESSAGE, field: 'date_time' };
			}
		},
	});
}
