/**
 * Self-Tuning Index Advisor — headless, dynamic DB performance tuning.
 *
 * A headless entity engine cannot know in advance which collections a tenant
 * will create or which query shapes they'll hit. This module closes that gap:
 * no business collection is hardcoded. Index requirements are DERIVED from how
 * the engine is actually used at runtime, and the resulting indexes are created
 * idempotently (CREATE INDEX IF NOT EXISTS).
 *
 * Data flow (all non-blocking / fire-and-forget from the request path):
 *
 *   1. OBSERVE   — every `listItems` call records a NORMALIZED FILTER SIGNATURE
 *                  (filter columns + sort column) per collection into an
 *                  in-isolate frequency ledger.
 *   2. VERIFY    — when a signature clears a frequency threshold, run
 *                  `EXPLAIN QUERY PLAN` on a representative probe. Only act when
 *                  the plan reports a `SCAN` (a missing-index symptom) — never
 *                  touch a query the planner already serves with `SEARCH`.
 *   3. CREATE    — issue the composite index for the observed leading filter
 *                  columns, honoring a safety budget and the DECLARATIVE override
 *                  (a collection's `composite_indexes` from schema_json always
 *                  win; auto-tuned ones are additions, never duplicates).
 *   4. JOURNAL   — every auto-created index is recorded for observability so an
 *                  operator can see exactly what the engine tuned and why.
 *
 * Safety / enterprise guard-rails:
 *   - per-collection auto-index budget (default 4), max columns per index (4)
 *   - min query frequency before acting (avoid one-off ad-hoc scans)
 *   - throttled evaluation (once per TUNE_INTERVAL per isolate) so the DDL never
 *     runs on the hot path
 *   - idempotent DDL; failures are caught and ignored (never fail the caller)
 *   - declarative `composite_indexes` are never overwritten or duplicated
 */
import { D1Client } from '../db/d1-client';
import { QueryBuilder } from '../db/query-builder';
import { sanitizeIdentifier } from '@mmbix/utils';

// ─── Config (sensible enterprise defaults) ──────────────────────────────

/** Max auto-tuned composite indexes created per collection. */
const MAX_AUTO_INDEXES_PER_COLLECTION = 4;
/** Max columns in one auto-tuned index (4th+ yields marginal gains). */
const MAX_COLUMNS_PER_INDEX = 4;
/** A signature must be observed this many times before we consider tuning. */
const MIN_OBSERVATIONS = 5;
/** How often the advisor may run DDL per isolate (rate-limit the tuner). */
const TUNE_INTERVAL_MS = 60_000;
/** Cap on the in-memory ledger so it can't grow unbounded. */
const LEDGER_MAX_ENTRIES = 2_000;

/** A normalized query shape the advisor learns from. */
export interface FilterSignature {
	/** Filter columns (equality/IN/range), in first-seen order. */
	filters: string[];
	/** Sort column ('' if none / default). */
	sort: string;
}

/** One row in the auto-index journal (observability). */
export interface AutoIndexEntry {
	table: string;
	columns: string[];
	signature: string;
	createdAt: number;
}

/** Self-tuning index advisor — instance-safe per isolate, deterministic. */
export class SelfTuningIndexAdvisor {
	// table → signatureKey → observation count
	private readonly ledger = new Map<string, Map<string, number>>();
	// signatureKey → prototype (filters/sort) for EXPLAIN verification
	private readonly prototypes = new Map<string, FilterSignature>();
	// table → set of created composite signatures (honors the per-collection budget)
	private readonly created = new Map<string, Set<string>>();
	// journal of what the engine auto-created
	private readonly journal: AutoIndexEntry[] = [];
	private lastTune = 0;

	/** Reset all state (used by tests and schema reseeds). */
	reset(): void {
		this.ledger.clear();
		this.prototypes.clear();
		this.created.clear();
		this.journal.length = 0;
		this.lastTune = 0;
		this.lastMode = 'auto';
	}

	/**
	 * Record the most recent tuning pass's mode (for observability / report()).
	 * The mode itself is passed PER tune() call (not persistent mutable state) so
	 * collections with different auto_index policies never leak mode into each
	 * other across a shared isolate. */
	private lastMode: 'auto' | 'propose' = 'auto';
	/** Mode of the last tuning pass (for the ops report). */
	get mode(): 'auto' | 'propose' {
		return this.lastMode;
	}

	/**
	 * The columns an index for this shape must cover: the recorded filter columns
	 * followed by the sort column. A TRAILING sort column is what lets SQLite serve
	 * `ORDER BY` from the index instead of building a temp B-tree — the difference
	 * between an ordered index scan and a full sort on every page. Deduped, in
	 * first-seen order.
	 */
	private static columnsOf(sig: FilterSignature): string[] {
		return [...new Set([...sig.filters, sig.sort].filter(Boolean))];
	}

	private static signatureOf(sig: FilterSignature): string {
		return SelfTuningIndexAdvisor.columnsOf(sig).join(',');
	}

	/**
	 * Record a query shape (non-blocking). `declared` = the collection's own
	 * `composite_indexes` — the declarative override the tuner must never
	 * duplicate.
	 */
	record(table: string, sig: FilterSignature, declared: { columns: string[] }[]): void {
		// The learned shape (filters + trailing sort) must span ≥2 columns: a lone
		// column is already `index:true`-able at the field level.
		const cols = SelfTuningIndexAdvisor.columnsOf(sig);
		if (cols.length < 2) return;
		const key = SelfTuningIndexAdvisor.signatureOf(sig);
		if (!key) return;
		// Never even learn a signature the collection already declares.
		const declaredKeys = declared.map((d) => [...d.columns].join(','));
		if (declaredKeys.some((dk) => dk === key)) return;

		let byTable = this.ledger.get(table);
		if (!byTable) {
			if (this.ledger.size >= LEDGER_MAX_ENTRIES && !this.ledger.has(table)) {
				// LRU-evict the oldest table to bound memory.
				const oldest = this.ledger.keys().next().value;
				if (oldest) this.ledger.delete(oldest);
			}
			byTable = new Map();
			this.ledger.set(table, byTable);
		}
		byTable.set(key, (byTable.get(key) ?? 0) + 1);
		if (!this.prototypes.has(key)) this.prototypes.set(key, { filters: [...sig.filters], sort: sig.sort });
	}

	/** The auto-index journal (what the engine created, for observability). */
	snapshot(): AutoIndexEntry[] {
		return [...this.journal];
	}

	/** Full operational report — journal + current hot candidates + mode. */
	report(): {
		mode: 'auto' | 'propose_only';
		journal: AutoIndexEntry[];
		candidates: { table: string; columns: string[]; count: number }[];
	} {
		return {
			mode: this.lastMode === 'propose' ? 'propose_only' : 'auto',
			journal: [...this.journal],
			candidates: this.topCandidates(),
		};
	}

	/** Max EXPLAIN/DDL probes per tuning pass — bounds background latency so the
	 *  fire-and-forget pass (awaited by test waitOnExecutionContext and kept small
	 *  in prod) can never stall a response. */
	static readonly MAX_PROBES_PER_PASS = 4;

	/**
	 * Rate-limited tuning pass. `propose` = recommend without issuing DDL (the
	 * trigger request's collection policy decides — per-call, not a singleton flag).
	 * Best-effort; never throws. Called opportunistically (fire-and-forget).
	 */
	async tune(db: D1Client, propose = false): Promise<AutoIndexEntry[]> {
		const now = Date.now();
		if (now - this.lastTune < TUNE_INTERVAL_MS) return [...this.journal];
		this.lastTune = now;
		this.lastMode = propose ? 'propose' : 'auto';

		const candidates = this.topCandidates();
		if (candidates.length === 0) return [...this.journal];
		// Verify the tables exist in THIS database — stale candidates from a shared
		// isolate (or dropped tables) are skipped without an EXPLAIN round-trip.
		const existing = await this.existingTables(
			db,
			candidates.map((c) => c.table),
		);
		let probes = 0;
		for (const cand of candidates) {
			if (!existing.has(cand.table)) continue;
			if (probes >= SelfTuningIndexAdvisor.MAX_PROBES_PER_PASS) break;
			probes++;
			await this.tuneOne(db, cand.table, cand.columns, propose).catch(() => {});
		}
		return [...this.journal];
	}

	/** Which of the given table names exist — a `LIMIT 1` point read each, NOT a
	 *  `sqlite_master` scan. The catalogue holds every table AND index name (513
	 *  rows on the live DB) and has no index on `name`, so the scan read all of it
	 *  for a handful of names. Bounded: the caller passes at most a few tables. */
	private async existingTables(db: D1Client, tables: string[]): Promise<Set<string>> {
		const out = new Set<string>();
		for (const t of tables) {
			try {
				await db.first({ sql: `SELECT 1 FROM ${sanitizeIdentifier(t, 'auto-index.table')} LIMIT 1`, bindings: [] });
				out.add(t);
			} catch {
				/* table missing — skip it */
			}
		}
		return out;
	}

	private async tuneOne(db: D1Client, table: string, columns: string[], propose: boolean): Promise<void> {
		const cols = columns.slice(0, MAX_COLUMNS_PER_INDEX).map((c) => sanitizeIdentifier(c, 'auto-index.col'));
		if (cols.length < 2) return;
		const safeTable = sanitizeIdentifier(table, 'auto-index.table');
		const signature = cols.join(',');

		// Budget: don't accumulate unbounded indexes per collection.
		const existing = this.created.get(safeTable);
		if (existing) {
			if (existing.has(signature)) return; // already created
			if (existing.size >= MAX_AUTO_INDEXES_PER_COLLECTION) return; // budget reached
		}

		// Verify the probe actually scans — if the planner already has a usable
		// index, creating another is pointless.
		const scans = await this.planScans(db, safeTable, cols);
		if (!scans) return;

		const idxName = `idx_${safeTable}_${cols.join('_')}`;

		// Propose-only mode: recommend without touching the schema (change mgmt).
		if (propose) {
			this.journal.push({ table: safeTable, columns: cols, signature, createdAt: Date.now() });
			return;
		}

		// Idempotent DDL — safe across re-deploys and concurrent isolates.
		await db.run({
			sql: `CREATE INDEX IF NOT EXISTS "${idxName}" ON "${safeTable}" ("${cols.join('", "')}")`,
			bindings: [],
		});
		if (!this.created.has(safeTable)) this.created.set(safeTable, new Set());
		this.created.get(safeTable)!.add(signature);
		this.journal.push({ table: safeTable, columns: cols, signature, createdAt: Date.now() });
	}

	/**
	 * `EXPLAIN QUERY PLAN` on an equality probe over the leading columns; report
	 * whether the planner chooses a table scan (a missing-index symptom).
	 */
	private async planScans(db: D1Client, table: string, cols: string[]): Promise<boolean> {
		try {
			const stmt = QueryBuilder.from(table).select('id').where(cols[0], '?').where(cols[1], '?').explain();
			const plan = await db.all<Record<string, unknown>>(stmt);
			return plan.some((r) => String(r.detail ?? r['3'] ?? '').includes('SCAN'));
		} catch {
			// Cannot EXPLAIN safely (table missing, D1 quirk) — fail closed rather
			// than guessing; the declarative path still covers user-declared indexes.
			return false;
		}
	}

	/** Each table's most-observed multi-column candidate, deterministically ordered. */
	private topCandidates(): { table: string; columns: string[]; count: number }[] {
		const out: { table: string; columns: string[]; count: number }[] = [];
		for (const [table, byKey] of this.ledger) {
			let best: { columns: string[]; count: number } | null = null;
			for (const [key, count] of byKey) {
				// The key IS the deduped column list (see signatureOf), so the
				// learned shape is recoverable without a second prototype lookup.
				if (!this.prototypes.has(key) || count < MIN_OBSERVATIONS) continue;
				const columns = key.split(',');
				if (columns.length < 2) continue;
				if (!best || count > best.count) best = { columns, count };
			}
			if (best) out.push({ table, columns: best.columns, count: best.count });
		}
		out.sort((a, b) => b.count - a.count || (a.table < b.table ? -1 : 1));
		return out;
	}
}

/** Per-isolate module singleton (like the shared CacheLayer). */
let advisor: SelfTuningIndexAdvisor | null = null;
export function getIndexAdvisor(): SelfTuningIndexAdvisor {
	if (!advisor) advisor = new SelfTuningIndexAdvisor();
	return advisor;
}
