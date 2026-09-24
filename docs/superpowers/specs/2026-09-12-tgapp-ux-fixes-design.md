# tgapp UX / correctness fixes — 17 issues (2026-09-12)

Status: approved by user ("fix all with recommendation way"). No commits made
(project rule: never commit unless explicitly asked).

## Decisions (recommended defaults)

| #     | Issue                                  | Decision                                                                                                                                                                       |
| ----- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Punch card needs reload                | Already fixed in working tree (`qk.attendanceSummaryAll()` prefix-invalidate). Verify deployed bundle; harden.                                                                 |
| 2     | Early Leave >1/day                     | Backend `before_insert` + `before_update` code hook on `hrm_early_leaves`; blocks when a same-employee, same-calendar-day row exists with status NOT IN (cancelled, rejected). |
| 3     | Search card ≠ list card                | One `renderCard` used by list + search; search scoped by `request_type`; approval search passes the decision actions.                                                          |
| 4     | Time on request/approve cards          | Facts render inline for BOTH variants (removes the hidden OT span); `formatShiftTime12h` zero-pads like `formatPunchTime`.                                                     |
| 5     | "v" chevron + Superior Comment         | Inline the comment always (all statuses); delete chevron/collapse/toggle.                                                                                                      |
| 6     | Employee refresh button                | Delete `employee-detail-page.tsx` refresh block + unused imports.                                                                                                              |
| 7     | Tasks/Projects tabs 403                | Gate the tabs on Projects access (`useAppAccess`), so a role without `hrm_tasks` read never fires the read. Managers/admins unaffected.                                        |
| 8     | Punch sheet safe area                  | `pb-safe` gains `var(--tg-safe-area-inset-bottom, 0px)`.                                                                                                                       |
| 9/10  | Licenses/Insurances only some vehicles | Register is re-sourced from `veh_fleets` (all vehicles), current doc via `last_license` / `last_insurance`, tolerant of stale pointers.                                        |
| 11    | App-wide bottom safe area              | Migrate hand-rolled `env()` to `pb-safe`; add inset to bottom-anchored surfaces incl. DS datepicker + toast.                                                                   |
| 12    | Confirmation required                  | New shared `ConfirmSheet`; wire the irreversible actions (stock confirm/approve/issue, reject, cancel draft). Form Save stays instant.                                         |
| 13    | Maintenance Started/Ended              | `grid-cols-2` → `grid-cols-1` (+ skeleton).                                                                                                                                    |
| 14    | Incident Date full width               | Date gets its own full-width row; Estimated cost stays 2-up or its own row.                                                                                                    |
| 15/16 | Item/Stock image upload                | Crop overlay clears Telegram native chrome (`pt-tg`, `pb-safe`); native BackButton closes the crop; upload failure blocks Save and is surfaced; `submit()` guards image state. |
| 17    | Bulb info icon                         | Already implemented via `FlowHint` on all four create forms. Verify + extend only if a page is genuinely missing it.                                                           |

## Constraints

- No `eval`/`new Function` in worker code; DDL single-line.
- Never edit `wrangler.jsonc` by hand (`pnpm gen:infra`).
- DS changes require `pnpm --filter @mmbix/design-system build`.
- Gates: `cd apps/tgapp && npx tsc -b --noEmit && npx vitest run`; `cd apps/api && npx tsc --noEmit && npx vitest run`; DS build for DS edits.
