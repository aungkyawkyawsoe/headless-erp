# Stock module — item drill-down (full stock-lines page) — design (2026-09-14)

Status: approved by user in conversation. The drill-down was FIRST built as an
inline card expansion, then changed on the user's instruction to a full page
("no need to show with expand view. show the menu with back button full layout —
show that item's details, line each with serial"). This document describes the
shipped page. No commit made (project rule: never commit unless explicitly
asked).

## Problem

Both stock surfaces routed a card tap to the **item master edit form**:

- `/app/stocks` — the search-first kiosk (`stock-page.tsx`)
- `/app/stocks/browse` — the four-tab dashboard (`stock-browse-page.tsx`)

both `navigate('/app/items/:id')` → `item-edit-page.tsx`, i.e. `ItemForm` in edit
mode (group / brand / name / expiry-alert). That is a **master-data** screen. On a
stock screen the operator is asking "what stock is actually here?", and the answer
is invisible: the balance card shows only image + name + store + qty (+ drift), so
the operator cannot even predict what a tap should reveal.

For a `batch` SKU the useful facts are its lots (batch no, expiry, remaining qty);
for a `serial` SKU its units (serial no, status, holder). Neither is reachable.

## Goal

Tapping a stock card opens a **full-screen page** for that SKU
(`/app/stocks/item/:modelId`) — the standard module layout with a back arrow —
showing the item's details and then its inventory lines by the SKU's tracking
policy:

| tracking   | line shown                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `standard` | per-store balance (Main store 9, Safety store 0)                                                |
| `batch`    | lot line — `batch_no · store · expiry · days_left`, FEFO order, expiry flag                     |
| `serial`   | unit line — `serial_no · holder (plate+slot / employee / store) · tread·psi`, one line per unit |

- Read-only. **No stock-moving writes from the stock module.**
- A `serial` unit line taps through to the existing unit page
  (`/app/tyres/tyre/:id` — it already serves both `tyre` and `asset` kinds).
- Applies to BOTH surfaces, since both render `OnHandRow`.
- The back arrow **pops** (via `ModuleShell`'s `popBack`) so it returns to the
  exact view the operator came from — the browse page's tab + store + category
  filters survive. A cold deep-link falls back to `/app/stocks`.

## Non-goals

- No inline issue/adjust/transfer. Stock is `writes.mode: 'service'` and moves only
  through a confirmed document with a two-person rule (reporter + separate
  approver).
- No new item-master editing surface. The master keeps `/app/items/:id`; it is
  demoted to a secondary link at the foot of the page.
- No changes to the tyres module's serial pages — they are **reused** (linked into),
  not modified. The expiry tab's 📄 action still opens the item master (unchanged).

## Why a page, not an inline expansion (the first attempt)

An inline expansion was built first and rejected. Two reasons:

1. **The card is ONE (model, store) cell, the answer is the SKU's whole picture.**
   Expanding under a card labelled "Vehicle store 0" and listing four units that
   are in Safety store reads as a contradiction, so the lines had to be scoped to
   the card's own store — which then made a `standard` card's expansion a single
   line repeating the number already on the card.
2. A dedicated page is the honest shape for "item details + every line", has room
   for the group / policy / totals the card deliberately omits, and gives the
   serial list a real scroll surface.

## Data

One server-scoped read:

```
GET /api/mro/stock/items/:modelId
```

### Why a server-scoped route, not generic entity reads

- `mro_stock_lots` and `mro_serial_events` are **not** in the Telegram role's
  config grant list (`packages/config`), which carries only `mro_inventory` and
  `mro_stock_serials`. A generic `/api/entities/mro_stock_lots?...` read therefore
  **403s for a real (non-admin) employee** — exactly the class of failure this
  module has already been bitten by twice.
- The MRO stock reports are already server-scoped, display-ready reads
  (`/stock/onhand`, `/stock/expiring`, `/assets/holder`) that resolve their joins
  server-side. This follows the same pattern: no client N+1, no RBAC drift, and the
  holder display (plate / wheel slot / employee name) reuses the resolution
  `/assets/holder` already performs.

### Response shape (as implemented)

```jsonc
{
	"model": {
		"id": "…",
		"name_en": "AF-4004",
		"name_mm": null,
		"image": "/api/media/…",
		"group_name": "Air Filter",
		"tracking": "batch",
	},
	"totals": {
		"on_hand": 9, // Σ (derived_qty ?? qty_on_hand) across stores
		"expired": 0, // Σ expired slice (never counted as available)
		"any_below_reorder": true, // true when ANY balance row is below its reorder level
	},
	"balances": [
		{
			"id": "…",
			"location": "main_store",
			"qty_on_hand": 9,
			"derived_qty": 9,
			"expired_qty": 0,
			"reorder_level": 15,
			"drift": false,
			"below_reorder": true,
		},
	],
	"lots": [
		{
			"id": "…",
			"location": "main_store",
			"batch_no": "LOT-2026-01",
			"expiry_date": "2026-10-12",
			"days_left": 28,
			"remaining_qty": 6,
			"expired": false,
		},
	],
	"serials": [
		{
			"id": "…",
			"location": "vehicle_store",
			"serial_no": "SN-001",
			"status": "in_stock",
			"vehicle": "…",
			"plate_no": "36Z-8888",
			"slot": "steer-left",
			"employee": null,
			"employee_name": null,
			"tread_mm": 13.8,
			"psi": 110,
			"condition": "good",
			"expiry_date": null,
		},
	],
}
```

- The model header carries the SKU's photo (`image`) as well as its bilingual
  name, group and policy: the page is a real route, so a cold deep-link or a
  reload must be able to paint the whole details card from this ONE read — it
  cannot depend on the summary card that happened to open it. (The card still
  seeds the title + photo through router state for an instant first paint; the
  read then reconciles it.)
- `derived_qty` is `null` for a `standard` model (its balance IS the truth) and a
  number for `batch`/`serial`; `totals.on_hand` sums `derived_qty ?? qty_on_hand`,
  so a drifted balance never inflates the header count.
- An **orphan** location (stock with no balance row) is emitted as a balance with
  `id: null`, `qty_on_hand: 0`, and `drift` carrying the derived total — mirroring
  `onHand()` so the two screens agree rather than contradict.
- `lots` and `serials` are present only for the model's policy (empty arrays
  otherwise) — the client renders what it is given and never re-derives policy.
- Only the policy's own trace table is queried (a `standard` SKU reads neither),
  and `lots` is limited to `status = 'active'` with `remaining_qty > 0`,
  `serials` to `status = 'in_stock'`.
- Expired lots/serials are **included but flagged** (`expired`), matching the
  on-hand report's rule that expired stock is physically present but never counts
  as available.

## Backend

- `MroInventoryService.itemComposition(modelId)` in `domain-modules/mro/inventory.service.ts`:
  - **balances** — the `mro_inventory` rows for the model, reusing the same
    tracking-aware derivation (`derived_qty`, `expired_qty`, `drift`,
    `below_reorder`) the existing `onHand()` already computes, so the two screens
    can never disagree;
  - **lots** — `mro_stock_lots` (`status = 'active'`, not deleted), ordered FEFO
    (expiry asc, nulls last, then `batch_no`), `days_left` from `todayMmtDate()`;
  - **serials** — `mro_stock_serials` (not deleted), holder resolved
    (`vehicle → plate_no`, `slot`, `employee → name_en`), ordered by location then
    `serial_no`;
  - read-only: no writes, no DDL, no schema change.
- Route `app.get('/stock/items/:modelId', …)` in `domain-modules/mro/routes.ts`,
  same auth shape as `/stock/onhand` (any authenticated session; the raw MRO read
  routes do not apply per-collection RBAC).
- Unknown/deleted model → `404` (a `NotFoundError`), so the client can show an
  inline "no longer exists" rather than an empty composition.

## Frontend (`apps/tgapp`)

- `mroApi.itemStock(modelId)` in `shared/mro.ts`, typed by a new
  `MroItemComposition` interface (with `MroCompositionBalance` / `…Lot` / `…Serial`
  row types) alongside the other shared MRO row shapes.
- Route `/app/stocks/item/:modelId` → `modules/stock/pages/stock-item-page.tsx`
  (`ModuleShell`, so the app bar + back arrow are the shared chrome; the back
  POPS to the referring screen, falling back to `/app/stocks` on a cold open).
- Query key `qk.itemStock(modelId)` → `['stock', 'item', modelId]`,
  `staleTime: STOCK_STALE_MS`. The existing `stock` invalidation domain already
  lists every confirm writer that moves balances/lots/serials, so a confirmed
  document refreshes the page with no extra wiring.
- **Pure mapper** `data/lines.ts` — `linesOf(composition)` → the policy-appropriate
  line list (kind, primary/secondary text, qty, tone, and the serial id a unit line
  taps through with). Unit-testable without mounting anything.
- The page renders, in order: the **details card** (photo, name, Burmese name,
  group, policy chip, and the `On hand` / `Expired` / `Below reorder` totals), the
  **line list** under a policy caption ("Lots · soonest expiry first"), and the
  **`ပစ္စည်း အချက်အလက်`** link to the item master.
- `OnHandRow` keeps its one change from the earlier attempt — the tracking-policy
  badge, which is what predicts the line kind the page will show — and gains a
  chevron; its tap now navigates instead of opening the item master.
- Both stock pages route the tap through a local `openItem(row)` that seeds the
  page header with the name + photo the card already holds. The browse page keeps
  its separate `openModel` for the expiry feed's 📄 action (item master, unchanged).

## Edge cases

- A kiosk row with no balance (`notStockedRow`) still opens the page — it shows the
  details card and "No stock lines yet", never an error.
- A model deleted since the list loaded → the read 404s; the page shows an inline
  error + retry, never a crash.
- A tracked SKU with no trace rows (a batch model with no active lots) → the page
  header's derived total is 0 too, so "no lines" is consistent with it. There is
  deliberately NO fallback to the balance rows, which would contradict the header.
- Drift: the composition's `derived_qty` must equal the on-hand report's, since
  both derive from the same snapshot helper.

## Testing / gates

- `cd apps/api && npx tsc --noEmit && npx vitest run`
- `cd apps/tgapp && npx tsc -b --noEmit && npx vitest run`
- New coverage:
  - `apps/api/test/mro-inventory.spec.ts` — after a confirmed inbound, the
    composition read returns the created lots/serials with the right tracking, FEFO
    order, resolved holder and correct totals; and it answers **404, not 403, for
    the Employee role** (the regression this feature exists to avoid —
    `apps/api/test/telegram-role.spec.ts`).
  - `apps/tgapp/src/modules/stock/data/lines.spec.ts` — the pure mapper over the
    three policies + the empty case.
- Live smoke: `npx wrangler dev`, then the kiosk + dashboard card taps in the
  browser (`/app/stocks/item/:modelId`), a cold deep-link (title + photo resolve),
  and the back arrow returning to the referring filters.
