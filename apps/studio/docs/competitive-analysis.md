# Studio — Competitive Analysis & Enterprise Roadmap

> ဤစာတမ်းသည် `apps/studio` (Headless Entity Engine ပေါ်မှာ တည်ဆောက်ထားတဲ့ metadata-driven
> app builder) ကို **Adobe / Figma** (visual design tools) နဲ့ **Odoo Studio** (enterprise low-code
> builder) တို့နဲ့ နှိုင်းယှဉ်ပြီး — ဘာတွေ အားသာချက်၊ ဘာတွေ ကွာဟချက် (gap) ရှိတယ်၊
> enterprise-grade "build anything" ဖြစ်ဖို့ ဘယ်လို မြှင့်တင်ရမလဲ ဆိုတာကို တစ်ဆင့်ချင်း ခွဲခြမ်းစိတ်ဖြာထားပါတယ်။

---

## 1. Positioning — ဒီ tools သုံးမျိုးက မတူတဲ့ "အကောင်" တွေပါ

|                | **Figma / Adobe XD**                                     | **Odoo Studio**                                             | **Our Studio**                                                          |
| -------------- | -------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| အဓိက ပန်းတိုင် | Pixel-perfect **design** — ဘာမဆို ဆွဲလို့ရတဲ့ canvas     | Form-centric **enterprise app** customization               | Metadata-driven **app building** (data + nav + pages)                   |
| Layout model   | Free canvas, absolute positioning, Auto Layout (flexbox) | Model-driven, backend-generated forms/views                 | Block tree + 4-col grid + form tabs/groups + view modes                 |
| Data / logic   | **မရှိ** — design spec ထုတ်ပေးရုံ                        | Model နဲ့ အပြည့်အဝချိတ် — computed fields, domains, actions | Headless engine (CRUD, RBAC, linkage, validation, encryption) နဲ့ ချိတ် |
| Runtime        | မရှိ — developer က ပြန်ဆောက်ရတယ်                         | Odoo runtime မှာ တိုက်ရိုက် render                          | Shared runtime renderer (`@mmbix/ui-views`) — preview == runtime        |
| အားသာချက်      | အကန့်အသတ်မဲ့ visual freedom                              | Enterprise productivity — data ပေါ် မှန်ကန်စွာ တည်ဆောက်     | နှစ်ခုလုံးရဲ့ "bridge" — design လည်းရ၊ data-driven လည်းဖြစ်             |
| အားနည်းချက်    | Data မပါ၊ logic မပါ                                      | Odoo ရဲ့ paradigm ထဲမှာသာ လွတ်လပ်                           | Canvas freedom + enterprise depth က အားနည်း (အောက်မှာ အသေးစိတ်)         |

**အဓိက ကောက်ချက်** — Studio က Figma လို design tool **မဟုတ်**၊ Odoo လို builder ဖြစ်ပါတယ်။
ဒါကြောင့် Figma နဲ့ တိုက်ရိုက်ယှဉ်ဖို့ မလို — Figma ရဲ့ **canvas power tools** တွေကို ယူပြီး
Odoo ရဲ့ **data-model depth** တွေကို ယူရင်၊ ကိုယ့် headless engine ပေါ်မှာ "best of both worlds" ဖြစ်သွားမယ်။

---

## 2. Our Studio — ဒီနေ့အထိ ရှိပြီးသား အားသာချက်များ (verified)

ကိုယ့်ဟာကို မနှိမ်ဘဲ အမှန်အတိုင်း မှတ်တမ်းတင်ရင် —

1. **Single source of truth** — `studio.db` metadata (components, props, styles, events, view modes,
   templates) → palette → inspector → runtime renderer အားလုံး တစ်နေရာတည်းကနေ ထွက်တယ်။
   Block အသစ်ထည့်ရင် registry တစ်နေရာပြောင်းရုံနဲ့ studio ရော runtime ရော အလုပ်ဖြစ်တယ်။
   ဒါ Figma ရဲ့ "design system sync" ထက် ပိုစနစ်ကျတယ်။
2. **Metadata admin** — `StudioAdminPage` က design system catalog ကိုယ်တိုင် CRUD လုပ်လို့ရတယ်။
   ဒါ Odoo မှာတောင် မရှိတဲ့ power — Odoo က view XML ကို code နဲ့သာ ပြောင်းရတယ်။
3. **Form layout engine** — tabs → groups → nested groups → field spans (1–4) → `visible_when`
   conditional → keyboard (WASD, shortcuts) → undo/redo။ ဒါက **Odoo form builder level** ရောက်နေပြီ။
4. **View modes + templates** — table / kanban / card / list / calendar / form / layout — DB-driven ဖြစ်ပြီး
   template အလိုက် view များကို သတ်မှတ်နိုင်တယ် (Odoo ရဲ့ view architecture ပုံစံပဲ)။
5. **Page builder** — nested containers (row/column/tabs/accordion), undo/redo (60 deep), clipboard
   (system clipboard JSON ပါ), device preview (desktop/tablet/mobile), draft/publish, optimistic
   concurrency (server updated_at check)။
6. **Data model editor** — field type catalog 40+ မျိုး, permissions (RBAC field visibility),
   table/schema နှစ်မျိုးနဲ့ server-side paginated data browser။
7. **Menu builder** — dnd-kit drag & drop tree, groups/links, roles, icon picker, **i18n (label_my)** —
   မြန်မာဘာသာ ထည့်ထားပြီးသား။
8. **Runtime parity** — page canvas က runtime `BlockView` ကိုပဲ သုံးတယ် — preview == runtime
   (ဒါ Figma → code မှာ အမြဲပြဿနာဖြစ်တဲ့ "design handoff drift" ကို ကာကွယ်ထားတာ)။

---

## 3. Gap Analysis — Figma/Adobe XD နဲ့ ယှဉ်ရင် ဘာတွေ ကွာဟနေလဲ

> "Complex layout and flexibility" ဆိုတဲ့ ကိုယ့်အကြိုက်နဲ့ ကိုက်ညီဖို့ — ဒီ list က အဓိက canvas gaps တွေပါ။

| Capability                                              | Figma / Adobe XD     | Our Studio (လက်ရှိ)                               | Gap ပမာဏ |
| ------------------------------------------------------- | -------------------- | ------------------------------------------------- | -------- |
| Free canvas / absolute positioning                      | ✅ အပြည့်            | ❌ 4-col grid + colSpan သာ                        | 🔴 ကြီး  |
| Palette → canvas **drag & drop**                        | ✅                   | ❌ click-to-add သာ (menu tree မှာသာ dnd)          | 🔴 ကြီး  |
| Multi-select + group                                    | ✅                   | ❌ single selection သာ                            | 🔴 ကြီး  |
| Alignment / distribute (left, center, right, evenly)    | ✅                   | ❌                                                | 🔴 ကြီး  |
| Zoom / pan / snap grid / rulers                         | ✅                   | ❌                                                | 🟠 ကြီး  |
| Per-side spacing (margin/padding), radius, gap controls | ✅                   | 🟡 Style tab မှာ preset အဆင့်သာ                   | 🟠 အလတ်  |
| Design tokens / theme editor                            | ✅ (Figma variables) | ❌ dark/light toggle သာ                           | 🔴 ကြီး  |
| Component library + **variants** + instance overrides   | ✅                   | 🟡 `design_components` catalog ရှိ၊ variants မရှိ | 🟠 အလတ်  |
| Layers / outline panel                                  | ✅                   | 🟡 `BlockTree` ရှိ                                | 🟢 သေး   |
| Plugins / extension API                                 | ✅                   | ❌                                                | 🟠 အလတ်  |
| Real-time collaboration / comments                      | ✅                   | ❌                                                | 🟠 အလတ်  |
| Page/asset version history + restore                    | ✅                   | 🟡 undo (session) သာ                              | 🟠 အလတ်  |
| Asset/media management (upload)                         | ✅                   | ❌ image = URL သာ                                 | 🟠 အလတ်  |
| Auto Layout (responsive flex)                           | ✅                   | 🟡 row/column containers ရှိ                      | 🟢 သေး   |
| Prototyping / interactions                              | ✅                   | 🟡 events tab (navigate/toast/dialog)             | 🟢 သေး   |

---

## 4. Gap Analysis — Odoo Studio နဲ့ ယှဉ်ရင် ဘာတွေ ကွာဟနေလဲ

> "Enterprise" ဆိုတာ လှတာထက် **data နဲ့ logic ကို ထိန်းချုပ်နိုင်တာ** — ဒီမှာ Odoo က အတန်းကျောင်းသားပါ။

| Capability                                    | Odoo Studio        | Our Studio (လက်ရှိ)                                                   | Gap ပမာဏ |
| --------------------------------------------- | ------------------ | --------------------------------------------------------------------- | -------- |
| Repeating sub-records (x2many lists in forms) | ✅                 | 🟡 table view မှာ child tabs ရှိ၊ form ထဲ x2many မရှိ                 | 🟠 အလတ်  |
| Computed fields / onchange logic              | ✅ (Python)        | 🟡 engine မှာ expression ရှိ၊ studio UI မှာ visual builder မရှိ       | 🟠 အလတ်  |
| Conditional visibility (domains)              | ✅ visual          | 🟡 `visible_when` (form groups) ရှိ၊ block-level condition မရှိ       | 🟠 အလတ်  |
| Pivot / graph / cohort views                  | ✅                 | 🟡 chart block (pages) ရှိ၊ pivot/cohort view mode မရှိ               | 🟠 အလတ်  |
| Workflow / automated actions designer         | ✅                 | 🟡 server functions (declarative JSON) API မှာရှိ၊ studio မှာ UI မရှိ | 🔴 ကြီး  |
| List view column reorder (drag)               | ✅                 | 🟡 TableLayoutCanvas (pick သာ)                                        | 🟢 သေး   |
| Record-level security / sharing rules         | ✅                 | 🟡 field-level RBAC ရှိ                                               | 🟠 အလတ်  |
| Schema snapshot / diff / rollback             | ✅ (upgrade infra) | 🟡 API docs မှာ schema-snapshot ရှိ၊ studio UI မရှိ                   | 🟠 အလတ်  |
| Audit log (who changed what)                  | ✅                 | ❌                                                                    | 🟠 အလတ်  |
| Multi-user editing + locking                  | ✅                 | 🟡 page-level optimistic concurrency သာ                               | 🟠 အလတ်  |
| Translation workflow                          | ✅ (full i18n)     | 🟡 label_my သာ                                                        | 🟢 သေး   |
| App export / import / duplicate               | ✅                 | 🟡 schema snapshot (JSON)                                             | 🟢 သေး   |
| Dashboard (workspace) builder                 | ✅                 | 🟡 layout template + block grid                                       | 🟢 သေး   |

---

## 5. ဘယ်သူ့ဆီက ဘာယူရမလဲ — "Steal" Matrix

| ယူရမယ့် Feature                     | ဘယ်ကယူ                 | ဘယ်မှာထည့်                                 | ဘာကြောင့် အရေးကြီး                                                |
| ----------------------------------- | ---------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| Drag-drop canvas + drop zones       | Figma / Webflow        | PageCanvas                                 | "Flexibility" ခံစားချက်ရဲ့ ၈၀% က ဒါကနေလာတယ်                       |
| Multi-select + align/distribute     | Figma                  | Canvas toolbar                             | လက်ရှိ 4-col grid နဲ့ ပေါင်းလိုက်ရင် workspace design လွယ်သွားမယ် |
| Design tokens + themes              | Figma variables / Odoo | `design_tokens` table + ThemeToggle မြှင့် | App တစ်ခုလုံး rebrand လုပ်လို့ရတဲ့ enterprise power               |
| Variants + instance overrides       | Figma                  | `design_components.variants_json`          | Component တစ်ခု → မျိုးကွဲများစွာ — design system scale           |
| Visual expression/condition builder | Odoo domain editor     | PageInspector + formlayout                 | Engine ရဲ့ expression evaluator ကို "no-code" ဖြစ်အောင်လုပ်       |
| x2many repeating lists              | Odoo                   | FormLayout (group → sub-table)             | Enterprise form တွေရဲ့ ကျောရိုး                                   |
| Pivot/graph view modes              | Odoo                   | view_modes table + renderer                | Business intelligence ကို studio ထဲမှာပဲ                          |
| Workflow/action designer            | Odoo studio actions    | New Studio section                         | Server functions (declarative) ကို visual ဖြစ်အောင်               |
| Version history + restore           | Figma history / Odoo   | Pages API (versioned blocks)               | Enterprise data loss protection                                   |
| Asset library (R2)                  | Adobe Assets / any     | Image block + uploader                     | Media မပါရင် page design မပြည့်စုံ                                |
| AI generation panel                 | v0 / Builder.io        | StudioMeta (machine-readable ဖြစ်ပြီးသား)  | schema.sql မှာပင် "AI tools read THIS file" လို့ ရေးထားပြီးသား    |

---

## 6. Enterprise-Grade Architecture — အဆင့် ၃ ဆင့် လမ်းပြမြေပုံ (Roadmap)

### Phase 1 — "Design Power" (အရင်ဆုံး လုပ်သင့်တာ — canvas freedom ရအောင်)

1. **Canvas engine** (`PageCanvas` ကို Figma-style interactive canvas အဖြစ် မြှင့်)
   - Palette ကနေ **drag onto canvas** — hover လုပ်တဲ့ drop zone မှာ highlight + ghost placeholder
   - ရှိပြီးသား block တွေ **drag to reorder / drag into container** (dnd-kit က menu မှာ အသုံးပြုပြီးသား — ပြန်သုံးလို့ရတယ်)
   - **Multi-select** (shift-click / marquee) → group → align/distribute → batch delete/duplicate
   - **Zoom / pan / rulers / snap-to-grid** — canvas transform (CSS transform-based, cheap)
   - Block JSON က **underlying truth** အဖြစ် ဆက်ထား — layout တွေက visual layer သာ
2. **Design tokens** (`studio_config` / new `design_tokens` table)
   - color scale, spacing, radius, typography, shadow — token key တွေအဖြစ် DB မှာ
   - Inspector က "token picker" ပြ — hardcoded CSS value မဟုတ်ဘဲ token ကို ရွေးရတယ်
   - Runtime `BlockView` က tokens ကို consume — theme တစ်ခုပြောင်း = app တစ်ခုလုံး restyle
3. **Component variants + snippets**
   - `design_components` မှာ `variants_json` + instance override (block.config က variant-key ကိုသာ သိမ်း)
   - "Snippet" (saved block groups) — လုပ်ထားတဲ့ layout ကို ပြန်သုံးလို့ရတဲ့ library

### Phase 2 — "Enterprise Depth" (data + logic ကို no-code ဖြစ်အောင်)

4. **Visual expression builder** — engine ရဲ့ safe expression evaluator (`packages/core/src/entity/expression.ts`) ကို
   field picker + operator picker UI နဲ့ ချိတ် → `visible_when`, defaults, validation, computed props
   (Odoo domain editor ပုံစံ — "ဘာသာစကားသင်စရာမလို" ဖြစ်အောင်)
5. **x2many in forms** — FormLayout မှာ "sub-table" group type → child collection fields (Odoo order-lines ပုံစံ)
6. **Pivot + graph view modes** — `view_modes` မှာ row ထည့် (metadata-driven ဖြစ်ပြီးသား အတွက်
   runtime renderer ကို ချဲ့ရုံ) — engine ရဲ့ aggregate ကို သုံး
7. **Workflow designer** — server functions (declarative JSON rules) အတွက် visual editor —
   trigger → condition → action blocks
8. **Versioning + audit** — page save တိုင်း version snapshot; diff + restore UI; audit log
   (engine မှာ optimistic concurrency ရှိပြီးသား — အဲ့ဒါကို version history အဖြစ် မြှင့်)
9. **Asset library (R2)** — studio ထဲက ပုံ upload → image block မှာ picker

### Phase 3 — "Scale & Ecosystem" (အဖွဲ့ကြီး + ပြင်ပကုမ္ပဏီ အတွက်)

10. **Collaboration** — presence cursors, comments/annotations, per-block locking
    (DB က local SQLite ဖြစ်နေတာ → team mode အတွက် D1-based sync/backend persistence လိုမယ်)
11. **Plugin / extension API** — custom block types ကို manifest နဲ့ register
    (`ds_exports` introspection table က ဒီအတွက် ရည်ရွယ်ပြီးသား)
12. **AI generation** — metadata က machine-readable ဖြစ်ပြီးသား → "describe a dashboard"
    prompt → generated block JSON → canvas မှာ preview → save
13. **App import/export** — module → single JSON (schema + menus + pages + views) — studio နဲ့
    engine ရဲ့ schema-snapshot ကို ပေါင်း

---

## 7. ဦးစားပေး Quick Wins (သီတင်းပတ် ၁–၂ အတွင်း စလို့ရတာ)

1. Canvas မှာ dnd-kit drag (palette → canvas, block reorder) — **အမြင်အာရုံအကျိုးသက်ရောက်မှု အကြီးဆုံး**
2. Multi-select + "align/distribute" toolbar (grid-based အတွက် distribute က အဓိပ္ပာယ်ရှိ)
3. `design_tokens` table + token picker in StyleTab — theme engine ရဲ့ အုတ်မြစ်
4. `variants_json` on `design_components` + variant dropdown in PropsTab
5. Visual condition builder (`visible_when` ကို block-level အထိ ချဲ့)

---

## 8. Risk & သတိထားရမယ့်အချက်

- **Canvas လွတ်လွတ်လပ်လပ်** ဖြစ်လွန်းရင် runtime renderer (flex/grid layout) နဲ့ ကိုက်ညီမှု ပျက်တတ်တယ် —
  absolute positioning ထည့်ရင် runtime CSS ကိုပါ တစ်ပြိုင်နက် update လုပ်ရမယ်။
  **အကြံပြုချက်** — default ကို block/grid layout ဆက်ထား၊ "free mode" ကို opt-in လုပ်ပါ။
- `studio.db` က local SQLite — multi-user အတွက် backend persistence (D1) ပြောင်းဖို့
  `apps/api` မှာ studio metadata API လိုမယ်။
- Metadata schema ကို ချဲ့တိုင်း `seed.sql` / `dump-seed.js` / `DEFAULT_META` fallback သုံးနေရာကို
  တစ်ပြိုင်နက် update လုပ်ပါ — migration မရှိတဲ့အချိန်မှာ source of truth ကွဲသွားနိုင်တယ်။

---

## 9. အနှစ်ချုပ်

- **Studio က ဒီနေ့အထိ** — Odoo-class data/model/builder architecture + Figma-style preview fidelity
  ရဲ့ "ထက်ဝက်" ရှိနေပြီ။
- **အဓိက ကွာဟချက်** — (1) canvas interaction (drag/multi-select/align/zoom) ၊
  (2) design tokens/variants ၊ (3) visual logic builders (expression/workflow) ၊ (4) enterprise lifecycle
  (versioning/audit/assets/collab) ။
- **ဦးစားပေး** — Phase 1 (canvas + tokens + variants) က "flexibility" ခံစားချက်ကို ချက်ချင်း ပေးနိုင်ပြီး
  metadata-driven ဖြစ်နေပြီးသား အုတ်မြစ်ပေါ်မှာ ရိုးရိုးရှင်းရှင်း တည်ဆောက်လို့ရတယ်။
- Phase 2–3 က Studio ကို "design tool" ရော "enterprise platform" ရော ဖြစ်စေမယ့်
  differentiation — ဒါတွေက Figma/Odoo နှစ်ခုလုံးမှာ မရှိတဲ့ ပေါင်းစပ်မှုပါ။
