# Custody transfer approval gate — design

Date: 2026-09-20
Status: approved (design), implementation in progress
Area: MRO asset custody (`apps/api/src/domain-modules/mro`), tgapp tyres/asset-transfers

## Problem

An asset unit (`mro_stock_serials`) is held by exactly one place: a **vehicle**
(+ wheel `slot`), an **employee**, or a **store**. The holder is DERIVED on read
(`employee ? person : vehicle ? truck : store`), never stored — so it cannot drift.

The engine already ships a governed transfer path (`mro_asset_requests`, `ATR-…`:
file → superior approves → execute), but it is **optional**. Three direct writers
still move a unit between holders with no approval at all:

| Surface                                            | What it does today                                     |
| -------------------------------------------------- | ------------------------------------------------------ |
| `moveSerialAsset` (`POST /serials/:id/move`)       | cross-truck **refit**, truck→person, **person→person** |
| `returnSerialToStore` (`POST /serials/:id/return`) | holder → store                                         |
| `fitSerialToSeat`                                  | already refuses cross-truck + person-held              |

So "the operator should not be able to hand a unit to someone else on their own"
is not actually enforced — the governed route is one of several.

## Rule (MECE, deny-by-default)

Derive both sides as a holder key — `e:<employee>` · `v:<vehicle>` · `null` (store):

| #   | Move                                                                | Holder change | Path                |
| --- | ------------------------------------------------------------------- | ------------- | ------------------- |
| 1   | same truck: seat↔seat / tray↔seat (rotate, unseat, own spare, swap) | none          | direct              |
| 2   | store → truck wheel (`/fit`)                                        | store→truck   | direct              |
| 3   | store → employee (`/issue`)                                         | store→emp     | direct              |
| 4   | inspect (`/check`) · scrap                                          | none          | direct              |
| 5   | **employee A → employee B**                                         | emp→emp       | **ATR request**     |
| 6   | **truck A → truck B**                                               | veh→veh       | **ATR request**     |
| 7   | **truck / employee → store**                                        | veh/emp→store | **Return request**  |
| 8   | truck ↔ employee                                                    | —             | **refused, always** |

Rule 8 has one workaround, and it is deliberate: return the unit to store
(rule 7, approved), then issue it from store to the person (rule 3, direct).
A truck's spare can therefore never be handed straight to a person.

Store-side operations stay direct because store→holder already has its own
document gate (`mro_requisitions` → `mro_outbounds` confirm) — this design does
not touch it (YAGNI).

Scrap stays direct (an owner decision, not a custody change). Flagged: it could
become a request later.

## Architecture

### One request table (SSOT)

`mro_asset_requests` gains one optional field, **`to_location`** (a
`LOCATION_OPTIONS` select). A request's KIND is derived from its from/to pair:

- `to_location` set → a **return request** (holder → store)
- `to_vehicle` / `to_employee` set → a **transfer request** (holder → holder)

One table ⇒ one approval machinery, one approver feed, one Approvals tab. No
second document family is introduced.

### One guard, in the service

`mro_stock_serials` declares `writes.mode: 'service'`, so the generic entity API
(and therefore an RBAC admin bypass) can never write a unit. Enforcing inside the
service is therefore airtight.

- `moveSerialAsset` gains `authorizedBy?: 'asset_request' | null`.
  - **rule 8** (truck↔employee) → `403` **unconditionally** (it is a property of
    the move's shape, not of the authorization).
  - **rules 5/6** (non-store cross-holder) → `403` unless
    `authorizedBy === 'asset_request'`.
  - same-holder + store-involving moves → unchanged.
- `returnSerialToStore` gains `authorizedBy?: 'asset_request' | null` and
  `403`s without it (every return is rule 7).
- `executeAssetRequest` is the ONLY caller that passes the token. It dispatches:
  `to_location` set → `returnSerialToStore`, else → `moveSerialAsset`; both
  receive `authorizedBy: 'asset_request'`, `refKind: 'ATR'` and `refDoc` = the
  request's `display_number`, and both accept a `compose` callback so the request
  status flip commits in the SAME guarded batch (or reverses with it).

No `X-Write-Ack`: approval must be two real people, not an acknowledgement.
An admin can decide/execute any request but cannot silently bypass one — the
requester and decider stay on the record.

Errors use the existing `MroError(status, message)` → `FORBIDDEN` (403) mapping,
consistent with every other MRO guard; no new error code is added to the catalog.

## tgapp

- `transfer-targets.ts` (pure, spec-pinned) becomes a destination union:
  - from a **vehicle** → wheel-capable trucks (tyre) / any plated truck (asset),
    excluding the current one, **plus** store;
  - from an **employee** → other employees, **plus** store;
  - never a truck↔employee pair.
- `TransferRequestSection` renders three destination kinds (truck | person | store).
- The truck registry's **Return to store** action files a return request instead
  of writing directly; `MovePositionSection` is narrowed to the SAME truck
  (rotate only) and points cross-truck intent at the request filer.
- `CustodySection`: store→person stays direct (`/issue`); a unit that is already
  held can only file a request.
- The filer is reachable for a person-held unit from its own serial detail page.
- `TransferCard` narrates a return destination (`→ Store`) as well as a holder.

## Rollout dependency

Approval needs the requester to have a recorded superior in `hrm_employee_links`.
Without one, a request lands in a feed nobody can decide (an admin can still
decide any). Dev has 12 links; production reporting lines must exist for anyone
who files.

## Tests

- API (`mro-inventory.spec.ts`): direct cross-truck move → 403; same-truck rotate
  → still works; truck↔employee → 403 even when authorized; `/return` direct →
  403; approved return executes; approved emp→emp executes; `/issue` from store
  still works.
- tgapp: `transfer-targets.spec.ts`, the transfer request section, the return
  section, `tyre-detail-body`.

## Docs

`docs/backend-api/mro-inventory.md` §8b/§8c + the AGENTS.md custody bullet.
