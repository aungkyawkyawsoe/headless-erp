# Studio ⇄ Scalar parity — implementation plan

**Spec:** [`docs/superpowers/specs/2026-09-29-studio-scalar-parity-design.md`](../specs/2026-09-29-studio-scalar-parity-design.md)
**Date:** 2026-09-29
**Status:** ready to execute

**Ordering.** Task 2 changes `packages/design-system`, whose **built `dist`** is what
`apps/studio` imports (`AppWorkbenchHeader.spec.tsx:15`, `ThemeToggle.tsx:2` both import from
`@mmbix/design-system`). So the DS build must precede the Studio typecheck/tests in tasks 3–4.
Tasks 1, 2 and 4 touch disjoint files and may be done in any order; task 3 depends on task 2;
task 5 depends on task 4 (its census reads the post-swap state).

**Working-tree discipline.** The repo currently carries unrelated uncommitted work from the
previous session. Stage **only** the files named in this plan; never `git add -A`.

**Dev servers.** `5174` (Studio vite) and `8788` (API) are already listening and must be
**reused as-is — never killed**. `5174/api/*` proxies to `8788`,
so `http://localhost:5174/#/idp/api-docs` is the live target.

---

## Task 0 — Baseline (before touching anything)

```bash
pnpm --filter @mmbix/design-system test                  # expect: all green
pnpm --filter @mmbix/studio test                         # expect: all green
pnpm --filter @mmbix/studio typecheck                    # expect: clean
pnpm --filter @mmbix/studio build && pnpm check:bundle    # expect: bundle gate passes
```

Record the entry-chunk size. A failure introduced later must be distinguishable from a
pre-existing one — these four commands are the control.

---

## Task 1 — Point Scalar's font tokens at ours

**File:** `apps/studio/src/studio.css` (add one new section; change nothing else)

Append a clearly-labelled section **after** the light/dark token blocks so it is not mistaken
for palette state (it is theme-independent — it only aliases, and `--font-sans`/`--font-mono`
are themselves theme-independent):

```css
/* Studio ⇄ Scalar parity — the embedded API reference must read as the same system.
   Scalar declares these inside `@layer scalar-base { :root { … } }`; an UNLAYERED rule
   beats any layered rule regardless of specificity, so this wins with no `!important`
   and regardless of when Vite injects Scalar's lazy-loaded CSS. */
:root {
	--scalar-font: var(--font-sans);
	--scalar-font-code: var(--font-mono);
	/* Literal on purpose: our base weight lives in theme.css's `@theme inline`, which
	   Tailwind INLINES into the utility — there is no runtime `--font-weight-normal` to
	   reference (verified: 0 occurrences in the built CSS). 420 = our DS base weight. */
	--scalar-font-normal: 420;
}
```

Notes:
- `--scalar-font` (14 usages) → `Inter Variable, Noto Sans Myanmar Variable, sans-serif`.
- `--scalar-font-code` (28 usages) → `Geist Mono, Noto Sans Mono, monospace`. No new
  dependency — Geist Mono already ships.
- `--scalar-font-medium` (500) and `--scalar-font-bold` (700) already agree with ours and are
  deliberately **not** restated.
- Fails safe: a future Scalar rename stops the alias applying; no crash, no half-state.

**Verify**

```bash
cd apps/studio && npx vite build
grep -c -- '--scalar-font:' dist/assets/*.css     # ≥1, in the Studio's own chunk
grep -o -- '--font-sans:[^;]*' dist/assets/*.css # the var it points at exists
```

---

## Task 2 — `resolvedTheme` out of the DS theme provider

**File:** `packages/design-system/src/components/theme-provider/theme-provider.tsx`

Today the "what does `'system'` resolve to" rule exists only *inside* `applyTheme`, so a
consumer cannot observe it — and feeding Scalar would need that rule copied into a second
place, which is the drift class this repo keeps deleting. The value `ResolvedTheme` already
exists (line 6); make it a first-class output instead of a private computation.

1. **Replace the module-private `getSystemTheme()` (lines 36–42)** with a `matchMedia` store:

```tsx
function subscribeToSystemTheme(callback: () => void) {
	const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY);
	mediaQuery.addEventListener('change', callback);

	return () => {
		mediaQuery.removeEventListener('change', callback);
	};
}

function getSystemThemeSnapshot(): ResolvedTheme {
	return window.matchMedia(COLOR_SCHEME_QUERY).matches ? 'dark' : 'light';
}

function getSystemThemeServerSnapshot(): ResolvedTheme {
	return 'light';
}
```

2. **Derive it in the provider** (right after `theme`), so it is re-derived on OS change and
   needs no setState-in-effect:

```tsx
const systemTheme = React.useSyncExternalStore(
	subscribeToSystemTheme,
	getSystemThemeSnapshot,
	getSystemThemeServerSnapshot,
);
const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme;
```

3. **`applyTheme` consumes the resolved value** — signature becomes
   `(nextTheme: ResolvedTheme)` and the body drops its
   `const resolvedTheme = nextTheme === 'system' ? getSystemTheme() : nextTheme;` line
   (the local name would now shadow the new one). Everything else in the body — the
   transition suppression, `classList.remove('light','dark')` + `add(resolvedTheme)` — is
   unchanged.

4. **Collapse the media-listener effect** (the block that re-registers
   `addEventListener('change')` when `theme === 'system'`) into:

```tsx
React.useEffect(() => {
	applyTheme(resolvedTheme);
}, [resolvedTheme, applyTheme]);
```

   The store subscription now covers the OS change, so the duplicate listener is deleted
   (one source of truth, and the class can no longer be applied from two paths).

5. **The `'d'` shortcut reads the resolved value:**

```tsx
setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
```

   with `[resolvedTheme, setTheme]` as deps (the handler is re-registered on change, so it
   never reads a stale value).

6. **Expose it:** `ThemeProviderState` gains `resolvedTheme: ResolvedTheme`, and the context
   `value` memo gains `resolvedTheme` in both the object and the dep array.

Additive: `theme`, `setTheme`, the `<html>` class contract, the transition suppression,
`storage` + `mmbix:theme-change` wiring, and `useTheme`'s existing consumers are unchanged.
`ResolvedTheme` stays module-local (consumers read the value; nothing needs the alias).

**New spec:** `packages/design-system/src/components/theme-provider/theme-provider.test.tsx`

Follow the DS conventions: `.test.tsx` (the DS glob is `src/**/*.test.{ts,tsx}`), jsdom is
global in `vitest.config.mts`, `globals: true`, explicit `import { describe, expect, it } from
'vitest'`, and assert with **plain DOM properties** (jest-dom matchers are deliberately not
installed). `vitest.setup.ts:17-29` already stubs `matchMedia` with `matches: false` and no-op
listeners — a test that needs the OS to flip installs its own stub (capturing listeners in a
`Set`) and restores the original in `afterEach`.

Cases (each renders a tiny probe component that prints `theme` + `resolvedTheme`):

| # | Setup | Expected |
|---|---|---|
| 1 | `defaultTheme="dark"` | `resolvedTheme === 'dark'` |
| 2 | `defaultTheme="light"` | `resolvedTheme === 'light'` |
| 3 | `defaultTheme="system"`, OS dark | `resolvedTheme === 'dark'` |
| 4 | `defaultTheme="system"`, OS light | `resolvedTheme === 'light'` |
| 5 | `defaultTheme="system"`, OS dark → flip stub to light, fire the captured listeners inside `act()` | `resolvedTheme` becomes `'light'` (the store re-renders) |
| 6 | `defaultTheme="system"` + OS dark, `fireEvent.keyDown(window, { key: 'd' })` | stored theme becomes `'light'` — the shortcut flips from the **resolved** value, not from `'system'` |
| 7 | `<html>` class follows: render with `defaultTheme="dark"` | `document.documentElement.classList.contains('dark')` is true, `'light'` is absent |

Clean up `document.documentElement.className` and `localStorage` between tests.

**Verify**

```bash
pnpm --filter @mmbix/design-system typecheck
pnpm --filter @mmbix/design-system test      # new spec + the existing 8
pnpm --filter @mmbix/design-system build     # REQUIRED before task 3's typecheck
```

---

## Task 3 — Drive Scalar's theme from it

**File:** `apps/studio/src/components/ApiDocsTab.tsx`

```tsx
import { useTheme } from '@mmbix/design-system';
…
const { resolvedTheme } = useTheme();
…
<ApiReferenceReact
	key={resolvedTheme}
	configuration={{
		content: spec,
		forceDarkModeState: resolvedTheme,
		hideDarkModeToggle: true,
		onBeforeRequest: ({ requestBuilder }) => {
			requestBuilder?.headers?.set?.('Authorization', `Bearer ${token}`);
		},
	}}
/>
```

- `forceDarkModeState` is the hard switch — it beats Scalar's localStorage and the OS.
- `hideDarkModeToggle: true` because with the mode forced Scalar's own control writes a
  localStorage value we then ignore: it would be a lie. One theme control per app — ours.
- **Why the `key` is not optional:** `ApiReference.vue.script.js:285-292` maps
  `forceDarkModeState` → `overrideColorMode`, which `useColorMode` captures **once at Vue
  setup**; `applyColorMode` only re-runs on a `colorMode`/OS-preference change. The React
  wrapper's `updateConfiguration` updates props but does **not** re-apply the body class, so a
  dynamic `forceDarkModeState` alone leaves Scalar stuck on its mount-time mode. Remounting on
  `resolvedTheme` is deterministic; the cost (re-parse the in-memory spec, reset scroll) is
  paid only on an explicit toggle.

**Verify:** `pnpm --filter @mmbix/studio typecheck` (needs the task-2 build), then the Task 6
live probes.

---

## Task 4 — The 13 active-state swaps (`'default'` → `'secondary'`)

Only the **active** branch changes; the inactive branch (`ghost`/`outline`), the geometry and
every `aria-*` attribute stay exactly as they are. No new component, no new CSS.

| File | Lines | Ternary |
|---|---|---|
| `apps/studio/src/components/builder/AppWorkbenchHeader.tsx` | 75, 100, 111 | `active ? 'default' : 'ghost'` |
| `apps/studio/src/pages/CollectionsWorkbench.tsx` | 758, 767 | `view === … ? 'default' : 'ghost'` |
| `apps/studio/src/pages/CollectionsWorkbench.tsx` | 664 | `trashMode ? 'default' : 'outline'` |
| `apps/studio/src/components/MenuInspector.tsx` | 228 | `tab === t ? 'default' : 'ghost'` |
| `apps/studio/src/components/PageInspector.tsx` | 1004 | `blockTab === t ? 'default' : 'ghost'` |
| `apps/studio/src/components/PageCanvas.tsx` | 987 | `canvasMode === m.key ? 'default' : 'ghost'` |
| `apps/studio/src/components/builder/NewCollectionDialog.tsx` | 136, 139 | `mode === … ? 'default' : 'outline'` |
| `apps/studio/src/components/ImageEditorDialog.tsx` | 419 | `aspect === id ? 'default' : 'outline'` |
| `apps/studio/src/components/app/AppDataPane.tsx` | 322 | `trashMode ? 'default' : 'outline'` |

**8 files, 13 sites.** Result: the active state stops being `--primary` and becomes the DS's
already-defined raised neutral (`--secondary` = `#272727` dark / `#e2e8f0` light, with its own
`--secondary-foreground`), so a pill-on-track delta becomes `#272727` on `#1a1a1a` — Scalar's
raised-chip delta exactly. Teal is then reserved for the one primary action per surface.

**Do not touch** (they are not toggles): `components/GenerationPanel.tsx:205` and
`components/admin/addons-tab.tsx:109` — their `'outline' : 'default'` is a CTA pair / a
state-dependent CTA, which is a different concern.

Why not a shared `Segmented` over the DS `ToggleGroup`: the three shapes carry bespoke
geometry (`width: 28`, `flex: 1`, `size="xs"`) and different option sources, so it would need
an options bag existing only to serve its own callers — and it would prevent nothing, because
the defect is a *token*, not a missing abstraction. The token stays single-sourced in
`buttonVariants`. (This is the Studio's first `variant="secondary"` use.)

**Verify**

```bash
pnpm --filter @mmbix/studio typecheck                    # 'secondary' is valid — must stay clean
pnpm --filter @mmbix/studio test                         # existing jsdom specs render these toolbars
pnpm --filter @mmbix/studio build && pnpm check:bundle    # entry ~0.02 MB, unchanged
```

No new unit spec: a test asserting a CSS class is not the property we care about. The visual
outcome is asserted live in Task 6.

---

## Task 5 — Teal-CTA census on the shared surfaces (measure, then demote)

**Do not pre-emptively edit six files.** The earlier "44 CTAs" figure came from a coarse scan,
and a static audit cannot see render-time co-presence: the only *explicit* `variant="default"`
in the whole Studio is `IdpDeploymentsPage.tsx:195` — every other CTA omits the prop.

Procedure:

1. On the live Studio (Task 6's probe rig), for each candidate — `IdpDeploymentsPage`,
   `MenuBuilder`, `admin/api-keys-tab`, `admin/users-tab`, `admin/roles-tab`, and
   `NewCollectionDialog` — enumerate each **rendered** surface (page, and each open dialog) and
   count `button.bg-primary` in it.
2. The rule is **≤1 teal CTA per rendered surface**. A dialog's submit is the CTA of the dialog
   surface, so two CTAs that never render together both stay.
3. Demote only where a surface shows >1: keep the submit teal, change the other to `outline`.
   Re-measure to confirm.
4. **A zero-work outcome is acceptable and expected** — if every surface already shows ≤1, this
   task closes with the measurement as its evidence.

---

## Task 6 — Verification

### Static / CI

```bash
pnpm --filter @mmbix/design-system typecheck && pnpm --filter @mmbix/design-system test
pnpm --filter @mmbix/design-system build
pnpm --filter @mmbix/studio typecheck && pnpm --filter @mmbix/studio test
pnpm --filter @mmbix/studio build && pnpm check:bundle
```

### Live (same-origin hidden-iframe probes against `http://localhost:5174`, reusing the running servers)

`#/idp/api-docs`:

1. **Font** — wait for `.scalar-app`, then read
   `getComputedStyle(document.querySelector('.scalar-app')).getPropertyValue('--scalar-font')`
   and `…('--scalar-font-code')`: they must resolve to our stacks. Then measure a fixed string
   rendered inside `.scalar-app` against a control span styled `font: 16px 'Inter Variable'`
   and against `system-ui` — it must match the former, not the latter (before this change it
   matched `system-ui` at 420.95px vs 438.96px).
2. **Theme** — read `document.body.className` (expect `dark-mode`/`light-mode`) and
   `getComputedStyle(document.body).getPropertyValue('--scalar-background-1')`. Flip our theme
   (rail `ThemeToggle` or the user menu), re-query and assert the body class flipped **and** the
   background var followed (`#fff` ⇄ `#0f0f0f`). Assert Scalar's own dark/light control no
   longer exists inside `.scalar-app` (`hideDarkModeToggle` took effect).
3. **Accent** — per route (`/apps/:slug` models+menus+pages, `/idp/collections`,
   `/idp/catalog`), count `button.bg-primary` per rendered surface (≤1) and assert each of the
   13 swapped toggles' active branch computes `--secondary`, not `--primary`. This doubles as
   Task 5's census.

Remove every probe iframe afterwards and assert none remain. Never kill the dev servers.

---

## Task 7 — Document the invariant

Extend the existing **"The Studio's dark palette is the API reference's palette"** bullet in
`AGENTS.md` (it already covers the `.dark` ramp mirroring Scalar) with the three new
invariants and their evidence:

- Scalar's font tokens are aliased to ours by one unlayered `:root` block in `studio.css`
  (unlayered beats `@layer scalar-base`; `--scalar-font-normal` is a literal `420` because our
  weight token is Tailwind-inlined and has no runtime var).
- Scalar's colour mode is **forced** from our `resolvedTheme` with a remount `key`, and its own
  toggle is hidden — so one theme control exists in the app.
- The theme rule lives in exactly one place: `useTheme().resolvedTheme` (the DS provider).
- Teal means "the action", never "you are here": the 13 active-state toggles use
  `variant="secondary"`.

---

## Rollback

Each task is independently revertible; nothing is a migration and no data is touched.

| Task | Revert |
|---|---|
| 1 | delete the `:root` block in `studio.css` |
| 2–3 | `git revert` the DS provider + the Studio spec — additive API, so partial revert is safe |
| 4 | flip 13 words back to `'default'` |
| 5 | flip the demoted sites back to the omitted/`default` variant |

## Not in scope

See spec §6 — Scalar's own accent, the DS `Toggle`/`ToggleGroup` pressed token, the dead
`data-[state=on]:bg-muted` class (observed, reported, not fixed here), the DS `--primary` teal
token, and the local `Segmented` wrapper in `components/formlayout/properties.tsx`.
