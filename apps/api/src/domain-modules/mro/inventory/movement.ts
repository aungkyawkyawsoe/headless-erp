/**
 * MRO parts-MOVEMENT ledger registers — the IN + OUT + TRF confirmed-line reads
 * (the per-model and per-group aggregates and the paged line register) plus the
 * doc-in-category lookup. Moved verbatim out of `stock-reads.ts` (ONE shared
 * `movementUnion` projection, reused by every reader here); the facade delegates here.
 */
import type { D1Client } from '@mmbix/core';
import { collectionTable } from '@/lib/utils/table-name';
import {
	decodeGroupCursor,
	decodeModelCursor,
	decodeMovementCursor,
	encodeGroupCursor,
	encodeModelCursor,
	encodeMovementCursor,
	movementAggRowOf,
} from './codecs';
import { MRO_MOVEMENT_GROUPS_PAGE, MRO_MOVEMENT_LEDGER_PAGE, MRO_MOVEMENT_MODELS_PAGE } from './types';
import type {
	MovementGroupRow,
	MovementLedgerAggRow,
	MovementLedgerSummary,
	MovementModelAggRow,
	MroLocation,
	MroMovementDirection,
	Tables,
} from './types';

export class MovementReads {
	constructor(
		private readonly db: D1Client,
		private readonly tables: Tables,
	) {}
	/**
	 * Doc headers of `kind` scoped to a `location` + `type` whose child lines
	 * include at least one item model classified under the given category — i.e.
	 * the doc-level equivalent of the stock page's category filter:
	 *
	 *   mro_{kind}_lines.item_model  (m2o) →  mro_item_model.item_name
	 *     (m2o → mro_item_name) → .category (m2o → mro_item_categories)
	 *
	 * Rows are returned in the header card projection (newest first), so a client
	 * reuses the SAME card renderer as the plain store list. A document whose
	 * lines carry no categorised model is simply absent — it never matches.
	 */
	async documentsInCategory(params: {
		kind: 'inbounds' | 'outbounds';
		categoryId: string;
		location: MroLocation;
		type: string;
	}): Promise<Array<Record<string, unknown>>> {
		const { kind, categoryId, location, type } = params;
		const t = this.tables;
		const isIn = kind === 'inbounds';
		const dateCol = isIn ? 'H.purchase_date' : 'H.effective_date';
		const headerCols =
			'H.id, H.display_number, H.doc_status, H.type, H.location, ' +
			`${dateCol}` +
			', H.note, H.total_qty, H.line_count, H.total_amount, H.confirmed_at, H.created_at';

		// EXISTS: header → its lines → each line's model → model's part-group → group's category.
		const sql = `SELECT DISTINCT ${headerCols}
			 FROM ${isIn ? t.inbound : t.outbound} H
			 WHERE H.deleted_at IS NULL AND H.location = ?2 AND H.type = ?3
			   AND EXISTS (
			     SELECT 1
			       FROM ${isIn ? t.inLines : t.outLines} L
			       JOIN ${t.model} M ON M.id = L.item_model AND M.deleted_at IS NULL
			       JOIN ${t.group} G ON G.id = M.item_name AND G.deleted_at IS NULL
			       JOIN ${t.category} C ON C.id = G.category AND C.deleted_at IS NULL
			       WHERE L.parent_id = H.id AND L.deleted_at IS NULL AND C.id = ?1
			   )
			 ORDER BY H.created_at DESC, H.id DESC`;

		return this.db.all<Record<string, unknown>>({ sql, bindings: [categoryId, location, type] });
	}

	// ── Parts-movement ledger (IN + OUT + TRF confirmed lines) ────────────────

	/**
	 * The shared confirmed-lines source: every inbound / outbound / transfer line
	 * whose header is `confirmed`. The projection is uniform across the three
	 * tables so both read methods filter/aggregate ONE subquery. Each branch keeps
	 * its own kind/date/location columns straight; the line alias is `L` and the
	 * header alias `H` in every branch.
	 *
	 * `branchCond` is an OPTIONAL raw fragment appended to EVERY branch's WHERE.
	 * Pushing a caller's selective predicate INTO the branches (one model, or one
	 * group's live models) lets each branch SEEK the line table instead of
	 * materialising the entire movement history and filtering after the UNION ALL.
	 * Omit it only for genuinely whole-history aggregates.
	 *
	 * The creator rides the union as the RAW `H.created_by` (`_users` id): naming it
	 * is the page reader's job (`movementRowsPage` resolves the employee ONCE per
	 * row), so the aggregate readers that never show a name pay no join for it.
	 */
	private movementUnion(branchCond = ''): string {
		const t = this.tables;
		const extra = branchCond ? ` ${branchCond}` : '';
		return [
			`SELECT 'in' AS direction, L.id AS line_id, H.type AS kind, H.display_number AS doc_no, H.id AS doc_id,
			        H.purchase_date AS date, H.location AS location,
			        NULL AS from_location, NULL AS to_location,
			        L.item_model AS model, L.qty AS qty, L.unit_price AS unit_price,
			        L.batch_no AS batch_no, L.serials AS serials, L.note AS note,
			        H.created_by AS created_by
			   FROM ${t.inbound} H
			   JOIN ${t.inLines} L ON L.parent_id = H.id
			  WHERE H.doc_status = 'confirmed' AND H.deleted_at IS NULL AND L.deleted_at IS NULL${extra}`,
			`SELECT 'out' AS direction, L.id AS line_id, H.type AS kind, H.display_number AS doc_no, H.id AS doc_id,
			        H.effective_date AS date, H.location AS location,
			        NULL AS from_location, NULL AS to_location,
			        L.item_model AS model, L.qty AS qty, L.unit_price AS unit_price,
			        NULL AS batch_no, L.serials AS serials, L.note AS note,
			        H.created_by AS created_by
			   FROM ${t.outbound} H
			   JOIN ${t.outLines} L ON L.parent_id = H.id
			  WHERE H.doc_status = 'confirmed' AND H.deleted_at IS NULL AND L.deleted_at IS NULL${extra}`,
			`SELECT 'trf' AS direction, L.id AS line_id, 'transfer' AS kind, H.display_number AS doc_no, H.id AS doc_id,
			        H.transfer_date AS date, NULL AS location,
			        H.from_location AS from_location, H.to_location AS to_location,
			        L.item_model AS model, L.qty AS qty, NULL AS unit_price,
			        L.batch_no AS batch_no, L.serials AS serials, L.note AS note,
			        H.created_by AS created_by
			   FROM ${t.transfer} H
			   JOIN ${t.transferLines} L ON L.parent_id = H.id
			  WHERE H.doc_status = 'confirmed' AND H.deleted_at IS NULL AND L.deleted_at IS NULL${extra}`,
			// Adjustment lines are parts movements too (add → in, remove → out): a
			// balance correction must be traceable in the SAME ledger it explains.
			`SELECT CASE WHEN L.direction = 'add' THEN 'in' ELSE 'out' END AS direction, L.id AS line_id,
			        'adjustment' AS kind, H.display_number AS doc_no, H.id AS doc_id,
			        H.adjustment_date AS date, H.location AS location,
			        NULL AS from_location, NULL AS to_location,
			        L.item_model AS model, L.qty AS qty, L.unit_cost AS unit_price,
			        L.batch_no AS batch_no, L.serials AS serials, NULL AS note,
			        H.created_by AS created_by
			   FROM ${t.adjustment} H
			   JOIN ${t.adjustmentLines} L ON L.parent_id = H.id
			  WHERE H.doc_status = 'confirmed' AND H.deleted_at IS NULL AND L.deleted_at IS NULL${extra}`,
		].join(' UNION ALL ');
	}

	/**
	 * The branch predicate restricting the union to ONE item-name group's live
	 * models — the group-scoped screens' equivalent of pushing a single model id.
	 * `?<groupSlot>` is the group-id binding the caller already supplies.
	 */
	private groupModelsCond(groupSlot: number): string {
		return `AND L.item_model IN (SELECT id FROM ${this.tables.model} WHERE item_name = ?${groupSlot} AND deleted_at IS NULL)`;
	}

	/**
	 * A group's belonging models (Screen 2's DEFAULT rows). Every model in the group
	 * with at least one CONFIRMED movement line, aggregated across IN/OUT/TRF; the
	 * active `direction` tab narrows the SET (models having that direction's lines)
	 * and an optional `location` scopes it the same way the ledger does (TRF rows
	 * match either endpoint store). Newest activity first.
	 *
	 * Keyset-paginated on `(last movement day, model id)` — the row set is the
	 * group's SKUs, so a group with hundreds of them must STREAM like every other
	 * register instead of dumping one capped page (`LIMIT 500` could not page at
	 * all: the client had no cursor to ask with).
	 *
	 * The keyset key is `COALESCE(MAX(date), '')`, not `MAX(date)`: a line whose
	 * source doc carries no date would key on NULL — ordered last, yet never
	 * matching the next page's `key < ?` comparison, so those models would silently
	 * vanish from page 2 onward.
	 */
	async movementModels(params: {
		group: string;
		direction: MroMovementDirection;
		location?: MroLocation | null;
		cursor?: string | null;
	}): Promise<{ rows: MovementModelAggRow[]; nextCursor: string | null }> {
		const { group, direction, location, cursor } = params;
		const conds = [`U.model IS NOT NULL`, `M.item_name = ?1`];
		const bindings: unknown[] = [group];
		let slot = 2;
		if (direction !== 'all') conds.push(`U.direction = '${direction}'`); // whitelisted literal
		if (location) {
			conds.push(`(?${slot} = U.location OR ?${slot} = U.from_location OR ?${slot} = U.to_location)`);
			bindings.push(location);
			slot += 1;
		}
		// The keyset compares an AGGREGATE, so it lives in HAVING (WHERE runs before
		// the GROUP BY and cannot see MAX). Same bindings either way.
		let having = '';
		if (cursor) {
			const key = decodeModelCursor(cursor);
			having = `HAVING (COALESCE(MAX(U.date), '') < ?${slot} OR (COALESCE(MAX(U.date), '') = ?${slot} AND U.model < ?${slot + 1}))`;
			bindings.push(key.lastDate, key.model);
			slot += 2;
		}
		bindings.push(MRO_MOVEMENT_MODELS_PAGE);
		const sql = `SELECT U.model AS model, M.name_en AS model_name,
		        COALESCE(SUM(CASE WHEN U.direction = 'in' THEN U.qty ELSE 0 END), 0) AS total_in,
		        COALESCE(SUM(CASE WHEN U.direction = 'out' THEN U.qty ELSE 0 END), 0) AS total_out,
		        COALESCE(SUM(CASE WHEN U.direction = 'trf' THEN U.qty ELSE 0 END), 0) AS total_trf,
		        COUNT(*) AS line_count,
		        COUNT(DISTINCT U.direction || ':' || COALESCE(U.doc_no, '')) AS doc_count,
		        COALESCE(MAX(U.date), '') AS last_date
		   FROM (${this.movementUnion(this.groupModelsCond(1))}) U
		   JOIN ${this.tables.model} M ON M.id = U.model AND M.deleted_at IS NULL
		  WHERE ${conds.join(' AND ')}
		  GROUP BY U.model, M.name_en
		  ${having}
		  ORDER BY last_date DESC, U.model DESC
		  LIMIT ?${slot}`;
		const rows = await this.db.all<Record<string, unknown>>({ sql, bindings });
		const last = rows[rows.length - 1];
		return {
			rows: rows.map((r) => ({
				model: String(r.model ?? ''),
				model_name: r.model_name == null ? null : String(r.model_name),
				total_in: Number(r.total_in ?? 0),
				total_out: Number(r.total_out ?? 0),
				total_trf: Number(r.total_trf ?? 0),
				line_count: Number(r.line_count ?? 0),
				doc_count: Number(r.doc_count ?? 0),
				last_date: r.last_date == null || r.last_date === '' ? null : String(r.last_date),
			})),
			nextCursor:
				rows.length === MRO_MOVEMENT_MODELS_PAGE && last ? encodeModelCursor(String(last.last_date ?? ''), String(last.model ?? '')) : null,
		};
	}

	/**
	 * ONE model's line-level ledger (Screen 3) — every confirmed IN/OUT/TRF line,
	 * newest first, keyset-paginated at MRO_MOVEMENT_LEDGER_PAGE. The header
	 * summary + current on-hand are computed over the SAME active scope (minus
	 * the page key) so the top line never disagrees with the rows below it.
	 */
	async movementLedger(params: {
		model: string;
		direction: MroMovementDirection;
		location?: MroLocation | null;
		cursor?: string | null;
	}): Promise<{ rows: MovementLedgerAggRow[]; nextCursor: string | null; summary: MovementLedgerSummary }> {
		const { model, direction, location, cursor } = params;
		const scopeConds = [`U.model = ?1`];
		const scopeBindings: unknown[] = [model];
		let slot = 2;
		if (direction !== 'all') scopeConds.push(`U.direction = '${direction}'`); // whitelisted literal
		if (location) {
			scopeConds.push(`(?${slot} = U.location OR ?${slot} = U.from_location OR ?${slot} = U.to_location)`);
			scopeBindings.push(location);
			slot += 1;
		}
		const scopeWhere = scopeConds.join(' AND ');

		const summaryRow = await this.db.first<Record<string, unknown>>({
			sql: `SELECT
			        COALESCE(SUM(CASE WHEN U.direction = 'in' THEN U.qty ELSE 0 END), 0) AS total_in,
			        COALESCE(SUM(CASE WHEN U.direction = 'out' THEN U.qty ELSE 0 END), 0) AS total_out,
			        COALESCE(SUM(CASE WHEN U.direction = 'trf' THEN U.qty ELSE 0 END), 0) AS total_trf,
			        COUNT(DISTINCT U.direction || ':' || COALESCE(U.doc_no, '')) AS doc_count,
			        COUNT(*) AS line_count
			   FROM (${this.movementUnion('AND L.item_model = ?1')}) U
			  WHERE ${scopeWhere}`,
			bindings: [...scopeBindings],
		});

		// Current on-hand for the model — one inventory row per (model, location);
		// an active store scope reads that row, otherwise the total across stores.
		const onHandRow = await this.db.first<Record<string, unknown>>({
			sql: `SELECT COALESCE(SUM(qty_on_hand), 0) AS on_hand
			   FROM ${this.tables.inv}
			  WHERE model = ?1 AND deleted_at IS NULL${location ? ' AND location = ?2' : ''}`,
			bindings: location ? [model, location] : [model],
		});

		// The page — the SAME keyset-page helper the group feed uses (one projection
		// + one mapper, no duplicated SQL), with the model pushed INTO each union
		// branch so a ledger page reads only THAT model's lines.
		const page = await this.movementRowsPage(scopeConds, scopeBindings, cursor ?? null, `AND L.item_model = ?1`);
		return {
			rows: page.rows.map(movementAggRowOf),
			nextCursor: page.nextCursor,
			summary: {
				total_in: Number(summaryRow?.total_in ?? 0),
				total_out: Number(summaryRow?.total_out ?? 0),
				total_trf: Number(summaryRow?.total_trf ?? 0),
				doc_count: Number(summaryRow?.doc_count ?? 0),
				line_count: Number(summaryRow?.line_count ?? 0),
				on_hand: Number(onHandRow?.on_hand ?? 0),
			},
		};
	}

	/**
	 * ONE keyset page of the shared movement-lines projection, newest first — the
	 * rows SQL both the single-model ledger and the group line feed use. Scope
	 * conds/bindings come from the caller; the keyset key (date, line_id) is
	 * appended here so the page never re-reads the caller's summary query.
	 */
	private async movementRowsPage(
		scopeConds: string[],
		scopeBindings: unknown[],
		cursor: string | null,
		branchCond = '',
	): Promise<{ rows: Array<Record<string, unknown>>; nextCursor: string | null }> {
		const conds = [...scopeConds];
		const bindings = [...scopeBindings];
		if (cursor) {
			const key = decodeMovementCursor(cursor);
			const slot = bindings.length + 1;
			conds.push(`(U.date < ?${slot} OR (U.date = ?${slot} AND U.line_id < ?${slot + 1}))`);
			bindings.push(key.date, key.lineId);
		}
		const limitSlot = bindings.length + 1;
		bindings.push(MRO_MOVEMENT_LEDGER_PAGE);
		// The creator is named HERE, once per row, rather than inside each union
		// branch — and named from the EMPLOYEE the session acted as, not from the
		// login row's own `full_name`.
		//
		// `created_by` is a `_users` id and `_users.full_name` is a denormalised copy:
		// the Telegram login route syncs it from the directory, but a WEB (email +
		// password) account's is whatever an admin typed — so the same person's act
		// could read one way signed in from Telegram and another from the browser.
		// The employee directory is the single source of truth for a person's name, so
		// the name resolves from there through either of the two links a `_users` row
		// can carry: a password account's durable `employee_id`, or a Telegram
		// account's `etg_id` — the id embedded in its `tg-<id>@telegram.local`
		// address, which `substr`/`instr` pull back out of the ONE address shape the
		// login route writes. `CU.full_name` stays the last resort so an account with
		// neither link (the bootstrap admin, a legacy row) still renders rather than
		// going blank.
		const empTable = collectionTable('hrm_employees');
		const rows = await this.db.all<Record<string, unknown>>({
			sql: `SELECT U.direction, U.line_id, U.model, U.kind, U.doc_no, U.doc_id, U.date,
			        U.location, U.from_location, U.to_location,
			        M.name_en AS model_name, U.qty, U.unit_price, U.batch_no, U.serials, U.note,
			        COALESCE(NULLIF(EMP.name_mm, ''), NULLIF(EMP.name_en, ''), CU.full_name) AS created_name
			   FROM (${this.movementUnion(branchCond)}) U
			   JOIN ${this.tables.model} M ON M.id = U.model AND M.deleted_at IS NULL
			   LEFT JOIN _users CU ON CU.id = U.created_by
			   LEFT JOIN ${empTable} EMP ON EMP.deleted_at IS NULL
			         AND (EMP.id = CU.employee_id
			              OR (CU.email LIKE 'tg-%@telegram.local'
			                  AND EMP.etg_id = substr(CU.email, 4, instr(CU.email, '@') - 4)))
			  WHERE ${conds.join(' AND ')}
			  ORDER BY U.date DESC, U.line_id DESC
			  LIMIT ?${limitSlot}`,
			bindings,
		});
		const last = rows[rows.length - 1];
		return {
			rows,
			nextCursor:
				rows.length === MRO_MOVEMENT_LEDGER_PAGE && last
					? encodeMovementCursor(last.date == null ? null : String(last.date), String(last.line_id ?? ''))
					: null,
		};
	}

	/**
	 * Screen 1 — the item-name masters that actually have CONFIRMED movement:
	 * one directory row per master with at least one non-deleted model carrying a
	 * confirmed inbound / outbound / transfer line. Keyset-paginated by
	 * `(name_en, id)` so the directory never walks the whole SKU catalog just to
	 * learn which groups moved (the old client-side derivation did exactly that).
	 * An optional `search` term narrows it server-side for the kiosk type-ahead.
	 */
	async movementGroups(params: {
		cursor?: string | null;
		search?: string | null;
	}): Promise<{ rows: MovementGroupRow[]; nextCursor: string | null }> {
		const t = this.tables;
		const conds: string[] = ['G.deleted_at IS NULL'];
		const bindings: unknown[] = [];
		if (params.cursor) {
			const key = decodeGroupCursor(params.cursor);
			const slot = bindings.length + 1;
			conds.push(`(G.name_en COLLATE NOCASE > ?${slot} OR (G.name_en COLLATE NOCASE = ?${slot} AND G.id > ?${slot + 1}))`);
			bindings.push(key.name, key.id);
		}
		// The kiosk type-ahead narrows the directory SERVER-side (a client filter over
		// page 1 alone would miss matches past the cursor). A term matches the group's
		// own display names OR any of its live models' names, so a full-SKU fragment
		// ("Alternator 100A") still lands on the group that SKU belongs to. LIKE
		// wildcards inside the term are escaped to match literally (ESCAPE '\\').
		if (params.search) {
			const slot = bindings.length + 1;
			bindings.push(`%${params.search.replace(/[%_]/g, '\\$&')}%`);
			conds.push(
				`(G.name_en LIKE ?${slot} ESCAPE '\\' OR G.name_mm LIKE ?${slot} ESCAPE '\\'` +
					` OR EXISTS (SELECT 1 FROM ${t.model} SM WHERE SM.item_name = G.id AND SM.deleted_at IS NULL` +
					` AND (SM.name_en LIKE ?${slot} ESCAPE '\\' OR SM.name_mm LIKE ?${slot} ESCAPE '\\')))`,
			);
		}
		const limitSlot = bindings.length + 1;
		bindings.push(MRO_MOVEMENT_GROUPS_PAGE);
		const rows = await this.db.all<Record<string, unknown>>({
			sql: `WITH moving AS MATERIALIZED (
			          SELECT L.item_model AS model
			            FROM ${t.inbound} H
			            JOIN ${t.inLines} L ON L.parent_id = H.id
			           WHERE H.doc_status = 'confirmed' AND H.deleted_at IS NULL AND L.deleted_at IS NULL
			          UNION
			          SELECT L.item_model AS model
			            FROM ${t.outbound} H
			            JOIN ${t.outLines} L ON L.parent_id = H.id
			           WHERE H.doc_status = 'confirmed' AND H.deleted_at IS NULL AND L.deleted_at IS NULL
			          UNION
			          SELECT L.item_model AS model
			            FROM ${t.transfer} H
			            JOIN ${t.transferLines} L ON L.parent_id = H.id
			           WHERE H.doc_status = 'confirmed' AND H.deleted_at IS NULL AND L.deleted_at IS NULL
			        )
			SELECT G.id AS id, COALESCE(NULLIF(G.name_en, ''), G.name_mm) AS name, G.name_en AS name_en, G.name_mm AS name_mm
			  FROM ${t.group} G
			 WHERE ${conds.join(' AND ')}
			   AND EXISTS (SELECT 1
			                 FROM ${t.model} M
			                WHERE M.item_name = G.id AND M.deleted_at IS NULL
			                  AND EXISTS (SELECT 1 FROM moving MV WHERE MV.model = M.id))
			 ORDER BY G.name_en COLLATE NOCASE ASC, G.id ASC
			 LIMIT ?${limitSlot}`,
			bindings,
		});
		const last = rows[rows.length - 1];
		return {
			rows: rows.map((r) => ({
				id: String(r.id ?? ''),
				name: r.name == null ? null : String(r.name),
				name_en: r.name_en == null ? null : String(r.name_en),
				name_mm: r.name_mm == null ? null : String(r.name_mm),
			})),
			nextCursor:
				rows.length === MRO_MOVEMENT_GROUPS_PAGE && last
					? encodeGroupCursor(last.name_en == null ? null : String(last.name_en), String(last.id ?? ''))
					: null,
		};
	}

	/**
	 * The group's LINE feed (Movement Screen 2) — every confirmed IN/OUT/TRF line
	 * whose model belongs to the group, newest first, keyset-paginated. Plain
	 * rows + cursor (no header summary — the group screen is a flat line list);
	 * each row carries its model_name so the mixed feed is readable on its own.
	 */
	async movementGroupLines(params: {
		group: string;
		direction: MroMovementDirection;
		location?: MroLocation | null;
		cursor?: string | null;
	}): Promise<{ rows: MovementLedgerAggRow[]; nextCursor: string | null }> {
		const { group, direction, location, cursor } = params;
		const conds = [`M.item_name = ?1`];
		const bindings: unknown[] = [group];
		if (direction !== 'all') conds.push(`U.direction = '${direction}'`); // whitelisted literal
		if (location) {
			const slot = bindings.length + 1;
			conds.push(`(?${slot} = U.location OR ?${slot} = U.from_location OR ?${slot} = U.to_location)`);
			bindings.push(location);
		}
		const { rows, nextCursor } = await this.movementRowsPage(conds, bindings, cursor ?? null, this.groupModelsCond(1));
		return { rows: rows.map(movementAggRowOf), nextCursor };
	}
}
