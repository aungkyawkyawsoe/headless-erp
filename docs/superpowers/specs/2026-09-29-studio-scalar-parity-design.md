# Studio ⇄ Scalar parity — font, theme, accent

**Date:** 2026-09-29
**Status:** approved (design) — implementation plan pending
**Scope:** `apps/studio` (the only place Scalar is embedded) + one additive change to
`packages/design-system`'s theme provider.

## 1. Problem

The Studio embeds Scalar's API reference (`@scalar/api-reference-react`) at `/idp/api-docs`.
The two surfaces do not read as one system. Three separate causes, two of them measured:

| # | Symptom | Measured cause |
|---|---|---|
| 1 | Different typeface | Scalar asks for `"Inter"` / `"JetBrains Mono"` and **ships no font files** (0 `@font-face` in its CSS and library JS builds). Our app ships `Inter Variable` / `Geist Mono` only. Live DOM measurement (16px, 55-char string): Scalar's stack renders **420.95px = exactly `system-ui`** (i.e. SF Pro on macOS); bare `"Inter"` renders **376.38px = identical to a nonexistent family** (not installed). Our stack renders **438.96px**. Two typefaces, ~4.3% width delta. |
| 2 | Theme toggle does not reach Scalar | Scalar's `useColorMode` writes `dark-mode`/`light-mode` on **`document.body`** and resolves mode as `overrideColorMode → localStorage['colorMode'] → initialColorMode`. With no override it follows **the OS**, never our `<html class="dark">`. Verified by reading `@scalar/use-hooks/dist/useColorMode/useColorMode.js` and live probing. |
| 3 | "Our buttons are still green" | **Premise correction.** Scalar's primary button is `--scalar-button-1: #fff` (dark) / `#000` (light) — a high-contrast *neutral*, not blue; its blue `#09f` is for links/active states only. The real defect is **accent area**: 15 segmented controls in the Studio render their *active state* as a teal (`--primary`) fill, so teal means "you are here" and "this is the action" at the same time, and the chrome looks saturated next to a nearly accent-free docs page. |

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

- **15 hand-rolled active-state toggles** — `variant={active ? 'default' : 'ghost'}` on
  `Button`, i.e. the *active* segment is painted `--primary`:
  `builder/AppWorkbenchHeader.tsx` (74, 100, 111), `pages/CollectionsWorkbench.tsx`
  (662, 757, 766), `builder/NewCollectionDialog.tsx` (136, 139),
  `app/AppDataPane.tsx` (320), `GenerationPanel.tsx` (202), `ImageEditorDialog.tsx` (419),
  `MenuInspector.tsx` (226), `PageCanvas.tsx` (984), `PageInspector.tsx` (1002),
  `admin/addons-tab.tsx` (108). (≈11 groups; 100/111, 136/139 and 757/766 are pairs.)
- **44 true CTAs** with a teal fill (`variant` omitted or literal `"default"`) — almost all
  exactly one per dialog/surface, which is correct and stays. Six files hold more than one
  (`IdpDeploymentsPage.tsx` 3, `NewCollectionDialog.tsx` 2, `MenuBuilder.tsx` 2,
  `admin/api-keys-tab.tsx` 2, `admin/users-tab.tsx` 2, `admin/roles-tab.tsx` 2). The rule is
  ≤1 teal CTA per **rendered** surface: a dialog's submit is the CTA of the dialog surface,
  so two CTAs that never render together both stay; two that do render together are resolved
  by keeping the submit teal and demoting the other to `outline`.

**The 15 toggles migrate to the DS component that already exists.** The DS ships
`ToggleGroup` / `ToggleGroupItem` (Base UI) whose pressed state is a **neutral `bg-muted`**
(not `--primary`) — and the Studio already wraps it once, locally, in
`components/formlayout/properties.tsx` (a generic `Segmented` over `ToggleGroup`). Promote
that wrapper to `apps/studio/src/components/Segmented.tsx` (same typed API:
`{ value, options: [{ value, label, title }], onChange, label }`) and migrate the 15 sites.
One implementation of "segmented control", and the active state stops being teal everywhere
at once.

**Token decision inside `Segmented`** (a segmented *track* needs the pill to differ from the
track, which the DS default does not give):

- track → `--muted` (`#1a1a1a` dark / `#f1f5f9` light), as today
- active pill → `--secondary` (`#272727` dark / `#e2e8f0` light) + `--secondary-foreground`

That is Scalar's raised-chip delta exactly (`#272727` on `#0f0f0f`). Applied as one
unlayered rule in `studio.css` (deterministic — no dependence on Tailwind class-merge
ordering):

```css
.mmbix-segmented [data-slot='toggle-group-item'][aria-pressed='true'],
.mmbix-segmented [data-slot='toggle-group-item'][aria-pressed='true']:hover {
  background: var(--secondary);
  color: var(--secondary-foreground);
}
```

**`aria-pressed`, not `data-state`,** because Base UI's Toggle sets `aria-pressed` and a
boolean `data-pressed` attribute (`Toggle.js:77`) — it never emits `data-state="on"`. That
also means the DS `toggle`'s own `data-[state=on]:bg-muted` class is dead code; the pressed
style there comes from its sibling `aria-pressed:bg-muted`, which is why the existing
`Segmented` in `properties.tsx` looks right today.

A standalone DS `Toggle` (not in a track) keeps `bg-muted` — correct there, so the shared
component is not touched.

## 3. Files

| File | Change |
|---|---|
| `apps/studio/src/studio.css` | `:root` Scalar font-token override; `.mmbix-segmented` active-pill rule |
| `packages/design-system/src/components/theme-provider/theme-provider.tsx` | expose `resolvedTheme`; `applyTheme`/shortcut consume it; drop the duplicate media listener |
| `packages/design-system/src/components/theme-provider/theme-provider.test.tsx` | **new** — `resolvedTheme` for the three `theme` values + OS-follow for `'system'` |
| `apps/studio/src/components/ApiDocsTab.tsx` | `key` + `forceDarkModeState` + `hideDarkModeToggle` |
| `apps/studio/src/components/Segmented.tsx` | **new** — promoted wrapper (`mmbix-segmented` class) |
| 10 files / 15 sites | migrate hand-rolled toggles to `Segmented` |
| ≤6 files | demote a second teal CTA on a shared surface to `outline` |
| `apps/studio/src/components/Segmented.spec.tsx` | **new** — jsdom: N options render, the active one carries `aria-pressed="true"`, click fires `onChange` |

## 4. Tests & verification

- **DS:** `pnpm --filter @mmbix/design-system build && pnpm --filter @mmbix/design-system test`
  (new theme-provider spec alongside the existing 6 DS spec files).
- **Studio:** `npx tsc --noEmit && pnpm test` (jsdom spec for `Segmented`), `npx vite build`,
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
    `button.bg-primary` and assert ≤1 per rendered surface, and that every migrated segmented
    control's active pill computes to `--secondary`, not `--primary`.

## 5. Risks & mitigations

- **Scalar rename of a font variable** → override silently stops applying (no crash). Accepted;
  the live check in §4 catches it in the same pass.
- **Remount cost on theme toggle** → only on an explicit toggle; scroll resets on that page.
  Accepted for determinism over a class-mirroring race (Scalar's `applyColorMode` re-writes
  its stale forced value whenever the OS preference changes).
- **Toggle migration touches toolbars** → each migrated site must preserve its geometry
  (width/height/font-size) and its `aria` semantics; `ToggleGroup` is single-select by
  default, matching the current "one active" behaviour. Live check covers the routes that
  render them.
- **`--scalar-font-normal` at 420** (a literal, since the DS token has no runtime var) is a
  deliberate deviation from Scalar's 400; magnitude is ~0.19% width (439.79px vs 438.96px on
  a 55-char run), so the live check compares families, not weights.

## 6. Out of scope

- Scalar's accent (`#09f`) and its own component shapes — untouched.
- The DS `Toggle`'s own pressed token (stays `bg-muted`; only the Studio's segmented track
  overrides).
- **Observed but not changed:** the DS `toggle`'s `data-[state=on]:bg-muted` never matches
  (Base UI emits `data-pressed`), so it is dead. Harmless, out of scope for this change.
- Any change to the DS `--primary` / teal brand token.
- The 44 CTAs that are already one-per-surface.
