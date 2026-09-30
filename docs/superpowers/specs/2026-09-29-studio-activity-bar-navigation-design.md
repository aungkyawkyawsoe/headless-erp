# Studio Activity Bar — Three-Tier Navigation — Design

> **Date:** 2026-09-29 · **Status:** APPROVED (user, 2026-09-29) — Phase 1 in implementation · **Scope:** `apps/studio` (IDP portal shell) + `packages/design-system`

## 0. TL;DR

The IDP portal navigates through **one flat text sidebar of 11 items** (Backstage-style), and Studio Admin adds **13 more tabs** on a second surface — 24 destinations in lists that grow with every module. Replace the IDP shape with VS Code's:

- **Tier 1 — Activity Bar (rail):** a persistent 3rem icon column, 7 **domains** as built
  (`⌂ Overview · ▦ Catalog · ▤ Collections · ⛨ Roles & Access · ⚇ Users · ⚙ Governance ·
  📖 API Docs`), bottom cluster (theme).
- **Tier 2 — Side Panel:** the active domain's **entity list** (e.g. the collections registry), collapsible with ⌘/Ctrl+B, resizable (already persisted).
- **Tier 3 — Content:** unchanged pages + breadcrumbs.

**One registry** (`lib/idp-nav.ts`) is the SSOT for rail, panel, and palette. **Routing does not change.** The flagship ask — the collections list living in the panel — is a **move** of the already-extracted `CollectionsRegistryList`, not a copy.

## 1. Goal & non-goals

**Goal.** Enterprise-grade two-tier navigation on the IDP portal: bounded icon count (7±2, Miller), constant rail width regardless of how many surfaces exist, more horizontal space for data tables, and the same three-tier mental model (domain → entity → record) the rest of the industry uses.

**Non-goals (Phase 1):**

| Out of scope | Why |
| --- | --- |
| Folding Studio Admin's 13 tabs into the same rail | Phase 2; needs the Admin surface migrated to the new shell first |
| The App workbench (`/apps/:slug/*`) | A builder canvas with its own 3-pane shell — a tool, not a nav surface |
| Any API/backend change | This is chrome only; reads/writes/permissions untouched |
| Rail badges / counts | No consumer wired yet (YAGNI); the panel header is the seam to add them |
| Number-key rail shortcuts | Browser-reserved or macOS system shortcuts (Ctrl/Cmd+1..9, Cmd+Shift+3/4/5, Firefox Alt+1..9). ⌘K palette is the keyboard path |

## 2. Decisions (ADR)

| # | Decision | Why |
| --- | --- | --- |
| **A1** | Two tiers: rail = domains, panel = entities | MECE; icon count is bounded by domains, not by destinations |
| **A2** | The panel **is** the existing `Sidebar` primitive in `offcanvas` mode | ⌘/Ctrl+B, resize + persistence, mobile Sheet already exist — zero new state model |
| **A3** | Rail + panel rows derive from ONE registry `lib/idp-nav.ts` | SSOT; mirrors the `lib/app-sections.ts` precedent — three lists cannot drift |
| **A4** | Active section is **derived from the pathname** (`activeSectionForPath`), not a page prop | Determinism; the per-page `activeNav` prop is removed |
| **A5** | Collections panel hosts the registry list; the workbench's left pane is **removed** | One list (SSOT). The list component already exists; only its container state moves |
| **A6** | Panel selection stays **view state** (`?collection=<slug>` via `useViewState`, replace) | The Studio URL/history contract: one history entry per screen |
| **A7** | `adminOnly` sections are filtered before render from `useMe()` capabilities | PoLP — the UI never offers what the API would 403 |
| **A8** | Panel open state survives the per-page shell remount | Each IDP page owns its own `IdpShell` mount; without cookie-seeded `defaultOpen`, Ctrl+B would be undone by the next navigation |
| **A9** | `AppShell` gains `rail` + `panel` slots; surfaces without a rail render exactly as today | Smallest DS change that composes; Studio Admin and the gallery are untouched |

## 3. Architecture

```
┌ Rail (NavRail, 3rem, fixed) ─┬─ Side Panel (existing Sidebar, offcanvas) ─┬─ Content ──────────┐
│ 7 domain icons               │ per-section entity list                      │ page + breadcrumbs │
│ idp-nav.ts (SSOT) ───────────┴→ section.panel.kind → CollectionsPanel |     │                    │
│                                   LinksPanel | (none)                        │                    │
└──────────────────────────────┴──────────────────────────────────────────────┴────────────────────┘
   activeSectionForPath(pathname) ── both tiers read the SAME section
```

```
<SidebarProvider>                      ← reads the persisted cookie (A8)
  <NavRail … />                        ← flows first in the row; width = --rail-width
  <AppSidebar panel={<SectionPanel/>}/>← offcanvas; header OFF (`showModuleSwitcher: false`)
  <SidebarInset>{children}</SidebarInset>  ← offset by --rail-width (0 ⇒ today's layout)
</SidebarProvider>
```

## 4. Contracts

### 4.1 The registry (SSOT)

```ts
// apps/studio/src/lib/idp-nav.ts
export type IdpSectionId = 'overview' | 'catalog' | 'collections' | 'access' | 'release' | 'insights' | 'governance';

export type IdpPanelSpec =
	| { kind: 'sections' }                                                     // Overview: labeled directory — DELETED, see As built
	| { kind: 'collections' }                                                  // CollectionsPanel
	| { kind: 'links'; items: Array<{ label: string; path: string; icon: LucideIcon }> }; // LinksPanel

export interface IdpSection {
	id: IdpSectionId;
	label: string;                 // tooltip + panel title (via t() with fallback)
	icon: LucideIcon;
	path: string;                  // default route on rail click
	/** Longest-prefix routes that resolve to this section (e.g. '/idp/:slug' → catalog). */
	match: string[];
	adminOnly?: boolean;
	panel: IdpPanelSpec;
}

export const IDP_SECTIONS: IdpSection[];
export function activeSectionForPath(pathname: string): IdpSection;      // pure — unit-tested
export function visibleSections(isAdmin: boolean): IdpSection[];         // pure — A7
```

Phase-1 mapping (11 pages → 7 sections):

| Section | Panel | Routes covered |
| --- | --- | --- |
| ⌂ Overview | sections (the portal's own directory) | `/idp` |
| ▦ Catalog | links: Catalog, Create | `/idp/catalog`, `/idp/create`, `/idp/:slug` (app detail) |
| ▤ Collections | collections | `/idp/collections`, `/idp/collections/:slug` |
| ⛨ Access | links: Roles & Access, Users | `/idp/access`, `/idp/users` |
| ⌸ Release | links: Environments, Deployments | `/idp/environments`, `/idp/deployments` |
| ◔ Insights | links: Usage, Audit | `/idp/usage`, `/idp/audit` |
| ⚙ Governance | links: Policies | `/idp/policies` |

**As built:** `API Docs` became a section of its own (`/idp/api-docs`, no panel), and `Access`
split into **Roles & Access** + **Users** — two rail items, one route each. That put the rail at
9 domains at the time; the removals below bring it to 7, inside the `≤ 9` Miller bound its own
spec pins (`idp-nav.spec.ts`).

**Later removals (operator ask):** the Studio's **Deployments** (`/idp/deployments`) and **Audit**
(`/idp/audit`) pages were deleted, which collapsed **Release** (`/idp/environments`) and
**Insights** (`/idp/usage`) to one page each — so both dropped their panel (see the rule below).
Studio surfaces only: the backend `/api/idp/deployments*` + `/api/idp/audit` routes stay (the
app-detail page's per-app deployment list, Promote and history still read them), the audit trail
stays visible there as deployment history, and the removed paths get no special redirect — they
match no route, so the `/idp/:slug` catch-all renders its `App not found` empty state with the rail
honestly showing Catalog (`idp-nav.spec.ts` pins the fall-through; `portal-home.spec.ts` drives it
live for both paths).

**Later still:** **Overview** dropped its panel too, and with it the `sections` kind itself — that
kind rendered a labeled list of the portal's OWN domains, derived from this registry, i.e. tier 1's
list one tier down (the rail labels every icon in a tooltip). It is the same waste as a self-link,
one level up: a copy of the nav is not information, so `IdpPanelSpec` is down to `collections`,
`roles`, `links` and `none`, and the landing page keeps its canvas (the scorecard).

**Later still — Release and Insights deleted:** the operator then dropped the LAST page of each
domain — Environments (`/idp/environments`) and Usage (`/idp/usage`) — which left both sections with
no page behind them at all. A section in that state can only render a rail item that lands nowhere,
so the two entries (and `IdpSectionId`'s `'release' | 'insights'`) are gone: **the rail is 7
domains**. Backend unchanged, same rule as the Deployments/Audit pass — `/api/idp/environments` and
`/api/idp/usage` stay (the app-detail page and the landing page's factory-activity table read
`usage`), and the two paths join the removed-path fall-through into the app-detail `App not found`
lane. Client code that existed only for the deleted pages went with them
(`idpEnvironmentsQuery`/`qk.idpEnvironments`/`listIdpEnvironments`; `idpUsageQuery` **stays** — the
landing page's table is its other caller).

Three sections render with no panel (`panel: { kind: 'none' }`) — Overview, API Docs, Users — but
the rule is narrower than "one page ⇒ no panel": a panel is dropped when the section has nothing to
ENUMERATE. All three qualify — a tier-2 list there would hold one self-link (or, for Overview, the
whole rail). **Roles & Access** is
also one page, yet it has entities, so it declares `panel: { kind: 'roles' }` and its panel is the
ROLE REGISTRY (`components/idp/RolesPanel.tsx`): the Collections panel's shape — header row + count +
New role, a `Search roles…` box filtered from client state, rows that write `?role=` as view state —
beside a page that is only the editor (`RolesTab` renders no rail of its own there, so the roles are
listed once). **Governance** keeps the one remaining one-row `links` panel (a self-link, left as the
known exception).

### 4.2 Design-system deltas

```ts
// NavRail (new) — packages/design-system/src/components/appshell/nav-rail.tsx
interface NavRailItem { id: string; label: string; icon: LucideIcon }
interface NavRailProps {
	items: NavRailItem[];
	activeId?: string;
	onSelectItem: (item: NavRailItem) => void;
	top?: React.ReactNode;      // brand mark → home
	footer?: React.ReactNode;   // theme toggle
	label?: string;             // accessible name of the <nav>
}

// AppShell (additive)
interface AppShellProps {
	rail?: React.ReactNode;        // rendered first in the provider row
	panel?: React.ReactNode;       // replaces NavMain/NavProjects inside SidebarContent
	                               // `null` drops the sidebar COLUMN entirely (no gutter, no
	                               // mobile Sheet) — for a section that is ONE page; `undefined`
	                               // keeps the default nav lists
}
```

`SidebarProvider` sets `--rail-width` (default `0rem`) and seeds `_open` from the persisted
cookie; `Sidebar`/`SidebarInset` offset by `--rail-width`. A surface without a rail sees zero
delta. Its `collapsible` prop (default `true`) is the PIN: `false` removes the collapsed DESKTOP
state entirely — the cookie, `defaultOpen` and a controlled `open` are all overridden, the
⌘/Ctrl+B listener leaves the combo to the app instead of swallowing it, and `SidebarRail`
degrades to a resize-only grip (and disappears when the sidebar is not resizable). `IdpShell`
passes `collapsible: false`, so the portal's navigation is permanent; the mobile Sheet is
untouched. `AppSidebar` collapses `offcanvas` (not `icon`) whenever a `panel` is passed — an icon
rail is meaningless for a panel — and the user menu stays in the panel footer (`NavUser`).
`panel={null}` removes the sidebar from the row altogether (`hasSidebar` in `appshell/index.tsx`),
which is the deliberate shape for a section with no tier-2 list.

### 4.3 Composition spec

- **Rail:** 3rem wide (`w-12` — the same width the shell reserves as `--rail-width`), 48px rows,
  20px icons. States: default (muted icon), hover (tinted bg), **active** (2px inline-start
  accent bar + tinted bg + `aria-current="page"`), focus-visible ring. Tooltip = `label`
  (hover **and** focus). Bottom: theme toggle. A click NEVER hides the panel — it expands it if
  collapsed and navigates only when the section changes (a real double-click lands its second
  click on the now-active icon, and the original toggle-on-active gesture slid the nav away).
  Collapsing is gone altogether: `IdpShell` pins the provider (`collapsible: false`), so neither
  ⌘/Ctrl+B nor the sidebar edge can hide the portal's navigation — the edge strip is a resize
  grip only, and a stale `sidebar_state=false` cookie boots expanded.
- **Panel:** 14rem default (resizable 12–30rem, persisted today), pinned open in the portal (no
  ⌘/Ctrl+B collapse — see the rail bullet), header = NONE — the DS module switcher (a picker
  button opening a full-screen `ModuleGrid` launcher, which also claimed ⌘K) is off via
  `SidebarHeaderProps.showModuleSwitcher: false`, so the panel starts with its own title row and
  the apps stay in the Catalog section; body = section title + the section's list; empty/loading/error
  states belong to each panel component (Information Visibility). A section with entities to
  list has a body; a section with nothing to enumerate declares `panel: { kind: 'none' }`
  (→ `AppShell panel={null}`), and the column is removed ENTIRELY rather than filled with a stub —
  the blank 14rem gutter this spec worried about never happens, because there is no gutter. The
  self-link case (**API Docs**, **Users**) is the narrow one; the strongest case arrived later:
  **Overview** listed the portal's own domains (`sections`), which is the RAIL's list one tier
  down — the kind was deleted and the landing page keeps its canvas. Users and
  Roles & Access used to share one rail icon with a two-row panel between them (the two halves of
  "who can do what?"); they are two domains now, one route each — and Roles & Access KEEPS a panel,
  because it has entities: `panel: { kind: 'roles' }` renders `RolesPanel` (the live role registry —
  header row + count + New role, a `Search roles…` box, `?role=` selection), the same shape the
  Collections section uses for collections, with `RolesTab` reduced to the editor beside it.
  `IdpShell` dispatches through an exhaustive `switch` over `IdpPanelSpec`, so a new panel kind
  fails the build until it has a body.
- **Content:** breadcrumbs header + page + status bar — with ONE exception: **API Docs** renders
  with neither, because the reference IS the destination and the canvas is Scalar's. `IdpShell`
  passes `showHeader={false} showStatusBar={false}` (new `IdpShell` props); the DS grew the same
  opt-outs — `AppShell.showHeader` (default `true`) drops the whole header row even when crumbs are
  passed (`breadcrumbs={[]}` alone only clears the crumbs; the fullscreen toggle keeps the row), and
  `statusBar={null}` drops the footer, the same null-drops-it shape as `panel`. The freed strip is
  48px header + its 4px margin + the 28px bar; every other consumer keeps its chrome, so the
  switches default to on. Pinned by `app-shell.test.tsx` (both sides) +
  `e2e/shell-viewport.spec.ts` (the api-docs page against the `/#/idp` control).
- **Height:** the app frame IS the viewport (`100svh` — the unit the rail/sidebar are sized with)
  and the shell FILLS it: `studio.css` pins the wrapper (`height: 100%`) and hands the scroll to
  the content column, so a page longer than the viewport scrolls UNDER the pinned rail, panel,
  header and status bar instead of stretching the shell — and the sidebar element with it — to
  the content height. Pinned by `e2e/shell-viewport.spec.ts`.
- **Narrow (`< md`):** the rail is hidden, so `AppShell` renders a `SidebarTrigger` in the
  header (only when a `rail` AND a sidebar exist) — the ONLY way to reach the panel, which opens
  the existing mobile Sheet with the same panel body inside. Without a sidebar (`panel={null}`)
  there is nothing to open, so the trigger is dropped and the parent breadcrumbs stay visible on
  small screens — they are the only way back out. On the API Docs page that header is gone by
  design, so below `md` — rail hidden too — the browser's own back affordance is the way out.
- **Theme:** rail/panel use the existing sidebar surface tokens, so white-label (`tenant-theme.ts`)
  applies automatically. In dark mode those tokens are the API reference's neutral ramp
  (`#0f0f0f` chrome, `#1a1a1a` raised, `#2d2d2d` hairlines — see `studio.css`), so the two tiers
  are separated by hairline borders and the active chip rather than by tinted tiers; teal remains
  the brand accent.
- **i18n:** labels via `t()` with the literal as fallback (existing `lib/i18n.ts`); icons never
  reflow with label length.

### 4.4 The Collections move (flagship)

- New `components/collections/CollectionsPanel.tsx` — the container that today lives in
  `CollectionsWorkbench`: `collectionsQuery` + `studioUiStore` filters (`registryQuery`,
  `showHiddenCollections`), hide/show + delete handlers, `+ New collection`, and
  `CollectionsRegistryList` (unchanged, presentational) inside. It also OWNS collection
  lifecycle (create + delete dialogs) — create where the list is (SSOT/Poka-Yoke: one entry
  point, not two).
- `CollectionsWorkbench` drops its left pane (`StudioLayout` `left` slot), the left
  `CollectionsPaneToggle` and its own New-collection button; the right palette pane stays. It
  renders `IdpShell` instead of a bare `StudioLayout`, so the workbench route participates in
  the same two-tier chrome (with the Table/Schema toggle in `headerChildren`).
- Selection writes `?collection=<slug>` (replace, `useViewState`) exactly as today; the
  workbench watches `selected` and clears transient local state (record/schema dialogs,
  row selection) on change — the cleanup `selectCollection()` does today.
- `⌘K` palette gains the section/panel entries from the same registry.
- **As built, the same shape was reused for ROLES** — the pattern generalizes past the flagship:
  `RolesPanel` owns the role registry (list + create + search, `?role=` view state) and
  `RolesTab` keeps only the editor, with ONE optional `roleId` prop deciding which half it owns
  so Studio Admin (no shell panel) still gets its rail. The panel/pages split is per-CONCERN, not
  per-surface: whichever surface owns the registry renders the list exactly once.
- **As built, that editor is ONE table with TWO views — not a grid of cards** — the tab beside the
  registry used to state the same role twice in two interaction languages: a governance summary
  card (five stat tiles) plus a "Mini-app board" of loose checkboxes next to the collection matrix.
  The summary card is gone (the per-row `Attributes & RLS` notes and the checkboxes already carry
  its facts; the tiles were ink, not information) and the app board became the SAME table, switched
  by a `ToggleGroup` in the table's label area: `Collections` (the default, pressed on mount) |
  `Apps`. The app view even reuses the flag columns' tri-state master toggle for its `Open` column,
  so in BOTH views a column acts on exactly the rows ON SCREEN. The two views save with the
  granularity of their write — the matrix per row, the board whole (`app_access` is one field, so
  one `Save board` gated by `sameBoard`) — and both feed the one `N unsaved` pill.

## 5. Security / STRIDE (delta only)

| Threat | Mitigation |
| --- | --- |
| Elevation | Rail/panel are navigation only; every destination keeps its existing route guard. `adminOnly` hides UI (PoLP), the API remains the authority |
| Information disclosure | Panel reads go through the same RBAC'd queries as today; no new endpoint, no new data |
| Tampering | No new write path |

## 6. Phases

| Phase | Deliverable |
| --- | --- |
| **P1** | Registry + `NavRail` + `AppShell` slots + IDP shell rewired + Collections panel move + tests |
| **P2** | Fold Studio Admin's 13 tabs into `⛨ Access` / `⚙ Governance` panels and delete the duplicate Users/Roles surfaces |
| **P3** | Panel badges/counts; rail overflow menu if domains exceed 7±2 |

## 7. Tests & verification

- **Pure (studio):** `lib/idp-nav.spec.ts` (15) — `activeSectionForPath` (root, deep paths,
  app-detail fallback, unknown), `visibleSections` (admin gate), registry integrity (unique ids,
  every `match` owned once, `match` covers `path`, ≤9 sections), and the panel-kind split
  (`access` ⇒ `roles`; `overview`/`users`/`api-docs` ⇒ `none`). Three pins guard what was REMOVED:
  no `release` / `insights` section exists at all (their one page each went, so the domain did
  too), a bookmark to any of the four dropped paths (`/idp/deployments`, `/idp/audit`,
  `/idp/environments`, `/idp/usage`) resolves to Catalog (the app-detail lane, no special
  redirect), and Overview carries no panel at all.
- **Component (design-system):** `appshell/nav-rail.test.tsx` — renders one button per item with
  accessible names, active carries `aria-current`, click fires `onSelectItem`, footer slot renders.
  `appshell/app-shell.test.tsx` (3) — the `panel` switch: `null` drops the sidebar column, its gap
  and the mobile trigger; a node and `undefined` both keep it (a node replaces the nav lists).
  `sidebar/sidebar.test.tsx` (6) — the `collapsible: false` pin from BOTH sides: the default still
  collapses on ⌘/Ctrl+B and still honours `sidebar_state=false`, while a pinned provider ignores
  the shortcut, ignores the strip's click, boots expanded despite the same stale cookie, keeps the
  strip as a resize-only grip (`aria-label="Resize sidebar"`), and drops the strip entirely when
  the sidebar is not resizable.
- **Component (studio, jsdom):** `components/idp/IdpRail.spec.tsx` (3) — the rail's click contract
  against the REAL `SidebarProvider` state: clicking the active icon twice keeps the panel expanded,
  clicking it while collapsed re-expands it (the old `toggleSidebar()`-on-active gesture fails all
  three), and clicking another section expands AND navigates. `components/CommandPalette.spec.tsx` — asserts the option count
  against `visibleSections()` (2 static + one row per section), so the palette and the rail can
  never disagree. `components/collections/CollectionsPanel.spec.tsx` (3) — the moved list renders
  from the same query/filter chain (hidden out until revealed, header count = rows on screen),
  a row pick writes `?collection=` as a REPLACE, and the empty state states it is empty.
- **Component (studio, jsdom) — the roles move:** `components/idp/RolesPanel.spec.tsx` (5) — the
  registry standalone: role rows with the header count and the `sys` badge, a search that filters
  from CLIENT state and never touches the URL, `?role=` focus with a second pick REPLACING the
  first (view state, not history), the empty registry, and create → focus the new role.
  `components/admin/roles-tab.spec.tsx` (15) — the two mounts, one prop apart: with no `roleId` the
  tab OWNS the registry (rail rendered, first role default-selected, New role reachable), and with
  a `roleId` handed in (the portal's shape) the rail is absent and the editor is inert without it —
  so the roles are listed exactly once per surface. The mutation control (rail wrapper forced to
  always render) fails exactly the controlled-mount case. The same file pins the two-view table:
  the switch defaults to Collections and swaps the body in place, the app table renders the module
  registry through the same shape, the board's master toggle writes the EXPLICIT list behind a
  filter but the unrestricted `null` when every shown app is opened unfiltered, `Save board` is
  gated by `sameBoard`, the board counts into the `N unsaved` pill, and an empty registry states
  itself (and what the board means for a later app).
- **E2E (Playwright, `apps/studio/e2e/`):** `portal-home.spec.ts` — Users and Roles & Access are
  two rail buttons; Users lands on its own route with NO sidebar column, Roles & Access lands on
  its own route WITH one holding the role rows and a `Search roles` box. Two controls keep that
  honest: **Catalog** (the multi-page domain — panel present, carrying its own Create row and no
  role search) and, on the other side, **Release / Insights being absent from the rail entirely**
  (their one page each was dropped, so the sections went with them). The LANDING page is pinned as
  panel-less too, and that has a consequence the same test records: the account menu lives in the
  panel FOOTER, so `/#/idp` carries no account menu and ⌘K is its sign-out (`Log out` is asserted as
  a palette row there) — the menu half of the test is therefore driven on Catalog, a panel-bearing
  section. A third test drives the removed paths: `/#/idp/deployments`, `/#/idp/audit`,
  `/#/idp/environments` and `/#/idp/usage` each render `App not found` through the `/idp/:slug`
  catch-all with the rail on Catalog, so a future "helpful" redirect cannot silently resurrect a
  deleted surface. `shell-viewport.spec.ts` — the API Docs page renders neither the header slot nor
  the status bar and its inset starts at y=0, with `/#/idp` keeping both; the two-tier geometry
  (rail + panel container + wrapper + inset, each exactly one viewport tall) is measured on a
  PANEL-BEARING section, since the panel-less landing page has no container to measure. Below `md`
  that panel-less shape is stark: measured live at 480px, `/#/idp` has the rail hidden, no sidebar
  and no trigger — the landing page carries NO navigation there, the trade this removal buys
  (named, not papered over; a phone's nav is the panel-bearing sections' Sheet).
- **Commands (evidence):** `pnpm --filter @mmbix/design-system build && pnpm --filter @mmbix/design-system test`
  (9 files, 66 passed), `cd apps/studio && npx tsc --noEmit && pnpm test` (44 files, 473 passed:
  `lib/role-matrix.spec.ts` 17 pure + `lib/idp-nav.spec.ts` 15 pure incl. the Release/Insights
  removal pin, the four removed paths' fall-through and the Overview panel-less pin +
  `components/admin/roles-tab.spec.tsx` 15 jsdom) `&& npx vite build && pnpm check:bundle`
  (total 5.13 MB, entry 0.02 MB), and `pnpm --filter @mmbix/studio test:e2e` (7 passed).
- **Live (this repo's own dev servers — port 5174/8788 belonged to a sibling checkout):** at a
  1280px viewport the rail measured x=0 w=48, `--rail-width=3rem`, the panel gap/container x=48
  w=224. The panel cannot be hidden at all: a `sidebar_state=false` cookie set BEFORE boot still
  rendered `data-state="expanded"`, ⌘/Ctrl+B left the gap at 224 with `defaultPrevented === false`
  (the combo is left to the app), a click on the edge strip left it at 224 (the strip reads
  `aria-label="Resize sidebar"` / `title="Drag to resize"` — no collapse promise), and a
  double-click on the active rail icon left the gap at 224 and the inset at x=272 — the nav cannot
  slide away under the pointer. A rail click on another section pushed `#/idp/access` (7→8) with the
  panel still expanded, while a panel row wrote `?collection=sales_orders` at
  `history.idx` unchanged (replace). ⌘K listed 10
  rows (2 static + 8 registry sections); at 480px the rail is `display:none`, the header trigger is
  `display:flex` and opens the Sheet with the same panel body — the pin did not cost mobile its
  Sheet. On `/idp/api-docs` (`panel={null}`)
  there is NO `[data-slot="sidebar"]`/`-gap`/`-trigger` at any width and the inset starts at x=48
  (full-bleed next to the rail), while every other section still renders its panel. On `/#/idp`
  (Overview) that same `panel={null}` shape now holds — the landing page renders no sidebar column
  either, its rail being the nav — measured later at 480px as rail hidden + sidebar 0 + trigger 0. On
  `/#/idp/access` the panel measured x=48 w=224 h=720 (rail x=0 w=48) and listed the REAL
  `Administrator` role with its `sys` pill and `aria-current="true"`, the URL took
  `?role=<uuid>`, the `Search roles…` box filtered the rows without touching the URL, and one
  `goBack()` left the screen (one history entry per screen — the view-state contract).

## 8. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Two clicks to a nested list | ⌘K palette (exists), panel remembers per-section content, deep links unchanged |
| Icon ambiguity for non-technical users | Tooltips on hover **and** focus; accessible names; panel header states the section |
| Shell remount per navigation resets panel state | A8 — provider seeds `from` the cookie it already writes |
| `?collection=` changes from outside the workbench | One watcher in the workbench clears transient state; pinned by a spec |
| DS change breaks other consumers | All deltas additive (`rail`/`panel` optional; `--rail-width` defaults to 0) |

## 9. Reuse map

| Need | Artifact |
| --- | --- |
| Sidebar primitive (offcanvas, resize, ⌘B, Sheet) | `packages/design-system/src/components/sidebar/index.tsx` |
| Registry-list UI | `apps/studio/src/components/collections/RegistryList.tsx` |
| Registry filters (client state) | `studioUiStore` (`registryQuery`, `showHiddenCollections`) |
| Section SSOT precedent | `apps/studio/src/lib/app-sections.ts` + spec |
| RBAC surface gating | `lib/use-me.ts`, `lib/capabilities.ts` |
| URL/history contract | `lib/view-state.ts` (`useViewState`, `popBack`) |
| Keyboard fast path | `components/CommandPalette.tsx`, `lib/command-palette.ts` |
| Theme | `lib/tenant-theme.ts`, `ThemeToggle`/`ThemeMenuItem` |
