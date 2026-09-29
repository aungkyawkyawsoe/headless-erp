# Studio Activity Bar — Three-Tier Navigation — Design

> **Date:** 2026-09-29 · **Status:** APPROVED (user, 2026-09-29) — Phase 1 in implementation · **Scope:** `apps/studio` (IDP portal shell) + `packages/design-system`

## 0. TL;DR

The IDP portal navigates through **one flat text sidebar of 11 items** (Backstage-style), and Studio Admin adds **13 more tabs** on a second surface — 24 destinations in lists that grow with every module. Replace the IDP shape with VS Code's:

- **Tier 1 — Activity Bar (rail):** a persistent 3rem icon column, 7 **domains** (`⌂ Overview · ▦ Catalog · ▤ Collections · ⛨ Access · ⌸ Release · ◔ Insights · ⚙ Governance`), bottom cluster (theme, user).
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
  <AppSidebar panel={<SectionPanel/>}/>← offcanvas; header = existing module switcher
  <SidebarInset>{children}</SidebarInset>  ← offset by --rail-width (0 ⇒ today's layout)
</SidebarProvider>
```

## 4. Contracts

### 4.1 The registry (SSOT)

```ts
// apps/studio/src/lib/idp-nav.ts
export type IdpSectionId = 'overview' | 'catalog' | 'collections' | 'access' | 'release' | 'insights' | 'governance';

export type IdpPanelSpec =
	| { kind: 'none' }                                                          // Overview: full-bleed dashboard
	| { kind: 'collections' }                                                   // CollectionsPanel
	| { kind: 'links'; items: Array<{ label: string; path: string }> };         // LinksPanel

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
| ⌂ Overview | none | `/idp` |
| ▦ Catalog | links: Catalog, Create | `/idp/catalog`, `/idp/create`, `/idp/:slug` (app detail) |
| ▤ Collections | collections | `/idp/collections`, `/idp/collections/:slug` |
| ⛨ Access | links: Roles & Access, Users | `/idp/access`, `/idp/users` |
| ⌸ Release | links: Environments, Deployments | `/idp/environments`, `/idp/deployments` |
| ◔ Insights | links: Usage, Audit | `/idp/usage`, `/idp/audit` |
| ⚙ Governance | links: Policies | `/idp/policies` |

### 4.2 Design-system deltas

```ts
// NavRail (new) — packages/design-system/src/components/appshell/nav-rail.tsx
interface NavRailItem { id: string; label: string; icon: LucideIcon }
interface NavRailProps {
	items: NavRailItem[];
	activeId?: string;
	onSelect: (item: NavRailItem) => void;
	top?: React.ReactNode;      // brand mark → home
	footer?: React.ReactNode;   // theme toggle + user menu
	ariaLabel?: string;
}

// AppShell (additive)
interface AppShellProps {
	rail?: React.ReactNode;        // rendered first in the provider row
	panel?: React.ReactNode;       // replaces NavMain/NavProjects inside SidebarContent
	hideSidebarFooterUser?: boolean; // the rail owns the user menu
}
```

`SidebarProvider` sets `--rail-width` (default `0rem`) and seeds `_open` from the persisted
cookie; `Sidebar`/`SidebarInset` offset by `--rail-width`. A surface without a rail sees zero
delta.

### 4.3 Composition spec

- **Rail:** 3rem wide (reuse `SIDEBAR_WIDTH_ICON`), 48px rows, 20px icons. States: default
  (muted icon), hover (tinted bg), **active** (2px inline-start accent bar + tinted bg +
  `aria-current="page"`), focus-visible ring. Tooltip = `label` (hover **and** focus).
  Bottom: theme toggle + user avatar menu (compact `NavUser`).
- **Panel:** 14rem default (resizable 12–30rem, persisted today), ⌘/Ctrl+B toggle, header =
  existing module switcher; body = section title + the section's list; empty/loading/error
  states belong to each panel component (Information Visibility).
- **Content:** unchanged — breadcrumbs header + page + status bar.
- **Narrow (`< md`):** the rail is hidden; the panel keeps its existing Sheet behaviour and its
  body gains the section list inline (the mobile path stays whole, just narrower).
- **Theme:** rail/panel use the existing sidebar surface tokens; three depth levels (rail
  darkest → panel → content) come from tokens, so white-label (`tenant-theme.ts`) applies
  automatically.
- **i18n:** labels via `t()` with the literal as fallback (existing `lib/i18n.ts`); icons never
  reflow with label length.

### 4.4 The Collections move (flagship)

- New `components/collections/CollectionsPanel.tsx` — the container that today lives in
  `CollectionsWorkbench`: `collectionsQuery` + `studioUiStore` filters (`registryQuery`,
  `showHiddenCollections`), hide/show + delete handlers, `+ New collection`, and
  `CollectionsRegistryList` (unchanged, presentational) inside.
- `CollectionsWorkbench` drops its left pane (`StudioLayout` `left` slot) and the left
  `CollectionsPaneToggle`; the right palette pane stays.
- Selection writes `?collection=<slug>` (replace, `useViewState`) exactly as today; the
  workbench watches `selected` and clears transient local state (record/schema dialogs,
  row selection) on change — the cleanup `selectCollection()` does today.
- `⌘K` palette gains the section/panel entries from the same registry.

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

- **Pure (studio):** `lib/idp-nav.spec.ts` — `activeSectionForPath` (root, deep paths, app-detail
  fallback, unknown), `visibleSections` (admin gate), registry integrity (unique ids, every
  `match` owned once).
- **Component (design-system, vitest):** `nav-rail.spec.tsx` — renders one button per item with
  accessible names, active carries `aria-current`, click fires `onSelect`, footer slot renders.
- **Component (studio, jsdom):** `CollectionsPanel.spec.tsx` (renders rows from a mocked query,
  selection updates the URL) and the workbench regression: the left pane is gone, right pane and
  content still render.
- **Commands (evidence):** `pnpm --filter @mmbix/design-system build && pnpm --filter @mmbix/design-system test`,
  `cd apps/studio && npx tsc --noEmit && pnpm test && npx vite build && pnpm check:bundle`,
  and the Playwright smoke (`pnpm --filter @mmbix/studio test:e2e`, login-only — unaffected).

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
