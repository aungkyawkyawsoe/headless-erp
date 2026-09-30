import { QueryClient } from '@tanstack/react-query';
import { qk } from './query-keys';
import type { EntitySchema } from './api';

/**
 * Defaults chosen for an admin/schema tool, not a consumer app:
 *
 * - `staleTime: 30s` — mount-time reads (collection list, hooks, rows) don't
 *   refetch on every navigation, so revisiting a view is instant and free. A
 *   write invalidates precisely (below), so "stale" never means "wrong" here.
 * - `gcTime: 5m` — a view you leave keeps its data briefly, so going back is
 *   synchronous.
 * - `refetchOnWindowFocus: false` — the engine's reads are conditional GETs and
 *   the user is editing schemas; refetching on every tab focus is noise.
 * - `retry: 1` — one retry for a transient D1/network blip, then surface the
 *   error (never an infinite retry loop).
 */
export function createStudioQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				gcTime: 5 * 60_000,
				retry: 1,
				refetchOnWindowFocus: false,
			},
			mutations: { retry: 0 },
		},
	});
}

/**
 * Drop every cached read a SESSION owns — call BEFORE a session change (login /
 * logout / 401) so the next user never renders the previous user's rows.
 *
 * The studio.db catalog (`qk.studioMeta()`) is deliberately KEPT: it is shared,
 * non-sensitive design metadata, identical for every session — which is exactly
 * why the worker serves `/__studio/meta` reads open. Wiping it would only force a
 * ~59 KB / 13-query re-read on the next authed render with a blank shell in
 * between: real cost, zero privacy gain.
 *
 * Preserves the two things `QueryClient.clear()` also did: it forgets EVERY other
 * key (studio-owned or not), and it empties the mutation cache.
 */
export function resetStudioQueries(client: QueryClient): void {
	const keep = qk.studioMeta();
	client.removeQueries({ predicate: (q) => !keep.every((segment, i) => q.queryKey[i] === segment) });
	client.getMutationCache().clear();
}

/**
 * Seed every m2o TARGET's schema that arrived bundled with a focused read
 * (`?with=relation_schemas`) into its OWN cache key.
 *
 * This is hydration, not caching: the payload IS the canonical schema row the
 * target's key would fetch, so the entry is indistinguishable from a direct read
 * — and the library's normal lifecycle still governs it (`invalidateCollection`
 * on a target write drops it, the 30s staleTime revalidates it). What it removes
 * is N round trips on every table load just to resolve each relation column's
 * display leaf.
 *
 * Existing entries are never clobbered: one may be fresher than this bundle, or
 * mid-flight, and both own the key legitimately.
 */
export function hydrateRelationSchemas(client: QueryClient, schema: EntitySchema): void {
	const related = schema.related_schemas;
	if (!related) return;
	for (const [slug, target] of Object.entries(related)) {
		if (!slug || !target) continue;
		if (client.getQueryData(qk.collection(slug)) !== undefined) continue;
		client.setQueryData(qk.collection(slug), target);
	}
}

/**
 * A collection's SCHEMA changed (create / field edit / delete) — drop the
 * registry list, that collection's schema, and every cached row page for it
 * (a new column changes the row shape). One call site = one invalidation,
 * replacing the old `refresh()` that reloaded the whole workbench.
 */
export function invalidateCollection(client: QueryClient, slug: string): Promise<void> {
	return Promise.all([
		client.invalidateQueries({ queryKey: qk.collections() }),
		client.invalidateQueries({ queryKey: qk.collection(slug) }),
		client.invalidateQueries({ queryKey: qk.rows(slug) }),
		// A schema write changes what an aggregate can select/group by.
		client.invalidateQueries({ queryKey: qk.reportsFor(slug) }),
	]).then(() => undefined);
}

/** Only the registry list moved (create / delete / hide) — the focused schema
 *  and its rows are untouched. */
export function invalidateCollectionList(client: QueryClient): Promise<void> {
	return client.invalidateQueries({ queryKey: qk.collections() }).then(() => undefined);
}

/**
 * A collection's runtime POLICY changed (`PUT /api/collections/:slug/policies`).
 *
 * Two keys carry those bytes — the policy document itself (what the panel reads)
 * and the collection schema (`schema_json.policies`) — so both are revalidated to
 * keep the Single Version of the Truth. The schema refetch is one cheap read on a
 * rare admin write, not a per-view cost.
 */
export function invalidateCollectionPolicies(client: QueryClient, slug: string): Promise<void> {
	return Promise.all([
		client.invalidateQueries({ queryKey: qk.policies(slug) }),
		client.invalidateQueries({ queryKey: qk.collection(slug) }),
	]).then(() => undefined);
}

/** A ROW write (create / edit / delete / restore / import / bulk) — refetch
 *  every cached page/sort/filter for that collection, and nothing else. Reports
 *  over the SAME collection are dropped too: an aggregate's numbers are a function
 *  of the rows, so keeping a pivot preview on stale bytes would be a second
 *  version of the truth. */
export function invalidateRows(client: QueryClient, slug: string): Promise<void> {
	return Promise.all([
		client.invalidateQueries({ queryKey: qk.rows(slug) }),
		client.invalidateQueries({ queryKey: qk.reportsFor(slug) }),
	]).then(() => undefined);
}

/** A collection's server-hook set changed. */
export function invalidateServerHooks(client: QueryClient, slug: string): Promise<void> {
	return client.invalidateQueries({ queryKey: qk.serverHooks(slug) }).then(() => undefined);
}

/** The app workbench module wiring changed (module / pages / menus). */
export function invalidateModule(client: QueryClient, slug: string): Promise<void> {
	return Promise.all([
		client.invalidateQueries({ queryKey: qk.modules() }),
		client.invalidateQueries({ queryKey: qk.module(slug) }),
		client.invalidateQueries({ queryKey: qk.menus(slug) }),
	]).then(() => undefined);
}

/** Only the module LIST moved (create / rename / delete an app) — no focused
 *  module or menu to touch. */
export function invalidateModuleList(client: QueryClient): Promise<void> {
	return client.invalidateQueries({ queryKey: qk.modules() }).then(() => undefined);
}

/** The role registry changed (create / edit a role) — refetch the one session-level
 *  key every role picker shares. Permission writes do NOT invalidate this: the role
 *  list itself is unchanged. */
export function invalidateRoles(client: QueryClient): Promise<void> {
	return client.invalidateQueries({ queryKey: qk.roles() }).then(() => undefined);
}

/** The `_users` registry — shared by the Users tab and the API-keys owner picker. */
export function invalidateUsers(client: QueryClient): Promise<void> {
	return client.invalidateQueries({ queryKey: qk.users() }).then(() => undefined);
}

/** An API key was created or revoked — refetch the admin key list. */
export function invalidateApiKeys(client: QueryClient): Promise<void> {
	return client.invalidateQueries({ queryKey: qk.apiKeys() }).then(() => undefined);
}

/** A design-token set was created / updated / deleted. */
export function invalidateDesignTokens(client: QueryClient): Promise<void> {
	return client.invalidateQueries({ queryKey: qk.designTokens() }).then(() => undefined);
}

/**
 * An IDP-portal write (scaffold a module, create/bind an app, deploy / apply /
 * rollback / promote) — revalidate the portal's whole subtree, plus the system
 * module list (scaffolding adds a module the launcher grid shows) in ONE call.
 *
 * Deliberately coarse: `qk.idp()` is a small, low-traffic console and every read
 * there is cheap, so refining this to per-badge precision would only risk a stale
 * badge. The alternative the portal used before was worse — each page re-fetched
 * its own copy on every mount with no cache at all.
 */
export function invalidateIdp(client: QueryClient): Promise<void> {
	return Promise.all([client.invalidateQueries({ queryKey: qk.idp() }), client.invalidateQueries({ queryKey: qk.modules() })]).then(
		() => undefined,
	);
}
