/**
 * Document Naming Service
 *
 * Auto-generates sequential document numbers from a naming-series pattern.
 *
 * Pattern grammar: a literal `<prefix>` ending in `-`, optionally followed by a
 * trailing run of `#` placeholders that declare the counter width:
 *
 *   "INV-"       → INV-00042        (no `#`s → default width 5)
 *   "INV-####"   → INV-0042         (4 `#`s → width 4)
 *   "INV-#######" → INV-0000042     (7 `#`s → width 7)
 *
 * The prefix keeps the legacy rule (alphanumeric + `_`/`-`, ends with `-`);
 * `#`s may appear ONLY as the trailing run (0–10). Width 5 is the default, so
 * every existing series ("INV-", "OUT-", …) numbers exactly as before.
 *
 * Race condition protection: Uses a retry loop with an atomic INSERT OR IGNORE
 * into a dedicated _naming_series table to prevent duplicate numbers.
 * On conflict, re-reads the current max and retries up to 3 times.
 */

import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { sanitizeIdentifier } from '@mmbix/utils';

export const DEFAULT_NAMING_WIDTH = 5;
export const MAX_NAMING_WIDTH = 10;
/** `<prefix>-` then 0..10 trailing `#`s. The prefix class intentionally excludes `#`. */
const NAMING_SERIES_RE = /^([A-Za-z0-9_-]+-)(#{0,10})$/;

export interface ParsedNamingSeries {
	/** Literal prefix incl. trailing dash — the part that appears in display_number. */
	prefix: string;
	/** Zero-padded counter width (default 5). */
	width: number;
	/** The original naming_series string — `_naming_series` claim rows are keyed by this. */
	raw: string;
}

export class NamingService {
	constructor(private db: D1Client) {}

	/**
	 * Parse a naming-series pattern into its literal prefix + counter width.
	 * Returns null when the pattern is not valid.
	 */
	static parseSeries(series: unknown): ParsedNamingSeries | null {
		if (typeof series !== 'string') return null;
		const m = series.match(NAMING_SERIES_RE);
		if (!m) return null;
		const prefix = m[1];
		const hashes = m[2] ?? '';
		return { prefix, width: hashes.length > 0 ? hashes.length : DEFAULT_NAMING_WIDTH, raw: series };
	}

	/**
	 * Validate a naming-series pattern.
	 * Examples: "INV-" (5-digit default) or "INV-####" (4-digit counter).
	 */
	static validateSeries(series: unknown): { valid: boolean; error?: string } {
		if (!series || typeof series !== 'string' || series.trim().length === 0) {
			return { valid: false, error: 'Naming series must be a non-empty string' };
		}
		if (!NAMING_SERIES_RE.test(series)) {
			return {
				valid: false,
				error:
					'Naming series must end with a dash (-) optionally followed by up to 10 digit placeholders (#). Examples: "INV-", "INV-####"',
			};
		}
		return { valid: true };
	}

	/**
	 * Get the next document number for a naming series.
	 *
	 * Retry loop: Generates a candidate number, atomically tries to claim it
	 * via INSERT OR IGNORE into _naming_series (which has a UNIQUE constraint on
	 * table_name + series + number). On conflict (no-op insert), re-reads the
	 * max value and retries up to 3 times.
	 *
	 * If the _naming_series table does not exist, it is auto-created on first use.
	 * If the INSERT OR IGNORE succeeds (does not throw), the number is considered
	 * claimed regardless of meta.changes, since D1 single-writer serialization
	 * provides additional protection within a single request.
	 *
	 * The candidate is derived from the display_number prefix, so the counter
	 * continues seamlessly when a table's width changes ("OUT-" → "OUT-####":
	 * after OUT-00037 comes OUT-0038).
	 *
	 * @param tableName - The collection table (e.g. "cms_invoices")
	 * @param series - The naming series pattern (e.g. "INV-" or "INV-####")
	 * @returns The next document number (e.g. "INV-00042" / "INV-0042")
	 */
	async getNextNumber(tableName: string, series: string): Promise<string> {
		const parsed = NamingService.parseSeries(series);
		if (!parsed) throw new Error(`Invalid naming series "${series}"`);
		const safeTable = sanitizeIdentifier(tableName, 'NamingService.table');
		const { prefix, width } = parsed;
		const MAX_RETRIES = 3;

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			// Read the current max number for this prefix
			const stmt = QueryBuilder.from(safeTable)
				.select('display_number')
				.where('display_number', 'LIKE', `${prefix}%`)
				.orderBy('display_number', 'desc')
				.limit(1)
				.toSelect();

			const last = await this.db.first<{ display_number: string }>(stmt);

			let nextNum = 1;
			if (last?.display_number) {
				const numPart = last.display_number.slice(prefix.length);
				// Guard against NaN when numPart is empty or non-numeric (e.g. prefix-only rows)
				nextNum = parseInt(numPart, 10) || 0;
				if (nextNum < 1) nextNum = 1;
				nextNum += 1;
			}

			// Format: pad to the pattern width (default 5)
			const nextNumber = `${prefix}${String(nextNum).padStart(width, '0')}`;

			// Atomic claim: INSERT OR IGNORE into the dedicated naming counter table.
			// If another request claimed this number first, the insert succeeds but
			// is a no-op (ignored). We detect this via meta.changes === 0 and retry.
			const claimed = await this._insertClaim(safeTable, series, nextNumber);
			if (claimed) return nextNumber;

			// Conflict — another request claimed this number. Retry with fresh read.
			if (attempt === MAX_RETRIES - 1) {
				throw new Error(`Failed to generate unique display_number for series "${series}" after ${MAX_RETRIES} attempts`);
			}
		}

		// Fallback (should not be reached)
		return `${prefix}${String(1).padStart(width, '0')}`;
	}

	/**
	 * Atomically claim a number in the _naming_series table.
	 * Returns true if claimed, false if ignored (conflict).
	 */
	private async _insertClaim(safeTable: string, series: string, number: string): Promise<boolean> {
		try {
			const result = await this.db.run(
				QueryBuilder.raw('INSERT OR IGNORE INTO _naming_series (table_name, series, number) VALUES (?1, ?2, ?3)', [
					safeTable,
					series,
					number,
				]),
			);
			// INSERT OR IGNORE succeeds but meta.changes = 0 when the row was ignored (conflict).
			// Fall back to success if meta is unavailable (e.g. in some test environments).
			const changes = (result.meta as { changes?: number } | undefined)?.changes;
			return changes === undefined || changes > 0;
		} catch {
			// Table may not exist yet — auto-create on first use and retry
			try {
				await this.db.exec(
					`CREATE TABLE IF NOT EXISTS _naming_series (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						table_name TEXT NOT NULL,
						series TEXT NOT NULL,
						number TEXT NOT NULL,
						created_at TEXT DEFAULT (datetime('now')),
						UNIQUE(table_name, series, number)
					)`,
				);
				const retry = await this.db.run(
					QueryBuilder.raw('INSERT OR IGNORE INTO _naming_series (table_name, series, number) VALUES (?1, ?2, ?3)', [
						safeTable,
						series,
						number,
					]),
				);
				const retryChanges = (retry.meta as { changes?: number } | undefined)?.changes;
				return retryChanges === undefined || retryChanges > 0;
			} catch {
				// Table creation failed — return true so the caller proceeds.
				// The caller should handle any unique constraint violations.
				return true;
			}
		}
	}
}
