/**
 * The Daily ODO record form's ONE admission rule.
 *
 * A new reading is append-only in BOTH dimensions the odometer moves: it may
 * not be dated BEFORE the vehicle's last reading, and its km may not sit BELOW
 * that reading. The odometer is cumulative, so the two move together — letting
 * either slip through writes an entry that the board (which shows the
 * newest-DATE reading) then hides, which is the "I changed the date/odo, saved,
 * and it still shows the old value" report.
 *
 * Pure (no SDK/React), so the form and its spec share exactly this rule.
 */

/** The FIRST reason a draft reading may not be saved. */
export type OdoReadingRejection = 'missing-date' | 'before-last-date' | 'missing-odo' | 'invalid-odo' | 'below-last-odo';

export interface OdoReadingDraft {
	/** `YYYY-MM-DD` chosen in the date field (`''` when cleared). */
	date: string;
	/** The raw odometer input string. */
	odo: string;
	/** The vehicle's last reading km — null when none is on file yet. */
	lastOdo: number | null;
	/** The vehicle's last reading date (`YYYY-MM-DD`) — null when none yet. */
	lastDate: string | null;
}

/**
 * The first reason `draft` is not a valid next reading, or null when it is.
 * Date issues are reported before km issues (a back date is the more obvious
 * mistake). `YYYY-MM-DD` strings compare lexicographically, so no Date parsing
 * (and no timezone drift) is involved.
 */
export function rejectOdoReading({ date, odo, lastOdo, lastDate }: OdoReadingDraft): OdoReadingRejection | null {
	if (date === '') return 'missing-date';
	if (lastDate != null && date < lastDate) return 'before-last-date';
	if (odo === '') return 'missing-odo';
	const km = Number(odo);
	if (!Number.isFinite(km) || km < 0) return 'invalid-odo';
	if (lastOdo != null && km < lastOdo) return 'below-last-odo';
	return null;
}
