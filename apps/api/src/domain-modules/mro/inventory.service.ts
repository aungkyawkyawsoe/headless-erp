/**
 * MRO Inventory Service — confirm-time stock engine for /api/mro.
 *
 * Documents are ENGINE-OWNED (multi-line headers + child lines, created and
 * edited through the generic entity API, numbered by `naming_series`). This
 * service owns ONLY the moment that touches stock:
 *
 *   POST /api/mro/inbounds/:id/confirm  — validate a draft inbound and apply
 *        its stock effect in ONE atomic D1 batch: per line create `mro_stock_lots`
 *        (batch policy) or `mro_stock_serials` rows (serial policy; a `return`
 *        line flips previously-issued units back to `in_stock` instead of
 *        duplicating them), move the `mro_inventory` balance, write the header
 *        totals and flip `doc_status` → `confirmed`.
 *   POST /api/mro/outbounds/:id/confirm — allocate stock per line in ONE atomic
 *        batch: standard = guarded balance decrement; batch = FEFO (nearest
 *        expiry) or FIFO lot allocation with expired lots excluded from goods
 *        issues and targeted by write-offs; serial = explicit serial pick that
 *        flips to `issued` / `scrapped`. Insufficient stock → 409, no partial
 *        state, no reservation before confirm (zero waste).
 *   POST /api/mro/transfers/:id/confirm — move stock between two locations in
 *        ONE atomic batch: the source store deducts (FEFO lots / listed serials)
 *        and the destination store receives — lot (batch_no + expiry) identity
 *        is preserved by merging into the matching destination lot or creating
 *        a new one; serial rows flip their location; trace rows land in
 *        mro_transfer_lots / mro_transfer_serials.
 *   POST /api/mro/adjustments/:id/confirm — apply an operator-reported stock
 *        correction in ONE atomic batch: an ADJUST add raises the store balance
 *        (creating a lot for batch models; serial adds are refused — receive via
 *        an inbound instead), an ADJUST remove lowers it (batch lots written off
 *        FEFO / serial units marked removed). Each line records the
 *        expected_qty/diff_qty it reconciled. Requires a SEPARATE approver
 *        (`approved_by != reported_by`) so an operator cannot self-sign a
 *        stock change.
 *   POST /api/mro/requisitions/:id/confirm — APPROVE a stock request without
 *        touching stock: validate the lines, write the header totals
 *        (total_qty / line_count / confirmed_at) and flip `doc_status` →
 *        confirmed. An approved requisition is the authority a later
 *        goods-issue outbound fulfils — the flow is request → approve → issue,
 *        and stock only moves when the outbound is confirmed.
 *   POST /api/mro/requisitions/:id/reject — REJECT/close an OPEN stock request
 *        without touching stock: sets `requisition_status = cancelled` +
 *        `close_reason` (409 if it is already fulfilled/cancelled). Drafts also
 *        flip engine `doc_status → cancelled`; already-approved requests keep
 *        doc_status confirmed and expose the closure via requisition_status.
 *
 * Nothing is ever reserved or moved while a document is a draft; a cancelled
 * document cannot be confirmed; re-confirming an already-confirmed document is
 * an idempotent no-op (never double-stocks).
 *
 * Correctness lives HERE in guarded single batches — never in formula fields
 * (engine stored formulas only recompute on engine writes; these rows and the
 * confirm transition are written by this service, so header totals are plain
 * columns written in the same batch that flips the document).
 */

import type { D1Client } from '@mmbix/core';
import { collectionTable } from '@/lib/utils/table-name';
import { CatalogReads } from './inventory/catalog';
import { StockReports } from './inventory/stock-reports';
import { MovementReads } from './inventory/movement';
import type { GuardedBatchFragment } from './inventory/guarded-batch';
import { buildContext } from './inventory/context';
import type { MroContext } from './inventory/context';
import { TyreChores } from './inventory/chores/tyres';
import { AssetChores } from './inventory/chores/assets';
import { AssetRequestChores } from './inventory/chores/asset-requests';
import { SerialChores } from './inventory/chores/serials';
import { InboundConfirm } from './inventory/confirm/inbound';
import { OutboundConfirm } from './inventory/confirm/outbound';
import { TransferConfirm } from './inventory/confirm/transfer';
import { AdjustmentConfirm } from './inventory/confirm/adjustment';
import { RequisitionConfirm } from './inventory/confirm/requisition';
import {
	MroError,
	MRO_ASSET_CONDITIONS,
	MRO_LOCATIONS,
	MRO_OUTBOUND_TYPES,
	MRO_INBOUND_TYPES,
	MRO_MOVEMENT_DIRECTIONS,
	MRO_MOVEMENT_LEDGER_PAGE,
	MRO_MOVEMENT_GROUPS_PAGE,
	MRO_MOVEMENT_MODELS_PAGE,
	MRO_ASSET_REQUEST_STATUSES,
	MRO_ASSET_REQUESTS_PAGE,
	MRO_REQUISITION_OPEN_STATUSES,
	MRO_REQUISITION_CLOSE_REASONS,
} from './inventory/types';
import type {
	MroTracking,
	MroLocation,
	MroOutboundType,
	MroInboundType,
	MroAssetCondition,
	MroMovementDirection,
	HolderAssetRow,
	AssetRequestListRow,
	Tables,
	ModelRow,
	MovementModelAggRow,
	MovementGroupRow,
	CatalogGroupRow,
	MovementLedgerAggRow,
	MovementLedgerSummary,
} from './inventory/types';
import { AUTHORIZED_BY_ASSET_REQUEST, assertCustodyChangeAllowed, holderKeyOf } from './inventory/custody';
import type { CustodyAuthorization, CustodySeam } from './inventory/custody';

// ── Public surface, re-exported so this module's contract (./routes.ts) is unchanged ──
export { MroError };
export {
	MRO_ASSET_CONDITIONS,
	MRO_LOCATIONS,
	MRO_OUTBOUND_TYPES,
	MRO_INBOUND_TYPES,
	MRO_MOVEMENT_DIRECTIONS,
	MRO_MOVEMENT_LEDGER_PAGE,
	MRO_MOVEMENT_GROUPS_PAGE,
	MRO_MOVEMENT_MODELS_PAGE,
	MRO_ASSET_REQUEST_STATUSES,
	MRO_ASSET_REQUESTS_PAGE,
	MRO_REQUISITION_OPEN_STATUSES,
	MRO_REQUISITION_CLOSE_REASONS,
};
export type {
	MroTracking,
	MroLocation,
	MroOutboundType,
	MroInboundType,
	MroAssetCondition,
	MroMovementDirection,
	HolderAssetRow,
	AssetRequestListRow,
};
export { AUTHORIZED_BY_ASSET_REQUEST, assertCustodyChangeAllowed, holderKeyOf };
export type { CustodyAuthorization, CustodySeam };

export class MroInventoryService {
	constructor(private readonly db: D1Client) {}

	private tables(): Tables {
		return {
			inbound: collectionTable('mro_inbounds'),
			outbound: collectionTable('mro_outbounds'),
			inLines: collectionTable('mro_inbound_lines'),
			outLines: collectionTable('mro_outbound_lines'),
			transfer: collectionTable('mro_transfers'),
			transferLines: collectionTable('mro_transfer_lines'),
			transferLots: collectionTable('mro_transfer_lots'),
			transferSerials: collectionTable('mro_transfer_serials'),
			adjustment: collectionTable('mro_adjustments'),
			adjustmentLines: collectionTable('mro_adjustment_lines'),
			adjustmentLots: collectionTable('mro_adjustment_lots'),
			adjustmentSerials: collectionTable('mro_adjustment_serials'),
			requisition: collectionTable('mro_requisitions'),
			requisitionLines: collectionTable('mro_requisition_lines'),
			model: collectionTable('mro_item_model'),
			inv: collectionTable('mro_inventory'),
			lots: collectionTable('mro_stock_lots'),
			serials: collectionTable('mro_stock_serials'),
			outLots: collectionTable('mro_outbound_lots'),
			outSerials: collectionTable('mro_outbound_serials'),
			group: collectionTable('mro_item_name'),
			category: collectionTable('mro_item_categories'),
			events: collectionTable('mro_serial_events'),
			assetRequest: collectionTable('mro_asset_requests'),
			empLinks: collectionTable('hrm_employee_links'),
			payments: collectionTable('mro_inbound_payments'),
		};
	}

	/**
	 * The shared use-case CONTEXT — the db handle, the resolved table names and the
	 * constructed collaborators. Built per call (all of them are stateless: they
	 * hold only the db + the resolved tables), so a use-case delegates through
	 * exactly one `DocReads` / `Allocation` / `GuardedBatch`.
	 */
	private context(): MroContext {
		return buildContext(this.db, this.tables());
	}

	/**
	 * Model lookup — delegated to the `DocReads` collaborator.
	 */
	async resolveModel(modelId: string): Promise<ModelRow> {
		return this.context().docs.resolveModel(modelId);
	}

	// ── Confirm — stock in — delegated to ./inventory/confirm/inbound.ts ──

	async confirmInbound(docId: string, receiver: { receivedBy?: string | null } = {}): Promise<Record<string, unknown>> {
		return new InboundConfirm(this.context()).confirmInbound(docId, receiver);
	}

	/**
	 * CANCEL an inbound — draft OR posted, decided by the DOCUMENT's own state
	 * (never a client flag). A draft never moved stock, so it is a pure lifecycle
	 * flip; a CONFIRMED receipt is REVERSED (the stock it added comes back) in the
	 * same guarded batch that flips it, so `cancelled` can never mean two different
	 * things to two callers. An already-cancelled document is an idempotent no-op.
	 */
	async cancelInbound(docId: string, actor: { cancelledBy?: string | null } = {}): Promise<Record<string, unknown>> {
		return new InboundConfirm(this.context()).cancelInbound(docId, actor);
	}

	// ── Asset holder chore — delegated to ./inventory/chores/assets.ts ──────

	async moveSerialAsset(input: {
		serialId: string;
		/** The storekeeper/technician performing the change (hrm_employees m2o id). */
		actorId?: string | null;
		/** The vehicle (veh_fleets m2o id) the unit is moving onto. */
		toVehicle?: string | null;
		/** The wheel position on `toVehicle` (e.g. "A1-L"); omit for a tray spare. */
		toSlot?: string | null;
		/** The employee (hrm_employees m2o id) taking custody of the unit. */
		toEmployee?: string | null;
		/**
		 * Governance pin: the move is only valid from this EXACT source (an approved
		 * asset-transfer request's recorded origin). Compared against the SAME row read
		 * the holder CAS uses, so it can never race. `undefined` skips a key; `null`
		 * means "must be empty".
		 */
		expectFrom?: { vehicle?: string | null; slot?: string | null; employee?: string | null };
		/** Override the event's reference kind / doc (defaults from the derived event). */
		refKind?: string | null;
		refDoc?: string | null;
		/**
		 * The custody authorization token. ONLY an approved asset request's execute passes
		 * it; every other caller leaves it unset, so a move that CHANGES the holder
		 * (truck→truck / person→person) is refused — see `assertCustodyChangeAllowed`.
		 */
		authorizedBy?: CustodyAuthorization;
		/**
		 * Extra GUARDED statements merged into the SAME atomic batch (e.g. the ATR
		 * status flip). `base` is the statement count at merge time so the builder can
		 * point its ops at absolute slots.
		 */
		compose?: (base: number) => GuardedBatchFragment;
		note?: string | null;
	}): Promise<Record<string, unknown>> {
		return new AssetChores(this.context()).moveSerialAsset(input);
	}

	// ── Asset transfer requests — delegated to ./inventory/chores/asset-requests.ts ──

	async approveAssetRequest(
		requestId: string,
		opts: { actorId?: string | null; allowAnyApprover?: boolean } = {},
	): Promise<Record<string, unknown>> {
		return new AssetRequestChores(this.context()).approveAssetRequest(requestId, opts);
	}

	async rejectAssetRequest(
		requestId: string,
		opts: { actorId?: string | null; reason?: string | null; allowAnyApprover?: boolean } = {},
	): Promise<Record<string, unknown>> {
		return new AssetRequestChores(this.context()).rejectAssetRequest(requestId, opts);
	}

	async executeAssetRequest(
		requestId: string,
		opts: { actorId?: string | null; allowAnyApprover?: boolean } = {},
	): Promise<Record<string, unknown>> {
		return new AssetRequestChores(this.context()).executeAssetRequest(requestId, opts);
	}

	async listAssetRequests(params: {
		approverId?: string | null;
		isAdmin?: boolean;
		statuses?: string[] | null;
		search?: string | null;
		cursor?: string | null;
		limit?: number;
	}): Promise<{ rows: AssetRequestListRow[]; nextCursor: string | null }> {
		return new AssetRequestChores(this.context()).listAssetRequests(params);
	}

	// ── Serial holder chores — delegated to ./inventory/chores/serials.ts ──────

	async issueSerialToHolder(input: {
		serialId: string;
		/** The storekeeper/technician performing the change (hrm_employees m2o id). */
		actorId?: string | null;
		/** The employee (hrm_employees m2o id) taking custody of the unit. */
		toEmployee?: string | null;
		note?: string | null;
	}): Promise<Record<string, unknown>> {
		return new SerialChores(this.context()).issueSerialToHolder(input);
	}

	async recordSerialCheck(input: {
		serialId: string;
		/** The storekeeper/technician taking the reading (hrm_employees m2o id). */
		actorId?: string | null;
		/** The measured remaining tread depth in millimetres — required, real reading. */
		treadMm?: number | null;
		/** The measured inflation pressure in psi — optional. */
		psi?: number | null;
		/** The wear/condition reading for ANY asset (tyres included) — optional but
		 *  the equipment counterpart of tread/psi, so a jack/toolbox can be graded. */
		condition?: string | null;
		note?: string | null;
	}): Promise<Record<string, unknown>> {
		return new SerialChores(this.context()).recordSerialCheck(input);
	}

	// ── Tyre kiosk chores — delegated to ./inventory/chores/tyres.ts ─────────

	async fitSerialToSeat(input: {
		serialId: string;
		actorId?: string | null;
		toVehicle?: string | null;
		toSlot?: string | null;
		note?: string | null;
		/** The physical day this fit happened (`YYYY-MM-DD`) — the operator-chosen
		 *  "wear date" when back-dating. Omitted ⇒ the history falls back to the
		 *  engine `created_at`. */
		eventDate?: string | null;
	}): Promise<Record<string, unknown>> {
		return new TyreChores(this.context()).fitSerialToSeat(input);
	}

	async returnSerialToStore(input: {
		serialId: string;
		actorId?: string | null;
		toLocation?: string | null;
		note?: string | null;
		/**
		 * The custody authorization token. A return is ALWAYS a holder → store change, so
		 * every caller needs it: only an approved return request's execute passes it, and
		 * the direct kiosk route is refused (see `assertCustodyChangeAllowed`).
		 */
		authorizedBy?: CustodyAuthorization;
		/** Governance pin — the move is only valid from this EXACT source (an approved
		 *  request's recorded origin), so a unit that moved in the meantime is never
		 *  silently returned from its new place. */
		expectFrom?: { vehicle?: string | null; slot?: string | null; employee?: string | null };
		/** Override the event's reference kind / doc (the ATR execute tags them). */
		refKind?: string | null;
		refDoc?: string | null;
		/** Extra GUARDED statements merged into the SAME atomic batch (e.g. the request's
		 *  status flip), so the return and the request state commit or reverse together. */
		compose?: (base: number) => GuardedBatchFragment;
	}): Promise<Record<string, unknown>> {
		return new TyreChores(this.context()).returnSerialToStore(input);
	}

	async scrapMountedSerial(input: {
		serialId: string;
		actorId?: string | null;
		note?: string | null;
		/** The approved write-off request's token — see the chore (GOVERNED writer). */
		authorizedBy?: CustodyAuthorization;
		expectFrom?: { vehicle?: string | null; slot?: string | null; employee?: string | null };
		refKind?: string | null;
		refDoc?: string | null;
		compose?: (base: number) => GuardedBatchFragment;
	}): Promise<Record<string, unknown>> {
		return new TyreChores(this.context()).scrapMountedSerial(input);
	}

	async unseatSerialToTray(input: {
		serialId: string;
		actorId?: string | null;
		note?: string | null;
		/** The physical day this un-seat happened (`YYYY-MM-DD`) — the operator-chosen
		 *  "un-wear date". Omitted ⇒ the history falls back to the engine `created_at`. */
		eventDate?: string | null;
	}): Promise<Record<string, unknown>> {
		return new TyreChores(this.context()).unseatSerialToTray(input);
	}

	async swapSerialSeats(input: {
		serialA: string;
		serialB: string;
		actorId?: string | null;
		note?: string | null;
	}): Promise<Record<string, unknown>> {
		return new TyreChores(this.context()).swapSerialSeats(input);
	}

	// ── Serial lifecycle + holder reads — delegated to ./inventory/chores/serials.ts ──

	async serialEvents(serialId: string): Promise<Array<Record<string, unknown>>> {
		return new SerialChores(this.context()).serialEvents(serialId);
	}

	async holderAssets(holder: { vehicle?: string | null; employee?: string | null } = {}): Promise<HolderAssetRow[]> {
		return new SerialChores(this.context()).holderAssets(holder);
	}

	// ── Confirm — outbound — delegated to ./inventory/confirm/outbound.ts ──

	async confirmOutbound(docId: string, issuer: { issuedBy?: string | null } = {}): Promise<Record<string, unknown>> {
		return new OutboundConfirm(this.context()).confirmOutbound(docId, issuer);
	}

	/** CANCEL an outbound — a draft flips, a POSTED issue is reversed (every
	 *  allocated lot returned, every issued unit back in stock, the source request's
	 *  fulfilment recomputed). See ./inventory/confirm/outbound.ts. */
	async cancelOutbound(docId: string, actor: { cancelledBy?: string | null } = {}): Promise<Record<string, unknown>> {
		return new OutboundConfirm(this.context()).cancelOutbound(docId, actor);
	}

	// ── Confirm — location-to-location transfer — delegated to ./inventory/confirm/transfer.ts ──

	async confirmTransfer(docId: string, approver: { approvedBy?: string | null } = {}): Promise<Record<string, unknown>> {
		return new TransferConfirm(this.context()).confirmTransfer(docId, approver);
	}

	/** CANCEL a transfer — a draft flips, a CONFIRMED move is reversed from its own
	 *  lot/serial trace (source lots back, destination lots down, units back to the
	 *  source store, both balances restored) in the same atomic batch that flips it.
	 *  See ./inventory/confirm/transfer.ts. */
	async cancelTransfer(docId: string, actor: { cancelledBy?: string | null } = {}): Promise<Record<string, unknown>> {
		return new TransferConfirm(this.context()).cancelTransfer(docId, actor);
	}

	// ── Confirm — adjustment — delegated to ./inventory/confirm/adjustment.ts ──

	async confirmAdjustment(docId: string, approver: { approvedBy?: string | null } = {}): Promise<Record<string, unknown>> {
		return new AdjustmentConfirm(this.context()).confirmAdjustment(docId, approver);
	}

	/** CANCEL an adjustment — a draft flips, an APPROVED correction is reversed
	 *  (± deltas undone from its own trace). See ./inventory/confirm/adjustment.ts. */
	async cancelAdjustment(docId: string, actor: { cancelledBy?: string | null } = {}): Promise<Record<string, unknown>> {
		return new AdjustmentConfirm(this.context()).cancelAdjustment(docId, actor);
	}

	// ── Confirm — requisition — delegated to ./inventory/confirm/requisition.ts ──

	async confirmRequisition(docId: string, approver: { approvedBy?: string | null } = {}): Promise<Record<string, unknown>> {
		return new RequisitionConfirm(this.context()).confirmRequisition(docId, approver);
	}

	async rejectRequisition(docId: string, intent: { closeReason?: string | null } = {}): Promise<Record<string, unknown>> {
		return new RequisitionConfirm(this.context()).rejectRequisition(docId, intent);
	}

	async issueRequisition(
		docId: string,
		opts: {
			issuedBy?: string | null;
			lines?: Array<{ item_model?: unknown; qty?: unknown }>;
			createOutbound: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
			discardOutbound: (outboundId: string) => Promise<void>;
		},
	): Promise<Record<string, unknown>> {
		return new RequisitionConfirm(this.context()).issueRequisition(docId, opts);
	}

	// ── Stock reads — delegated to the read collaborators (one accessor per ──
	// family). ONE `stockSnapshot` derivation lives in StockReports, shared by
	// `onHand` and `reconcile`; these methods only wire this service's db +
	// resolved tables to them.

	private stockReports(): StockReports {
		return new StockReports(this.db, this.tables());
	}

	private movement(): MovementReads {
		return new MovementReads(this.db, this.tables());
	}

	private catalog(): CatalogReads {
		return new CatalogReads(this.db, this.tables());
	}

	async expiringStock(days?: number): Promise<{
		days: number;
		expired: Array<Record<string, unknown>>;
		expiring: Array<Record<string, unknown>>;
	}> {
		return this.stockReports().expiringStock(days);
	}

	async onHand(): Promise<Array<Record<string, unknown>>> {
		return this.stockReports().onHand();
	}

	async itemComposition(modelId: string, opts: { location?: string | null } = {}): Promise<Record<string, unknown>> {
		return this.stockReports().itemComposition(modelId, opts);
	}

	async reconcile(): Promise<{ rows: Array<Record<string, unknown>>; summary: Record<string, number>; checked_at: string }> {
		return this.stockReports().reconcile();
	}

	async documentsInCategory(params: {
		kind: 'inbounds' | 'outbounds';
		categoryId: string;
		location: MroLocation;
		type: string;
	}): Promise<Array<Record<string, unknown>>> {
		return this.movement().documentsInCategory(params);
	}

	async movementModels(params: {
		group: string;
		direction: MroMovementDirection;
		location?: MroLocation | null;
		cursor?: string | null;
	}): Promise<{ rows: MovementModelAggRow[]; nextCursor: string | null }> {
		return this.movement().movementModels(params);
	}

	async movementLedger(params: {
		model: string;
		direction: MroMovementDirection;
		location?: MroLocation | null;
		cursor?: string | null;
	}): Promise<{ rows: MovementLedgerAggRow[]; nextCursor: string | null; summary: MovementLedgerSummary }> {
		return this.movement().movementLedger(params);
	}

	async movementGroups(params: {
		cursor?: string | null;
		search?: string | null;
	}): Promise<{ rows: MovementGroupRow[]; nextCursor: string | null }> {
		return this.movement().movementGroups(params);
	}

	async movementGroupLines(params: {
		group: string;
		direction: MroMovementDirection;
		location?: MroLocation | null;
		cursor?: string | null;
	}): Promise<{ rows: MovementLedgerAggRow[]; nextCursor: string | null }> {
		return this.movement().movementGroupLines(params);
	}

	async catalogGroups(): Promise<{ rows: CatalogGroupRow[] }> {
		return this.catalog().catalogGroups();
	}
}
