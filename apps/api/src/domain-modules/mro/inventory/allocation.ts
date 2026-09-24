/**
 * MRO stock ALLOCATION — the ONE FEFO/FIFO lot allocator, the batch-identity
 * lookup and the serial picker that every stock-decreasing use-case shares.
 * Split out of `inventory.service.ts` verbatim: the total ordering
 * (score → expiry_date → created_at → id) lives HERE and nowhere else.
 */
import type { D1Client } from '@mmbix/core';
import { todayMmtDate } from '@mmbix/utils';
import { moneyOrNull } from './money';
import { MroError } from './types';
import { MM_INSUFFICIENT } from './types';
import type { LotRow, SerialRow, Tables } from './types';

export class Allocation {
	constructor(
		private readonly db: D1Client,
		private readonly tables: Tables,
	) {}

	/**
	 * FEFO/FIFO lot allocation. `goods_issue` and `transfer` skip expired lots
	 * (move/use fresh stock; expired stock is written off where it sits);
	 * write-offs and defects target expired lots first (that is their purpose),
	 * then nearest expiry, then expiry-less lots by receipt order. An optional
	 * `batchNo` restricts the allocation to one batch (transfers of a specific
	 * batch). Returns each take with the source lot's identity so the caller can
	 * recreate/merge it at a destination.
	 */
	async allocateLots(
		modelId: string,
		location: string,
		qty: number,
		type: string,
		batchNo: string | null = null,
	): Promise<Array<{ lotId: string; take: number; batch_no: string | null; expiry_date: string | null; unit_cost: number | null }>> {
		const t = this.tables;
		// No SQL ORDER BY on purpose: the FEFO re-sort below is a TOTAL order
		// (score → expiry_date → created_at → id, and id is unique), so the DB's row
		// order is discarded either way. Dropping it lets SQLite answer straight from
		// the (status, model, location, remaining_qty) index — no temp B-tree at all.
		const rows = await this.db.all<LotRow>({
			sql: `SELECT id, batch_no, expiry_date, unit_cost, remaining_qty, created_at FROM ${t.lots}
			 WHERE model = ?1 AND location = ?2 AND status = 'active' AND deleted_at IS NULL AND remaining_qty > 0
			 ${batchNo ? 'AND batch_no = ?3' : ''}`,
			bindings: batchNo ? [modelId, location, batchNo] : [modelId, location],
		});
		const today = todayMmtDate();
		const likeIssue = type === 'goods_issue' || type === 'transfer'; // never move/use expired stock
		const score = (expiry: string | null): number => {
			if (expiry === null) return likeIssue ? 1 : 2; // no expiry → after dated
			return expiry < today ? 0 : 1;
		};
		const usable = rows.filter((l) => (likeIssue ? l.expiry_date === null || l.expiry_date >= today : true));
		usable.sort(
			(a, b) =>
				score(a.expiry_date) - score(b.expiry_date) ||
				String(a.expiry_date ?? '').localeCompare(String(b.expiry_date ?? '')) ||
				a.created_at.localeCompare(b.created_at) ||
				a.id.localeCompare(b.id),
		);
		const total = usable.reduce((sum, l) => sum + Number(l.remaining_qty), 0);
		if (total < qty) throw new MroError(409, MM_INSUFFICIENT);

		const plan: Array<{ lotId: string; take: number; batch_no: string | null; expiry_date: string | null; unit_cost: number | null }> = [];
		let remaining = qty;
		for (const lot of usable) {
			if (remaining <= 0) break;
			const take = Math.min(Number(lot.remaining_qty), remaining);
			plan.push({
				lotId: lot.id,
				take,
				batch_no: lot.batch_no ?? null,
				expiry_date: lot.expiry_date ?? null,
				unit_cost: moneyOrNull(lot.unit_cost),
			});
			remaining -= take;
		}
		return plan;
	}

	/** An active destination lot with the same (model, batch_no, expiry_date) — NULL-safe on expiry. */
	async lotByIdentity(
		modelId: string,
		location: string,
		batchNo: string | null,
		expiryDate: string | null,
	): Promise<{ id: string } | null> {
		const row = await this.db.first<{ id: string }>({
			sql: `SELECT id FROM ${this.tables.lots}
			 WHERE model = ?1 AND location = ?2 AND batch_no = ?3 AND expiry_date IS ?4 AND status = 'active'
			   AND deleted_at IS NULL AND remaining_qty > 0 LIMIT 1`,
			bindings: [modelId, location, batchNo, expiryDate],
		});
		return row ?? null;
	}

	/** Validate + load the serial pick — every serial must exist, be in stock at the location, and (goods issues) not be expired. */
	async pickSerials(modelId: string, location: string, serials: string[], qty: number, type: string): Promise<SerialRow[]> {
		if (serials.length !== qty) {
			throw new MroError(400, `Serial model: provide exactly ${qty} serial(s) to issue — got ${serials.length}`);
		}
		if (new Set(serials).size !== serials.length) throw new MroError(400, 'serials contains duplicates');
		const t = this.tables;
		const binds = serials.map((_, i) => `?${i + 2}`); // ?1 is the model id below
		const rows = await this.db.all<SerialRow>({
			sql: `SELECT id, serial_no, status, location, expiry_date FROM ${t.serials}
			 WHERE model = ?1 AND serial_no IN (${binds.join(', ')}) AND deleted_at IS NULL`,
			bindings: [modelId, ...serials],
		});
		const bySerial = new Map(rows.map((r) => [r.serial_no, r]));
		const today = todayMmtDate();
		const problems: string[] = [];
		for (const serialNo of serials) {
			const row = bySerial.get(serialNo);
			if (!row) {
				problems.push(`${serialNo} (not found)`);
			} else if (row.status !== 'in_stock') {
				problems.push(`${serialNo} (${row.status})`);
			} else if (row.location !== location) {
				problems.push(`${serialNo} (different location)`);
			} else if ((type === 'goods_issue' || type === 'transfer') && row.expiry_date && row.expiry_date < today) {
				problems.push(`${serialNo} (expired)`);
			}
		}
		if (problems.length > 0) throw new MroError(409, `Cannot issue: ${problems.join(', ')}`);
		return serials.map((serialNo) => bySerial.get(serialNo) as SerialRow);
	}
}
