/**
 * MRO stock REPORTS — the stock-POSITION side of the read engine: the shared stock
 * snapshot and the on-hand / reconciliation / composition / expiry reports derived
 * from it. Moved verbatim out of `stock-reads.ts` (ONE `stockSnapshot` derivation,
 * shared by `onHand` and `reconcile`); the facade delegates here.
 */
import type { D1Client } from '@mmbix/core';
import { addDays, todayMmtDate } from '@mmbix/utils';
import { collectionTable } from '@/lib/utils/table-name';
import { isTracking, nowIso, strId } from './codecs';
import { MroError } from './types';
import type { ModelRow, StockInvRow, StockSnapshot, Tables } from './types';

export class StockReports {
	constructor(
		private readonly db: D1Client,
		private readonly tables: Tables,
	) {}

	/** Several models' tracking policy + display name in ONE read — the batched
	 *  form of `resolveModel` for callers resolving a LIST of models (an unknown /
	 *  deleted id is simply absent from the map; that is the `null` fallback the
	 *  per-id version produced for a missing row). */
	private async modelsByIds(ids: readonly string[]): Promise<Map<string, ModelRow>> {
		if (ids.length === 0) return new Map();
		const t = this.tables;
		const binds = ids.map((_, i) => `?${i + 1}`);
		const rows = await this.db.all<{ id: string; tracking: string | null; name_en: string | null }>({
			sql: `SELECT m.id AS id, g.tracking AS tracking, m.name_en AS name_en
			        FROM ${t.model} m
			        LEFT JOIN ${t.group} g ON g.id = m.item_name AND g.deleted_at IS NULL
			       WHERE m.id IN (${binds.join(', ')}) AND m.deleted_at IS NULL`,
			bindings: [...ids],
		});
		return new Map(rows.map((r) => [r.id, { tracking: r.tracking, name_en: r.name_en }]));
	}

	// ── Expiry + on-hand reads ──────────────────────────────────────────────

	/**
	 * Lots + serials that are expired or expire within the horizon. Every row also
	 * reports its model's own alert policy (`expiry_alert_days`): `days_left`
	 * (negative = already expired), `model_alert_days` and `alert` (expired, or
	 * within the model's alert window) — the per-item "act now" flag.
	 *
	 * The horizon: an explicit `days` wins; OMITTED, it is derived from the WIDEST
	 * per-model `expiry_alert_days` any live model declares (so a 90-day item is
	 * never missed by a blanket 30-day window) — falling back to 30 when no model
	 * configures one. The server owns the alert policy, so it owns the window.
	 */
	async expiringStock(days?: number): Promise<{
		days: number;
		expired: Array<Record<string, unknown>>;
		expiring: Array<Record<string, unknown>>;
	}> {
		const t = this.tables;
		const explicit = days != null && Number.isFinite(days) && days > 0 ? Math.trunc(days) : null;
		let windowDays = explicit;
		if (windowDays === null) {
			const widestRow = await this.db.first<{ widest: number | null }>({
				sql: `SELECT MAX(expiry_alert_days) AS widest FROM ${t.model} WHERE deleted_at IS NULL`,
				bindings: [],
			});
			const widest = Number(widestRow?.widest ?? 0);
			windowDays = widest > 0 ? Math.trunc(widest) : 30;
		}
		const horizon = addDays(todayMmtDate(), Math.min(Math.max(windowDays, 1), 3650));

		// The model name + alert window ride the SAME row via a JOIN (one index seek
		// per model, shared across its rows) instead of two correlated scalar
		// subqueries evaluated per row. Combined with the (status, expiry_date[, _qty])
		// index the scan is a bounded range seek already in `ORDER BY expiry_date`
		// order — no temp B-tree.
		const lotRows = await this.db.all<Record<string, unknown>>({
			sql: `SELECT l.id, l.model, l.location, l.batch_no, l.expiry_date, l.remaining_qty,
			        m.name_en AS model_name, m.expiry_alert_days AS alert_days
			 FROM ${t.lots} l
			 LEFT JOIN ${t.model} m ON m.id = l.model AND m.deleted_at IS NULL
			 WHERE l.status = 'active' AND l.deleted_at IS NULL AND l.remaining_qty > 0 AND l.expiry_date IS NOT NULL AND l.expiry_date <= ?1
			 ORDER BY l.expiry_date ASC`,
			bindings: [horizon],
		});
		const serialRows = await this.db.all<Record<string, unknown>>({
			sql: `SELECT s.id, s.model, s.location, s.serial_no, s.expiry_date,
			        m.name_en AS model_name, m.expiry_alert_days AS alert_days
			 FROM ${t.serials} s
			 LEFT JOIN ${t.model} m ON m.id = s.model AND m.deleted_at IS NULL
			 WHERE s.status = 'in_stock' AND s.deleted_at IS NULL AND s.expiry_date IS NOT NULL AND s.expiry_date <= ?1
			 ORDER BY s.expiry_date ASC`,
			bindings: [horizon],
		});

		const today = todayMmtDate();
		const todayMs = Date.parse(`${today}T00:00:00Z`);
		const bucket = (rows: Array<Record<string, unknown>>, kind: 'lot' | 'serial') =>
			rows.map((r) => {
				const daysLeft = Math.round((Date.parse(`${String(r.expiry_date)}T00:00:00Z`) - todayMs) / 86_400_000);
				const modelAlertDays = r.alert_days == null ? null : Number(r.alert_days);
				const alert = daysLeft <= 0 || (modelAlertDays !== null && modelAlertDays > 0 && daysLeft <= modelAlertDays);
				return {
					id: r.id,
					model: r.model,
					model_name: r.model_name ?? null,
					location: r.location,
					kind,
					ref: kind === 'lot' ? r.batch_no : r.serial_no,
					expiry_date: r.expiry_date,
					qty: kind === 'lot' ? Number(r.remaining_qty ?? 0) : 1,
					days_left: daysLeft,
					model_alert_days: modelAlertDays,
					alert,
				};
			});
		const lots = bucket(lotRows, 'lot');
		const serials = bucket(serialRows, 'serial');
		return {
			days: Math.min(Math.max(windowDays, 1), 3650),
			expired: [...lots, ...serials].filter((r) => String(r.expiry_date) < today),
			expiring: [...lots, ...serials].filter((r) => String(r.expiry_date) >= today),
		};
	}

	/**
	 * The stock-truth gather behind BOTH the on-hand report and reconciliation:
	 * stored balances + derived lot/serial totals keyed `${model}|${location}`
	 * (each key's expired slice summed in the SAME pass — one bound `today`, no
	 * extra query), plus the keys holding stock with NO balance row. Extracted so
	 * "what the ledger says" has exactly ONE implementation: the on-hand screen
	 * and the reconcile screen can never disagree about drift (Bit-for-bit SSOT).
	 */
	private async stockSnapshot(): Promise<StockSnapshot> {
		const t = this.tables;
		const invRows = await this.db.all<StockInvRow>({
			sql: `SELECT i.id, i.model, i.location, i.qty_on_hand, i.reorder_level,
			 m.name_en AS model_name, g.tracking AS tracking, m.image AS model_image,
			 COALESCE(NULLIF(g.name_en, ''), g.name_mm) AS group_name, g.name_mm AS group_name_mm,
			 c.id AS category, COALESCE(NULLIF(c.name_en, ''), c.name_mm) AS category_name
			 FROM ${t.inv} i
			 LEFT JOIN ${t.model} m ON m.id = i.model AND m.deleted_at IS NULL
			 LEFT JOIN ${t.group} g ON g.id = m.item_name AND g.deleted_at IS NULL
			 LEFT JOIN ${t.category} c ON c.id = g.category AND c.deleted_at IS NULL
			 WHERE i.deleted_at IS NULL ORDER BY i.location ASC, m.name_en ASC`,
			bindings: [],
		});
		// Expired lots/serials are still physically present but must NEVER count as
		// available (they are only ever written off) — so each aggregate sums the
		// expired slice in the SAME pass (one bound `today`, no extra query).
		const today = todayMmtDate();
		const lotSums = await this.db.all<{ model: string; location: string; s: number; e: number }>({
			sql: `SELECT model, location, SUM(remaining_qty) AS s,
			        COALESCE(SUM(CASE WHEN expiry_date IS NOT NULL AND expiry_date < ?1 THEN remaining_qty ELSE 0 END), 0) AS e
			   FROM ${t.lots} WHERE status = 'active' AND deleted_at IS NULL GROUP BY model, location`,
			bindings: [today],
		});
		const serialCounts = await this.db.all<{ model: string; location: string; c: number; e: number }>({
			sql: `SELECT model, location, COUNT(*) AS c,
			        COALESCE(SUM(CASE WHEN expiry_date IS NOT NULL AND expiry_date < ?1 THEN 1 ELSE 0 END), 0) AS e
			   FROM ${t.serials} WHERE status = 'in_stock' AND deleted_at IS NULL GROUP BY model, location`,
			bindings: [today],
		});
		const sumBy = (rows: Array<{ model: string; location: string; s?: number; c?: number; e?: number }>, key: 's' | 'c' | 'e') =>
			new Map(rows.map((r) => [`${r.model}|${r.location}`, Number(r[key] ?? 0)]));
		// Balance rows that exist only in lots/serials (no inventory row yet). Keys are
		// DE-DUPED: a key present in BOTH maps (reachable only if a model's tracking
		// policy changed mid-life — the "policy is set once" invariant forbids it) must
		// still yield exactly ONE row, so every report stays a partition. Sorted so the
		// (SQLite-unordered) GROUP BY output becomes a DETERMINISTIC wire order.
		const covered = new Set(invRows.map((r) => `${r.model}|${r.location}`));
		const orphanKeys = [...new Set([...sumBy(lotSums, 's').keys(), ...sumBy(serialCounts, 'c').keys()])]
			.filter((key) => !covered.has(key))
			.sort();
		// The model metadata each orphan needs — resolved in ONE batched read (the loop
		// this feeds would otherwise await `resolveModel` per orphan: an N+1).
		const orphanMeta = await this.modelsByIds([...new Set(orphanKeys.map((key) => key.split('|')[0]))]);
		return {
			invRows,
			lotBy: sumBy(lotSums, 's'),
			serialBy: sumBy(serialCounts, 'c'),
			expiredLotBy: sumBy(lotSums, 'e'),
			expiredSerialBy: sumBy(serialCounts, 'e'),
			orphanKeys,
			orphanMeta,
		};
	}

	/**
	 * On-hand per (model, location): the stored balance plus a drift check for
	 * batch/serial models (balance vs the sum of active lots / in-stock serials)
	 * so double-writes surface instead of hiding, and a `below_reorder` flag
	 * (reorder_level configured AND available ≤ reorder_level — available is the
	 * derived lot/serial total for tracked models, never a drifted balance).
	 */
	async onHand(): Promise<Array<Record<string, unknown>>> {
		const { invRows, lotBy, serialBy, expiredLotBy, expiredSerialBy, orphanKeys, orphanMeta } = await this.stockSnapshot();

		const orphans: Array<Record<string, unknown>> = orphanKeys.map((key) => {
			const [model, location] = key.split('|');
			const m = orphanMeta.get(model);
			// Tracking-aware derivation, so a key in both maps still reports the qty its
			// CURRENT policy tracks; an unknown master (deleted) — or a stray row under a
			// `standard` master — takes whichever side has a row, lots first.
			const tracking = isTracking(m?.tracking);
			const lotQty = lotBy.get(key);
			const serialQty = serialBy.get(key);
			let derived: number;
			if (tracking === 'serial') derived = serialQty ?? 0;
			else if (tracking === 'batch') derived = lotQty ?? 0;
			else derived = lotQty ?? serialQty ?? 0;
			// The expired slice of the same key, read with the row's CURRENT policy.
			const expiredQty =
				tracking === 'serial'
					? (expiredSerialBy.get(key) ?? 0)
					: tracking === 'batch'
						? (expiredLotBy.get(key) ?? 0)
						: Math.max(expiredLotBy.get(key) ?? 0, expiredSerialBy.get(key) ?? 0);
			return {
				id: null,
				model,
				location,
				qty_on_hand: 0,
				reorder_level: null,
				model_name: m?.name_en ?? null,
				model_image: null,
				tracking: m?.tracking ?? null,
				group_name_mm: null,
				derived_qty: derived,
				expired_qty: expiredQty,
				// No stored balance to disagree with — an orphan IS its derived total, so
				// `drift` carries that total (the pinned read contract for orphans).
				drift: derived,
			};
		});

		const rows = invRows.map((r) => {
			const tracking = isTracking(r.tracking);
			let derived: number | null = null;
			if (tracking === 'batch') derived = lotBy.get(`${r.model}|${r.location}`) ?? 0;
			if (tracking === 'serial') derived = serialBy.get(`${r.model}|${r.location}`) ?? 0;
			const balance = Number(r.qty_on_hand ?? 0);
			// The expired slice of this (model, location) — same policy mapping.
			const expiredQty =
				tracking === 'batch'
					? (expiredLotBy.get(`${r.model}|${r.location}`) ?? 0)
					: tracking === 'serial'
						? (expiredSerialBy.get(`${r.model}|${r.location}`) ?? 0)
						: 0;
			// Reorder check runs against the REAL available quantity: for batch/serial
			// models that is the derived lot/serial total MINUS anything expired (which
			// can only be written off), never a drifted balance.
			const reorderLevel = Number(r.reorder_level ?? 0);
			const available = (derived === null ? balance : derived) - expiredQty;
			return {
				id: r.id,
				model: r.model,
				model_name: r.model_name ?? null,
				model_image: r.model_image ?? null,
				location: r.location,
				tracking,
				qty_on_hand: balance,
				reorder_level: reorderLevel,
				derived_qty: derived,
				expired_qty: expiredQty,
				drift: derived === null ? false : Math.abs(balance - derived) > 0.001,
				below_reorder: reorderLevel > 0 && available <= reorderLevel,
				// English-first group/category labels arrive already JOINed, so the stock
				// page can render + filter from THIS one /stock report and never fire
				// separate mro_item_name / mro_item_model / mro_item_categories reads.
				group_name: r.group_name ?? null,
				group_name_mm: r.group_name_mm ?? null,
				category: r.category ?? null,
				category_name: r.category_name ?? null,
			};
		});
		return [...rows, ...orphans];
	}

	/**
	 * ONE SKU's stock composition — the read behind the stock card's drill-down page
	 * (`GET /api/mro/stock/items/:modelId`). It answers "what is actually
	 * here?" for a single item, shaped by its tracking policy:
	 *
	 *   balances  every store's balance row (always) — including ORPHAN locations
	 *             (lots/serials with no balance row), the same contract
	 *             `/stock/onhand` reports
	 *   lots      the FEFO-ordered active lots                     (batch models)
	 *   serials   the in-stock units with their holder resolved    (serial models)
	 *
	 * Server-scoped on purpose: `mro_stock_lots` is NOT in the Telegram role's
	 * config grant list (`mro_inventory` + `mro_stock_serials` only), so a generic
	 * `/api/entities/mro_stock_lots` read 403s for a real employee — the failure
	 * class the stock screens have already been bitten by. The balance derivation
	 * mirrors `stockSnapshot()` (same `today`, same policy mapping), so a
	 * composition can never disagree with the on-hand report it was opened from.
	 *
	 * Read-only: no writes, no DDL.
	 */
	async itemComposition(modelId: string, opts: { location?: string | null } = {}): Promise<Record<string, unknown>> {
		const id = strId(modelId, 'modelId');
		const t = this.tables;
		const vehicleTable = collectionTable('veh_fleets');
		const empTable = collectionTable('hrm_employees');
		// An OPTIONAL store scope — the outbound form's serial picker passes its
		// target store so only units issue-able from there are returned. Blank =
		// every location (the stock drill-down page's whole-composition view).
		const location = (opts.location ?? '').trim();
		const scoped = location !== '';

		// The SKU header — the bilingual name, the group, the photo and the POLICY (the
		// policy lives on the item NAME).
		const model = await this.db.first<{
			id: string;
			name_en: string | null;
			name_mm: string | null;
			image: string | null;
			group_name: string | null;
			tracking: string | null;
		}>({
			sql: `SELECT m.id AS id, m.name_en AS name_en, m.name_mm AS name_mm, m.image AS image,
			        COALESCE(NULLIF(g.name_en, ''), g.name_mm) AS group_name, g.tracking AS tracking
			   FROM ${t.model} m
			   LEFT JOIN ${t.group} g ON g.id = m.item_name AND g.deleted_at IS NULL
			  WHERE m.id = ?1 AND m.deleted_at IS NULL`,
			bindings: [id],
		});
		if (!model) throw new MroError(404, 'Item model not found');
		const tracking = isTracking(model.tracking);

		const balanceRows = await this.db.all<{ id: string; location: string; qty_on_hand: number | null; reorder_level: number | null }>({
			sql: `SELECT id, location, qty_on_hand, reorder_level
			   FROM ${t.inv} WHERE model = ?1 AND deleted_at IS NULL${scoped ? ' AND location = ?2' : ''} ORDER BY location ASC`,
			bindings: scoped ? [id, location] : [id],
		});
		// Only the policy's own trace table is read — a standard SKU has neither, and a
		// batch SKU has no serials to fetch.
		const lotRows =
			tracking === 'batch'
				? await this.db.all<{
						id: string;
						location: string;
						batch_no: string | null;
						expiry_date: string | null;
						remaining_qty: number | null;
					}>({
						sql: `SELECT L.id, L.location, L.batch_no, L.expiry_date, L.remaining_qty
						   FROM ${t.lots} L
						  WHERE L.model = ?1 AND L.status = 'active' AND L.deleted_at IS NULL AND L.remaining_qty > 0${scoped ? ' AND L.location = ?2' : ''}
						  ORDER BY (L.expiry_date IS NULL) ASC, L.expiry_date ASC, L.batch_no ASC`,
						bindings: scoped ? [id, location] : [id],
					})
				: [];
		const serialRows =
			tracking === 'serial'
				? await this.db.all<{
						id: string;
						location: string;
						serial_no: string | null;
						status: string | null;
						vehicle: string | null;
						slot: string | null;
						employee: string | null;
						tread_mm: number | null;
						psi: number | null;
						condition: string | null;
						expiry_date: string | null;
						plate_no: string | null;
						employee_name: string | null;
					}>({
						sql: `SELECT s.id, s.location, s.serial_no, s.status, s.vehicle, s.slot, s.employee,
						        s.tread_mm, s.psi, s.condition, s.expiry_date,
						        V.plate_no AS plate_no, E.name_en AS employee_name
						   FROM ${t.serials} s
						   LEFT JOIN ${vehicleTable} V ON V.id = s.vehicle AND V.deleted_at IS NULL
						   LEFT JOIN ${empTable} E ON E.id = s.employee AND E.deleted_at IS NULL
						  WHERE s.model = ?1 AND s.status = 'in_stock' AND s.deleted_at IS NULL${scoped ? ' AND s.location = ?2' : ''}
						  ORDER BY s.location ASC, s.serial_no ASC`,
						bindings: scoped ? [id, location] : [id],
					})
				: [];

		const today = todayMmtDate();
		const todayMs = Date.parse(`${today}T00:00:00Z`);
		const daysLeftOf = (expiry: string) => Math.round((Date.parse(`${expiry}T00:00:00Z`) - todayMs) / 86_400_000);

		// The per-location derived total + expired slice, summed in the SAME pass as
		// the line build — the on-hand report's own rule (expired stock is physically
		// present but never available).
		const derivedByLocation = new Map<string, { total: number; expired: number }>();
		const bump = (location: string, qty: number, expiredQty: number) => {
			const current = derivedByLocation.get(location) ?? { total: 0, expired: 0 };
			current.total += qty;
			current.expired += expiredQty;
			derivedByLocation.set(location, current);
		};

		const lots = lotRows.map((r) => {
			const remaining = Number(r.remaining_qty ?? 0);
			const expired = r.expiry_date != null && r.expiry_date < today;
			bump(String(r.location), remaining, expired ? remaining : 0);
			return {
				id: r.id,
				location: r.location,
				batch_no: r.batch_no ?? null,
				expiry_date: r.expiry_date ?? null,
				days_left: r.expiry_date == null ? null : daysLeftOf(r.expiry_date),
				remaining_qty: remaining,
				expired,
			};
		});
		const serials = serialRows.map((r) => {
			const expired = r.expiry_date != null && r.expiry_date < today;
			bump(String(r.location), 1, expired ? 1 : 0);
			return {
				id: r.id,
				location: r.location,
				serial_no: r.serial_no ?? null,
				status: r.status ?? null,
				vehicle: r.vehicle ?? null,
				plate_no: r.plate_no ?? null,
				slot: r.slot ?? null,
				employee: r.employee ?? null,
				employee_name: r.employee_name ?? null,
				tread_mm: r.tread_mm == null ? null : Number(r.tread_mm),
				psi: r.psi == null ? null : Number(r.psi),
				condition: r.condition ?? null,
				expiry_date: r.expiry_date ?? null,
				// Expiry is exposed on a UNIT exactly as it is on a lot (same
				// `daysLeftOf`, same `today`): the stock list flags a unit the same way
				// it flags a lot, and the two can never disagree about a date.
				days_left: r.expiry_date == null ? null : daysLeftOf(r.expiry_date),
				expired,
			};
		});

		const balances = balanceRows.map((r) => {
			const agg = derivedByLocation.get(String(r.location));
			const balance = Number(r.qty_on_hand ?? 0);
			const derived = tracking === 'standard' ? null : (agg?.total ?? 0);
			const expired = tracking === 'standard' ? 0 : (agg?.expired ?? 0);
			const reorderLevel = Number(r.reorder_level ?? 0);
			const available = (derived === null ? balance : derived) - expired;
			return {
				id: r.id,
				location: r.location,
				qty_on_hand: balance,
				derived_qty: derived,
				expired_qty: expired,
				reorder_level: reorderLevel,
				drift: derived === null ? false : Math.abs(balance - derived) > 0.001,
				below_reorder: reorderLevel > 0 && available <= reorderLevel,
			};
		});
		// Orphan locations — stock held with NO balance row. Mirrors `onHand()`: qty 0
		// and `drift` carrying the derived total, so the two screens agree.
		const covered = new Set(balances.map((b) => String(b.location)));
		const orphans = [...derivedByLocation.keys()]
			.filter((location) => !covered.has(location))
			.sort()
			.map((location) => {
				const agg = derivedByLocation.get(location)!;
				return {
					id: null,
					location,
					qty_on_hand: 0,
					derived_qty: agg.total,
					expired_qty: agg.expired,
					reorder_level: 0,
					drift: agg.total,
					below_reorder: false,
				};
			});
		const allBalances = [...balances, ...orphans];

		return {
			model: {
				id: model.id,
				name_en: model.name_en ?? null,
				name_mm: model.name_mm ?? null,
				image: model.image ?? null,
				group_name: model.group_name ?? null,
				tracking,
			},
			totals: {
				// The REAL on-hand count (a tracked model's derived total, never a drifted
				// balance), split so the client can show "9 · 1 expired".
				on_hand: allBalances.reduce((sum, b) => sum + Number(b.derived_qty ?? b.qty_on_hand), 0),
				expired: allBalances.reduce((sum, b) => sum + Number(b.expired_qty ?? 0), 0),
				any_below_reorder: allBalances.some((b) => b.below_reorder),
			},
			balances: allBalances,
			lots,
			serials,
		};
	}

	/**
	 * Stock integrity reconciliation — the read-only "does the ledger agree with
	 * itself?" report (`GET /stock/reconcile`, admin-gated). THREE independent
	 * checks, each BOUNDED (no full-history event scan):
	 *
	 *   balance_drift   an inventory balance row disagrees with the derived
	 *                   lot/serial total for its tracking policy (the on-hand
	 *                   report's own `drift`, surfaced here as a defect row).
	 *   orphan_stock    lot/serial rows hold stock at a (model, location) with NO
	 *                   balance row — stock the store cannot see.
	 *   snapshot_stale  a serial's newest lifecycle event is NEWER than its
	 *                   snapshot row (`updated_at`): an event the snapshot
	 *                   predates, i.e. a partially-applied state change.
	 *
	 * Clean data yields ZERO rows, so a nightly job or a supervisor gates on a
	 * single `summary.total`. Every row carries the identity an operator needs to
	 * act (collection + id / model / location / serial_no) — no follow-up read.
	 */
	async reconcile(): Promise<{ rows: Array<Record<string, unknown>>; summary: Record<string, number>; checked_at: string }> {
		const t = this.tables;
		const snap = await this.stockSnapshot();
		const rows: Array<Record<string, unknown>> = [];
		let balanceDrift = 0;
		let orphanStock = 0;
		let snapshotStale = 0;

		// (a) balance drift — only a TRACKED model has a derived ledger to disagree with.
		for (const r of snap.invRows) {
			const tracking = isTracking(r.tracking);
			if (tracking !== 'batch' && tracking !== 'serial') continue;
			const key = `${r.model}|${r.location}`;
			const derived = tracking === 'batch' ? (snap.lotBy.get(key) ?? 0) : (snap.serialBy.get(key) ?? 0);
			const balance = Number(r.qty_on_hand ?? 0);
			if (Math.abs(balance - derived) <= 0.001) continue;
			balanceDrift++;
			rows.push({
				check: 'balance_drift',
				collection: 'mro_inventory',
				id: r.id,
				model: r.model,
				model_name: r.model_name,
				location: r.location,
				tracking,
				stored_qty: balance,
				derived_qty: derived,
				delta: balance - derived,
				detail: `balance ${balance} ≠ ${tracking} total ${derived}`,
			});
		}

		// (b) orphan stock — derived stock with no balance row to show it.
		for (const key of snap.orphanKeys) {
			const [model, location] = key.split('|');
			const m = snap.orphanMeta.get(model);
			const tracking = isTracking(m?.tracking);
			const lotQty = snap.lotBy.get(key);
			const serialQty = snap.serialBy.get(key);
			const derived = tracking === 'serial' ? (serialQty ?? 0) : tracking === 'batch' ? (lotQty ?? 0) : (lotQty ?? serialQty ?? 0);
			orphanStock++;
			rows.push({
				check: 'orphan_stock',
				collection: tracking === 'serial' ? 'mro_stock_serials' : 'mro_stock_lots',
				id: null,
				model,
				model_name: m?.name_en ?? null,
				location,
				tracking: m?.tracking ?? null,
				derived_qty: derived,
				detail: `${derived} ${tracking} unit(s) with no mro_inventory balance row`,
			});
		}

		// (c) snapshot stale — a serial whose newest event the snapshot predates. Both
		// timestamps are compared at SECOND granularity after normalising the 'T'
		// separator, so a legacy space-format `CURRENT_TIMESTAMP` snapshot never
		// false-positives against an ISO event written in the same second.
		//
		// ONE grouped aggregate joined back, not a correlated subquery + EXISTS: the
		// previous shape ran a per-serial `MAX(created_at)` subquery for EVERY serial
		// (computed even for rows the EXISTS then rejected) plus a second full scan
		// for the EXISTS. `GROUP BY serial` walks the `(serial, created_at, id)` index
		// once — O(events), not O(serials × events-per-serial). The joins also reduce
		// to serials that HAVE events, so the EXISTS scan is gone entirely.
		const stale = await this.db.all<{
			id: string;
			serial_no: string | null;
			model: string | null;
			location: string | null;
			status: string | null;
			updated_at: string | null;
			last_event_at: string | null;
		}>({
			sql: `SELECT s.id, s.serial_no, s.model, s.location, s.status, s.updated_at, ev.last_event_at
			   FROM ${t.serials} s
			   JOIN (
			     SELECT serial, MAX(created_at) AS last_event_at
			       FROM ${t.events}
			      WHERE deleted_at IS NULL
			      GROUP BY serial
			   ) ev ON ev.serial = s.id
			  WHERE s.deleted_at IS NULL
			    AND substr(replace(ev.last_event_at, 'T', ' '), 1, 19) > substr(replace(s.updated_at, 'T', ' '), 1, 19)
			  ORDER BY s.id ASC`,
			bindings: [],
		});
		const staleMeta = await this.modelsByIds([...new Set(stale.map((r) => r.model).filter((v): v is string => !!v))]);
		for (const r of stale) {
			snapshotStale++;
			rows.push({
				check: 'snapshot_stale',
				collection: 'mro_stock_serials',
				id: r.id,
				serial_no: r.serial_no,
				model: r.model,
				model_name: r.model ? (staleMeta.get(r.model)?.name_en ?? null) : null,
				location: r.location,
				status: r.status,
				snapshot_at: r.updated_at,
				last_event_at: r.last_event_at,
				detail: 'newest lifecycle event is newer than the serial snapshot row',
			});
		}

		return {
			rows,
			summary: { balance_drift: balanceDrift, orphan_stock: orphanStock, snapshot_stale: snapshotStale, total: rows.length },
			checked_at: nowIso(),
		};
	}
}
