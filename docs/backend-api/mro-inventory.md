# MRO Inventory — requisitions, documents, transfers & adjustments with a confirm gate (`/api/mro`)

MRO stock control on the entity engine: **multi-line Requisition (request), Inbound (receipt/GRN), Outbound (issue/write-off), Transfer (location→location) and Adjustment (operator-reported stock correction) documents**, a **draft → confirm** gate (stock is touched **only** at confirm — and a requisition's confirm only approves), **document IDs** (`REQ-` / `INB-` / `OUT-` / `TRF-` / `AJT-`), and per-model **tracking policies**:

| Policy                          | Example                       | Stock lives in                           |
| ------------------------------- | ----------------------------- | ---------------------------------------- |
| `standard` (qty only)           | bolts, fasteners              | `mro_inventory.qty_on_hand`              |
| `batch` (lot + optional expiry) | engine oil, grease, batteries | `mro_stock_lots` (per received lot)      |
| `serial` (per physical unit)    | tyres, pumps                  | `mro_stock_serials` (unique `serial_no`) |

Live collections: `mro_suppliers` (vendor master), `mro_item_categories` (top-level grouping — Engine & Gear Box, Body & Lighting, …; `name_en`\/`name_mm`), `mro_item_name` (catalog master — what the part IS: Bulb/Clutch/Tyre/Tools, each part group belongs to ONE `mro_item_categories` via its `category` m2o and defines the stock policy `tracking` that EVERY SKU under it inherits, plus `assets` — a boolean marking a group whose units are PHYSICAL ASSETS tracked one-by-one, a tyre or a jack; the rule is `assets ⇒ tracking: 'serial'`), `mro_item_model` (SKU per tracked part; `item_name` m2o REQUIRED, classification via `item_name`, bilingual display pair `name_en` (the indexed English name document lines show) `name_mm`, plus `expiry_alert_days`), the document families + their child lines (`mro_requisitions`\/`mro_requisition_lines`, `mro_inbounds`\/`mro_inbound_lines`, `mro_outbounds`\/`mro_outbound_lines`, `mro_transfers`\/`mro_transfer_lines`, `mro_adjustments`\/`mro_adjustment_lines`), the stock trace tables `mro_stock_lots`, `mro_stock_serials` (an asset unit carries its DERIVED holder — `vehicle` + `slot`, or `employee` — plus the live `tread_mm`\/`psi`\/`condition` reading), `mro_serial_events` (the immutable per-unit lifecycle), `mro_outbound_lots`\/`mro_outbound_serials`, `mro_transfer_lots`\/`mro_transfer_serials`, `mro_adjustment_lots`\/`mro_adjustment_serials` (which lot/serial satisfied an outbound, moved in a transfer, or was created\/removed by a correction — with per-line provenance; these trace tables are what a REVERSAL reads, §5c), and `mro_inventory` (aggregate balance + `reorder_level`). All of them (plus every column) are declared in `apps/api/src/domain-modules/mro/schema-defs.json` and created by `scripts/apply-mro-schema.mjs` — the schema is fully self-bootstrapping on any fresh environment, never raw SQL.

## The workflow (why drafts exist)

A document is created as a **draft** through the generic entity API — nothing is reserved or moved. Confirming is a single server-side atomic batch; a failed or overselling confirm leaves **no partial state** and a replay **never double-stocks**.

```
create draft (engine) ──> edit draft (engine, free while draft)
        │                          │
        └──────────── confirm ─────┘   POST /api/mro/{inbounds|outbounds|transfers|adjustments|requisitions}/:id/confirm
                        │                          │
                        ▼                          └──── cancel ────┐
   ONE atomic batch: stock rows + balance + totals + doc_status = confirmed
                        │                                          │
                        └──────── cancel ──────────────────────────┘
              POST /api/mro/{inbounds|outbounds|transfers|adjustments}/:id/cancel
   draft → a pure lifecycle flip · confirmed → REVERSED in the same atomic batch
```

- `doc_status`: `draft` → `confirmed` (service-only) or `draft` → `cancelled` (generic PUT). The engine's core doc-status rules make `confirmed` unreachable via generic writes — only the confirm endpoint may set it.
- `cancelled` is reached through ONE route per family (§5c) which decides by the DOCUMENT's own state: a draft flips, a posted document is reversed, a replay is a no-op. For all four cancellable families `cancelled` is also **frozen** (`writes.freeze_when`), so the engine's generic `cancelled → draft` reopen is refused — see §5b.
- Re-confirming a confirmed document returns `{ already: true }` and changes nothing; re-cancelling returns `{ already: true, reversed: false }` and changes nothing.
- Confirm writes the header totals (`total_qty`, `line_count`, `total_amount`) in the same batch — one authoritative writer, never stale.

## 1. Draft an inbound (GRN) — generic entity API

```bash
curl -X POST http://localhost:8788/api/entities/mro_inbounds \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' -d '{
    "supplier": "<mro_suppliers id>", "purchase_date": "2026-09-04",
    "type": "purchase", "location": "main_store",
    "lines": [
      { "item_model": "<serial model id>", "qty": 2, "unit_price": 350000,
        "serials": ["TY-2026-0001", "TY-2026-0002"] },
      { "item_model": "<batch model id>", "qty": 20, "unit_price": 12000,
        "batch_no": "OIL-2601", "expiry_date": "2027-03-03" },
      { "item_model": "<standard model id>", "qty": 500, "unit_price": 250 }
    ]}'
# → { success:true, data:{ id, display_number:"INB-00001", doc_status:"draft", lines:[…] } }
```

Line fields: `item_model` (req) · `qty` (req) · `unit_price` · `location` (optional — defaults to the header location) · `batch_no` · `expiry_date` · `serials` (JSON array) · `note`. `type` = `purchase` | `legacy` | `return`. Editing/cancelling drafts is a normal engine PUT (`doc_status: "cancelled"` cancels). Nothing here touches stock.

**The counterparty is PER KIND — a vendor OR an employee, never both, never neither.** The header carries two relationships and a `required_if` validation rule decides which one the write must name:

| `type`                     | Counterparty                                 | Field                                       | Notes                             |
| -------------------------- | -------------------------------------------- | ------------------------------------------- | --------------------------------- |
| `purchase`                 | the VENDOR it was bought from                | `supplier` (m2o `mro_suppliers`, required)  | a purchase with no supplier → 400 |
| `legacy` (opening balance) | the EMPLOYEE handing the existing stock over | `handed_by` (m2o `hrm_employees`, required) | an opening balance has no vendor  |
| `return`                   | the EMPLOYEE the goods came back from        | `handed_by` (required)                      | nothing was bought — no vendor    |

```bash
# a RETURN: goods coming back from a person, no supplier at all
curl -X POST http://localhost:8788/api/entities/mro_inbounds \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' -d '{
    "handed_by": "<hrm_employees id>", "purchase_date": "2026-09-04",
    "type": "return", "location": "main_store",
    "lines": [{ "item_model": "<serial model id>", "qty": 1, "serials": ["TY-2026-0001"] }]}'
# → 201 …| a return with no handed_by → 400 "handed_by is required when type is return"
```

`handed_by` is distinct from `received_by`, which the confirm route stamps from the SESSION (the store side that booked the receipt in). The mini app renders this as ONE field whose label + picker follow the kind (`INBOUND_TYPE_META[type].party` in `apps/tgapp/src/modules/inbounds/data/meta.ts`): “Supplier” → the vendor sheet, “Returned by” / “Handed over by” → the personnel picker. Pinned by `apps/api/test/mro-inventory.spec.ts` + `apps/tgapp/src/modules/inbounds/components/inbound-doc-form.spec.tsx`.

## 2. Confirm the inbound — the stock effect

```bash
curl -X POST http://localhost:8788/api/mro/inbounds/<id>/confirm \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' -d '{}'
```

Per line, by policy (`type=return` re-instocks instead of duplicating):

| Policy   | purchase / legacy                                                              | return                                                                                     |
| -------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| standard | balance `+qty`                                                                 | balance `+qty`                                                                             |
| batch    | new lot (`batch_no` auto `B-<date>-<rand>` when blank, `expiry_date` optional) | new lot                                                                                    |
| serial   | `serials[]` length == qty, unique, globally unused → `in_stock` rows           | `serials[]` must exist and be `issued` → flip back to `in_stock` at the effective location |

Also writes the header (`total_qty`, `line_count`, `total_amount`, `confirmed_at`, `received_by`, `doc_status=confirmed`) in the same batch. `received_by` (an m2o to `hrm_employees`) records **who booked the receipt in** — resolved from the session (`actorOf`: the signed JWT's `employee_id`; an admin may name one in the body), so an inbound confirm is never anonymous. A replay is a no-op and never rewrites it. A POSTED receipt is undone by the cancel route, which reverses every effect above from the document's own rows (§5c) — including withdrawing the payment the confirm itself filed for a `paid_at_receipt` draft.

## 2b. Paying a purchase receipt — the payment ledger (`mro_inbound_payments`)

A receipt can be paid over many days and many instalments, so the money is a **ledger**, not a field: one row per payment made against the receipt. The receipt header carries the **derived** mirror the list/card reads in one fetch:

| `mro_inbounds` column | meaning                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paid_amount`         | Σ of the receipt's LIVE ledger entries' `amount`                                                                                                  |
| `payment_status`      | `unpaid` · `partial` (0 < paid < total) · `paid` (paid ≥ total)                                                                                   |
| `fully_paid_on`       | the DAY it settled — the latest live entry's `paid_on` once the sum reached `total_amount`; cleared again if the entry that cleared it is removed |

```bash
# 1) FILE a payment (the recorder is the session; an admin may name one)
curl -X POST http://localhost:8788/api/entities/mro_inbound_payments \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' -d '{
    "parent_id": "<inbound id>", "paid_on": "2026-09-05", "amount": 1500000,
    "method": "cash", "reference": "CHQ-1234"
  }'
# → 201 { … "method":"cash" } and the receipt header now reads
#   { paid_amount: 1500000, payment_status: "paid", fully_paid_on: "2026-09-05" }

# 2) WHICH DAY we paid what (the ledger, oldest first)
curl 'http://localhost:8788/api/entities/mro_inbound_payments?filter[parent_id]=<inbound id>&sort=paid_on' \
  -H 'Authorization: Bearer dev-token'

# 3) CORRECT a mistake — remove the entry (soft delete), then file the right one.
#    The mini app's path (an operator role has NO `delete` on the ledger, so the
#    generic DELETE would 403 it — see below):
curl -X DELETE .../api/mro/inbounds/<inbound id>/payments/<payment id> \
  -H 'Authorization: Bearer <operator token>'   # → 200 { id, payment: {paidAmount, status, fullyPaidOn} }
#    An admin / Studio / CLI may still use the generic route, which needs `can_delete`:
curl -X DELETE .../api/entities/mro_inbound_payments/<id>   # → 200, the mirror steps back

#    An EDIT of amount / paid_on / method / parent_id is refused on every path:
curl -X PATCH  .../api/entities/mro_inbound_payments/<id> -d '{"amount":9999}'
# → 400 VALIDATION_ERROR "A recorded payment cannot be edited — remove the entry and
#   file the correct payment instead."   (reference / note stay editable)
```

Rules and invariants:

- **The mirror is derived, never written by a client.** The compiled hooks in `apps/api/src/domain-modules/mro/inbound-payments.ts` (registered in `mountDomainModules`) re-derive all three columns from the LIVE ledger after every payment write — create, edit, soft-delete, restore — with ONE guarded `UPDATE` that lands only when a value actually differs (a re-run is a no-op, no `updated_at` churn). A payment filed from the Studio, the CLI or an import therefore keeps the receipt true, not only one filed from the mini app.
- **Filing AND removing go through the receipt's own routes, never the ledger's RBAC.** `POST /api/mro/inbounds/:id/payments` files one; `DELETE /api/mro/inbounds/:id/payments/:paymentId` removes one. Both are gated on `write` for **`mro_inbounds`** — the collection whose money they change — because NO operational role carries `delete` on `mro_inbound_payments` (the standard grant set is read/write/create/submit, and `scripts/reconcile-storekeeper-role.mjs` keeps the ledger read-only on purpose). A mini-app storekeeper who used the GENERIC delete met `You do not have "delete" permission on "mro_inbound_payments"` — the removal half of the correction path was simply missing. The DELETE route also refuses (409) a payment whose `parent_id` is another receipt, since there the mirror of the WRONG document would be stepped back, and it is a no-op on replay that still returns the receipt's current money state. Pinned by `apps/api/test/mro-inventory.spec.ts` (`…with NO delete grant on the ledger`).
- **A receipt can arrive SETTLED (`mro_inbounds.paid_at_receipt`)** — the money handed over with the goods (the create form's `Paid in full` checkbox). It is a **draft-only flag on the header**, and the CONFIRM is what files the money: one `mro_inbound_payments` row inside the SAME atomic batch as the header flip (amount = the total that confirm computed, `paid_on` = the receipt date, `method` = the collection's declared default, `note` = “Paid in full at receipt”, `recorded_by` = the confirming session actor, with an undo op), so a receipt can never be confirmed “paid at receipt” without the entry that settles it and the mirror never sees money with no ledger behind it. The client sends the FLAG, never the amount. The confirm **refuses** the flag for a kind that owes nobody (a return / opening balance → 400) and for a receipt with no total (unit prices unset → 400), and `writes.freeze_when` freezes the flag at confirm, so it can never be flipped on a posted receipt. The confirm ROUTE then awaits the mirror derivation and returns `payment`, so the screen that booked it already reads `paid` / `fully_paid_on` with nothing left. Pinned by `apps/api/test/mro-inventory.spec.ts` (`files the receipt's ONE payment when the draft said paid at receipt` + `refuses paid-at-receipt where…`) and `apps/tgapp/src/modules/inbounds/components/inbound-doc-form.spec.tsx` (the checkbox offers itself for a priced purchase only, and sends `paid_at_receipt`).
- **The rule lives in ONE pure function** (`derivePaymentState(totalAmount, entries)`) — the card, the sheet, a report and the tests all read the same semantics; there is no second copy of "what count as paid".
- **The document page IS the receipt's FORM, and the DOCUMENT decides whether it edits.** `/app/inbounds/:id` mounts the same `InboundDocForm` the create screen uses, seeded from one read (`fetchInboundDocEditor` = the header projection `EDITOR_FIELDS` + the child lines, mapped twice: `card` for the money/lifecycle facts, `seed` for the fields). A `draft` edits and saves with `PUT /api/entities/mro_inbounds/:id` (the `lines` child table is REPLACED by the payload, so a removed line really leaves the draft and a re-send is idempotent); a `confirmed`/`cancelled` row renders the identical layout read-only, because `isInboundEditable` mirrors the two rules the engine already enforces — `writes.freeze_when { doc_status: ['confirmed'] }` and the core `draft → cancelled`-only transition — so the screen never offers a write the server would 403. **The mode is read off `docStatus`, never passed in as a flag**, and one `locked = submitting || readOnly` expression disables every field, so a control cannot be forgotten. An edit states the clearable fields outright (`supplier`/`handed_by` one id + the other `null`, `note: null`, `paid_at_receipt: false`), which a create omits — that is what lets a draft CHANGE ITS KIND without leaving a stale counterparty beside the new one. The money is deliberately NOT a form field: it stays a separate tappable strip below the form, because the ledger — not this document — writes it, and its sheet is the only place an entry is added or removed. A SERIAL line's units are entered in their own sheet too (`SerialEditorSheet`: entry + `Add` on top, one row per unit below, `n/qty` in the title), with the field showing the resulting comma list — and `addSerials` refuses a unit that is already on this line OR on another line of the same receipt (case-insensitively, and with the reason shown), so the two mistakes a free-text field hides — a mistyped unit and a duplicate — surface while the label is still in the operator's hand. A settled receipt opens the same sheet as a read-only VIEWER (no entry box, no `Add`, no per-row delete, no count instruction): reading the units a posted receipt received is not a write, so the field stays live (`disabled={submitting}`) while every other control is frozen — the units are otherwise only readable as a truncated comma list. Every line names its SKU the same way the picker does — the parent item NAME over the SKU (`Tyre · 11R 22.5`, `mroItemLineLabel`) — so the line, the picker row and the sheet's title cannot read differently. Pinned by `apps/tgapp/src/modules/inbounds/data/edit.spec.ts` (the seed mapper + `isInboundEditable`), `pages/inbound-detail-page.spec.tsx` (a draft saves by PUT; a confirmed receipt has no live field and no save bar), `components/inbound-doc-form.spec.tsx` (edit mode PUTs the same id, never a second POST; a serial line collects its units in the sheet, and a settled receipt opens it read-only) and `components/serial-editor-sheet.spec.tsx` (one row per unit, a pasted column, a refused repeat, and the read-only view).
- **The money is immutable; the correction path is remove + re-file.** A `frozen_fields` policy could not express this (the engine strips frozen columns from the CREATE too, so the row could never be filed), so a `before_update` guard refuses a change to a defining column. `reference` / `note` stay correctable.
- **Only a purchase is payable.** An opening balance / return owes nobody, so the mini app renders no money strip and no payment sheet for them; the engine stays neutral (a stray ledger row on a draft simply cannot settle it — no total to compare against → `unpaid`).
- **Money survives a reversal; the receipt's own payment does not.** Cancelling a POSTED receipt (§5c) refuses while any payment a PERSON recorded stands (409 — "remove them first"), so a stock correction can never erase money that really left the till. The ONE exception is the entry the confirm itself filed for a `paid_at_receipt` draft: it carries `_meta = {"source":"paid_at_receipt"}`, which is how the un-post tells its own entry from a recorded one and withdraws exactly that one with the receipt (the mirror is then re-derived and returns `unpaid`). And a **cancelled receipt takes no money at all** — a compiled `before_insert` guard refuses a payment whose parent is `cancelled`, on the payments route and on the generic API alike, so a void document can never describe money again.
- **An over-payment settles the receipt** (`paid ≥ total`) and leaves `Left = 0`: the ledger records what actually left the till, and refusing it would push a real payment into a corner it cannot be recorded in.
- **Deleting a receipt cannot orphan its ledger** — `parent_id` is an m2o with `cascade_delete: true`.
- UI: the purchase card leads with `Total cost`, then the progress bar + Paid/Left + “fully paid on” and opens the **payment sheet** (`apps/tgapp/src/modules/inbounds/components/inbound-purchase-card.tsx` + `inbound-payment-sheet.tsx`). The strip deliberately omits the total: it sits directly under the headline figure, so repeating it would spend the row's scarcest ink on a number the reader just saw. The sheet is the compact three-block layout — one row (`Paid: X / Y` … `N Ks left`) over a slim bar, the ledger under its own entry count, then amount + date side by side with `Pay remaining balance` one tap away and the submit at the foot. It is **deliberately UNTINTED** (a failure still tints — an error is not decoration): the figures carry the state there, whereas the card keeps its tones because on the LIST the money state is a scanning cue across dozens of rows. Once the ledger has CLEARED the total the third block disappears entirely (`expectsPaymentOf` — the sheet is still opened on a settled receipt to review the history and remove a wrong entry, and the card's ⋮ `Record payment` entry goes with the form). `expectsPaymentOf` is deliberately narrower than `canPayOf`: the engine still accepts another instalment on a settled receipt, but nothing is owed, so the mini app stops asking.
- **One receipt, one face per QUESTION** — the card is the LIST ROW (identity, `Total cost`, the tappable money strip, the ⋮ actions), and the document page is the receipt's FORM; the strip is the one piece both mount (`InboundMoneyStrip`), because a money figure must read identically wherever the receipt appears. The card has no second frame: the page spends its surface on the editable fields (`InboundDocForm`), so an "extra" read-only rendering of the same receipt would only be a second place to keep true. The document's line items are therefore the FORM's line editor on the page, not a detached list under the money. `canPayOf` (`data/money.ts`) decides whether a money face exists at all (a draft or a vendor-less kind shows none) and the payment sheet is its only opener, so the row, the page and the sheet can never disagree. Pinned by `inbound-purchase-card.spec.tsx` + `inbound-detail-page.spec.tsx` + `data/money.spec.ts`.
- Pinned by `apps/api/test/mro-inventory.spec.ts` (`inbound payment ledger …`) + `apps/tgapp/src/modules/inbounds/components/inbound-purchase-card.spec.tsx`.

```bash
curl -X POST http://localhost:8788/api/entities/mro_outbounds \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' -d '{
    "type": "goods_issue", "effective_date": "2026-09-04", "location": "main_store",
    "lines": [
      { "item_model": "<serial model id>", "qty": 1, "serials": ["TY-2026-0001"] },
      { "item_model": "<batch model id>", "qty": 8 },
      { "item_model": "<standard model id>", "qty": 100 }
    ]}'
# → display_number "OUT-00001", doc_status "draft" — stock NOT deducted yet
```

`type` = `goods_issue` | `write_offs` | `defects_missing`.

- **The document page IS the issue's FORM, and the DOCUMENT decides whether it edits.** `/app/outbounds/:id` mounts the same `OutboundDocForm` the create screen uses, seeded from one read (`fetchOutboundDocEditor` = the header projection `EDITOR_FIELDS` + the child lines, mapped twice: `card` for the display facts, `seed` for the fields). A `draft` edits and saves with `PUT /api/entities/mro_outbounds/:id` (the `lines` child table is REPLACED by the payload, so a removed line really leaves the draft and a re-send is idempotent); a `confirmed`/`cancelled` row renders the identical layout read-only, because `isOutboundEditable` mirrors the collection's own `writes.freeze_when { doc_status: ['confirmed','cancelled'] }` plus the core `draft → cancelled`-only transition — the screen never offers a write the server would 403. The mode is read off `docStatus`, never passed in as a flag, and one `locked = submitting || readOnly` disables every field; ACTIONS (add/remove a line, the submit bar, every picker sheet) are ABSENT rather than dead, with the reason stated in the status pill's own words. Two things an EDIT states that a create simply omits: the HOLDER pair (`to_vehicle` / `to_employee` — one id and one `null`, so switching a draft from a truck to a person, or dropping its last serial line, cannot leave the old holder set beside the new one) and `note: null`; and it RE-STATES the source `request`, so an edit can neither drop the link nor invent one. The document's OWN `type` outranks the route's `?type=` (the tab an operator came from is navigation state, the column is the document), and a seeded line carries the STORED `modelName` / `tracking`, so a serial row keeps its unit picker — and its picks as its quantity — while the cached SKU directory is still in flight (re-picking a model clears both). An EDIT also RE-STATES `unit_price` on every line (it drives the confirm's `total_amount`), because the `lines` child table is REPLACED by the payload — a column the form does not collect would otherwise silently vanish on every save. An outbound line carries **no batch/expiry input at all**: `mro_outbound_lines` has no such column and allocation is the engine's FEFO rule (§4), so the form offers nothing to type that the confirm would ignore. An issue's line items are therefore the FORM's line editor, not a detached list below a summary card. Pinned by `apps/tgapp/src/modules/goods-issues/data/edit.spec.ts` + `pages/outbound-detail-page.spec.tsx` + `components/outbound-doc-form.spec.tsx`.

## 4. Confirm the outbound — allocation + deduction

```bash
curl -X POST http://localhost:8788/api/mro/outbounds/<id>/confirm \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' -d '{}'
```

| Policy   | goods_issue                                                               | write_offs / defects_missing                     |
| -------- | ------------------------------------------------------------------------- | ------------------------------------------------ |
| standard | guarded balance `−qty`                                                    | same                                             |
| batch    | **FEFO** (nearest expiry first), **expired lots excluded**                | expired lots targeted first, then nearest expiry |
| serial   | `serials[]` must be `in_stock` at the location and not expired → `issued` | → `scrapped`                                     |

Allocation rows land in `mro_outbound_lots` / `mro_outbound_serials` (each linked to its outbound **line** for full provenance) — the trace a REVERSAL later reads, so cancelling a posted issue puts stock back into the exact lots and units it took (§5c), never into a fresh FEFO guess. An outbound line has **no batch restriction**: `mro_outbound_lines` carries no `batch_no`/`expiry_date` column, so the create/edit form offers no lot field and this FEFO rule is the only way a lot is chosen. Insufficient usable stock → `409 လက်ကျန် မလုံလောက်ပါ…`, the draft stays a draft, and no partial state survives (guards + reversal).

## 5. Reports

```bash
curl http://localhost:8788/api/mro/stock/onhand                 # per (model, location) + drift check
curl "http://localhost:8788/api/mro/stock/expiring?days=30"     # expired vs expiring lots/serials
```

`onhand` cross-checks the stored balance against `SUM(active lots)` / `COUNT(in_stock serials)` and flags `drift` when the generic-CRUD era's double-writes disagree. Each row also carries the operator-set `reorder_level` and a `below_reorder` flag (`reorder_level > 0` AND available ≤ it — available is the derived lot/serial total for tracked models, never a drifted balance).

`expiring` rows carry `days_left` (negative = already expired), `model_alert_days` (the model's `expiry_alert_days` policy) and `alert` (true when already expired, or within the model's window) — the per-item "act now" flag for the expiry alert list.

**Integrity reconciliation** — the admin-gated _"does the ledger agree with itself?"_ report:

```bash
curl http://localhost:8788/api/mro/stock/reconcile -H 'Authorization: Bearer <admin jwt>'
# → { rows: [{ check, collection, id, model, model_name, location, … }],
#     summary: { balance_drift, orphan_stock, snapshot_stale, total }, checked_at }
```

Three bounded checks (never a full-history scan): **balance_drift** (a balance row disagrees with its derived lot/serial total), **orphan_stock** (lot/serial stock with no balance row — stock the store cannot see), **snapshot_stale** (a serial's newest lifecycle event postdates its snapshot row — a partially-applied state change). Clean data ⇒ `summary.total === 0`, so a nightly job or a supervisor gates on a single number. Admin-only (`403` otherwise) because it exposes internal defects, not operational stock. `onhand` and `reconcile` read the **same** gather (`stockSnapshot`), so the two screens can never disagree about drift.

## 5b. Posted documents are immutable (F6)

A confirmed inbound / outbound / transfer / adjustment / requisition header declares `writes.freeze_when: { field: "doc_status", values: ["confirmed"] }`, so the generic entity API refuses any update / delete / restore once posted (`403`) — a posted GRN, goods issue or transfer can never be silently rewritten. Their child lines declare `writes.mode: "service"`, so document-owned lines are written only through the parent's `lines` field or the confirm service, never the generic line API. See [runtime policies](policies-operations.md#policy-shape).

The four **cancellable** families (`mro_inbounds`, `mro_outbounds`, `mro_transfers`, `mro_adjustments`) go one step further, because a cancelled stock document is a state with a stock effect behind it:

| Policy                             | Collections                                          | Effect                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `freeze_when … ["confirmed", "cancelled"]` | the four headers above                               | A **cancelled** stock document is final: update / delete / restore are refused (`403`). That closes the engine's generic `cancelled → draft` reopen, which would otherwise leave a document reading `draft`\/`confirmed` while still carrying `cancelled_at`\/`cancelled_by`, and would let a reversed posting be re-applied through the same number an auditor already saw reversed. |
| `frozen_fields: ["cancelled_at", "cancelled_by"]` | the same four headers                                | The cancel STAMP is service-written only — stripped from every generic write (create *and* update), so no client can forge *or clear* who ended a document and when.                                                                                                          |

A requisition keeps the plain `confirmed` freeze (its closure is `/reject`, a stock-free lifecycle change — see §8). The correction path for a cancelled document is a **NEW document** — that is the whole point of `cancelled` being frozen rather than reopened. Run `node scripts/apply-mro-schema.mjs` to lift the freeze onto an existing environment (it is a validated, idempotent `PUT /api/collections/:slug`). Pinned by `apps/api/test/mro-inventory.spec.ts` (`cancels a DRAFT …`).

## 5c. Cancelling a stock document — the ONE verb that reverses it

```bash
# END a document. Enforce the DOCUMENT's own state — never a caller flag.
curl -X POST http://localhost:8788/api/mro/inbounds/<id>/cancel      -H 'Authorization: Bearer dev-token'
curl -X POST http://localhost:8788/api/mro/outbounds/<id>/cancel     -H 'Authorization: Bearer <operator token>'
curl -X POST http://localhost:8788/api/mro/transfers/<id>/cancel     -H 'Authorization: Bearer <operator token>'
curl -X POST http://localhost:8788/api/mro/adjustments/<id>/cancel   -H 'Authorization: Bearer <operator token>'
# → 201 { inboundId, display_number, doc_status: "cancelled", reversed: true|false,
#          reversed_qty, cancelled_at, cancelled_by }
# → 201 { …, already: true, reversed: false }        # a replay: nothing was flipped
# → 409 <the reason>                                  # a reversal that cannot be honest
```

There is **one cancel route per family and no mode parameter**. The document decides:

| Document state | What `/cancel` does                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `draft`        | A pure lifecycle flip. A draft never moved stock, so there is nothing to reverse and the balance is untouched.                                          |
| `confirmed`    | **REVERSED** in the SAME atomic guarded batch that flips it to `cancelled` — the stock it moved comes back (below).                                     |
| `cancelled`    | An idempotent no-op (`already: true`) that answers with the document's REAL state — including the ORIGINAL `cancelled_at`\/`cancelled_by`, never re-stamped. |
| anything else  | `409` — the verb refuses a state these collections do not use rather than guessing which of the two paths applies.                                      |

Why ONE verb: a client that had to choose between “cancel my draft” and “reverse this posting” could choose wrong, and a wrong choice writes a conflict into the stock ledger. With one route, `cancelled` cannot mean two different things to two screens. Gated on `write` for the document's own collection, and `cancelled_by` is the SESSION's employee (`actorOf` — an admin may name one), so ending a document is never anonymous.

What a **reversal** undoes (per family, all inside the guarded batch — header flip **last**):

| Family        | Undone                                                                                                                                                                                                                                                        | Refused (409, nothing applied)                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inbounds`    | Each `(model, store)` balance back down by exactly what the receipt added · the **batch lot** the receipt created removed (only while untouched) · the **serial units** it created deleted with their own `purchased` event (only while still `in_stock` and carrying no other history) · the ledger entry the confirm itself filed withdrawn | Stock already issued (`qty_on_hand >= added` fails) · the received lot partly consumed · a received unit fitted\/checked\/moved on · a unit carrying another document's events · **a `return` inbound of serial units** (their prior holder is no longer recorded — re-issue from the store) · **money a person recorded** standing on the receipt |
| `outbounds`   | Each allocated **lot** back by the exact `qty` this issue took (an `empty` lot back to `active`) · each **serial unit** back to `in_stock` at that line's store with the whole holder seam cleared · the balances back up · the **source request's** `issued_qty`\/`requisition_status` recomputed WITHOUT this issue (never resurrecting a cancelled request) | A unit that has since been seated\/returned\/re-issued\/moved (its `status`, `location`, `vehicle`\/`employee` must still be exactly what this issue left) · a trace that does not account for the line exactly |
| `transfers`   | Each source **lot** gets back the exact `qty` this move took from it (an `empty` lot revived to `active`), and each **destination lot** comes down by the same `qty` — a destination lot the confirm CREATED is left inert at `0`, its identity (and expiry) preserved · moved **serial units** back to `in_stock` at the source store · the source balance back up \/ the destination balance back down · the trace rows + this move's OWN `store_transferred` events withdrawn | The destination stock already drawn on (409 — "clear the remainder before cancelling") · a unit no longer `in_stock` at the destination (it has moved on since the transfer) · a trace that does not account for the line exactly |
| `adjustments` | An `add` line's created **lot** taken back whole + the balance lowered · a `remove` line's FEFO takes put back into the EXACT lots they came from + the balance raised · removed **serial units** back to `in_stock` at the store · the confirm-written `expected_qty`\/`diff_qty` on each line cleared | The added lot already drawn on (a partly used lot is not ours to delete) · a unit no longer `scrapped`, or one since put in service · a trace that does not account for the line exactly |

Three properties make this safe to reach for:

1. **The reversal reads the confirm's own TRACE, never a re-derivation.** `mro_outbound_lots`\/`mro_outbound_serials`, `mro_adjustment_lots`\/`mro_adjustment_serials` and `mro_transfer_lots`\/`mro_transfer_serials` record which lot gave how much and which unit left (written in the confirm batch). Re-running FEFO today would put stock back into different lots than it came out of, and a re-derived serial pick could restore the wrong unit — so the trace is the single source of truth for a posted document's effect, and a trace that does not account for a line exactly is a `409` ("run the reconciliation report") rather than a guess.
2. **Guarded + all-or-nothing.** Every statement is guarded on the live state the confirm left and the header flip goes LAST, so a guard that loses after some writes landed rolls the WHOLE batch back (trace rows, events and all) and answers with the reason. A refusal is always *nothing changed* + *why* — never a half-reversed document.
3. **A reversal cannot reach money, and a reversal reads money first.** The ledger entry the CONFIRM filed for a `paid_at_receipt` draft carries `_meta = {"source":"paid_at_receipt"}` — provenance, so the un-post withdraws exactly ITS OWN entry while refusing (409) while any payment a PERSON recorded stands ("remove them first"). And, symmetrically, a **cancelled receipt takes no money**: a compiled `before_insert` guard on `mro_inbound_payments` refuses a payment whose parent is `cancelled`, on every writer (the payments route, Studio, the CLI, an import).

The cancel STAMP (`cancelled_at`, `cancelled_by` — both service-written, see §5b) is written in the flipping statement, so the audit fact and the reversal are one atomic write. The mini app mounts one shared hook for all four families (`apps/tgapp/src/shared/hooks/use-doc-cancel.ts` + `cancelCopyOf`, the one place the "nothing was moved" vs "the stock goes back" wording is derived) on every list card AND document page, and renders a `cancelled` document read-only with no actions at all.

Pinned by `apps/api/test/mro-inventory.spec.ts` (`document cancellation — ONE verb, the DOCUMENT decides`: draft flip + replay + forge-proof stamp + freeze, batch\/serial receipt reversal, the partly-consumed refusal and the ordered recovery, paid-at-receipt withdrawal vs a real payment refusal, the outbound reversal + request recompute + a closed request left closed, the truck-issue reversal and the moved-on refusal, the adjustment lot\/balance\/serial reversals + both refusals, the `submitted` refusal, the 401 and the cancelled-receipt payment refusal; and for transfers: the draft flip + replay + forge-proof stamp + freeze, the batch reversal with the revived source lot and the inert created destination lot, the serial reversal + the moved-on refusal, and the drawn-on destination refusal) + `apps/api/test/guarded-batch.spec.ts` (the rollback mirror is the exact opposite of its statement, both directions) + `apps/tgapp/src/shared/hooks/use-doc-cancel.spec.ts` + `apps/tgapp/src/modules/inbounds/components/inbound-purchase-card.spec.tsx` + `apps/tgapp/src/modules/inbounds/pages/inbound-detail-page.spec.tsx` + `apps/tgapp/src/modules/stock-moves/components/stock-move-card.spec.tsx`.

**Doc-level category read** — list inbound/outbound docs (headers, newest first) whose child lines include an item model classified under a category:

```bash
curl "http://localhost:8788/api/mro/documents/category?kind=inbounds&category=<mro_item_categories id>&location=main_store&type=purchase"
```

`category`/`location`/`type` are required; `kind` must be `inbounds` or `outbounds`. A document matches when at least one line's `mro_item_model` points (via its `item_name` part-group) at the category — the same model → part-group → category relation the stock page's filter uses. Rows are returned in the header card projection so clients reuse the same card renderer.

## 6. Transfer — location → location (`TRF-…`)

A transfer moves stock between two stores without consuming it. Draft it through the generic entity API, then confirm:

```bash
curl -X POST http://localhost:8788/api/entities/mro_transfers \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' -d '{
    "from_location": "main_store", "to_location": "admin_store",
    "transfer_date": "2026-09-04",
    "lines": [
      { "item_model": "<serial model id>", "qty": 1, "serials": ["TY-2026-0002"] },
      { "item_model": "<batch model id>", "qty": 3 },
      { "item_model": "<standard model id>", "qty": 50 }
    ]}'
curl -X POST http://localhost:8788/api/mro/transfers/<id>/confirm \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' -d '{}'
```

| Policy   | What confirm does                                                                                                                                                                                                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| standard | balance `−qty` at the source, `+qty` at the destination                                                                                                                                                                                                                                                               |
| batch    | **FEFO** allocation at the source (**expired lots stay put** — write them off where they sit); each take is merged into the destination lot with the same `(batch_no, expiry_date)` or re-created there, so **lot identity (and expiry) survives the move**; optional line `batch_no` restricts the move to one batch |
| serial   | the listed units must be `in_stock` at the source (and not expired) → their `location` flips                                                                                                                                                                                                                          |

`from_location == to_location` → 400; insufficient/expired-only source stock → 409 with no partial state. Lot/serial-level trace rows land in `mro_transfer_lots` / `mro_transfer_serials` (each `from_lot` → `to_lot` mapped).

A posted transfer is undone by the SAME cancel verb as the other stock documents — `POST /api/mro/transfers/<id>/cancel` — which reads its own trace and reverses it in one atomic batch (§5c): the source lots get their exact takes back, the destination lots come down by the same qty (a lot the confirm CREATED there is left inert at 0), the moved units return to the source store, both `(model, store)` balances are restored, and the trace rows plus this move's own `store_transferred` events are withdrawn. It REFUSES (409, nothing applied) while the destination has drawn on the moved stock or a unit has moved on since. `mro_transfers` therefore declares `cancelled_at`/`cancelled_by` (service-written) and `writes.freeze_when doc_status: ['confirmed', 'cancelled']` + `frozen_fields: ['cancelled_at', 'cancelled_by']`, so a cancelled move can be neither reopened nor re-stamped (§5b).

## 7. Adjustment — operator-reported stock correction (`AJT-…`)

An adjustment is the lightweight correction tool (the replacement for the retired physical-count stocktake). An **operator reports** a correction to a store — the current employee is recorded on `reported_by` (an **m2o to `hrm_employees`**), alongside `description` (the "why") — then a **different employee approves** it (`approved_by`, also an m2o to `hrm_employees`, set at confirm). Approving applies the signed per-line changes to the header location **in one atomic batch** and flips the document to `confirmed`. The confirmed document is the immutable audit record of what was applied, with each line storing the `expected_qty` it reconciled and the `diff_qty` delta it applied.

```bash
curl -X POST http://localhost:8788/api/entities/mro_adjustments \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' -d '{
    "location": "main_store", "adjustment_date": "2026-09-04",
    "description": "Found extra oil pallet + wrote off two scrap tyres",
    "reported_by": "<reporter hrm_employees.id>",
    "lines": [
      { "item_model": "<batch model id>", "direction": "add", "qty": 5,
        "batch_no": "OIL-2601", "expiry_date": "2027-03-03", "unit_cost": 12000 },
      { "item_model": "<serial model id>", "direction": "remove", "qty": 2,
        "serials": ["TY-2026-0001", "TY-2026-0003"] },
      { "item_model": "<standard model id>", "direction": "remove", "qty": 10 }
    ]}'
# → display_number "AJT-00001", doc_status "draft" — stock NOT changed yet

# A SEPARATE employee (≠ reporter) approves:
curl -X POST http://localhost:8788/api/mro/adjustments/<id>/confirm \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' -d '{
    "approved_by": "<approver hrm_employees.id>"
  }'
```

| Policy   | `direction: add`                                                                                  | `direction: remove`                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| standard | balance `+qty`                                                                                    | guarded balance `−qty`                                                                                     |
| batch    | new lot with the given `batch_no` (+ optional `expiry_date`, `unit_cost`) — requires a `batch_no` | written off **FEFO** (expired lots first)                                                                  |
| serial   | **refused** (400) — receive via an inbound instead                                                | the listed `serials` must be `in_stock` at the store → set `scrapped`; `serials[]` length must equal `qty` |

An adjustment line's lot identity is an **`add`-only** field. Only an `add` NAMES a lot — its `batch_no` is REQUIRED (a blank one is a 400, so the mini app's form blocks the save until it is typed, where the operator can still fix it) and optionally carries `expiry_date` / `unit_cost`. A `remove`'s `batch_no`/`expiry_date` are IGNORED outright: allocation takes FEFO and the lots it really used are recorded in `mro_adjustment_lots`, so the form shows the lot block for an `add` only and CLEARS it when a row switches to `remove` — rather than store a lot number the stock ledger never honoured.

The document page IS the form (`/app/adjustments/:id`, seeded by `fetchAdjustmentDocEditor`, editing only while `isAdjustmentEditable`; §3's rule), and its EDIT states `description: null` when the reason was emptied, re-states each line's `unit_cost`, and keys each seeded row on the row's OWN `mro_item_model` id (the cached directory only NAMES the SKU — a line whose SKU is missing from it is saved AS IT WAS, never dropped). It NEVER carries `reported_by`: the report's author is an `actor_fields` fact the update payload cannot express, so the form hides its `Reported by` section on an edit instead of claiming the current user filed somebody else's report. Pinned by `apps/tgapp/src/modules/adjustments/data/edit.spec.ts` + `pages/adjustment-detail-page.spec.tsx`.

The two-person rule is enforced server-side: confirming without an `approved_by` → 400, and an approver equal to `reported_by` → 409. Confirming a draft writes `expected_qty`/`diff_qty` back onto each line (the balance it corrected + the delta applied) and records `approved_by` (the approver's m2o id) on the header in the same guarded batch. Removal is guarded (if the balance moves between report and approval, confirm returns 409 and nothing changes); serial-add through an adjustment is rejected so every serial unit still arrives via a proper inbound.

The same batch also writes the **trace** that makes the correction reversible: `mro_adjustment_lots` (one row per lot an `add` line created or a `remove` line's FEFO take came from, with `direction` + `qty`) and `mro_adjustment_serials` (one row per unit a `remove` line took out of stock). Cancelling an APPROVED adjustment (§5c) reads exactly those rows to put stock back into the lots it came from — never a fresh FEFO guess, which would land in different lots — takes an added lot back only while it is whole, and un-scraps the units it removed. A trace that does not account for a line exactly is a 409 ("run the reconciliation report"), never a silent best-effort.

## 8. Requisition — request document, approve without touching stock (`REQ-…`)

A requisition is a **request document** (a workshop asks the store for tyres/oil/bolts). Drafting is the usual generic multi-line POST; approving (`confirm`) **never touches stock** — it validates the lines, writes the header totals and flips the document to `confirmed` (= approved). The approved requisition is the authority a later **goods-issue outbound** fulfils: stock moves only when that outbound is confirmed. The flow is _request → approve → issue_.

```bash
curl -X POST http://localhost:8788/api/entities/mro_requisitions \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' -d '{
    "request_date": "2026-09-04", "location": "main_store",
    "note": "Workshop weekly need",
    "lines": [
      { "item_model": "<serial model id>", "qty": 2 },
      { "item_model": "<batch model id>", "qty": 6 },
      { "item_model": "<standard model id>", "qty": 50 }
    ]}'
curl -X POST http://localhost:8788/api/mro/requisitions/<id>/confirm \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' -d '{}'
# → { requisitionId, display_number:"REQ-00001", doc_status:"confirmed", line_count:3, total_qty:58 }
```

Same rules as every other document: `draft` → `confirmed` is service-only (the engine's doc-status rules block generic writes from ever reaching it), `draft` → `cancelled` is a generic PUT, an already-approved replay is an idempotent no-op (`{ already: true }`), and a cancelled requisition cannot be approved (409).

### Asking twice in one day — the duplicate is a WARNING, not a refusal

A compiled guard refuses a requisition whose basket (the same `item_model` ids with the same quantities, order-insensitive) the **same requester already filed for the same `request_date`** — `mro_requisitions` cannot express that declaratively, so it runs as a `before_insert` hook on the entity-pipeline spine and therefore covers every create path (mini app, Studio, CLI, import). A `cancelled` request frees the basket again, soft-deleted rows never block, and a request with no recorded requester is never blocked.

Filing the same basket twice is occasionally deliberate (a split delivery the store only partly issued), so the guard is **soft**: the form asks first, the user confirms, and the create then carries the confirmation.

```bash
# 1) PRE-FLIGHT — the guard's own verdict for a basket (read-only; the actor is the session)
curl -X POST http://localhost:8788/api/mro/requisitions/check-duplicate \
  -H 'Authorization: Bearer <jwt>' -H 'Content-Type: application/json' -d '{
    "request_date": "2026-09-04", "lines": [{ "item_model": "<model id>", "qty": 4 }] }'
# → { duplicate:true, message:"An identical requisition … today.", display_number:"REQ-00002",
#     ack:"requisition-duplicate" }   # duplicate:false ⇒ message/display_number/ack are null

# 2) FILE ANYWAY — return the `ack` token the pre-flight handed out
curl -X POST http://localhost:8788/api/entities/mro_requisitions \
  -H 'Authorization: Bearer <jwt>' -H 'Content-Type: application/json' \
  -H 'X-Write-Ack: requisition-duplicate' -d '{ …the same request… }'
# → 201 (the repeat request is filed). Without the header → 400 VALIDATION_ERROR + the message.
```

The acknowledgement is **request metadata, never record data** — it rides on the request and never reaches the row (see `apps/api/src/lib/write-ack.ts`). Deny-by-default is preserved: every unconfirmed path is still refused with the same 400, and the token is scoped to the guard that names it. Reading the verdict goes through the SAME function the guard uses, so a "no duplicate" answer can never be contradicted by the create. Pinned by `apps/api/test/mro-inventory.spec.ts` (+ `apps/api/test/write-ack.spec.ts`, `packages/sdk/test/items.test.ts`).

## 8b. Asset holder — who/where holds a physical asset unit

An item name flagged `assets: true` (a tyre, a jack, a toolbox) is tracked one unit per row in `mro_stock_serials`. **The holder is DERIVED, never stored as its own column:** `employee` ? a person : `vehicle` ? a truck (with an optional wheel `slot`) : a store. An `assets`-flagged unit can never be both vehicle-bound and person-bound, and a `slot` requires a vehicle — the writers enforce this and a unit's history (`mro_serial_events`) records every holder change.

```bash
# ONE holder's whole register — tyres AND assets, display-ready (no client joins).
curl 'http://localhost:8788/api/mro/assets/holder?vehicle=<veh_fleets id>'   -H 'Authorization: Bearer dev-token'
curl 'http://localhost:8788/api/mro/assets/holder?employee=<hrm_employees id>' -H 'Authorization: Bearer dev-token'
# → { rows: [{ id, serial_no, kind:'tyre'|'asset', model, model_name, item_name_en, item_name_mm,
#              vehicle, plate_no, slot, employee, employee_name, location, tread_mm, psi, condition, … }],
#     holder: { vehicle, employee } }   # omit both query params for every held asset (fleet-wide)

# Move an ALREADY-ISSUED unit's WHEEL POSITION on the truck that already holds it
# (a rotation / re-seat — the truck does not change, so the HOLDER does not change).
curl -X POST http://localhost:8788/api/mro/serials/<id>/move \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{ "to_vehicle": "<same veh id>", "to_slot": "drive-l", "actor_id": "<employee id>" }'

# Issue an in-store / loose unit into an EMPLOYEE's custody (deducts the store balance):
curl -X POST http://localhost:8788/api/mro/serials/<id>/issue \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{ "to_employee": "<employee id>", "actor_id": "<employee id>" }'

# Cross-truck device lifecycle (unchanged routes): /fit /unseat /return /scrap /swap /check /events
```

`/fit` seats an in-store or spare unit onto a vacant wheel (or, with no `to_slot`, stages it as that truck's standby spare); `/unseat` takes a seated unit off the wheel and keeps it on the same truck; `/scrap` writes it off where it sits; `/swap` exchanges two seated tyres **on the same truck** (a rotation). `/check` records a real `tread_mm` / `psi` / `condition` reading — a `tread_mm` past the SKU's declared `mro_item_model.reference_tread_mm` (its depth when NEW) is a `400` that writes nothing, since a tyre is never thicker than brand new; the reading equal to the baseline is legal (the ceiling is inclusive), and a SKU with no baseline has no ceiling. That ceiling is enforced **here**, not only in the kiosk form, so the generic API cannot write an impossible reading either. Every one is a single guarded `db.batch()` — a lost guard reverses the whole batch (event included) and answers `409`.

### Which holder changes are DIRECT, and which are GOVERNED

A `mro_stock_serials` unit's **holder** is what the approval gate protects, so the writers ask one question (`assertCustodyChangeAllowed`, `inventory.ts`): _does this write move the unit from one holder to a DIFFERENT holder?_

| From → to                              | Path                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| store → truck wheel (`/fit`)           | **direct**                                                                           |
| store → employee (`/issue`)            | **direct**                                                                           |
| same truck, another seat (`/move`)     | **direct** (a rotation keeps the holder)                                             |
| truck A → truck B                      | **request** — `ATR` (§8c), exec via `returnSerialToStore`/`moveSerialAsset`          |
| employee A → employee B                | **request** — `ATR` (§8c)                                                            |
| truck / employee → store (`/return`)   | **request** — `ATR` (§8c) with `to_location`, execute = the return                   |
| truck / employee → scrapped (`/scrap`) | **request** — `ATR` (§8c) with `write_off` + NO destination, execute = the write-off |
| truck ↔ employee                       | **refused on EVERY path** (`403`) — return to store, then issue                      |

So the direct `/move`, `/return` and `/scrap` routes answer `403` on a governed shape — e.g. `TY_13 is changing holder — file a transfer request and have a superior approve it before moving it`, for a return `… file a return request and have a superior approve it before sending it back to store`, or for a write-off `… is written off through an approved write-off request — file one and have a superior approve it before scrapping it`. **An admin does NOT bypass this**: `authorizedBy` is passed by the service's own caller (`AUTHORIZED_BY_ASSET_REQUEST`), never read from a request body, so the RBAC admin bypass cannot reach it. `mro_stock_serials` is `writes.mode: 'service'`, which is what makes the guard airtight — the generic entity API cannot write the table even as admin.

A **return** is expressed by filing the SAME `mro_asset_requests` table with `to_location` set instead of `to_vehicle`/`to_employee`, and a **write-off** by filing it with `write_off` and NO destination at all — the request's KIND is derived from its own shape rather than stored as a mode flag, so one table (and one execute) serves all three governed shapes:

```bash
# FILE a return request (holder → store). to_location is what makes it a return.
curl -X POST http://localhost:8788/api/entities/mro_asset_requests \
  -H 'Authorization: Bearer <requester jwt>' -H 'Content-Type: application/json' -d '{
    "serial": "<mro_stock_serials id>",
    "from_vehicle": "<veh_fleets id>", "from_slot": "drive-l",
    "to_location": "main_store", "reason": "spare after road change" }'
# approve → execute exactly as in §8c; the execute performs the unmount + store credit.
```

A **write-off** (scrap) is the third shape: FILE the same table with `write_off: true` and **no destination** (the compiled `mro-asset-request-kind-guard` refuses a row that carries both). A worn-out unit is therefore retired by an approved request rather than by whoever noticed it — the execute performs the `issued → scrapped` flip, clears the seat + holder, and appends ONE `written_off` event tagged `ref_kind='ATR'` + the request number:

```bash
# FILE a write-off request — the flag IS the kind; every destination stays null.
curl -X POST http://localhost:8788/api/entities/mro_asset_requests \
  -H 'Authorization: Bearer <requester jwt>' -H 'Content-Type: application/json' -d '{
    "serial": "<mro_stock_serials id>",
    "from_vehicle": "<veh_fleets id>", "from_slot": "drive-l",
    "write_off": true, "note": "sidewall cut — beyond repair" }'
# approve → execute exactly as in §8c; the execute scraps the unit where it sits
# (no store balance moves — an issued unit is already out of every store's stock).
```

## 8c. Asset transfer request — approve _before_ a move (`ATR-…`)

A truck→truck (or person→person) asset move, **any return to store**, and **any write-off**, is a **governed transfer**, not a direct write: it is **filed** as a request, **decided** by a recorded superior of the requester, then **executed** as one atomic change. This is the approval gate the raw `/serials/:id/move`, `/return` and `/scrap` routes now **require** — those routes `403` on a governed shape (§8b), so `ATR` is the only two-person path and no longer merely an alternative one.

ONE table serves all three governed shapes, and the kind is DERIVED from the row itself, so there is no mode flag to drift from it: `write_off` set is a **WRITE-OFF** (every destination null — the unit is scrapped where it sits); `to_location` set is a **RETURN** (holder → store); `to_vehicle`/`to_employee` is a **TRANSFER**.

| Step    | Who                 | Endpoint                                                | Effect                                                                                                      |
| ------- | ------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| File    | the requester       | `POST /api/entities/mro_asset_requests` (generic)       | numbers `ATR-…`, `status="requested"`; **no stock/holder change**                                           |
| Track   | any decider         | `GET /api/mro/asset-requests[?status=&search=&cursor=]` | the **approver-scoped** feed (admin = all; otherwise the requester's recorded superiors), newest first      |
| Decide  | a recorded superior | `POST /api/mro/asset-requests/:id/approve` \| `/reject` | `status` → `approved`/`rejected`, stamps `approved_by` + `approved_at` / `rejected_reason`; still no change |
| Execute | the store/approver  | `POST /api/mro/asset-requests/:id/execute`              | the move **or the return or the write-off** **and** `status → executed` commit in ONE guarded batch         |

> **Not every truck→truck move needs a request.** The two shapes differ: a **wheel-position** change on the SAME truck is a rotation and stays direct. A **transfer** — the unit changing which truck or person holds it — is what `ATR` gates, and it moves the unit into the destination truck's **inventory tray** (no `to_slot`): the receiving truck wears it later from its own fitment picker. Truck ↔ person is offered by NEITHER shape: return to store first, then issue.

```bash
# 1) FILE (as the requester — requested_by is stamped from the signed session)
curl -X POST http://localhost:8788/api/entities/mro_asset_requests \
  -H 'Authorization: Bearer <requester jwt>' -H 'Content-Type: application/json' -d '{
    "serial": "<mro_stock_serials id>",
    "from_vehicle": "<veh_fleets id>", "from_slot": "drive-l",
    "to_vehicle": "<veh_fleets id>", "to_slot": "drive-l" }'
# → { id, display_number:"ATR-00001", status:"requested", requested_by:"<session employee>" }

# 2) DECIDE (as the superior — actor comes from the session, not the body)
curl -X POST http://localhost:8788/api/mro/asset-requests/<id>/approve -H 'Authorization: Bearer <superior jwt>'
curl -X POST http://localhost:8788/api/mro/asset-requests/<id>/reject  -H 'Authorization: Bearer <superior jwt>' \
  -H 'Content-Type: application/json' -d '{ "reason": "no spare at destination" }'

# 3) EXECUTE — pinned to the recorded source, event tagged ref_kind='ATR' + ATR-…
curl -X POST http://localhost:8788/api/mro/asset-requests/<id>/execute -H 'Authorization: Bearer <superior jwt>'

# 4) TRACK — the decide queue (default), the tracking view, or one term across all
curl 'http://localhost:8788/api/mro/asset-requests?status=requested' -H 'Authorization: Bearer <superior jwt>'
curl 'http://localhost:8788/api/mro/asset-requests?status=approved,executed' -H 'Authorization: Bearer <superior jwt>'
curl 'http://localhost:8788/api/mro/asset-requests?status=approved,executed&search=ATR-TY-1' -H 'Authorization: Bearer <superior jwt>'
# → { rows:[{ id, display_number, status, serial_no, from_plate, to_plate, requested_by_name, … }], nextCursor:null }
```

`GET /api/mro/asset-requests` is the **display-ready** feed the tgapp Approval center reads: every m2o (serial / both plates / both custodians / requester / decider) is resolved server-side, `status` accepts a comma list (the `approved` chip folds in `executed`), `search` matches the doc number / serial / either plate / requester name (LIKE-escaped), and the keyset cursor pages newest-first. **Its scope is the SAME rule the decide routes enforce** — so the feed can never offer a request the decision would then `403` on; a session with no recorded reporting line gets an empty feed rather than an error.

Guard rails (all server-enforced, all `409` unless noted):

- **Two-person + reporting line.** The decider must differ from `requested_by` and — unless an admin — be a recorded superior in `hrm_employee_links` (non-superior → `403`). The actor is resolved from the **signed session** (`actorOf`), so a body `actor_id` cannot impersonate anyone.
- **Frozen workflow columns.** `mro_asset_requests` declares `writes.frozen_fields: [status, approved_by, approved_at, rejected_reason, executed_at]`, so neither the filing POST nor a generic PUT can forge a decision — the fields are stripped and the request can only advance through the service. `requested_by` is `actor_fields`-stamped.
- **Race-free execute.** The move is pinned to the request's recorded origin (`expectFrom`): a unit that moved elsewhere between approval and execution is refused, never silently relocated from its new seat. `status='approved'` is a compare-and-set, so a replay is a `409` and can never double-move.
- **A wheel position is optional.** `to_vehicle` with no `to_slot` executes as a move into that truck's **inventory** (a standby spare, `slot` null), to be worn later from the truck's own fitment picker — the shape the tgapp filer always files.
- One request targets **one** serial; approve/reject touch no stock.
- **tgapp surface.** The Approval center (`/app/approval`) has a **Transfers** tab backed by this feed: a superior approves/rejects in the reason sheet, then executes behind a confirmation sheet; a holder files a request from the unit's own action menu (`Request a transfer`), which opens its own full-screen filer page. The filer names a **destination TRUCK, not a wheel position** — `to_slot` is always null, so the unit (a tyre included) joins that truck's inventory and is worn later from that truck's own fitment picker — and a person is not offered at all: a governed move is truck-to-truck. The truck is picked from a searchable sheet fed the pure rule (`apps/tgapp/src/modules/tyres/data/transfer-targets.ts`, pinned by its spec): a **tyre** may target wheel-capable trucks only, an **asset** (a jack, a toolbox…) any plated truck. Either way the truck already holding the unit is excluded — with no position to pick, naming it is the no-op the engine rejects. The tab mounts the same session identity the API checks, so the UI can only offer what the caller may actually decide.

## 9. Schema & rollout

Single source of truth: `apps/api/src/domain-modules/mro/schema-defs.json` (v1, development — self-bootstrapping: catalog masters + base + movement + transfer/adjustment + requisition + asset-request collections). Apply through the validated API — never raw SQL. The script creates the catalog master (`mro_item_name`) when missing and **syncs newly declared fields onto an already-existing `mro_item_model`** (e.g. the `item_name` classification field and the bilingual `name_en`/`name_mm` pair — nullable on the sync path, so populated live tables migrate safely and existing rows are backfilled per item). Because the sync step only ADDs, the retired `mro_item_model.name`/`model` columns are DROPPED (after backfilling `name_en`) by the paired one-off `scripts/migrate-mro-model-names.mjs`:

```bash
node scripts/apply-mro-schema.mjs                  # dev (localhost:8788, dev-token)
node scripts/apply-mro-schema.mjs <url> <jwt>      # prod
```

Because the field sync only ADDs, a field made **NOT NULL** later needs a paired one-off as well: `mro_item_name.name_en` → `scripts/migrate-mro-item-name-required.mjs`, and `mro_item_name.tracking` → `scripts/migrate-mro-item-name-tracking-required.mjs`. The latter keeps `"default": "standard"`, so the **column** is NOT NULL while the **field stays optional on the wire** (the engine skips the required check for any field with a default — a create that omits `tracking` gets `standard`). Both are idempotent no-ops on a fresh environment (which creates the columns NOT NULL from the definition) and refuse to run while any row — including trashed ones, since NOT NULL is applied by a `CREATE → COPY → DROP → RENAME` rebuild — carries a NULL/empty value.

A field **added later, and made required per-kind** (the inbound counterparty: `handed_by`) needs a paired applier too: `scripts/apply-mro-inbound-handoff-remote.mjs` (dry-run by default, `--apply` to write). It targets the Cloudflare D1 directly through the ops credential (`scripts/lib/cf-token.mjs`) for an environment where no production admin JWT is available, and it does only what the validated PUT would do there: one `ADD COLUMN handed_by TEXT` plus the declared `required`/`validation` merge into `_entity_schemas.schema_json` with the `_schema_version` bump. It **refuses** (writing nothing) when the physical `supplier` column is still NOT NULL, because relaxing nullability is a table rebuild that only the engine's migrator may perform — use `apply-mro-schema.mjs <url> <admin jwt>` in that case.

```bash
node scripts/apply-mro-inbound-handoff-remote.mjs           # dry run (reports the exact changes)
node scripts/apply-mro-inbound-handoff-remote.mjs --apply   # writes to infra/env.prod's D1
```

Idempotent; recreates legacy single-line headers only when empty, rebuilds headers created without `naming_series` (empty only), and **removes stale legacy tables when empty** — including the misspelled `mro_requesations` placeholder and the retired stocktake family `mro_stocktakes`\/`mro_stocktake_lines` (declared in `removeCollections`). `DOMAIN_MODULES` must include `mro` — `apps/api/wrangler.jsonc` now ships `"hr,store,mro"` for production. Catalog seed, stock reset and the end-to-end smoke tests:

```bash
node scripts/seed-mro-catalog.mjs --apply             # item names + their tracking policies + SKUs
node scripts/reset-mro-stock.mjs --apply              # blank the stock screens (KEEP the item masters)
node scripts/smoke-mro-lifecycle.mjs                  # e2e: purchase → use → write-off → return, all 3 policies
node scripts/smoke-store-request-issue.mjs            # e2e: request → approve → partial/full issue → write-off
node scripts/smoke-mro-assets.mjs                     # e2e: purchase → seat → spare → employee custody → move → write-off

pnpm smoke:mro                                        # all three smokes in one shot (API must be up on :8788)
```

Both smoke scripts are **self-seeding** — they create the stock they need with a real purchase document, so they pass on a blank instance, and every assertion is a delta. They mutate live data (real INB-/OUT- documents + balances); `reset-mro-stock.mjs --apply` blanks it again. `seed-mro-demo.mjs` (and the other pre-rework stock seeds) is SUPERSEDED and refuses to run — see `scripts/lib/superseded-seed.mjs`.

### Composite indexes (why the reads are seeks, not scans)

Movement tables are written by the services and read on a handful of hot, always-identical predicates (confirm a document, allocate a lot FEFO, show a serial's lifecycle, sum the on-hand report). D1's only broadly usable index was the engine's `(deleted_at, id)` pagination index, so `EXPLAIN QUERY PLAN` showed **`SEARCH … USING INDEX idx_*_deleted_id` = scan every non-deleted row** plus a `TEMP B-TREE` for every `ORDER BY`/`GROUP BY`. The fix is declarative: each collection in `schema-defs.json` carries a `composite_indexes` array (the schema SSOT), `apply-mro-schema.mjs` step **3b** issues a composite-only `PUT /api/collections/:slug` (the engine's validated DDL path — `EntityMigrator` diffs the declaration against the table and creates only the **missing** indexes), and a **fresh** environment gets them at `CREATE TABLE` time via `createCollection`, so 3b is a no-op there. The step is idempotent: a re-run logs `skip index <slug> (N declared)` and writes nothing.

| Collection                                                                                                           | Composite index (columns)                  | Serves                                                                                             |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `mro_inventory`                                                                                                      | `(model, location)`                        | confirm lookups, items `GROUP BY model`, stock search `filter[model][_in]`                         |
| `mro_stock_lots`                                                                                                     | `(model, location, status, expiry_date)`   | FEFO allocation + lot identity `(batch_no, expiry_date)`                                           |
| `mro_stock_lots`                                                                                                     | `(status, model, location, remaining_qty)` | on-hand drift sum — **covering**, index-only scan in key order                                     |
| `mro_stock_serials`                                                                                                  | `(status, model, location)`                | serial drift sum — **covering**                                                                    |
| `mro_stock_serials`                                                                                                  | `(vehicle, status, slot)`                  | one truck's holder register (seated tyres, spares, assets) — `GET /api/mro/assets/holder?vehicle=` |
| `mro_stock_serials`                                                                                                  | `(employee, status)`                       | one employee's held assets — `GET /api/mro/assets/holder?employee=`                                |
| `mro_serial_events`                                                                                                  | `(serial, created_at, id)`                 | a serial's lifecycle history, newest first (also satisfies the `ORDER BY`)                         |
| `mro_inbound_lines` · `mro_outbound_lines` · `mro_transfer_lines` · `mro_adjustment_lines` · `mro_requisition_lines` | `(parent_id, id)`                          | every detail screen **and** every confirm reads the children by parent                             |
| `mro_outbound_lots` · `mro_outbound_serials`                                                                         | `(outbound_id, outbound_line)`             | provenance junctions (written by confirm, read by the reversal — §5c)                              |
| `mro_transfer_lots` · `mro_transfer_serials`                                                                         | `(transfer_id, transfer_line)`             | provenance junctions                                                                               |
| `mro_adjustment_lots` · `mro_adjustment_serials`                                                                     | `(adjustment_id, adjustment_line)`         | provenance junctions (written by approve, read by the reversal — §5c)                              |
| `mro_inbounds` · `mro_outbounds`                                                                                     | `(type, location, created_at)`             | document lists (eq `type`+`location`, then newest-first)                                           |
| `mro_inbounds` · `mro_outbounds` · `mro_transfers` · `mro_adjustments`                                               | `(doc_status, created_at)`                 | the draft/confirmed/cancelled board — status filter then newest-first, without a scan              |
| `mro_requisitions`                                                                                                   | `(requisition_status, created_at)`         | the requisition board (`requested → approved → …`) filtered by lifecycle status                    |
| `mro_requisitions`                                                                                                   | `(vehicle, created_at)`                    | one vehicle's requisition history                                                                  |
| `mro_stock_lots`                                                                                                     | `(status, expiry_date, remaining_qty)`     | the expiring-soon sweep — range seek already in expiry order                                       |
| `mro_stock_serials`                                                                                                  | `(status, expiry_date)`                    | the expiring-soon sweep                                                                            |
| `mro_item_model`                                                                                                     | `(item_name, deleted_at)`                  | group → its live SKUs (movement groups, catalog groups, group line feed)                           |
| `mro_inbound_lines` · `mro_outbound_lines` · `mro_transfer_lines`                                                    | `(item_model, deleted_at)`                 | a single model's movement ledger — branches seek the line table by model                           |

Query SHAPING is the other half of the fix — an index only helps if the SQL can reach it:

- `allocateLots` dropped its SQL `ORDER BY created_at ASC, id ASC`: the FEFO re-sort that follows is a **total** order (`score → expiry_date → created_at → id`, and `id` is unique), so the DB row order was discarded anyway. Removing it removed the last `TEMP B-TREE FOR ORDER BY`.
- `expiringStock` reads each model's name + alert window through a `LEFT JOIN` (one seek per model, shared across its rows) instead of **two correlated scalar subqueries evaluated per row**, and both sweeps are covered by `(status, expiry_date[, remaining_qty])`.
- The movement `UNION ALL` (`movementUnion`) takes an optional `branchCond` pushed **into** every branch, so a single-model ledger seeks `item_model` instead of materialising the whole movement history and filtering after the union; the group screens push their `IN (group's live models)`. `movementGroups` uses `WITH moving AS **MATERIALIZED**` so its model set is computed **once** instead of re-running the whole union per group row.
- The single-model ledger page and the group line feed share ONE `movementRowsPage` helper (one projection + one `movementAggRowOf` mapper) instead of two near-duplicate SQL blocks.

A `TEMP B-TREE` still appears where the sort key spans a joined table or is genuinely needed (`onHand`'s `ORDER BY location, model name`; the movement feed's `ORDER BY date DESC`), but each such sort is over a page-limited or bounded set. Reads that already have a single-column index (`mro_stock_lots (batch_no)`, `mro_stock_serials (serial_no)`, catalog `(name_en)`) get no composite.

### Write locks (service-only / append-only)

The stock trace and ledger tables have exactly **one** legitimate writer: the confirm services. That was a comment, not an invariant, so a generic `PUT /api/entities/mro_stock_serials/:id` could move live state with **no** matching `mro_serial_events` row (and, because admins bypass the RBAC guard, it was reachable by any admin token). The fix is declarative and generic — a collection-level `policies.writes` in `schema-defs.json`, applied by `apply-mro-schema.mjs` step **3c** via a partial-merge `PUT /api/collections/:slug` and at `CREATE TABLE` time on a fresh env:

| Policy                     | Collections                                                                                                          | Effect                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `writes.mode: "service"`   | `mro_stock_lots`, `mro_stock_serials`, `mro_outbound_lots/serials`, `mro_transfer_lots/serials`, `mro_adjustment_lots/serials`, `mro_serial_events` | The generic entity API rejects create / update / soft-delete / restore / hard-delete (403). The service writes through D1 directly and is unaffected. |
| `writes.append_only: true` | the trace/ledger tables above (`*_lots`, `*_serials`, `mro_serial_events`)                                           | Rows are immutable history: update + delete + restore are rejected outright (rows may only be inserted).                                              |

The engine seam is `ItemMutationService.assertGenericWrite` — it runs on the already-cached schema before any row read, so the lock costs **zero** extra D1 reads per write, and it closes the RBAC admin bypass at the same time (the check is inside the service, not in `businessGuard`). It is a generic factory capability, not MRO code: any collection can declare it.

`writes` is a first-class policy feature, so `GET /api/collections/:slug/policies/features` advertises it and `PUT/DELETE /api/collections/:slug/policies` (admin-only) validates and manages it — never hand-edit `schema_json`.

### Identity binding (who did it, un-forgeable)

Every MRO route records the acting employee in the lifecycle event / document (`by_user`, `approved_by`, `issued_by`) and the two-person rule compares the approver against the reporter. That was only as strong as the client — `actor_id` / `approved_by` came from the request body, so an operator could attribute a move to someone else (F4) or name a victim as the reporter and self-approve (F3). Two changes close it:

1. **The session carries the employee.** The signed JWT embeds `employee_id` (the `hrm_employees` row) at Telegram login — see `docs/backend-api/authentication.md` §JWT Details. The MRO routes resolve the actor with `actorOf(c, body?.… )`: the token's `employee_id` always wins; only an admin (the trusted root, and the dev-token path) may name another actor explicitly. A non-admin's body value is ignored.
2. **Creator-attribution fields are engine-stamped.** A collection may declare `policies.actor_fields` (e.g. `mro_adjustments` / `mro_transfers` → `["reported_by"]`, `mro_requisitions` → `["requested_by"]`). On create the engine overwrites those fields with the session employee; on update a non-admin cannot reassign them. So the reporter is never forgeable, and `approver != reporter` actually means two people.

Both are generic factory capabilities (`ItemMutationService.bindActorFields` / `actorOf`), not MRO code, and both keep the admin escape hatch for recording on an operator's behalf. The dev-token path (admin, no `employee_id`) is therefore unchanged for tests and local workflows.

## Notes / deliberate choices

- **No engine formula columns on movement collections** — stored formulas only recompute on engine writes, and stock rows/confirm transitions are service-written, so such columns would silently stay `NULL`. Header totals are plain columns written by the confirm batch (single authoritative writer). Balance/allocation logic is service SQL — correctness never depends on formula evaluation. Read cost is instead addressed with declared composite indexes on the hot filter/join columns (see §9).
- Serial numbers are globally unique forever (an `issued` or `scrapped` serial cannot be re-received; only `return` re-instocks an `issued` unit).
- Confirmed documents are immutable **for the stock trace**: the balance/serial/lot/ledger tables are locked to the confirm services (`policies.writes` — see §Composite indexes), so history can only be appended, never mutated through the generic API. Correct a confirmed inbound with a `return`/write-off document, move stock with a `transfer`, and fix the balance with an `adjustment` — never by editing history. The document's own HEADER is frozen too (`writes.freeze_when` on `confirmed`), and for the three cancellable families a CANCELLED one stays frozen — so a posted document is never rewritten and a reversed one is never reopened: the correction path is always a NEW document, or the `/cancel` reversal (§5c).
- **A posted document is undone by cancelling it, never by editing it** — `POST /api/mro/{inbounds|outbounds|adjustments}/:id/cancel` reverses the stock effect from the document's own trace in one atomic batch (§5c). A reversal that cannot be honest — partly consumed stock, a unit that has since moved on, money recorded against a receipt — is refused with the reason, and the document stays posted. There is no “reopen a reversed posting” path: an auditor reading the header always sees one truth, and a replacement is a new document.
- **A serial's lifecycle is COMPLETE, never windowed** — `GET /api/mro/serials/:id/events` returns **every** event for that unit. The `(serial, created_at, id)` index covers the `serial = ?` range seek, so there is no `LIMIT` and no silent truncation (the earlier hard cap dropped the oldest events of a long-lived tyre). Display JOINs resolve only **live** masters (`deleted_at IS NULL`) — the same visibility rule every other read uses — so a soft-deleted master's plate/name is never surfaced.
- **…and every row carries its EFFECTIVE date, resolved by the read** — `event_date` on the way out is the day the transition TOOK EFFECT, derived in ONE SQL expression used by both the projection and the `ORDER BY` (so a row can never sort by one day while displaying another): the day the WRITER stored (an operator's back-dated wear for a fit/un-seat), else the governing DOCUMENT's own date through the same `ref_doc` ↔ `display_number` joins the approver uses — `mro_inbounds.purchase_date`, `mro_outbounds.effective_date`, `mro_transfers.transfer_date`, `mro_adjustments.adjustment_date` — else the day the row was recorded (a kiosk chore, an inspection, an ATR execution). Stock bought in June and booked in today reads and sorts as **June**, never as the session's clock, and the field is never null. Nothing is stored or backfilled: the derivation lives in the read, so rows confirmed before the rule existed gain the right date too. The wide sort key means the new ordering is a sort of the ONE unit's rows (bounded by its own history), not an index-ordered scan.
- Transfers never move expired stock (write it off where it sits); batch lot identity `(batch_no, expiry_date)` is preserved across a transfer by merging into the matching destination lot.
- Adjustments are signed and two-person by design: one employee **reports** the correction and a **different** one must **approve** it before any stock changes (server-enforced), which is the control point for physical stock corrections without a physical count.
- The retired stocktake family (`mro_stocktakes`\/`mro_stocktake_lines`, `STK-…`) was removed and replaced by the lean adjustment flow — a correction is now an explicit signed `add`/`remove` per line, approved by a second person, not a full shelf-count reconciliation. Serial units are never _added_ by adjustment (they must arrive via an inbound); they are only removed by listing exact serials.
- `mro_requesations` was removed during development: a misspelled, empty, unreferenced placeholder whose m2o fields pointed at a non-existent `employees` collection. It was never a real requisition flow — if one is added it should be designed properly (a draft → confirm document, like the other document families) — not resurrected as-is.
