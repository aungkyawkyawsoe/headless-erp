# Mini-App Role → App access (launcher) — delivered (Design B)

> Status: **implemented + verified live** — `/auth/me apps` + DB-driven per-role launcher grid.

## What it does

အလုပ်သမားတစ်ယောက် (directory employee) ကို role တစ်ခုနဲ့ DB မှာ bind လုပ်ထား၊ သူ login ဝင်တဲ့အခါ Mini‑App launcher မှာ **သူ့ role ရဲ့ `_roles.app_access` list ထဲက app တွေပဲ** ပြပေးပါတယ်။ App block ကို frontend မှာ သိမ်းမထားဘူး — **DB က single source of truth** (`_roles.app_access` → `/auth/me apps` → launcher filter)။

## Why a dedicated role→app field (not collection-read gating)

Verified live: a base role can read-grant dozens of collections — so deriving boards from read-grants alone cannot separate one team from another. Design B instead stores, **per role**, the exact client app ids that role may open. Predictable, auditable, and does not force tightening live read-grants (which would 403 existing screens).

## Schema & API (backend)

- **Migration `028_role_app_access`** (packages/core migrations): `ALTER TABLE _roles ADD COLUMN app_access TEXT DEFAULT NULL`
  - stored as JSON TEXT of launcher app ids; `NULL/absent` ⇒ role may open every app.
- `RoleRecord.app_access?: string|null` (packages/types).
- `AuthService`: `createRole` accepts/`listRoles`+`getRole` expose raw `app_access`; new `roleAppAccess(roleId)` (parsed), `setRoleAppAccess`, `getRole`, `updateRoleDescription`.
- Users routes: `POST /api/users/roles` (accepts `app_access`), new `PUT /api/users/roles/:id` (curate `app_access`/`description`); role JSON surfaces `app_access` as **parsed string[]**; `GET /api/users/permissions/:role` unchanged.
- `/auth/me` (`apps/api/src/routes/auth.ts`): now also returns:
  - `granted_collections` — role's read-grant collection slugs (`'*'` admin),
  - `apps` — parsed `_roles.app_access` list (admin ⇒ null ⇒ all).

## Mini-App (client app)

- `launcher/registry.ts`: unchanged app ids (DB uses them).
- `launcher/launcher-page.tsx allowedApps(me)`: admin / `apps` null ⇒ all tiles; `apps` list ⇒ only those registry ids. While `/auth/me` loads a spinner is shown; on failure it degrades to **all** tiles (never lock out on a hiccup). Dock keeps only allowed pinned apps.
- `shared/auth.ts MeUser`: `granted_collections`, `apps`.

## Binding a role to an employee

`_users.role_id` is the single role the permission engine reads. After an employee logs in once (auto‑provisioned `tg-<etg>@telegram.local` auth user), point that auth user at the target role — admin `PUT /api/users/:id { role_id }`. On the employee's next login `/auth/me` carries the new role's `apps`, so the launcher changes.

## Seed / reprovision

- `scripts/reconcile-storekeeper-role.mjs` — idempotent: ensures the **Storekeeper** role, its collection write grants, its `app_access` board.
  `node scripts/reconcile-storekeeper-role.mjs <url> <token> --bind <etg…>` also binds the listed employees' auth users onto Storekeeper.
- `scripts/reconcile-client app-role-permissions.mjs` — ensures the base **Employee** role reads the client app-facing collections (unchanged behaviour).

## If a role opens every app (no curated board)

`app_access` `null` (`Administrator`, and any newly-created role until you curate it) means the launcher shows every tile — the exact same rule the `reconcile` script treats `app_access` `null` as “unrestricted”. Curate it (store a specific app list) the moment you need to scope a launcher board.

## Studio RBAC admin UI (Roles & Access)

The RBAC editor is available as **IDP → Roles & Access** (`#/idp/access`, the primary home alongside Collections/Catalog) and as a **Studio Admin** tab (`#/studio` → Roles & Access). Both render the same `apps/studio/src/components/admin/roles-tab.tsx` surface for viewing **and** editing the permission tables directly — no code needed, same endpoints an admin would curl:

- Left pane lists every role (`GET /api/users/roles`); pick one or click **New role** (`POST`).
- **Description** + **Mini-app board**: “Every app” vs individual app checkboxes — writes the curated id list via `PUT /api/users/roles/:id` (`app_access: null` = every app).
- **Collection permissions** table (from `_role_permissions`): per collection, the six flags read/write/create/delete/approve/submit as checkboxes. Toggling only marks the draft; each row’s **Save** posts the **complete six-flag set** in one `POST /api/users/permissions` upsert so editing one flag never resets the others. Existing field whitelists (`field_restrictions`) and row filters carry over untouched. Read-only grants, e.g. `suppliers`, display `read` checked and everything else off.
- “Add permission” dropdown lists the real entity collection slugs; adding defaults to a read-only grant.

It edits **role-level** access (`_roles.app_access`) and **per-role** collection grants — not which `_users` hold a role (manage that via `PUT /api/users/:id { role_id }`, docs above). Like every RBAC tool in this repo it talks to the validated users/permissions endpoints; raw D1 writes are never used for real edits.

- Role-grants write-persisted (**24 rows**, 13 `can_write`) on Storekeeper.
- `/auth/me` as a non-admin Storekeeper returns the curated `apps` list.
- Browser: Employee-bound account shows HR/HR‑request board; after binding to Storekeeper + re-login, the launcher shows only tyres / store-requests / inbounds / outbounds / stock-moves / adjustments / stocks / group (+ attendance / approval / settings) and hides HR admin, licenses, insurance, incidents.
- Gates: api/core/types/client app typecheck + client app build + auth-gate + mro-inventory tests green.
