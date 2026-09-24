import { queryOptions } from '@tanstack/react-query';
import { qk } from './query-keys';
import { hydrateRelationSchemas } from './query-client';
import * as api from './api';
import type { EntityListParams } from './api';

/**
 * Typed `queryOptions` factories — every Studio read, declared once.
 *
 * Each factory is the SINGLE source of a read's key, fetch and staleness, so a
 * page can't invent its own key or forget the token guard. Policies that differ
 * from the client default are argued inline:
 *
 * - the field-type catalog and the code-hook registry are STATIC per deploy, so
 *   they never go stale inside a session (`staleTime: Infinity`) — the same
 *   guarantee the old `loadFieldTypes` session cache gave, now via Query;
 * - everything else is mutable metadata/data and revalidates on write
 *   (see `query-client.ts`), so the 30s default is a floor, not a stale risk.
 */

/** One page of rows, shaped for the DataTable's `fetchData` contract. */
export interface ItemsPage {
	rows: Record<string, unknown>[];
	nextCursor: string | null;
	prevCursor: string | null;
	/**
	 * `meta.total` — the filtered count, and ONLY when the read asked for it
	 * (`params.countOnly` → `?count_only=true`). The engine omits `meta.total` from a
	 * normal page read, so this is `null` (UNKNOWN) rather than a guess like
	 * `rows.length`, which would silently report a `limit: 1` count probe as "1".
	 */
	total: number | null;
}

// A query is live only for a non-empty token. Typed to accept a nullable token so a
// caller that has one CANNOT accidentally enable a read (which would fire an
// unauthenticated request); `!!token` also rejects the empty string from storage.
const live = (token: string | null | undefined): boolean => !!token;

export const collectionsQuery = (token: string) =>
	queryOptions({
		queryKey: qk.collections(),
		queryFn: () => api.listCollections(token),
		enabled: live(token),
	});

export const collectionQuery = (token: string, slug: string | null | undefined) =>
	queryOptions({
		queryKey: qk.collection(slug ?? ''),
		// One round trip carries the schema AND every m2o target it references
		// (`?with=relation_schemas`); the targets are seeded under their OWN keys
		// inside the query function, BEFORE this promise resolves — so by the time a
		// consumer observes the schema and asks for a target schema, it is already
		// cached. That is what turns "one request per relation" into zero.
		queryFn: async ({ client }) => {
			const schema = await api.getCollectionDetail(token, slug!, { withRelations: true });
			hydrateRelationSchemas(client, schema);
			return schema;
		},
		enabled: live(token) && !!slug,
	});

export const collectionPoliciesQuery = (token: string, slug: string | null | undefined) =>
	queryOptions({
		queryKey: qk.policies(slug ?? ''),
		queryFn: () => api.getCollectionPolicies(token, slug!),
		enabled: live(token) && !!slug,
	});

export const fieldTypesQuery = (token: string) =>
	queryOptions({
		queryKey: qk.fieldTypes(),
		queryFn: () => api.getFieldTypes(token),
		enabled: live(token),
		// Static module on the API — it only changes on redeploy.
		staleTime: Infinity,
	});

export const codeHooksQuery = (token: string) =>
	queryOptions({
		queryKey: qk.codeHooks(),
		queryFn: () => api.listCodeHooks(token),
		enabled: live(token),
		// Boot-time registry — fixed for the life of the deploy.
		staleTime: Infinity,
	});

export const serverHooksQuery = (token: string, slug: string | null | undefined) =>
	queryOptions({
		queryKey: qk.serverHooks(slug ?? ''),
		queryFn: () => api.listServerHooks(token, slug ?? undefined),
		enabled: live(token) && !!slug,
	});

// ── Access control ───────────────────────────────────────────────────────────

export const rolesQuery = (token: string) =>
	queryOptions({
		queryKey: qk.roles(),
		queryFn: () => api.listRoles(token),
		enabled: live(token),
		// Role definitions change only through an admin action, which invalidates this
		// key explicitly — so within a session they are a constant, and every role
		// picker in the Studio shares the one read.
		staleTime: Infinity,
	});

export const usersQuery = (token: string) =>
	queryOptions({
		queryKey: qk.users(),
		queryFn: () => api.listUsers(token),
		enabled: live(token),
	});

// ── Admin console ────────────────────────────────────────────────────────────

export const apiKeysQuery = (token: string) =>
	queryOptions({
		queryKey: qk.apiKeys(),
		queryFn: () => api.listApiKeys(token),
		enabled: live(token),
	});

export const designTokensQuery = (token: string) =>
	queryOptions({
		queryKey: qk.designTokens(),
		queryFn: () => api.listDesignTokens(token),
		enabled: live(token),
	});

export const itemsQuery = (token: string, slug: string, params: EntityListParams) =>
	queryOptions({
		queryKey: qk.items(slug, params),
		queryFn: async (): Promise<ItemsPage> => {
			const res = await api.listItems(token, slug, params);
			return {
				rows: res.rows,
				nextCursor: res.meta.next_cursor ?? null,
				prevCursor: res.meta.prev_cursor ?? null,
				total: res.meta.total ?? null,
			};
		},
		enabled: live(token) && !!slug,
	});

// ── Live report execution ────────────────────────────────────────────────────

/**
 * One report definition executed against the engine (`POST /api/reports/execute`).
 *
 * A report is a GROUP BY over one collection — the single most expensive read the
 * Studio issues — so it rides the same cache as every other read: opening the
 * pivot editor, the pivot canvas and a report block over the SAME definition now
 * costs ONE execution, and revisiting a view is free. `key` is the canonical JSON
 * of the definition (the definition IS the identity); a row write in the report's
 * collection drops it via `invalidateRows`.
 */
export const reportQuery = (token: string, collection: string, key: string, def: api.StudioReportDef | null) =>
	queryOptions({
		queryKey: qk.report(collection, key),
		queryFn: () => api.executeReportV2(token, def!),
		enabled: live(token) && !!def,
	});

// ── App workbench ────────────────────────────────────────────────────────────

export const modulesQuery = (token: string) =>
	queryOptions({
		queryKey: qk.modules(),
		queryFn: () => api.listModules(token),
		enabled: live(token),
	});

/** Server contract — static per deploy, so it never goes stale in a session. */
export const serverMetaQuery = (token: string) =>
	queryOptions({
		queryKey: qk.serverMeta(),
		queryFn: () => api.getServerMeta(token),
		enabled: live(token),
		staleTime: Infinity,
	});

export const moduleQuery = (token: string, slug: string | null | undefined) =>
	queryOptions({
		queryKey: qk.module(slug ?? ''),
		queryFn: () => api.getModule(token, slug!),
		enabled: live(token) && !!slug,
	});

export const pagesQuery = (token: string) =>
	queryOptions({
		queryKey: qk.pages(),
		queryFn: () => api.listPages(token),
		enabled: live(token),
	});

export const menusQuery = (token: string, slug: string | null | undefined) =>
	queryOptions({
		queryKey: qk.menus(slug ?? ''),
		queryFn: () => api.getMenus(token, slug!),
		enabled: live(token) && !!slug,
	});

// ── IDP developer portal ─────────────────────────────────────────────────────

export const idpCatalogQuery = (token: string) =>
	queryOptions({
		queryKey: qk.idpCatalog(),
		queryFn: () => api.getIdpCatalog(token),
		enabled: live(token),
	});

export const idpScorecardQuery = (token: string) =>
	queryOptions({
		queryKey: qk.idpScorecard(),
		queryFn: () => api.getIdpScorecard(token),
		enabled: live(token),
	});

export const idpUsageQuery = (token: string, days = 30) =>
	queryOptions({
		queryKey: qk.idpUsage(days),
		queryFn: () => api.getIdpUsage(token, days),
		enabled: live(token),
	});

export const idpTemplatesQuery = (token: string) =>
	queryOptions({
		queryKey: qk.idpTemplates(),
		queryFn: () => api.listIdpTemplates(token),
		enabled: live(token),
		// Golden-path templates are a build-time constant set.
		staleTime: Infinity,
	});

export const idpDeploymentsQuery = (token: string) =>
	queryOptions({
		queryKey: qk.idpDeployments(),
		queryFn: () => api.listIdpDeployments(token),
		enabled: live(token),
	});

export const idpEnvironmentsQuery = (token: string) =>
	queryOptions({
		queryKey: qk.idpEnvironments(),
		queryFn: () => api.listIdpEnvironments(token),
		enabled: live(token),
	});

export const idpHistoryQuery = (token: string, id: string | null | undefined) =>
	queryOptions({
		queryKey: qk.idpHistory(id ?? ''),
		queryFn: () => api.getDeploymentHistory(token, id!),
		enabled: live(token) && !!id,
	});
