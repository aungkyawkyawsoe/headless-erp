# Wheel Wear / Un-wear Flow — Design (2026-09-10)

## Goal

On the tyre wheel plan (`/app/tyres/vehicle/:id`), replace the vacant-seat "Fit a
tyre" **bottom sheet** with a **truck-inventory picker**: every spare in the truck's
inventory tray is listed as a card, each carrying a `+` that assigns (wears) the
tyre to the tapped wheel position. A filled wheel exposes a corner `✕` that takes
the tyre off the wheel. Both actions capture the **physical date** the operator
chose (wear date / un-wear date), which the tyre's lifecycle history then narrates.

## Single source of truth (SSOT)

The lifecycle history is **already** the immutable `mro_serial_events` table:

| Action                            | Existing event         |
| --------------------------------- | ---------------------- |
| Wear (assign a tyre to a wheel)   | `fitted`               |
| Un-wear (take a tyre off a wheel) | `unseated`             |
| Move / rotate / refit             | `rotated` / `refitted` |
| Return to store                   | `returned`             |
| Scrap                             | `written_off`          |
| Inspect                           | `checked`              |

The UI reads them through `GET /api/mro/serials/:id/events` →
`MroInventoryService.serialEvents()` → one direct D1 query. There is **no second
log** and **no separate "asset assign" record** — the `fitted` event _is_ the
asset assignment. Therefore:

- **Do NOT create a new wear/unwear table or a parallel log.** Doing so would
  duplicate every action in the timeline.
- **Reuse the existing `fitted` / `unseated` rows**, adding only the chosen date.

## The gap: a back-dated movement needs a date field

The engine stamps `created_at = now`. The operator may record a fit that happened
on an earlier day, so the _physical_ date must be stored separately.

- Add **`event_date`** (`type: date`, optional) to `mro_serial_events`.
- `created_at` remains the audit "when was it recorded"; `event_date` is the
  physical day, and is empty for every event that does not back-date.
- The timeline reads `event_date ?? created_at`.

Precedent: `veh_fluid_fills.date` ("the day the service was performed; older rows
without it fall back to created_at").

## Backend changes

1. `apps/api/src/domain-modules/mro/schema-defs.json` — declare `event_date`.
2. `scripts/apply-mro-schema.mjs` — add `mro_serial_events` to
   `syncFieldCollections` so an already-populated table gains the nullable column
   via `PUT /api/collections/:slug` (no recreate, no data loss).
3. `inventory.service.ts`
   - `SerialEventSeed.event_date` + `planEventInserts` column.
   - `normalizeEventDate()` — reject anything but a real `YYYY-MM-DD`.
   - `fitSerialToSeat` / `unseatSerialToTray` accept `eventDate` and set it on
     their event seed.
   - `serialEvents()` selects `event_date` and keeps the `created_at DESC` record
     order (a back-dated event must not reorder the whole timeline against
     events that carry no date); `event_date` is for display.
4. `routes.ts` — `/fit` and `/unseat` read `event_date` from the body.
5. `apps/api/test/mro-inventory.spec.ts` — mirror the field; assert a back-dated
   fit + unseat round-trip.

## Frontend changes (tgapp)

1. `types.ts` — `TyreEventRow.event_date`.
2. `api.ts` — `fitTyreToSeat` / `unseatTyreToTray` accept `eventDate`;
   `eventLineOf` uses `event_date ?? created_at` and titles a seat-less `fitted`
   as "Issued to truck (spare)" (so a tray staging never reads as a wheel fit).
3. `shared/mro.ts` — `fitSerial` / `unseatSerial` send `event_date`.
4. New `components/tyre-wheel-dialogs.tsx`
   - `TyreWearDialog` — a **Dialog** (never a bottom sheet) showing the truck
     inventory as cards; `+` per card opens the wear-date step; a serial search
     remains as the store-tyre fallback. Confirm → fit with `eventDate`.
   - `TyreUnwearDialog` — the corner-`✕` flow: pick the un-wear date → unseat.
5. `tyre-wheel-plan.tsx` — vacant seat opens `TyreWearDialog`; a filled tile gets
   a corner `✕` (always rendered at low opacity, emphasised on hover/focus so it
   works on both touch and pointer devices) opening `TyreUnwearDialog`. Tap on the
   tile still opens the manage sheet.

## Testing

- `cd apps/api && npx tsc --noEmit` and the vitest suite (the kiosk + tray specs).
- `cd apps/tgapp && npx tsc --noEmit` and the vite build.
