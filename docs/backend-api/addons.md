# Add-ons — runtime install / remove

The factory's add-on model: a module is a self-describing bundle
(`ModuleManifest`), and a deployment **installs/removes** it at runtime. Two
gates decide whether an add-on is LIVE, and both must pass:

1. **Build allowlist** — `DOMAIN_MODULES` (what this build makes available).
2. **Runtime install state** — the `_addons` table (what is installed).

An add-on that is disabled or uninstalled is a **404** and registers nothing
(no routes, no hooks, no migrations) — zero waste, no redeploy.

## Manifest

```ts
interface ModuleManifest {
	id: string;
	name: string;
	version: string;
	scope?: 'platform' | 'domain' | 'ui';
	depends?: string[]; // must be installed first
	provides?: string[]; // capabilities offered to others
	requires?: string[]; // capabilities needed from the installed set
	extends?: string[]; // base add-ons this one extends (no fork)
	routes: Hono;
	hooks?: Array<() => void>;
	roles?: ModuleRole[];
	identity?: ModuleIdentity;
	collections?: ModuleCollectionDef[]; // declarative provisioning on install
}
```

## API

| Method | Path                        | Auth  | Purpose                                                |
| ------ | --------------------------- | ----- | ------------------------------------------------------ |
| `GET`  | `/api/addons`               | auth  | Catalog + install state + dependency/capability issues |
| `POST` | `/api/addons/:id/install`   | admin | Install (validates deps / extends / capabilities)      |
| `POST` | `/api/addons/:id/uninstall` | admin | Uninstall (refused while another add-on depends on it) |

```jsonc
// GET /api/addons
{
	"addons": [
		{
			"id": "idp",
			"name": "Internal Developer Platform",
			"version": "1.0.0",
			"scope": "domain",
			"available": true,
			"installed": true,
			"depends": [],
			"provides": [],
			"requires": [],
			"extends": [],
		},
	],
	"issues": [], // e.g. { "id": "billing", "issue": "missing capability: payments" }
}
```

## Graph resolution

`resolveAddons(manifests, availableIds, installedIds)` (in `@mmbix/types`) is the
pure resolver — it flags, for every INSTALLED add-on, a missing `depends` /
`extends` target or an unmet `requires` capability. Install refuses the same
conditions; uninstall refuses while an installed add-on still depends on the
target.

## Discovery

- `GET /api/addons` — the runtime install state (reads `_addons`).
- `GET /api/meta` — the **build** allowlist (`modules`, `plugins`), I/O-free.

The route gate is `available(env) ∩ installed(db)`; the installed set is memoized
per isolate (`lib/addon-registry.ts`) and invalidated on install/uninstall.

Pinned by `apps/api/test/addons.spec.ts` (uninstall → routes 404 → install →
routes back) + the resolver unit tests.
