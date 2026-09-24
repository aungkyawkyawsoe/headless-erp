/**
 * Row shapes for the Daily ODO app — the per-vehicle odometer-reading screen
 * (`/app/daily-odo`). One collection is read: `veh_odo_months` (ONE row per
 * (vehicle, Gregorian month); the month's daily readings live in the row's
 * `readings` JSON array) over the `veh_fleets` master list.
 *
 * The raw collection row types + the month-row reader live in the fleets module
 * (it owns the fleet-card care vocabulary), so this module only declares the
 * screen models it renders.
 */
import type { FleetRow } from '@/modules/fleets/data/types';

export type { FleetRow };

/** One vehicle row on the Daily ODO list — the master facts + its current odo
 *  (the master's denormalized `last_odo` on a provisioned DB — the list costs
 *  ONE `veh_fleets` fetch; only an un-provisioned schema falls back to the
 *  batched `veh_odo_months` read). This is ALSO the shape passed through router
 *  state when a row is tapped, so the vehicle page's identity header needs no
 *  fetch of its own. */
export interface OdoListModel {
	id: string;
	/** The license plate — the row's plate chip (e.g. "YGN 9D/2547"). */
	plateNo: string;
	/** Display label for `brand` (e.g. "HINO") — null when unset/unknown. */
	brandLabel: string | null;
	/** The vehicle's last odometer in km (`veh_fleets.last_odo` when provisioned,
	 *  else the newest reading across its month rows) — null when none on file. */
	latestKm: number | null;
	/** `YYYY-MM-DD` of the newest reading — null when no reading is on file OR
	 *  when the row's odo came from the master's `last_odo` (the denormalized
	 *  column carries the value, not the date). */
	latestDate: string | null;
}

/** One recent odo reading — the vehicle page's history rows. */
export interface OdoReadingModel {
	/** A stable per-reading key (date · odo · write-time — the JSON entries have
	 *  no row id of their own). */
	id: string;
	/** `YYYY-MM-DD` — null when the entry was saved without a date. */
	date: string | null;
	/** The odometer value in km — null when the entry has no number. */
	km: number | null;
	note: string | null;
}

/** The CURRENT odo facts — the vehicle page's card needs only these (the
 *  month's history is NOT loaded until the history screen is opened). */
export interface OdoCurrentModel {
	/** The newest-date reading (the vehicle's current odo) — null = none yet. */
	currentOdo: number | null;
	/** The newest reading's date (`YYYY-MM-DD`) — null when undated. */
	latestOdoDate: string | null;
}

/** The vehicle page's CHANGEABLE odo facts — the current reading only. The
 *  vehicle IDENTITY (plate/brand) is passed from the tapped list row, never
 *  refetched per visit; the readings are fetched lean (no month history), so a
 *  fresh entry opens with one small read. */
export interface OdoReadingsModel {
	id: string;
	/** The newest-date reading (the vehicle's current odo) — null = none yet. */
	currentOdo: number | null;
	/** The newest reading's date (`YYYY-MM-DD`) — null when undated. */
	latestOdoDate: string | null;
	/** Recent readings, newest first — the month's history (loaded only by the
	 *  history screen; the vehicle page deliberately never requests them). */
	readings: OdoReadingModel[];
}

/** One vehicle's full odo board — identity stitched from the tapped list row
 *  (or a deep-link fleet fetch) plus the fetched current. Represents the ready
 *  page state before render. */
export interface OdoBoardModel extends OdoCurrentModel {
	/** The vehicle id — the record writes' target. */
	id: string;
	/** The license plate — the page header chip (e.g. "YGN 9D/2547"). */
	plateNo: string;
	/** Brand display label — omitted when null. */
	brandLabel: string | null;
}
