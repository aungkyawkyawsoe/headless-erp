# Factory Cleanup & Roadmap (မြန်မာလို)

> ဒီစာရွက်က "ဘယ်သူမဆို ယူသုံးလို့ရတဲ့ ready-to-use **headless software factory**"
> ဖြစ်ဖို့ လုပ်ပြီးသား အလုပ် (done) နဲ့ ကျန်သေး (to-do) ကို မြန်မာလို ချုပ်ထားတာပါ။
> အနှစ်ချုပ် → အလုပ်လုပ်ပုံ → ကျန်တဲ့ to-do။

---

## ၀။ အနှစ်ချုပ် (Done)

Repo ကို **pure headless factory** အဖြစ် ရှင်းပြီးပါပြီ။ hr/mro domain module
တွေ၊ tgapp reference app တစ်ခုလုံး၊ သူတို့ရဲ့ script/test/config hardcode
အားလုံး ဖယ်ရှားပြီး — **IDP admin panel** (factory ရဲ့ operate/govern surface) ကို
သာ ကျန်ထားပါတယ်။

**အတည်ပြုပြီး (all green):**

| Gate                                                   | ရလဒ်                        |
| ------------------------------------------------------ | --------------------------- |
| `pnpm check` (infra drift + typecheck + lint + format) | ✅ 20/20 typecheck          |
| `pnpm turbo run test`                                  | ✅ 14/14 task               |
| API tests                                              | ✅ 150/150                  |
| Studio tests                                           | ✅ 274/274                  |
| `pnpm turbo run build`                                 | ✅ 5/5                      |
| `pnpm check:infra`                                     | ✅ configs ↔ env SSOT match |

---

## ၁။ ဖယ်ရှားခဲ့တာ (Removed)

| အမျိုးအစား | ဖယ်ရှားတာ                                                                      | အကြောင်း                             |
| ---------- | ------------------------------------------------------------------------------ | ------------------------------------ |
| App        | `apps/tgapp/**` (MRO/HR Mini App, 85k LOC)                                     | domain-specific reference app        |
| Backend    | `apps/api/src/domain-modules/{hr,mro}`                                         | business vertical — project-specific |
| Scripts    | `scripts/{seed,smoke,migrate,apply}-{mro,veh,hr,tyre,store}-*`                 | one-off domain ops                   |
| Tests      | domain spec ၁၇ ခု (mro/veh/hr/attendance/my-tasks/idp-domain…)                 | domain test ဖျက်၊ core test ကျန်     |
| Config     | `packages/config` ထဲက HR/MRO collection ၁၀၀+ default                           | SSOT ချိုး                           |
| Wire       | `domains/{tgapp,hr,mro}` refs — turbo/package.json/infra/CI/gen-wrangler/start | build plumbing                       |

**ကျန်ထားတာ (kept, on purpose):**

- `apps/studio` — admin/schema/page builder UI (> အကုန်လုံး)
- `apps/api` — generic entity engine
- `domain-modules/idp` — IDP catalog/scorecard/deployments (admin panel)
- `packages/*` — core, types, sdk, sdk-react, ui-views, design-system, plugins ၂၉ ခု

---

## ၂။ Headless ဖြစ်သွားပုံ (How it is headless now)

### ၂.၁ Config — domain default ဖယ်

- `packages/config/src/index.ts`: `telegram.roleCollections: []`, `directoryCollection: ''`,
  `modules.enabled: ['idp']`။ (အရင် HR/MRO slug ၁၀၀+)
- `factory core` (`routes/`, `lib/`, `services/`, `plugins/`) ထဲ **domain slug 0** —
  `rg "hrm_|mro_|veh_|store_" apps/api/src` → 0 (idp module မှလွဲလို့)။

### ၂.೨ Identity တစ်ခုတည်းက စီမံ (directory config-driven)

- `findLiveEmployeeById` က `getConfig().telegram.directoryCollection` ကို ဖတ်;
  မရှိရင် gate off (deny-by-default)။
- `telegram-role.service.ts` ထဲက `APPROVE_COLLECTIONS` / `ROLE_ROW_FILTERS`
  hardcode ဖယ် — module ကိုယ်တိုင် declare လုပ်ရမယ့် seam ဖြစ်လာ။
- `notify-employees.ts` (HR directory hardcode) — ဖျက်။
- `/api/meta` က `identity.directory_collection` + `directory_field` advertise →
  client က collection နာမည် hardcode မလုပ်ရတော့။

### ၂.၃ Client ကို DB-driven လုပ်

- Studio `roles-tab` ရဲ့ app-access board က `APP_CATALOG` hardcode အစား
  `/api/modules` ကနေ derive။
- `packages/types` `APP_COLLECTIONS = {}` (empty factory default)။
- Studio `users-tab` က employee column ကို `/api/meta` directory ကနေ ရယူ။

### ၂.೪ Domain module ထည့်နည်း (တစ်ခုတည်းသော လမ်း)

```text
apps/api/src/domain-modules/<id>/  → routes.ts  + collections
  ↓ domain-modules/index.ts ရဲ့ domainModules[] မှာ list
  ↓ DOMAIN_MODULES=idp,<id> (infra/env.prod)
  ↓ pnpm gen:infra
→ enable ဆို mount, disable ဆို 404 (dead code မဟုတ်)
```

---

## ၃။ အခြေအနေ — Done / To-Do

### ✅ Done (P1 — manifest + gating)

1. **`ModuleManifest` contract** ✅ — `packages/types/src/module.ts` (id/name/routes/
   path/hooks/plugins/roles/identity)။ `idp` က `idp/manifest.ts` နဲ့ declare;
   `domain-modules/index.ts` က `moduleManifests[]` ကနေ mount။ core က module ကို
   import မလုပ်။
2. **Plugin gating** ✅ — `PLUGINS` env (`isPluginEnabled`)။ unset ⇒ all; `none` ⇒
   none; list ⇒ only those။ Disabled plugin route = 404, migration skip
   (`PluginMigrationService(guardKey)`)။
3. **Hook gating** ✅ — `bootModuleHooks(env)` က enabled module ရဲ့ compiled hooks ကို
   **isolate တစ်ခုလျှင် တစ်ခါ** register။ disabled ဆို 0။
4. **`buildConfig` purity fix** ✅ — `structuredClone(DEFAULT_CONFIG)` (shallow spread
   က nested defaults ကို mutate လုပ်နေတဲ့ bug)။
5. **Docs reset** ✅ — README/AGENTS/docs ထဲက domain refs ဖယ်; stale doc ၃ ခု
   (`mro-inventory.md`, `tasks-follow-up.md`, `directus-sync.md`) + frontend doc +
   truck-rig html ဖျက်; CLI built-in templates `hrm/accounting/wms` ဖျက် (`cms`+blank ကျန်);
   `/api/templates` template library ရှင်း။

### ✅ Done (P2 — engine features)

6. **Generic integrity engine** ✅ — `policies.integrity` (`orphan` |
   `aggregate_mismatch` | `duplicate` | `stale`); `GET /api/collections/:slug/integrity`
   bounded + identifier-validated; `apps/api/test/integrity.spec.ts`။
7. **Permission lineage** ✅ — migration `036_role_permissions_lineage`
   (`source` / `source_module`); admin=`admin`, provisioner=`provisioner`;
   `GET /api/users/permissions/:role_id` ကနေ ပြ; `role-lineage.spec.ts`။
8. **Deployment discovery** ✅ — `GET /api/meta` က `identity` + `modules`
   (enabled code manifests) + `plugins` (enabled ids) advertise — client/ops က
   ဒီ deploy ဘာတွေပါလဲ တစ်ချက်တည်းနဲ့ သိ; `contract.spec.ts` ပင်။

### ✅ Done (God-level — add-on model + Studio enterprise)

9. **Add-on Registry** ✅ — `ModuleManifest` (`scope`/`depends`/`provides`/
   `requires`/`extends`) + `_addons` (migration 037) + `resolveAddons` graph +
   `GET/POST /api/addons` (install/uninstall, admin)။ Route gate = allowlist ∩
   installed; uninstall ⇒ 404 (no redeploy); `addons.spec.ts`။
10. **Studio RBAC-aware UI** ✅ — `useMe()` + `lib/capabilities.ts`; admin-only
    tabs hide for non-admins; `capabilities.spec.ts`။
11. **Studio Add-ons tab** ✅ — catalog + install/remove via `/api/addons`။
12. **Optimistic concurrency** ✅ — `If-Match: <_schema_version>` on schema/policy
    writes ⇒ stale save **409** (current version ပါ); `ifMatchGuard` +
    `concurrency.spec.ts`; Studio က form-layout save မှာ version ပို့။

### 🟠 P2 — ကျန်သေး (Studio enterprise polish)

13. **Schema draft→review→apply** — **review ✅** (save မတိုင်မီ
    `reviewSchemaChange` → breaking-change confirm; `schema-diff.spec.ts`);
    draft/publish workflow (snapshot staging + IDP promote) ကျန်။
14. **i18n** — plumbing ✅ (`lib/i18n.ts` + `/api/translations`); string
    coverage (Studio screen တိုင်း) ကျန်။
15. **Maintainability** — god-file split **စတင် ✅** (`workbench-parts` + `builder-parts` ဖယ်; CollectionsWorkbench 1972→1883, AppDetailPage 1813→1724); ကျန် in-page monolith + inline style 1423 → design-system ဆက်လုပ်။
16. **E2E/visual + a11y + virtualization** — **E2E smoke ✅** (Playwright + `studio-e2e` CI job), **component tests ✅** (addons-tab, CommandPalette); visual regression, a11y audit, table virtualization ကျန်။
17. **MVE consumer / runtime frontend shell / OCR** — frontend လိုအပ်။

---

## ၄။ Guardrails (မချိုးရ)

1. `eval`/`new Function` မသုံးရ (workerd) — safe expression evaluator သာ။
2. `db.exec()` DDL single-line။
3. Factory core ထဲ domain slug **0** (ဒီ cleanup ရဲ့ KPI)။
4. Business module = `domain-modules/<id>/` + `DOMAIN_MODULES` gate; core က
   import မလုပ်ရ။
5. Schema cache invalidate / authz-version stamp / change envelope — မပျက်ရ။

---

## ၅။ နိဂုံး

> "We are not building a car — we are building a factory."

အခု assembly line က **domain ကင်းစင်ပြီး** — IDP admin panel လည်း ဆက်ရှိတယ်။
လိုတဲ့ business ကို `domain-modules/<id>/` မှာ ရေးပြီး `DOMAIN_MODULES` နဲ့
ဖွင့်လိုက်ရုံ။ တခြားအားလုံး (schema engine, RBAC, plugins, SDK, Studio) က
ဘယ် business အတွက်မဆို အသင့်။
