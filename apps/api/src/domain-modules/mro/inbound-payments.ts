/**
 * Inbound payment denorm — the receipt header's PAYMENT state, maintained by
 * lifecycle hooks on the payment ledger.
 *
 * A purchase receipt (`mro_inbounds`, `type = 'purchase'`) can be paid over many
 * days and in many instalments, so the money question ("fully paid? what is
 * left? when did it settle?") is answered from a LEDGER
 * (`mro_inbound_payments`) and mirrored onto three header columns the list card
 * reads in ONE fetch:
 *
 *   mro_inbounds.paid_amount     → Σ live ledger entries' `amount`
 *   mro_inbounds.payment_status  → unpaid | partial | paid
 *   mro_inbounds.fully_paid_on   → the day the receipt SETTLED
 *
 * Why hooks (not client writes): a payment can be filed by ANY client (tgapp,
 * Studio, CLI, import) through the generic entity API, and any of them can also
 * soft-delete a wrong entry. A client-side header update would silently drift the
 * moment another path writes — the hooks re-derive the header from the LIVE
 * ledger after every payment write, so the mirror is correct no matter the
 * writer. The three values are ALWAYS derived together, from `total_amount` +
 * the ledger, in ONE place (`derivePaymentState`) — there is no second rule.
 *
 * Semantics (deliberately linear — an over-payment is allowed and simply stays
 * `paid`, because the ledger records what actually left the till):
 *
 *   no total yet (a draft)      → unpaid,   fully_paid_on = null
 *   paid == 0                   → unpaid
 *   0 < paid <  total           → partial
 *   paid ≥  total (total > 0)   → paid  + fully_paid_on = the LATEST entry's day
 *
 * `fully_paid_on` is the LATEST live entry's `paid_on` once the sum has reached
 * the total — the day the last instalment cleared it (a pre-payment dated earlier
 * therefore reports the day it was actually paid). Removing an entry that had
 * settled the receipt clears the date again, because the receipt is no longer
 * settled.
 *
 * Write-path invariants (same discipline as `veh-care-denorm.ts`): the mirror is
 * re-derived FROM THE FULL LEDGER on every event, and the header is rewritten
 * ONLY when a value actually differs — a duplicate fire or a re-run is a strict
 * no-op (no write amplification, no `updated_at` churn). The write ALSO re-reads
 * the inputs it derived from inside its own statement, so a mirror can never
 * settle on a sum the ledger no longer supports (see `mirrorStatement`) — and a
 * derivation that fails to land is reported structured: money is the one derived
 * value that must never go quietly stale (`reportMirrorFailure`).
 */

import { D1Client, invalidateCollectionReads } from '@mmbix/core';
import type { SqlStatement } from '@mmbix/types';
import { dayOf } from '@mmbix/utils';
import { pluginHookRegistry } from '@/core/plugin-hooks';
import { collectionTable } from '@/lib/utils/table-name';

/** One shared plugin id — the Studio hook viewer lists the rule once. */
export const INBOUND_PAYMENT_DENORM_PLUGIN = 'mro-inbound-payment-denorm' as const;

const INBOUND = 'mro_inbounds';
const PAYMENT = 'mro_inbound_payments';

export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

/** The derived payment state of ONE receipt. */
export interface PaymentState {
	paidAmount: number;
	status: PaymentStatus;
	/** `YYYY-MM-DD` the receipt settled, or null while it is not fully paid. */
	fullyPaidOn: string | null;
}

/** The ledger AGGREGATE the rule consumes — computed in ONE SQL pass, never row-by-row. */
export interface PaymentSummary {
	/** Σ of the live entries' `amount`. */
	paid: number;
	/** The latest live entry's `paid_on` day (`YYYY-MM-DD`), or null with none. */
	latestDay: string | null;
}

/** Money is REAL in SQLite — round to cents so 0.1+0.2 residue is never a phantom balance. */
const cents = (value: number): number => Math.round(value * 100) / 100;

/**
 * The ONE payment rule — pure, so the hook and every reader (card, report, test)
 * agree by construction.
 *
 * @param totalAmount the receipt's `total_amount` (null/0 on an unconfirmed draft)
 * @param summary     the live ledger aggregate (`paid` + the latest payment day)
 */
export function derivePaymentState(totalAmount: number | null | undefined, summary: PaymentSummary): PaymentState {
	const raw = Number(summary?.paid);
	const paid = cents(Number.isFinite(raw) ? raw : 0);
	const latestDay = typeof summary?.latestDay === 'string' && summary.latestDay ? dayOf(summary.latestDay) : null;

	const total = typeof totalAmount === 'number' && Number.isFinite(totalAmount) ? cents(totalAmount) : null;
	const hasValue = total !== null && total > 0;
	const settled = hasValue && paid >= total;
	const status: PaymentStatus = settled ? 'paid' : hasValue && paid > 0 ? 'partial' : 'unpaid';
	return { paidAmount: paid, status, fullyPaidOn: settled ? latestDay : null };
}

/** Receipts per repair page — and so, statements per `db.batch`. A batch costs
 *  ONE round trip (D1 runs it as a single implicit transaction), but every
 *  statement inside still counts against the per-invocation query budget
 *  ("Queries per Worker invocation", 1000 on Workers Paid), so a page keeps its
 *  read + writes well inside that budget. */
const SWEEP_PAGE = 100;

/** The receipt + its LIVE ledger summed in ONE pass (LEFT JOIN … GROUP BY) — the
 *  aggregate the rule consumes. Only `whereSql`/`tailSql` differ between the
 *  single-row derivation (`WHERE i.id = ?1`) and the repair sweep (a keyset page),
 *  so both read the SAME sum: a second, subtly different aggregate is exactly how
 *  a card and a report start disagreeing. */
function ledgerReadSql(whereSql: string, tailSql = ''): string {
	return `SELECT i.id AS id,
			i.total_amount AS total_amount,
			COALESCE(SUM(p.amount), 0) AS paid,
			MAX(substr(p.paid_on, 1, 10)) AS latest_day
		FROM ${collectionTable(INBOUND)} i
		LEFT JOIN ${collectionTable(PAYMENT)} p ON p.parent_id = i.id AND p.deleted_at IS NULL
		WHERE ${whereSql}
		GROUP BY i.id
		${tailSql}`;
}

/** One receipt's row as the aggregate returns it — the derivation's INPUTS, before
 *  the rule turns them into a state. The raw values travel with the state so the
 *  write can prove they have not moved (see `mirrorStatement`). */
interface LedgerInputs {
	id: string;
	total_amount: number | null;
	paid: number | null;
	latest_day: string | null;
}

/** The rule applied to ONE read row — the single-row derivation and the repair
 *  sweep both go through this, so a healed receipt lands on exactly the state the
 *  hook would have written. */
function stateOfRow(row: LedgerInputs): PaymentState {
	return derivePaymentState(row.total_amount, { paid: Number(row.paid ?? 0), latestDay: row.latest_day ?? null });
}

/**
 * The ONE mirror write — a guarded UPDATE that lands only when BOTH hold:
 *
 *  1. a mirrored value DIFFERS from the derived state (the house idempotency rule:
 *     a duplicate fire, a re-run or a repair rewrites nothing, so a no-op never
 *     bumps `updated_at` and can never loop back through a hook);
 *  2. the INPUTS the derivation consumed are STILL the inputs — the header total,
 *     the live ledger sum and the latest payment day are re-read INSIDE the
 *     statement and compared with `?6`–`?8`, the values the derivation read.
 *
 * (2) is what closes the read-modify-write window: the aggregate read and this
 * write are separate statements, so two concurrent payments could otherwise both
 * derive from the same ledger snapshot and the LAST writer would settle the mirror
 * on a sum the ledger no longer supports. With the guard a value that LANDS is
 * always a value the live inputs imply; a write whose inputs moved is refused, and
 * the derivation that saw the newer ledger (every ledger write fires one) lands it
 * instead. The sum is compared in WHOLE CENTS — the rule's own unit — ROUNDed by
 * SQLite on BOTH sides, so neither float residue in a SQL `SUM` nor a rounding-mode
 * difference can block a legitimate write, while a sum that genuinely moved is
 * refused.
 *
 * `?1` receipt · `?2`–`?4` derived values · `?5` stamp · `?6`–`?8` the inputs as read.
 */
function mirrorStatement(row: LedgerInputs, state: PaymentState, stamp: string): SqlStatement {
	const paymentTable = collectionTable(PAYMENT);
	return {
		sql: `UPDATE ${collectionTable(INBOUND)}
			SET paid_amount = ?2, payment_status = ?3, fully_paid_on = ?4, updated_at = ?5
			WHERE id = ?1 AND deleted_at IS NULL
				AND (COALESCE(paid_amount, -1) <> ?2
					OR COALESCE(payment_status, '') <> ?3
					OR COALESCE(fully_paid_on, '') <> COALESCE(?4, ''))
				AND COALESCE(total_amount, 0) = COALESCE(?6, 0)
				AND ROUND(100 * COALESCE((SELECT SUM(p.amount) FROM ${paymentTable} p WHERE p.parent_id = ?1 AND p.deleted_at IS NULL), 0)) = ROUND(100 * ?7)
				AND COALESCE((SELECT MAX(substr(p.paid_on, 1, 10)) FROM ${paymentTable} p WHERE p.parent_id = ?1 AND p.deleted_at IS NULL), '') = COALESCE(?8, '')`,
		bindings: [row.id, state.paidAmount, state.status, state.fullyPaidOn, stamp, row.total_amount, Number(row.paid ?? 0), row.latest_day],
	};
}

/**
 * Re-derive ONE receipt's payment mirror from its live ledger and write it back
 * only when something differs. Idempotent; safe from any hook or a repair route.
 * Returns the derived state (null when the receipt is gone).
 *
 * The ledger aggregate is computed in ONE statement (a LEFT JOIN … GROUP BY), so
 * a receipt with a hundred payments still costs one read, and a receipt with no
 * header row is a clear `null` (no mirror is written for a row that is gone).
 */
export async function relinkInboundPayments(db: D1Client, inboundId: string): Promise<PaymentState | null> {
	if (!inboundId) return null;
	const row = await db.first<LedgerInputs>({
		sql: ledgerReadSql('i.id = ?1 AND i.deleted_at IS NULL'),
		bindings: [inboundId],
	});
	if (!row) return null;

	const state = stateOfRow(row);
	// ONE guarded UPDATE: the row is rewritten only when a mirrored value differs,
	// so a no-op never bumps `updated_at` and can never loop back through a hook.
	await db.run(mirrorStatement(row, state, new Date().toISOString()));
	invalidateCollectionReads(INBOUND, inboundId);
	return state;
}

/**
 * Re-derive EVERY live purchase receipt's payment mirror — the repair path for
 * rows that predate the feature (their `paid_amount` / `payment_status` are still
 * NULL, which the client reads as `unpaid`, but a report reading the column
 * directly deserves the truth) and for any drift a maintenance run should clear.
 *
 * Bounded, batched and idempotent: the receipts are paged with a KEYSET
 * (`id > ?`, the primary key — an O(1) seek per page, no `OFFSET` rescan and no
 * unbounded id list in memory), each page's aggregate is read in ONE statement
 * and its writes go out in ONE `db.batch` — so N receipts cost O(N/SWEEP_PAGE)
 * round trips instead of the aggregate + UPDATE per receipt this used to issue.
 * Every statement is the same guarded write the hooks use, so re-running it
 * changes nothing. Returns the number of receipts examined. Exposed as
 * `POST /api/mro/inbounds/relink-payments` (admin) — the same role `veh/relink`
 * and `veh/care/relink` play.
 */
export async function relinkAllInboundPayments(db: D1Client): Promise<number> {
	let examined = 0;
	let after = '';
	for (;;) {
		const rows = await db.all<LedgerInputs>({
			sql: ledgerReadSql(`i.deleted_at IS NULL AND i.type = 'purchase' AND i.id > ?1`, `ORDER BY i.id LIMIT ${SWEEP_PAGE}`),
			bindings: [after],
		});
		if (rows.length === 0) break;
		const stamp = new Date().toISOString();
		await db.batch(rows.map((row) => mirrorStatement(row, stateOfRow(row), stamp)));
		for (const row of rows) invalidateCollectionReads(INBOUND, row.id);
		examined += rows.length;
		after = rows[rows.length - 1].id;
		if (rows.length < SWEEP_PAGE) break;
	}
	return examined;
}

/* Every event that can change the derivation: a payment appearing, an EDIT that
 * moves its amount/date (the money columns are frozen for non-admins, but an
 * admin can still rewrite them) and a soft-delete/restore that makes the row
 * leave or re-enter the live set. */
const PAYMENT_EVENTS = ['after_insert', 'after_update', 'after_delete', 'after_restore'] as const;

/** The header's own events — the mirror depends on `total_amount` too. */
const INBOUND_EVENTS = ['after_insert', 'after_update'] as const;

/** The receipt a payment row hangs off — the PRE-write row carries it on every event. */
function inboundOf(doc: Record<string, unknown> | undefined): string | null {
	const parent = doc?.parent_id;
	return typeof parent === 'string' && parent ? parent : null;
}

/** One STRUCTURED line per derivation that did not land — the same shape the VEH
 *  denorm hooks emit (`veh-relink.ts` `reportDenormFailure`), so ONE edge-log query
 *  (`type:"hook_failed"`) lists every derived master currently behind. Money is the
 *  one mirror that must never go quietly stale: the mini app's filing/removing
 *  routes AWAIT the derivation, so a failure there already fails the request and
 *  reaches the operator — this is the backstop for the fire-and-forget paths
 *  (Studio, CLI, import), and it names the idempotent admin route that re-derives
 *  the receipt. A hook must still never fail the user's write. */
function reportMirrorFailure(context: { hook: string; documentId: string | null; targetIds: string[] }, err: unknown): void {
	console.error(
		JSON.stringify({
			level: 'error',
			timestamp: new Date().toISOString(),
			type: 'hook_failed',
			plugin: INBOUND_PAYMENT_DENORM_PLUGIN,
			derivation: 'mro_inbounds.payment_mirror',
			hook: context.hook,
			document_id: context.documentId,
			target_ids: context.targetIds,
			repair: 'POST /api/mro/inbounds/relink-payments',
			error: err instanceof Error ? err.message : String(err),
		}),
	);
}

/**
 * The columns that DEFINE a payment. They are immutable after the row exists:
 * what actually left the till is history, so the correction path is
 * **remove the entry, file the right one** — never a silent rewrite of an amount
 * or a back-dated edit that would move a receipt's settlement day.
 *
 * A `frozen_fields` policy could not express this: the engine STRIPS frozen
 * columns from every generic write including the CREATE, so a client could never
 * file the row at all. Hence a compiled `before_update` guard instead.
 */
const IMMUTABLE_FIELDS = ['parent_id', 'paid_on', 'amount', 'method', 'recorded_by'] as const;

/** The refusal message — names the correction path, so a client can show it verbatim. */
export const PAYMENT_IMMUTABLE_MESSAGE = 'A recorded payment cannot be edited — remove the entry and file the correct payment instead.';

/** The refusal a VOID receipt answers with — see the `before_insert` guard below. */
export const CANCELLED_RECEIPT_PAYMENT_MESSAGE =
	'This receipt was cancelled — a void document takes no payment. File the money against the receipt that replaced it (or a new one).';

let registered = false;

/** Register the denorm hooks — idempotent, called once at boot from `mountDomainModules`. */
export function registerInboundPaymentDenormHooks(): void {
	if (registered) return;
	registered = true;

	// Immutability: refuse a generic update that would CHANGE a defining column.
	// Only fields the payload actually carries a different value for count, so a
	// client may still correct the free-text `reference` / `note`.
	pluginHookRegistry.register({
		collection: PAYMENT,
		event: 'before_update',
		pluginId: INBOUND_PAYMENT_DENORM_PLUGIN,
		priority: 20,
		timeoutMs: 5_000,
		description: 'Refuse an edit to a recorded payment’s amount / date / method / receipt (remove and re-file instead).',
		handler: async (doc) => {
			const previous = doc?._existing;
			if (!previous || typeof previous !== 'object') return;
			const before = previous as Record<string, unknown>;
			const changed = IMMUTABLE_FIELDS.find((field) => field in doc && String(doc[field] ?? '') !== String(before[field] ?? ''));
			if (!changed) return;
			return { abort: true, error: PAYMENT_IMMUTABLE_MESSAGE, field: changed };
		},
	});

	// A CANCELLED receipt is VOID: it took no stock and its ledger is EMPTY (the
	// un-post withdraws the one entry the confirm itself filed), so money booked
	// against it would make the money mirror describe a document that no longer
	// means anything. Refused here for EVERY writer — Studio, the CLI, an import and
	// the payments route — not only for the mini app that never offers it.
	pluginHookRegistry.register({
		collection: PAYMENT,
		event: 'before_insert',
		pluginId: INBOUND_PAYMENT_DENORM_PLUGIN,
		priority: 20,
		timeoutMs: 5_000,
		description: 'Refuse a payment against a CANCELLED receipt — a void document takes no money.',
		handler: async (doc, db) => {
			const inboundId = inboundOf(doc);
			if (!inboundId) return;
			const parent = await db.first<{ doc_status: string | null }>({
				sql: `SELECT doc_status FROM ${collectionTable(INBOUND)} WHERE id = ?1`,
				bindings: [inboundId],
			});
			if (!parent || (parent.doc_status ?? '') !== 'cancelled') return;
			return { abort: true, error: CANCELLED_RECEIPT_PAYMENT_MESSAGE, field: 'parent_id' };
		},
	});

	for (const event of PAYMENT_EVENTS) {
		pluginHookRegistry.register({
			collection: PAYMENT,
			event,
			pluginId: INBOUND_PAYMENT_DENORM_PLUGIN,
			priority: 10,
			timeoutMs: 5_000,
			description:
				"Re-derive the receipt's payment mirror (paid_amount / payment_status / fully_paid_on) from its live payment ledger after a payment is filed, edited, trashed or restored.",
			writesTo: [INBOUND],
			handler: async (doc, db) => {
				const inboundId = inboundOf(doc);
				if (!inboundId) return;
				// A payment MOVED to another receipt (an admin edit): re-derive the one it
				// left as well, from the ledger that remains there.
				const previous = doc?._existing;
				const previousId = previous && typeof previous === 'object' ? inboundOf(previous as Record<string, unknown>) : null;
				// The row the hook fired for — the report names it even for a delete/restore.
				const paymentId = typeof doc?.id === 'string' && doc.id ? doc.id : null;
				try {
					await relinkInboundPayments(db, inboundId);
					if (previousId && previousId !== inboundId) await relinkInboundPayments(db, previousId);
				} catch (err) {
					// Fire-and-forget: the money routes AWAIT this derivation instead, so a
					// failure here must SAY which receipt is now understating its money.
					reportMirrorFailure(
						{
							hook: `${PAYMENT}.${event}`,
							documentId: paymentId,
							targetIds: [...new Set([inboundId, previousId])].filter((id): id is string => !!id),
						},
						err,
					);
				}
			},
		});
	}

	// The OTHER side of the same derivation: the mirror is a function of
	// (total_amount, ledger), so a change to the HEADER re-derives too — a new
	// receipt starts life explicitly `unpaid` instead of a null status, and the
	// confirm writing `total_amount` (or an admin correcting it) keeps the status
	// honest. The guarded UPDATE makes this a no-op when nothing differs, which is
	// also what stops the write from re-entering this very hook forever.
	for (const event of INBOUND_EVENTS) {
		pluginHookRegistry.register({
			collection: INBOUND,
			event,
			pluginId: INBOUND_PAYMENT_DENORM_PLUGIN,
			priority: 30,
			timeoutMs: 5_000,
			description:
				"Re-derive the receipt's own payment mirror from its ledger whenever the header changes (a new receipt reads `unpaid`; the confirm writing total_amount re-settles the status).",
			writesTo: [INBOUND],
			handler: async (doc, db) => {
				const id = typeof doc?.id === 'string' ? doc.id : null;
				if (!id) return;
				try {
					await relinkInboundPayments(db, id);
				} catch (err) {
					reportMirrorFailure({ hook: `${INBOUND}.${event}`, documentId: id, targetIds: [id] }, err);
				}
			},
		});
	}
}
