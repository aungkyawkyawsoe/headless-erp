import type { OdoReadingModel } from '../data/types';
import { kmValueLabel } from '@/modules/fleets/data/status';
import { LedgerRow } from '@/shared/components/ledger';
import { formatEnglishDayMonth } from '@/shared/time/myanmar';

/**
 * The Daily ODO ledger vocabulary — the per-reading transition and the ONE row
 * a reading renders as. The record FORM moved to its own full page
 * (`/app/daily-odo/:id/reading/new`), so nothing here writes.
 */

/**
 * The largest single-reading jump treated as plausible. Beyond this the ledger
 * flags the row: an odometer cannot gain 1,000 km between two readings without a
 * long-haul run, so a bigger jump usually means a typo, a skipped reading or a
 * swapped meter — the anomaly the transition line exists to surface.
 */
const IMPLAUSIBLE_JUMP_KM = 1_000;

/**
 * Per-reading TRANSITION — the km gained since the PREVIOUS reading in the same
 * window, keyed by reading id. Readings arrive newest-first, so a row's previous
 * reading is the next entry. The oldest row has no predecessor and no jump.
 */
export function odoJumpsOf(readings: OdoReadingModel[]): Map<string, number | null> {
	const jumps = new Map<string, number | null>();
	for (let i = 0; i < readings.length; i++) {
		const current = readings[i];
		const previous = readings[i + 1];
		jumps.set(current.id, current.km != null && previous?.km != null ? current.km - previous.km : null);
	}
	return jumps;
}

/**
 * ONE daily reading as a ledger row — the day as the anchor, the odometer as the
 * value, and the TRANSITION it represents (`+700 km`) underneath. Rendered both
 * in the ledger and in the bar search's results, so a hit always looks like the
 * row it replaced.
 */
export function OdoReadingRow({ reading, jump }: { reading: OdoReadingModel; jump?: number | null }) {
	const delta =
		jump != null && jump !== 0
			? {
					label: `${jump > 0 ? '+' : ''}${jump.toLocaleString()} km`,
					tone: jump > IMPLAUSIBLE_JUMP_KM ? ('warn' as const) : ('neutral' as const),
				}
			: undefined;

	return (
		<LedgerRow
			anchor={reading.date ? formatEnglishDayMonth(reading.date) : '—'}
			secondary={reading.note ?? undefined}
			value={reading.km != null ? kmValueLabel(reading.km) : '—'}
			delta={delta}
		/>
	);
}
