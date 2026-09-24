/**
 * Requisition duplicate guard — ONE same-day requisition per requester for the SAME
 * basket (same items, same quantities).
 *
 * `mro_requisitions` cannot express this declaratively: a field rule sees only the
 * current row and the basket lives in the child `mro_requisition_lines`. The rule is
 * therefore a compiled lifecycle hook on the entity-pipeline event spine
 * (`plugin-hooks.ts`) — the same pattern as the HR early-leave guard and the MRO
 * veh_fleets relink hooks — so it fires on EVERY create path (tgapp, Studio, CLI,
 * import) rather than only in the mini-app form.
 *
 * Semantics:
 *   - the requester (`requested_by`) is REQUIRED for the comparison; a request with
 *     no recorded requester is never blocked (the engine owns that rule);
 *   - "same day" is the stored `request_date` (a `YYYY-MM-DD` date column);
 *   - the basket must match EXACTLY — the same `item_model` ids with the same
 *     quantities, ORDER-INSENSITIVE (a re-ordered basket is still a duplicate);
 *   - a `cancelled` request does NOT block — the basket is free to be re-filed;
 *   - soft-deleted rows never block;
 *   - create only: the mini-app has no "edit these lines" path, so an update cannot
 *     smuggle a second basket past this guard.
 *
 * An unacknowledged duplicate surfaces as a 400 `VALIDATION_ERROR` carrying the
 * message below, so a client can show it verbatim.
 *
 * The duplicate is a WARNING, not a rule violation: filing the same basket twice in
 * one day is occasionally deliberate (a split delivery the store only partly
 * issued). So the guard is not absolute — the unconfirmed create is refused, while
 * a caller that has SEEN the warning may confirm it and file anyway (see
 * `lib/write-ack.ts` and the pre-flight route
 * `POST /api/mro/requisitions/check-duplicate`, which returns the verdict, the
 * message and the token a client sends back in `X-Write-Ack`). Deny-by-default
 * holds: every unconfirmed path — Studio, CLI, import, a blind retry — is refused.
 */

import type { D1Client } from '@mmbix/core';
import { pluginHookRegistry } from '@/core/plugin-hooks';
import { collectionTable } from '@/lib/utils/table-name';
import { writeAcknowledged } from '@/lib/write-ack';
import { dayOf } from '@mmbix/utils';

/** One shared plugin id — the Studio hook viewer lists the guard as one rule. */
export const REQUISITION_DUPLICATE_GUARD_PLUGIN = 'mro-requisition-duplicate-guard' as const;

/**
 * The acknowledgement token for this guard — the value a caller sends in
 * `X-Write-Ack` to confirm it has seen the warning and wants the duplicate filed
 * anyway. The pre-flight route hands it out, so a client never hardcodes it.
 */
export const REQUISITION_DUPLICATE_ACK = 'requisition-duplicate' as const;

const REQUISITION = 'mro_requisitions';
const REQUISITION_LINES = 'mro_requisition_lines';

/** How many same-day baskets to compare against — a bounded scan, never the day's history. */
const CANDIDATE_LIMIT = 25;

/** The message the mini-app form shows when a same-day basket is warned about. */
export const REQUISITION_DUPLICATE_MESSAGE =
	'An identical requisition (same items and quantities) was already made by this requester today.';

/** The same-day requisition an incoming basket duplicates. */
export interface DuplicateRequisition {
	id: string;
	displayNumber: string | null;
}

/**
 * The canonical basket signature of a create payload's `lines` — one `<model>:<qty>`
 * token per line, sorted so ordering never matters. `null` when the payload has no
 * usable lines, so required-field validation owns that case and the guard stays out
 * of the way (it never turns a malformed payload into a duplicate verdict).
 */
function basketOf(lines: unknown): string[] | null {
	if (!Array.isArray(lines) || lines.length === 0) return null;
	const tokens: string[] = [];
	for (const line of lines) {
		if (!line || typeof line !== 'object') return null;
		const row = line as Record<string, unknown>;
		const model = typeof row.item_model === 'string' ? row.item_model.trim() : '';
		const qty = Number(row.qty);
		if (!model || !Number.isFinite(qty)) return null;
		tokens.push(`${model}:${qty}`);
	}
	return tokens.sort();
}

/**
 * The SAME-DAY basket a requester already holds — the ONE duplicate verdict.
 *
 * BOTH readers of this rule go through here (the `before_insert` guard and the
 * pre-flight route the form asks before filing), so a client can never be told
 * "no duplicate" by the check and then refused by the guard under a different
 * rule: there is one implementation, not two.
 *
 * `null` when the payload cannot be judged (no requester / no date / no usable
 * lines) OR when no live same-day basket matches. Bounded: at most
 * `CANDIDATE_LIMIT` same-day parents, then ONE child-lines read for those ids.
 */
export async function findDuplicateRequisition(
	db: D1Client,
	payload: { requested_by?: unknown; request_date?: unknown; lines?: unknown },
): Promise<DuplicateRequisition | null> {
	const requester = typeof payload.requested_by === 'string' ? payload.requested_by.trim() : '';
	const day = dayOf(payload.request_date);
	const basket = basketOf(payload.lines);
	// No identity / date / basket — required-field validation owns that case.
	if (!requester || !day || !basket) return null;

	const parents = await db.all<{ id: string; display_number: string | null }>({
		sql: `SELECT id, display_number FROM ${collectionTable(REQUISITION)}
			WHERE requested_by = ?1
				AND substr(request_date, 1, 10) = ?2
				AND deleted_at IS NULL
				AND COALESCE(requisition_status, '') <> 'cancelled'
			ORDER BY created_at DESC
			LIMIT ?3`,
		bindings: [requester, day, CANDIDATE_LIMIT],
	});
	if (parents.length === 0) return null;

	const ids = parents.map((parent) => parent.id);
	const placeholders = ids.map((_, index) => `?${index + 1}`).join(', ');
	const lines = await db.all<{ parent_id: string; item_model: string; qty: number }>({
		sql: `SELECT parent_id, item_model, qty FROM ${collectionTable(REQUISITION_LINES)}
			WHERE parent_id IN (${placeholders}) AND deleted_at IS NULL AND item_model IS NOT NULL AND qty IS NOT NULL`,
		bindings: ids,
	});

	// One candidate's basket per parent, then an exact multiset match on the tokens.
	const byParent = new Map<string, string[]>();
	for (const line of lines) {
		const tokens = byParent.get(line.parent_id) ?? [];
		tokens.push(`${line.item_model}:${Number(line.qty)}`);
		byParent.set(line.parent_id, tokens);
	}
	for (const parent of parents) {
		const tokens = byParent.get(parent.id);
		if (!tokens || tokens.length !== basket.length) continue;
		tokens.sort();
		if (tokens.every((token, index) => token === basket[index])) {
			return { id: parent.id, displayNumber: parent.display_number?.trim() || null };
		}
	}
	return null;
}

let registered = false;

/** Register the guard — idempotent, called once at boot from `mountDomainModules`. */
export function registerRequisitionDuplicateGuard(): void {
	if (registered) return;
	registered = true;

	pluginHookRegistry.register({
		collection: REQUISITION,
		event: 'before_insert',
		pluginId: REQUISITION_DUPLICATE_GUARD_PLUGIN,
		priority: 20,
		timeoutMs: 5_000,
		description:
			'Refuse a same-day requisition for the same requester with an identical basket unless the caller acknowledged the warning.',
		handler: async (doc, db) => {
			const duplicate = await findDuplicateRequisition(db, doc);
			if (!duplicate) return;
			// The caller has SEEN this warning (the pre-flight check, or the refusal
			// below it) and confirmed it — file the duplicate request as asked.
			if (writeAcknowledged(REQUISITION_DUPLICATE_ACK)) return;
			return { abort: true, error: REQUISITION_DUPLICATE_MESSAGE, field: 'lines' };
		},
	});
}
