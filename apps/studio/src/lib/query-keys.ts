/**
 * The ONE place Studio query keys are spelled.
 *
 * Kept next to the client (not inside each page) so a write can invalidate
 * exactly what it changed without a page knowing another page's key. Keys never
 * contain the auth token — the whole cache is dropped when the session changes
 * (`resetStudioQueries`), so a re-login can never read the previous user's rows.
 *
 * Prefix discipline: `qk.rows(slug)` is a PREFIX of every `qk.items(slug, …)`
 * page query, so `invalidateQueries({ queryKey: qk.rows(slug) })` refetches
 * every cached page/sort/filter for that collection in one go.
 *
 * Anti-collision discipline: a LIST key must NEVER be a prefix of its DETAIL
 * key, or invalidating the list silently invalidates every detail. `invalidateQueries`
 * matches by prefix, so `['studio','collections']` would also match
 * `['studio','collections','orders']`. Hence the explicit `-list` / singular
 * split: the registry list and a single schema are disjoint subtrees, as are the
 * module list and one module. The rows/items pair is the ONE deliberate prefix.
 */
export const qk = {
	/** Root of the Studio cache — `resetStudioQueries` and tests target this. */
	all: ['studio'] as const,

	// ── Schema plane ─────────────────────────────────────────
	collections: () => [...qk.all, 'collection-list'] as const,
	collection: (slug: string) => [...qk.all, 'collection', slug] as const,
	/** A collection's runtime policy document — a sibling of the schema, not a
	 *  child (so invalidating the policy never drags the schema and vice versa). */
	policies: (slug: string) => [...qk.all, 'policies', slug] as const,
	fieldTypes: () => [...qk.all, 'field-types'] as const,

	// ── Hooks ───────────────────────────────────────────────
	codeHooks: () => [...qk.all, 'hook-registry'] as const,
	serverHooks: (slug: string) => [...qk.all, 'server-functions', slug] as const,

	// ── Access control ──────────────────────────────────────
	// One session-level registry shared by every role picker (workflow, field
	// permissions, the admin roles tab) — not per-collection, so it dedupes across
	// all of them instead of each panel re-reading it on mount.
	roles: () => [...qk.all, 'roles'] as const,
	users: () => [...qk.all, 'users'] as const,

	// ── Admin console ─────────────────────────────────
	apiKeys: () => [...qk.all, 'api-keys'] as const,
	designTokens: () => [...qk.all, 'design-tokens'] as const,

	// ── Studio metadata (studio.db catalog) ───────────
	/** The one studio.db metadata snapshot the whole Studio shares. */
	studioMeta: () => [...qk.all, 'meta'] as const,

	// ── Rows ────────────────────────────────────────────────
	rows: (slug: string) => [...qk.all, 'entities', slug] as const,
	items: (slug: string, params: unknown) => [...qk.all, 'entities', slug, params] as const,

	// ── Live report execution ───────────────────────────────
	// A report is an AGGREGATE over ONE collection (`StudioReportDef.collection`),
	// so its key is scoped by that collection: a row write in `orders`
	// re-runs the pivot previews over `orders` and NOTHING else. `key` is the
	// canonical JSON of the definition — the definition IS the identity.
	reportsFor: (slug: string) => [...qk.all, 'report', slug] as const,
	report: (slug: string, key: string) => [...qk.all, 'report', slug, key] as const,

	// ── App workbench ────────────────────────────────
	modules: () => [...qk.all, 'module-list'] as const,
	/** Server contract (`/api/meta`) — static per deploy, never revalidates. */
	serverMeta: () => [...qk.all, 'server-meta'] as const,
	/** The signed session's identity + capabilities (`/api/auth/me`). */
	me: () => [...qk.all, 'me'] as const,
	/** The add-on catalog + install state (`/api/addons`). */
	addons: () => [...qk.all, 'addons'] as const,
	/** Self-tuning index-advisor telemetry (`/api/operations`). */
	operations: () => [...qk.all, 'operations'] as const,
	module: (slug: string) => [...qk.all, 'module', slug] as const,
	pages: () => [...qk.all, 'pages'] as const,
	menus: (slug: string) => [...qk.all, 'menus', slug] as const,

	// ── IDP developer portal ───────────────────────────
	// `idp()` is the intentional ROOT of this subtree: an IDP write (scaffold /
	// deploy / promote) revalidates the whole small portal in one call.
	idp: () => [...qk.all, 'idp'] as const,
	idpCatalog: () => [...qk.all, 'idp', 'catalog'] as const,
	idpScorecard: () => [...qk.all, 'idp', 'scorecard'] as const,
	idpUsage: (days: number) => [...qk.all, 'idp', 'usage', days] as const,
	idpTemplates: () => [...qk.all, 'idp', 'templates'] as const,
	idpDeployments: () => [...qk.all, 'idp', 'deployments'] as const,
	idpEnvironments: () => [...qk.all, 'idp', 'environments'] as const,
	idpHistory: (id: string) => [...qk.all, 'idp', 'history', id] as const,
} as const;
