# Vehicle "edit last record" — design

Date: 2026-09-15
Status: approved (design), implementation pending

## Problem

The vehicle mini-app screens that record documents are **create-only**. If a
reading/policy/permit/fill is entered wrong, the operator cannot correct it — the
only option is to add a new record, which then becomes the vehicle's "current"
record and skews its status/pill/care chips. The `Employee` Telegram role already
carries `can_write`, so the generic entity API accepts an update; the gap is the
UI and the client data layer.

Incidents and Maintenance already solve this with a dedicated edit screen reached
from the history card. This design mirrors that pattern for the remaining
screens.

## Scope

In scope:

- **Insurances** (`veh_insurances`)
- **Licenses** (`veh_permits`)
- **Fluid** (`veh_fluid_fills`)
- **Daily ODO** (the newest entry inside a `veh_odo_months` bucket)

Already covered (no change): **Incidents**, **Maintenance** — both already have a
dedicated edit screen.

Deferred: **Adjustments** and **Tyres** — their records are multi-line /
serial-event based and need their own design.

## Rule

Only the vehicle's **newest** record is editable — where "newest" means the
record shown first in that module's history list, i.e. its **current** record
(Insurances: furthest expiry; Licenses: newest issue date; Fluid: newest
effective date; ODO: newest reading date).

- The Edit action renders **only on the newest record** — the head of the
  history list (for ODO, beside the current reading on the Odometer card; see
  below).
- The edit screen re-checks that the id it was opened with **is** the vehicle's
  newest record; a direct URL to an older record renders a "not editable" state.
  This makes the control un-bypassable by URL.

Rationale: these are compliance/financial documents; older history is an audit
trail. A correction window is only open for the current record.

## Architecture

Mirrors the shipped Incidents/Maintenance edit flow:

1. The newest history card gains an explicit **Edit** action (pencil).
2. It navigates to a dedicated route.
3. The edit screen loads the full row by id (new `fetchXById`), renders the
   module's form pre-filled, saves via a new `updateX`, invalidates the truck
   history + current + overview query keys, then returns to the history view.
4. The existing record-form component is extended with an optional edit mode
   (initial values + update-on-submit) instead of duplicating field markup.

### Routes

| Module     | Route                             | Editable fields                                                                               |
| ---------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| Insurances | `/app/insurances/policy/:id`      | provider, policy no, expiry, premium, sum insured, windscreen, betterment, note               |
| Licenses   | `/app/licenses/permit/:id`        | license no (hidden on the truck _create_ form), place, fee, issue/expiry, agent, mobile, note |
| Fluid      | `/app/fluid/fill/:id`             | date, odo at fill, next-due interval, qty, note                                               |
| Daily ODO  | `/app/daily-odo/:id/reading/edit` | date + km of the newest reading                                                               |

### Data layer (per module `data/api.ts`)

- `fetchXById(id)` — full row read for the prefill.
- `updateX(id, input)` — `ops.items(collection).update(id, {...})`.

Fluid stores an absolute `next_due_odo`; the edit form keeps showing the interval
(`next_due_odo - odo_at_fill`) and re-derives `next_due_odo = odo_at_fill +
interval` on save.

### Daily ODO

A reading has no row id — it lives inside its `(vehicle, month)` bucket's
`readings` JSON array. The edit screen loads the vehicle's newest reading
(newest-date across the newest buckets), edits `date` + `odo`, and rewrites that
single entry in its bucket (matched by `date` + write-time `at`).

Because a reading has no row id and the ODO history lists only the CURRENT month
(the last reading can predate it), the Edit action lives on the **Odometer card's
header** beside the current reading — always reachable — rather than on a
history card. It appears only when a reading is on file.

Guardrails (correction, not append):

- date must be ≥ the **previous** (second-newest) reading's date;
- km must be ≥ the previous reading's km;
- km **may** be lower than the record's own previous value (that is the point).

### Server-side

- Licenses / Insurances / Fluid already re-rank their `veh_fleets` pointer
  (`last_license` / `last_insurance` / `last_engine_oil` / `last_gear_oil`) on
  `after_update`, so edits propagate with no backend work.
- **Daily ODO:** `veh_fleets.last_odo` is maintained by a monotonic
  (`GREATER-of`) guard, so a corrected-lower reading would not drop it. The odo
  after-write hook becomes an **exact, guarded max recompute** over the vehicle's
  month rows. A back-dated/lower _append_ still never regresses (the max is
  unchanged), so the existing `veh-relink.spec.ts` contract holds; an additional
  case pins that lowering the edited max _does_ update `last_odo`.

## Error handling

- Edit screens surface save failures inline (same vocabulary as the create forms).
- A non-newest id renders "This record is no longer the latest — only the newest
  record can be edited."
- The denorm hooks and cache invalidation paths are reused unchanged.

## Testing

- **Pure:** the "is this the newest record" guard; the fluid interval↔due
  round-trip.
- **Component:** the Edit action is present on the newest card only.
- **API:** extend `veh-relink.spec.ts` — editing the max down lowers
  `veh_fleets.last_odo`; a back-dated append still does not regress it.

## Out of scope

- Editing older (non-newest) records.
- Delete/restore UI.
- Adjustments and Tyres (separate design).
