/**
 * Asset transfer requests — truck→truck / person→person, superior-approved. A
 * request is FILED through the generic entity API, then approved/rejected by a
 * recorded superior and finally EXECUTED as one atomic guarded move pinned to the
 * request's source. Moved verbatim out of `inventory.service.ts`, which now
 * delegates here so its public surface is unchanged; runs on the shared `MroContext`.
 */
import { collectionTable } from '@/lib/utils/table-name';
import { decodeAssetRequestCursor, encodeAssetRequestCursor, isAssetRequestStatus, nowIso, strId } from '../codecs';
import type { GuardedBatchFragment } from '../guarded-batch';
import { AUTHORIZED_BY_ASSET_REQUEST } from '../custody';
import { MRO_ASSET_REQUESTS_PAGE, MroError } from '../types';
import type { AssetRequestListRow } from '../types';
import type { MroContext } from '../context';
import { TyreChores } from './tyres';
import { AssetChores } from './assets';

export class AssetRequestChores {
	constructor(private readonly c: MroContext) {}

	private get db() {
		return this.c.db;
	}

	private get tables() {
		return this.c.tables;
	}

	private get docs() {
		return this.c.docs;
	}

	private get guarded() {
		return this.c.guarded;
	}

	private get tyres() {
		return new TyreChores(this.c);
	}

	private get assets() {
		return new AssetChores(this.c);
	}

	// ── Asset transfer requests — truck→truck / person→person, superior-approved ──
	// A request is FILED through the generic entity API (`mro_asset_requests`;
	// `requested_by` is session-stamped, `status`/`approved_by`/… are frozen), then
	// approved/rejected by a recorded superior and finally EXECUTED as one atomic
	// guarded move pinned to the request's source. The lifecycle is a plain `status`
	// column the service is the sole writer of.

	/** Approve a requested transfer (no stock effect) — the superior's sign-off. */
	async approveAssetRequest(
		requestId: string,
		opts: { actorId?: string | null; allowAnyApprover?: boolean } = {},
	): Promise<Record<string, unknown>> {
		const id = strId(requestId, 'requestId');
		const actorId = (opts.actorId ?? '').trim();
		const t = this.tables;
		const req = await this.docs.assetRequestRow(id);
		if (!req) throw new MroError(404, 'Request not found');
		if ((req.status ?? '') !== 'requested')
			throw new MroError(409, `This request is ${req.status ?? 'unknown'} — only a request awaiting a decision can be approved`);
		await this.docs.guardRequestApprover(req, actorId, Boolean(opts.allowAnyApprover));

		const now = nowIso();
		const failed = await this.guarded.runGuarded(
			[
				{
					sql: `UPDATE ${t.assetRequest}
					      SET status = 'approved', approved_by = ?1, approved_at = ?2, updated_at = ?2
					      WHERE id = ?3 AND status = 'requested'`,
					bindings: [actorId, now, id],
				},
			],
			new Map([[0, 'That request was just decided — reload it']]),
			[],
			'Could not approve the request',
		);
		if (failed) throw new MroError(409, failed);
		this.docs.invalidate();
		return { requestId: id, status: 'approved', approved_by: actorId, display_number: req.display_number };
	}

	/** Reject a requested transfer (no stock effect) — records who and why. */
	async rejectAssetRequest(
		requestId: string,
		opts: { actorId?: string | null; reason?: string | null; allowAnyApprover?: boolean } = {},
	): Promise<Record<string, unknown>> {
		const id = strId(requestId, 'requestId');
		const actorId = (opts.actorId ?? '').trim();
		const reason = (opts.reason ?? '').trim() || null;
		const t = this.tables;
		const req = await this.docs.assetRequestRow(id);
		if (!req) throw new MroError(404, 'Request not found');
		if ((req.status ?? '') !== 'requested')
			throw new MroError(409, `This request is ${req.status ?? 'unknown'} — only a request awaiting a decision can be rejected`);
		await this.docs.guardRequestApprover(req, actorId, Boolean(opts.allowAnyApprover));

		const now = nowIso();
		const failed = await this.guarded.runGuarded(
			[
				{
					sql: `UPDATE ${t.assetRequest}
					      SET status = 'rejected', approved_by = ?1, approved_at = ?2, rejected_reason = ?3, updated_at = ?2
					      WHERE id = ?4 AND status = 'requested'`,
					bindings: [actorId, now, reason, id],
				},
			],
			new Map([[0, 'That request was just decided — reload it']]),
			[],
			'Could not reject the request',
		);
		if (failed) throw new MroError(409, failed);
		this.docs.invalidate();
		return { requestId: id, status: 'rejected', rejected_by: actorId, display_number: req.display_number };
	}

	/**
	 * Execute an approved transfer: move the asset in ONE atomic batch that ALSO
	 * flips the request to `executed`. The move is pinned to the request's recorded
	 * source (`expectFrom`) — a unit that moved elsewhere since approval 409s rather
	 * than being silently relocated from wherever it now is. The event is tagged
	 * `ref_kind='ATR'` + the request number, so the serial's lifecycle names the
	 * document that authorised it.
	 */
	async executeAssetRequest(
		requestId: string,
		opts: { actorId?: string | null; allowAnyApprover?: boolean } = {},
	): Promise<Record<string, unknown>> {
		const id = strId(requestId, 'requestId');
		const actorId = (opts.actorId ?? '').trim() || null;
		const t = this.tables;
		const req = await this.docs.assetRequestRow(id);
		if (!req) throw new MroError(404, 'Request not found');
		if ((req.status ?? '') !== 'approved')
			throw new MroError(409, `This request is ${req.status ?? 'unknown'} — approve it before executing`);
		// The executor is bound to the SESSION and must be a second person: the
		// request's own filer may not authorise the move by executing it too
		// (two-person). An admin — the trusted root — may execute anything.
		if (!actorId) throw new MroError(400, 'The executing employee is required');
		const requester = (req.requested_by ?? '').trim();
		if (!opts.allowAnyApprover && requester && requester === actorId)
			throw new MroError(409, 'This request must be executed by someone other than the requester');
		const serialId = (req.serial ?? '').trim();
		if (!serialId) throw new MroError(409, 'This request names no asset to move');

		const now = nowIso();
		// The request's OWN kind decides the writer: a WRITE-OFF (`write_off`) ends the
		// unit's life where it sits, a RETURN (`to_location`) flips it back into a
		// store's stock, a TRANSFER rewrites the holder seam. Whichever it is, the
		// request's status flip rides in the SAME guarded batch, and the event is tagged
		// ATR + the request number, so the lifecycle names the document that authorised it.
		const flipRequest = (base: number): GuardedBatchFragment => ({
			statements: [
				{
					sql: `UPDATE ${t.assetRequest} SET status = 'executed', executed_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'approved'`,
					bindings: [now, id],
				},
			],
			guards: [{ index: 0, message: 'That request was already executed — reload it' }],
			ops: [{ kind: 'doc_unflip', table: t.assetRequest, docId: id, fromStatus: 'approved', stmt: base, column: 'status' }],
		});
		const result = req.write_off
			? await this.tyres.scrapMountedSerial({
					serialId,
					actorId,
					note: req.note ?? null,
					authorizedBy: AUTHORIZED_BY_ASSET_REQUEST,
					expectFrom: { vehicle: req.from_vehicle ?? null, slot: req.from_slot ?? null, employee: req.from_employee ?? null },
					refKind: 'ATR',
					refDoc: req.display_number ?? id,
					compose: flipRequest,
				})
			: req.to_location
				? await this.tyres.returnSerialToStore({
						serialId,
						actorId,
						toLocation: req.to_location,
						authorizedBy: AUTHORIZED_BY_ASSET_REQUEST,
						expectFrom: { vehicle: req.from_vehicle ?? null, slot: req.from_slot ?? null, employee: req.from_employee ?? null },
						refKind: 'ATR',
						refDoc: req.display_number ?? id,
						compose: flipRequest,
					})
				: await this.assets.moveSerialAsset({
						serialId,
						actorId,
						toVehicle: req.to_vehicle,
						toSlot: req.to_slot,
						toEmployee: req.to_employee,
						expectFrom: { vehicle: req.from_vehicle ?? null, slot: req.from_slot ?? null, employee: req.from_employee ?? null },
						authorizedBy: AUTHORIZED_BY_ASSET_REQUEST,
						refKind: 'ATR',
						refDoc: req.display_number ?? id,
						compose: flipRequest,
					});
		return { requestId: id, status: 'executed', ...result };
	}

	/**
	 * The APPROVER-scoped transfer-request feed (`GET /api/mro/asset-requests`) —
	 * every request THIS session is entitled to decide, newest first, keyset-paged.
	 *
	 * The scope is the SAME rule `guardRequestApprover` enforces at decide time, so
	 * the list can never offer a request the decision would then 403 on: an admin
	 * sees all, anyone else sees only requests filed by their recorded
	 * subordinates (`hrm_employee_links`). A session with no recorded reporting
	 * line gets an empty feed (not an error) — there is simply nothing they may
	 * decide.
	 *
	 * `statuses` is a whitelisted list (an unknown value is dropped); the default
	 * the route applies is `['requested']` — the decide queue. Rows are
	 * display-ready: serial / both plates / both custodians / requester / decider
	 * are resolved here so the card needs no client join.
	 */
	async listAssetRequests(params: {
		approverId?: string | null;
		isAdmin?: boolean;
		statuses?: string[] | null;
		search?: string | null;
		cursor?: string | null;
		limit?: number;
	}): Promise<{ rows: AssetRequestListRow[]; nextCursor: string | null }> {
		const t = this.tables;
		const empTable = collectionTable('hrm_employees');
		const vehicleTable = collectionTable('veh_fleets');
		const where: string[] = ['R.deleted_at IS NULL'];
		const bindings: unknown[] = [];

		// Scope — mirror of the decide-time guard (deny-by-default).
		if (!params.isAdmin) {
			const approverId = (params.approverId ?? '').trim();
			if (!approverId) return { rows: [], nextCursor: null };
			bindings.push(approverId);
			where.push(
				`R.requested_by IN (SELECT L.subordinate FROM ${t.empLinks} L WHERE L.superior = ?${bindings.length} AND L.deleted_at IS NULL)`,
			);
		}

		// Status filter — values are whitelisted literals (never interpolated input).
		const statuses = (params.statuses ?? []).filter(isAssetRequestStatus);
		if (statuses.length > 0) where.push(`R.status IN (${statuses.map((s) => `'${s}'`).join(', ')})`);

		// Server-side search — a term matches the doc number, the serial, either
		// plate, or the requester's name; LIKE wildcards are escaped (ESCAPE '\\').
		if (params.search) {
			bindings.push(`%${params.search.replace(/[%_]/g, '\\$&')}%`);
			const s = bindings.length;
			where.push(
				`(R.display_number LIKE ?${s} ESCAPE '\\' OR S.serial_no LIKE ?${s} ESCAPE '\\'` +
					` OR VF.plate_no LIKE ?${s} ESCAPE '\\' OR VT.plate_no LIKE ?${s} ESCAPE '\\'` +
					` OR RQ.name_en LIKE ?${s} ESCAPE '\\')`,
			);
		}

		// Keyset — (created_at DESC, id DESC).
		if (params.cursor) {
			const key = decodeAssetRequestCursor(params.cursor);
			bindings.push(key.createdAt);
			const c = bindings.length;
			bindings.push(key.id);
			where.push(`(R.created_at < ?${c} OR (R.created_at = ?${c} AND R.id < ?${c + 1}))`);
		}

		const limit = Math.min(Math.max(1, params.limit ?? MRO_ASSET_REQUESTS_PAGE), MRO_ASSET_REQUESTS_PAGE);
		bindings.push(limit + 1);
		const rows = await this.db.all<Record<string, unknown>>({
			sql: `SELECT R.id AS id, R.display_number AS display_number, R.status AS status,
			             R.serial AS serial, S.serial_no AS serial_no,
			             R.from_vehicle AS from_vehicle, VF.plate_no AS from_plate, R.from_slot AS from_slot,
			             R.from_employee AS from_employee, RF.name_en AS from_employee_name,
			       R.to_vehicle AS to_vehicle, VT.plate_no AS to_plate, R.to_slot AS to_slot,
			       R.to_employee AS to_employee, RT.name_en AS to_employee_name,
			       R.to_location AS to_location,
			       R.write_off AS write_off,
			             R.requested_by AS requested_by, RQ.name_en AS requested_by_name,
			             R.approved_by AS approved_by, RB.name_en AS approved_by_name,
			             R.approved_at AS approved_at, R.rejected_reason AS rejected_reason,
			             R.executed_at AS executed_at, R.note AS note, R.created_at AS created_at
			        FROM ${t.assetRequest} R
			        LEFT JOIN ${t.serials} S ON S.id = R.serial AND S.deleted_at IS NULL
			        LEFT JOIN ${vehicleTable} VF ON VF.id = R.from_vehicle AND VF.deleted_at IS NULL
			        LEFT JOIN ${vehicleTable} VT ON VT.id = R.to_vehicle AND VT.deleted_at IS NULL
			        LEFT JOIN ${empTable} RF ON RF.id = R.from_employee AND RF.deleted_at IS NULL
			        LEFT JOIN ${empTable} RT ON RT.id = R.to_employee AND RT.deleted_at IS NULL
			        LEFT JOIN ${empTable} RQ ON RQ.id = R.requested_by AND RQ.deleted_at IS NULL
			        LEFT JOIN ${empTable} RB ON RB.id = R.approved_by AND RB.deleted_at IS NULL
			       WHERE ${where.join(' AND ')}
			       ORDER BY R.created_at DESC, R.id DESC
			       LIMIT ?${bindings.length}`,
			bindings,
		});
		const hasMore = rows.length > limit;
		const page = hasMore ? rows.slice(0, limit) : rows;
		const last = page[page.length - 1];
		return {
			rows: page.map((r) => ({
				id: String(r.id ?? ''),
				display_number: r.display_number == null ? null : String(r.display_number),
				status: r.status == null ? 'requested' : String(r.status),
				serial: r.serial == null ? null : String(r.serial),
				serial_no: r.serial_no == null ? null : String(r.serial_no),
				from_vehicle: r.from_vehicle == null ? null : String(r.from_vehicle),
				from_plate: r.from_plate == null ? null : String(r.from_plate),
				from_slot: r.from_slot == null ? null : String(r.from_slot),
				from_employee: r.from_employee == null ? null : String(r.from_employee),
				from_employee_name: r.from_employee_name == null ? null : String(r.from_employee_name),
				to_vehicle: r.to_vehicle == null ? null : String(r.to_vehicle),
				to_plate: r.to_plate == null ? null : String(r.to_plate),
				to_slot: r.to_slot == null ? null : String(r.to_slot),
				to_employee: r.to_employee == null ? null : String(r.to_employee),
				to_employee_name: r.to_employee_name == null ? null : String(r.to_employee_name),
				to_location: r.to_location == null ? null : String(r.to_location),
				write_off: r.write_off == null ? null : Boolean(Number(r.write_off) || r.write_off === true),
				requested_by: r.requested_by == null ? null : String(r.requested_by),
				requested_by_name: r.requested_by_name == null ? null : String(r.requested_by_name),
				approved_by: r.approved_by == null ? null : String(r.approved_by),
				approved_by_name: r.approved_by_name == null ? null : String(r.approved_by_name),
				approved_at: r.approved_at == null ? null : String(r.approved_at),
				rejected_reason: r.rejected_reason == null ? null : String(r.rejected_reason),
				executed_at: r.executed_at == null ? null : String(r.executed_at),
				note: r.note == null ? null : String(r.note),
				created_at: r.created_at == null ? null : String(r.created_at),
			})),
			nextCursor:
				hasMore && last ? encodeAssetRequestCursor(last.created_at == null ? null : String(last.created_at), String(last.id ?? '')) : null,
		};
	}
}
