/**
 * Row shapes for the Fluid app — the per-vehicle engine-oil / gear-oil service
 * screens (`/app/fluid`). One collection is read per screen: `veh_fluid_fills`
 * (the fill logs) over the `veh_fleets` master list — the list rows carry the
 * fleet-care denormalized columns (current odo + per-kind due), so no
 * `veh_odo_months` read happens anywhere in this module.
 *
 * The raw collection row types are imported from the fleets module (the vehicle
 * master + odo/fill row vocabulary live there — it owns the fleet-card care
 * chips that read the same care collections), so this module only declares the
 * screen models it renders.
 */
import type { FleetRow, FluidFillRow, FluidKind } from '@/modules/fleets/data/types';

export type { FleetRow, FluidFillRow, FluidKind };

/** One vehicle row on the Fluid list — the master facts + the vehicle's current
 *  odometer + each km-serviced kind's km-left chip (attached by the shared
 *  fleet-care reader — COLUMN-FIRST from the master's denormalized care
 *  columns, so the whole list is ONE `veh_fleets` fetch). */
export interface FluidListModel {
	id: string;
	/** The license plate — the row's plate chip (e.g. "YGN 9D/2547"). */
	plateNo: string;
	/** Display label for `brand` (e.g. "HINO") — null when unset/unknown. */
	brandLabel: string | null;
	/** The vehicle's CURRENT odometer (the master's denormalized `last_odo`) —
	 *  the card's top-right readout. Null only when no odo is on file. */
	currentOdo: number | null;
	/** Km left until the engine-oil service — null until the newest engine fill
	 *  has a due odo AND a current odo exist (the row shows a neutral "No
	 *  service yet" chip). */
	engineOilKmLeft: number | null;
	/** Km left until the gear-oil service — same read-side rule. */
	gearOilKmLeft: number | null;
}

/** ONE fill row of a kind's history — a `veh_fluid_fills` row rendered as its
 *  own card (odo · qty · an English day-month date), showing the next-service
 *  odo THAT fill set as the trailing emphasis. The date label is the fill's
 *  EFFECTIVE `date` column when set; rows recorded before that column existed
 *  fall back to the calendar day of `created_at` (the fill's write time). */
export interface FluidFillHistoryModel {
	/** The `veh_fluid_fills` row id — the history card's stable key. */
	id: string;
	/** The odometer at the fill — null when the row has no number. */
	odo: number | null;
	/** The next-service due odo this fill set — null when unset. */
	nextDueOdo: number | null;
	/** Fill quantity in liters — null when unset. */
	qtyLiters: number | null;
	/** English day-month (e.g. "7 Sep") — the effective `date` when set, else the
	 *  `created_at` calendar day. */
	createdLabel: string | null;
	/** The engine's system `doc_status` (draft → pending_review → approved /
	 *  cancelled) — the card's Pending / Confirmed badge + confirm action. */
	docStatus: string | null;
}

/** Lean fleet identity (plate/brand) — the app-bar header. Empty string/null
 *  plate means the row has no plate on file yet. */
export interface FluidFleetIdentity {
	/** The plate — the page header chip. */
	plateNo: string;
	/** Brand display label — omitted when null. */
	brandLabel: string | null;
	/** The truck's photo (`/api/media/<key>`, public GET) — the page's leading
	 *  square tile; null while the fleet card has none uploaded. */
	image: string | null;
	/** The vehicle's current odometer (`veh_fleets.last_odo`) — the hero's km-left
	 *  arithmetic (`next due − current`) on a deep link, where router state
	 *  carries no odo. */
	lastOdo: number | null;
}
