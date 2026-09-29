# Studio ⇄ Scalar parity — font, theme, accent

**Date:** 2026-09-29
**Status:** approved (design) — plan:
[`docs/superpowers/plans/2026-09-29-studio-scalar-parity-plan.md`](../plans/2026-09-29-studio-scalar-parity-plan.md)
**Scope:** `apps/studio` (the only place Scalar is embedded) + one additive change to
`packages/design-system`'s theme provider.

## 1. Problem

The Studio embeds Scalar's API reference (`@scalar/api-reference-react`) at `/idp/api-docs`.
The two surfaces do not read as one system. Three separate causes, two of them measured:

| # | Symptom | Measured cause |
|---|---|---|
| 1 | Different typeface | Scalar asks for `"Inter"` / `"JetBrains Mono"` and **ships no font files** (0 `@font-face` in its CSS and library JS builds). Our app ships `Inter Variable` / `Geist Mono` only. Live DOM measurement (16px, 55-char string): Scalar's stack renders **420.95px = exactly `system-ui`** (i.e. SF Pro on macOS); bare `"Inter"` renders **376.38px = identical to a nonexistent family** (not installed). Our stack renders **438.96px**. Two typefaces, ~4.3% width delta. |
| 2 | Theme toggle does not reach Scalar | Scalar's `useColorMode` writes `dark-mode`/`light-mode` on **`document.body`** and resolves mode as `overrideColorMode → localStorage['colorMode'] → initialColorMode`. With no override it follows **the OS**, never our `<html class="dark">`. Verified by reading `@scalar/use-hooks/dist/useColorMode/useColorMode.js` and live probing. |
| 3 | "Our buttons are still green" | **Premise correction.** Scalar's primary button is `--scalar-button-1: #fff` (dark) / `#000` (light) — a high-contrast *neutral*, not blue; its blue `#09f` is for links/active states only. The real defect is **accent area**: 15 sites in the Studio paint their *active state* with a teal (`--primary`) fill, so teal means "you are here" and "this is the action" at the same time, and the chrome looks saturated next to a nearly accent-free docs page. |

**Decisions (user, 2026-09-29):**

1. **Font** — align both families to ours (prose → `Inter Variable`, code → `Geist Mono`; no new dependency) and align the base weight.
2. **Theme** — the remount approach: our resolved theme drives `forceDarkModeState`, Scalar's own toggle is hidden.
3. **Accent** — keep teal; **reduce its area**: teal is reserved for the one primary action per surface, active-state pills become neutral.

## 2. Design

### 2.1 Font parity — one CSS block, no JS

Scalar declares its font tokens inside `@layer scalar-base { :root { … } }`. **Unlayered
rules beat any layered rule** in the cascade regardless of specificity — so a plain `:root`
block in `apps/studio/src/studio.css` wins with no `!important` and no specificity games,
and Vite's later injection of Scalar's lazy-loaded CSS does not matter.

```css
/* The embedded Scalar API reference must read as the same system: point its font
   tokens at ours. Unlayered :root beats Scalar's @layer scalar-base block. */
:root {
  --scalar-font: var(--font-sans);
  --scalar-font-code: var(--font-mono);
  /* Literal on purpose: our base weight lives in theme.css's `@theme inline`, which
     Tailwind INLINES into the utility — there is no runtime `--font-weight-normal`
     to reference (verified: 0 occurrences in the built CSS). */
  --scalar-font-normal: 420;
}
```

- `--scalar-font` (14 usages) → `Inter Variable, Noto Sans Myanmar Variable, sans-serif`.
  Both that and `--font-mono` **are** live vars in the Studio bundle (verified in the built
  CSS), so `var()` references are safe here.
- `--scalar-font-code` (28 usages) → `Geist Mono, Noto Sans Mono, monospace`. **No new
  dependency**: Geist Mono already ships, and code samples then match every other code
  surface in the Studio.
- Weights: only `normal` differs (Scalar 400 → our 420); `--scalar-font-medium` (500) and
  `--scalar-font-bold` (700) already agree, so they are deliberately not restated.
- Fails safe: if a future Scalar renames its variables the override simply stops applying —
  no crash, no half-state.

### 2.2 Theme sync — resolved theme out of the DS, remount into Scalar

**Step 1 — `packages/design-system`'s theme provider exposes `resolvedTheme`.**

Today `useTheme()` returns `{ theme, setTheme }` where `theme` may be `'system'`; the rule
"what does `'system'` resolve to" lives inside `applyTheme` and is not observable. Feeding
Scalar therefore needs that rule in a second place — the drift class this repo keeps
removing. Instead:

- `ThemeProviderState` gains `resolvedTheme: 'dark' | 'light'`.
- It is derived with `React.useSyncExternalStore` over `matchMedia('(prefers-color-scheme: dark)')`
  (`getServerSnapshot` → `'light'`), so it is a single source of truth, re-renders on OS change,
  and needs no setState-in-effect.
- `applyTheme` and the `'d'` keyboard shortcut consume `resolvedTheme`; the provider's own
  `matchMedia` listener effect is deleted (the store subscription now covers it).
- Additive: no existing consumer breaks; the `<html>` class contract, transition suppression,
  `storage` + `mmbix:theme-change` wiring are unchanged.

**Step 2 — `ApiDocsTab` drives Scalar from it.**

```tsx
const { resolvedTheme } = useTheme();
…
<ApiReferenceReact
  key={resolvedTheme}
  configuration={{
    content: spec,
    forceDarkModeState: resolvedTheme,
    hideDarkModeToggle: true,
    onBeforeRequest: …,
  }}
/>
```

- `forceDarkModeState` is the hard switch (beats localStorage and the OS).
- `hideDarkModeToggle: true` because with the mode forced Scalar's own toggle is a lie
  (it would write a localStorage value we ignore). One theme control per app — ours, in the
  rail footer and the user menu.
- **Why the `key`:** reading `ApiReference.vue.script.js:285-292`, `useColorMode` captures
  `overrideColorMode` **once at Vue setup**, and `applyColorMode` only re-runs when
  `colorMode`/the OS preference change. The React wrapper does forward config updates
  (`updateConfiguration`), but that will *not* re-apply the body class — so a dynamic
  `forceDarkModeState` alone leaves Scalar stuck on its mount-time mode. Remounting on
  `resolvedTheme` is deterministic; the cost (Scalar re-parses the in-memory spec and resets
  scroll) is paid only on an explicit theme toggle. Accepted.

### 2.3 Accent discipline — teal stops meaning "active", keeps meaning "the action"

**Premise correction first (do not implement a colour swap):** Scalar's primary is a
high-contrast neutral (`#fff` on dark / `#000` on light) and its secondary buttons are
`#272727` — which our dark `--secondary`/`--accent` already equals. Adopting "Scalar's button
colour" would mean removing hue from our primary CTA: it costs the primary affordance
(preattentive processing — the one action stops popping), loses the brand, and collides with
the teal focus ring and rail. Our teal stays.

**What actually changes — where teal is spent.**

Inventory (scanned from `apps/studio/src`):

- **15 sites whose *active* branch is painted `--primary`** (`variant={… ? 'default' : …}` on
  `Button`) — classified by shape in the table below; 13 of them are real toggles.
- **44 true CTAs** with a teal fill (`variant` omitted or literal `"default"`) — almost all
  exactly one per dialog/surface, which is correct and stays. Six files hold more than one
  (`IdpDeploymentsPage.tsx` 3, `NewCollectionDialog.tsx` 2, `MenuBuilder.tsx` 2,
  `admin/api-keys-tab.tsx` 2, `admin/users-tab.tsx` 2, `admin/roles-tab.tsx` 2). The rule is
  ≤1 teal CTA per **rendered** surface: a dialog's submit is the CTA of the dialog surface,
  so two CTAs that never render together both stay; two that do render together are resolved
  by keeping the submit teal and demoting the other to `outline`.

**The 13 real toggles are three different shapes — so the change is a token swap, not a new
component.** Every one of them is a two-branch `variant` ternary whose *active* branch is
`'default'` (i.e. `--primary`); the fix is the one word in that branch.

| # | Shape | Sites | Ternary |
|---|---|---|---|
| A | pill on a **muted track** (`var(--mmbix-muted, …)` = `#1a1a1a` dark / `#f1f5f9` light) | `builder/AppWorkbenchHeader.tsx` 75, 100, 111 · `pages/CollectionsWorkbench.tsx` 758, 767 · `components/MenuInspector.tsx` 228 · `components/PageInspector.tsx` 1004 · `components/PageCanvas.tsx` 987 — **8** | `active ? 'default' : 'ghost'` |
| B | trackless single-select | `builder/NewCollectionDialog.tsx` 136, 139 · `components/ImageEditorDialog.tsx` 419 — **3** | `active ? 'default' : 'outline'` |
| C | one pressed toggle (both are the Trash switch) | `pages/CollectionsWorkbench.tsx` 664 · `app/AppDataPane.tsx` 322 — **2** | `on ? 'default' : 'outline'` |
| D | **not toggles** — no change | `components/GenerationPanel.tsx` 205 (reject/approve CTA pair) · `admin/addons-tab.tsx` 109 (Install/Remove CTA) — 2 | `'outline' : 'default'` |

**13 one-word edits (`'default'` → `'secondary'`) across 8 files.** The active state keeps its
preattentive "you are here" role but stops also claiming to be *the action*: `--secondary` is
the DS's already-defined raised neutral (`#272727` dark / `#e2e8f0` light) carrying its own
`--secondary-foreground`, so a shape-A pill's delta becomes `#272727` on `#1a1a1a` — Scalar's
raised-chip delta exactly.

A shared `Segmented` component (promote the local `ToggleGroup` wrapper from
`components/formlayout/properties.tsx` and migrate all 15) was **considered and rejected
(YAGNI)**: the three shapes carry bespoke geometry (`width: 28`, `flex: 1`, `size="xs"`) and
different option sources, so a shared component would need a `track` / `size` / `itemStyle`
options bag existing only to serve its own callers — and it would prevent nothing, because the
defect is a *token*, not a missing abstraction. The swap reaches the same end with a
13-character diff and no geometry risk, and the token stays single-sourced in
`buttonVariants`. (It is also the Studio's first `variant="secondary"` — the DS variant
existed with no consumer; the live check in §4 covers the new surface.)

Neutrality is the point: the DS `Toggle`'s own pressed token is `bg-muted`
(`aria-pressed:bg-muted`; its `data-[state=on]:bg-muted` sibling never matches, because Base
UI's Toggle emits `aria-pressed` + a boolean `data-pressed`, never `data-state="on"`), so the
13 sites now agree with the one toggle component the DS already ships. That dead class is
reported in §6, not fixed here.

## 3. Files

| File | Change |
|---|---|
| `apps/studio/src/studio.css` | `:root` Scalar font-token override |
| `packages/design-system/src/components/theme-provider/theme-provider.tsx` | expose `resolvedTheme`; `applyTheme`/shortcut consume it; drop the duplicate media listener |
| `packages/design-system/src/components/theme-provider/theme-provider.test.tsx` | **new** — `resolvedTheme` for the three `theme` values + OS-follow for `'system'` |
| `apps/studio/src/components/ApiDocsTab.tsx` | `key` + `forceDarkModeState` + `hideDarkModeToggle` |
| 8 files / 13 sites | active branch `'default'` → `'secondary'` (shapes A/B/C in §2.3) |
| ≤6 files | demote a second teal CTA on a shared surface to `outline` |

## 4. Tests & verification

- **DS:** `pnpm --filter @mmbix/design-system build && pnpm --filter @mmbix/design-system test`
  (new `theme-provider.test.tsx` alongside the existing DS spec files).
- **Studio:** `npx tsc --noEmit && pnpm test` (the existing jsdom specs already render the
  swapped toolbars — `AppWorkbenchHeader.spec.tsx` and friends; the swaps add no new spec,
  because a unit test asserting a CSS class is not the property we care about), `npx vite build`,
  `pnpm check:bundle` (entry stays ~0.02 MB — no new static import).
- **Live (dev servers on 5174/8788, same-origin probe):**
  - `/idp/api-docs` — the computed `--scalar-font` / `--scalar-font-code` resolve to our
    stacks, and a measured text run inside `.scalar-app` now matches an `Inter Variable`
    control run (not `system-ui`).
  - theme toggle on that route — `document.body` class flips `light-mode` ⇄ `dark-mode` with
    our `<html>` class, and `getComputedStyle(body).getPropertyValue('--scalar-background-1')`
    follows (`#fff` ⇄ `#0f0f0f`). Also: the dark/light toggle control Scalar renders inside
    `.scalar-app` before this change is gone (`hideDarkModeToggle` took effect).
  - accent — per route (`/apps/:slug`, `/idp/collections`, `/idp/catalog`), count
    `button.bg-primary` and assert ≤1 per rendered **surface**, and that each of the 13
    swapped toggles' *active* branch computes to `--secondary` (`#272727` dark / `#e2e8f0`
    light), not `--primary`.

## 5. Risks & mitigations

- **Scalar rename of a font variable** → override silently stops applying (no crash). Accepted;
  the live check in §4 catches it in the same pass.
- **Remount cost on theme toggle** → only on an explicit toggle; scroll resets on that page.
  Accepted for determinism over a class-mirroring race (Scalar's `applyColorMode` re-writes
  its stale forced value whenever the OS preference changes).
- **A filled neutral pill can read as "disabled" where there is no track to contrast against**
  (shapes B/C: `--secondary` `#272727` sits straight on `#0f0f0f`) → the treatment is the same
  one Scalar's own pressed chips use, and the inactive sibling stays a bordered `outline`, so
  the pair still reads as a segmented choice; the per-route live check covers every site, and a
  site that reads wrong can revert to `outline` + `aria-pressed` without touching the token.
- **The swaps touch toolbars, so geometry must not move** → each is a one-word `variant`
  change: no width/height/font-size/`aria` attribute is edited, and the sites keep their
  existing `aria-pressed` / `aria-current`. The live check re-measures the migrated controls.
- **`--scalar-font-normal` at 420** (a literal, since the DS token has no runtime var) is a
  deliberate deviation from Scalar's 400; magnitude is ~0.19% width (439.79px vs 438.96px on
  a 55-char run), so the live check compares families, not weights.

## 6. Out of scope

- Scalar's accent (`#09f`) and its own component shapes — untouched.
- The DS `Toggle` / `ToggleGroup`'s own pressed token — stays `bg-muted`; the Studio's 13
  toggles are `Button`s, so the DS component is not touched at all.
- **Observed but not changed:** the DS `toggle`'s `data-[state=on]:bg-muted` never matches
  (Base UI emits `data-pressed`), so it is dead. Harmless, out of scope for this change.
- The local `Segmented` wrapper in `components/formlayout/properties.tsx` — it already
  renders neutral active states, so it is left as it is.
- Any change to the DS `--primary` / teal brand token.
- The 44 CTAs that are already one-per-surface.
