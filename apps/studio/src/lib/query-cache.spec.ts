import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { qk } from './query-keys';
import {
	createStudioQueryClient,
	invalidateApiKeys,
	invalidateCollection,
	invalidateCollectionList,
	invalidateCollectionPolicies,
	invalidateDesignTokens,
	invalidateIdp,
	invalidateModuleList,
	invalidateRoles,
	invalidateRows,
	resetStudioQueries,
} from './query-client';
import {
	apiKeysQuery,
	codeHooksQuery,
	collectionPoliciesQuery,
	collectionQuery,
	collectionsQuery,
	designTokensQuery,
	fieldTypesQuery,
	idpCatalogQuery,
	idpDeploymentsQuery,
	idpEnvironmentsQuery,
	itemsQuery,
	moduleQuery,
	modulesQuery,
	pagesQuery,
	reportQuery,
	rolesQuery,
	usersQuery,
} from './queries';

// The Query layer IS the Studio's cache/DAG, so these tests pin its contract:
// dedupe, staleness, and PRECISE invalidation (the thing the hand-rolled caches
// used to get wrong). Transport is mocked — we count ROUND TRIPS, not promises.
vi.mock('./api', () => ({
	listItems: vi.fn(async (_token: string, _slug: string, params: { limit?: number }) => ({
		rows: [{ id: 'r1', n: params.limit ?? 0 }],
		meta: { limit: 50, has_more: false, next_cursor: null, prev_cursor: null },
	})),
	listCollections: vi.fn(async () => [{ id: '1', name: 'A', slug: 'a' }]),
	getCollectionDetail: vi.fn(async (_token: string, slug: string) => ({
		id: '1',
		name: slug,
		slug,
		table_name: `t_${slug}`,
		schema_json: { fields: [] },
		// 'a' has one m2o target → the bundled relation read carries 'b'.
		...(slug === 'a'
			? {
					related_schemas: {
						b: {
							id: '2',
							name: 'b',
							slug: 'b',
							table_name: 't_b',
							schema_json: { fields: [{ name: 'name', type: 'text', required: false }] },
						},
					},
				}
			: {}),
	})),
	listModules: vi.fn(async () => [{ id: '1', name: 'A', slug: 'a' }]),
	getModule: vi.fn(async (_token: string, slug: string) => ({ slug })),
	getIdpCatalog: vi.fn(async () => [{ id: 'm1', name: 'A', slug: 'a' }]),
	getIdpScorecard: vi.fn(async () => ({ total: 1 })),
	getIdpUsage: vi.fn(async () => ({ days: 30 })),
	listIdpTemplates: vi.fn(async () => []),
	listIdpDeployments: vi.fn(async () => []),
	listIdpEnvironments: vi.fn(async () => []),
	getDeploymentHistory: vi.fn(async () => []),
	listRoles: vi.fn(async () => [{ id: '1', name: 'editor' }]),
	getCollectionPolicies: vi.fn(async () => ({ cache: { enabled: true, ttl_s: 60 } })),
	listApiKeys: vi.fn(async () => [{ id: 'k1', name: 'integration' }]),
	listDesignTokens: vi.fn(async () => [{ id: 't1', set_name: 'default' }]),
	listUsers: vi.fn(async () => [{ id: 'u1', email: 'dev@x.io' }]),
	executeReportV2: vi.fn(async () => ({ data: [{ bucket: 'x', c: 1 }], columns: ['bucket', 'c'] })),
}));

import * as api from './api';

const rowsMock = vi.mocked(api.listItems);
const collectionsMock = vi.mocked(api.listCollections);
const schemaMock = vi.mocked(api.getCollectionDetail);
const modulesMock = vi.mocked(api.listModules);
const moduleMock = vi.mocked(api.getModule);
const idpCatalogMock = vi.mocked(api.getIdpCatalog);
const idpDeploymentsMock = vi.mocked(api.listIdpDeployments);
const idpEnvironmentsMock = vi.mocked(api.listIdpEnvironments);
const rolesMock = vi.mocked(api.listRoles);
const policiesMock = vi.mocked(api.getCollectionPolicies);
const apiKeysMock = vi.mocked(api.listApiKeys);
const designTokensMock = vi.mocked(api.listDesignTokens);
const usersMock = vi.mocked(api.listUsers);
const reportsMock = vi.mocked(api.executeReportV2);

const token = 'dev-token';

let client: QueryClient;
beforeEach(() => {
	vi.clearAllMocks();
	client = createStudioQueryClient();
});

describe('query keys — prefix discipline', () => {
	it('qk.rows(slug) is a PREFIX of every qk.items(slug, params)', () => {
		const rows = [...qk.rows('hrm_employees')];
		const items = [...qk.items('hrm_employees', { limit: 25 })];
		expect(items.slice(0, rows.length)).toEqual(rows);
	});

	it('different collections never share a key', () => {
		expect(qk.items('a', {})).not.toEqual(qk.items('b', {}));
	});

	it('a LIST key is never a prefix of its DETAIL key (no accidental over-invalidation)', () => {
		// `invalidateQueries` matches by prefix — if the registry list were
		// ['studio','collections'], invalidating it would also drop every schema.
		const list = [...qk.collections()];
		const schema = [...qk.collection('a')];
		expect(schema.slice(0, list.length)).not.toEqual(list);

		const modules = [...qk.modules()];
		const module = [...qk.module('a')];
		expect(module.slice(0, modules.length)).not.toEqual(modules);
	});

	it('qk.reportsFor(slug) is a PREFIX of every qk.report(slug, key)', () => {
		const forSlug = [...qk.reportsFor('hrm_employees')];
		const one = [...qk.report('hrm_employees', '{"rowDimensions":[]}')];
		expect(one.slice(0, forSlug.length)).toEqual(forSlug);
	});

	it('a report key never leaks across collections', () => {
		const key = '{"rowDimensions":["dept"]}';
		expect(qk.report('a', key)).not.toEqual(qk.report('b', key));
	});
});

describe('cache + in-flight dedupe', () => {
	it('the same key fetched twice within staleTime costs ONE round trip', async () => {
		const opts = itemsQuery(token, 'a', { limit: 25 });
		const first = await client.fetchQuery(opts);
		const second = await client.fetchQuery(opts);
		expect(rowsMock).toHaveBeenCalledTimes(1);
		expect(second).toEqual(first);
	});

	it('concurrent identical fetches coalesce into ONE request', async () => {
		const opts = itemsQuery(token, 'a', { limit: 25 });
		await Promise.all([client.fetchQuery(opts), client.fetchQuery(opts), client.fetchQuery(opts)]);
		expect(rowsMock).toHaveBeenCalledTimes(1);
	});

	it('a DIFFERENT page is a different key (and a different request)', async () => {
		await client.fetchQuery(itemsQuery(token, 'a', { limit: 25 }));
		await client.fetchQuery(itemsQuery(token, 'a', { limit: 50 }));
		expect(rowsMock).toHaveBeenCalledTimes(2);
	});

	it('an empty token disables the observer query (and is never fetched by a hook)', () => {
		expect(itemsQuery('', 'a', { limit: 25 }).enabled).toBe(false);
		expect(itemsQuery(token, 'a', { limit: 25 }).enabled).toBe(true);
	});

	it('the login screen issues ZERO reads — every boot-path query is disabled without a token', () => {
		// Pins the observed bug: an unauthenticated shell used to fire `GET /api/modules`
		// (and pay its 401). Every query the authed shell mounts on boot must be inert
		// until a token exists, so the login render costs no round trips at all.
		for (const disabled of [
			modulesQuery(''),
			pagesQuery(''),
			collectionsQuery(''),
			fieldTypesQuery(''),
			codeHooksQuery(''),
			rolesQuery(''),
			itemsQuery('', 'a', { limit: 25 }),
		]) {
			expect(disabled.enabled).toBe(false);
		}
	});

	it('a count probe asks for count_only and reads meta.total — never a fabricated total', async () => {
		rowsMock.mockResolvedValueOnce({
			rows: [],
			meta: { limit: 0, has_more: false, total: 42 },
		});
		const probe = await client.fetchQuery(itemsQuery(token, 'a', { countOnly: true, fields: 'id' }));
		expect(probe.total).toBe(42);
		expect(rowsMock.mock.calls[0][2]).toEqual({ countOnly: true, fields: 'id' });

		// The engine omits meta.total from an ordinary page read — the page must report
		// UNKNOWN (null), not `rows.length`, which would turn a count probe into "1".
		const page = await client.fetchQuery(itemsQuery(token, 'a', { limit: 25 }));
		expect(page.total).toBeNull();
	});
});

describe('precise invalidation', () => {
	it('invalidateRows refetches only THAT collection’s pages', async () => {
		await client.fetchQuery(itemsQuery(token, 'a', { limit: 25 }));
		await client.fetchQuery(itemsQuery(token, 'b', { limit: 25 }));
		expect(rowsMock).toHaveBeenCalledTimes(2);

		await invalidateRows(client, 'a');
		await client.fetchQuery(itemsQuery(token, 'a', { limit: 25 }));
		await client.fetchQuery(itemsQuery(token, 'b', { limit: 25 }));

		// 'a' refetched, 'b' came from cache — exactly one extra round trip.
		expect(rowsMock).toHaveBeenCalledTimes(3);
		expect(rowsMock.mock.calls.map((c) => c[1])).toEqual(['a', 'b', 'a']);
	});

	it('invalidateRows targets every cached page/sort of the collection', async () => {
		await client.fetchQuery(itemsQuery(token, 'a', { limit: 25 }));
		await client.fetchQuery(itemsQuery(token, 'a', { limit: 25, sort: '-created_at' }));
		expect(rowsMock).toHaveBeenCalledTimes(2);

		await invalidateRows(client, 'a');
		await client.fetchQuery(itemsQuery(token, 'a', { limit: 25 }));
		await client.fetchQuery(itemsQuery(token, 'a', { limit: 25, sort: '-created_at' }));
		expect(rowsMock).toHaveBeenCalledTimes(4);
	});

	it('invalidateCollection drops the registry list, the schema AND the rows', async () => {
		await client.fetchQuery(collectionsQuery(token));
		await client.fetchQuery(collectionQuery(token, 'a'));
		await client.fetchQuery(itemsQuery(token, 'a', { limit: 25 }));
		expect(collectionsMock).toHaveBeenCalledTimes(1);
		expect(schemaMock).toHaveBeenCalledTimes(1);
		expect(rowsMock).toHaveBeenCalledTimes(1);

		await invalidateCollection(client, 'a');

		await client.fetchQuery(collectionsQuery(token));
		await client.fetchQuery(collectionQuery(token, 'a'));
		await client.fetchQuery(itemsQuery(token, 'a', { limit: 25 }));
		expect(collectionsMock).toHaveBeenCalledTimes(2);
		expect(schemaMock).toHaveBeenCalledTimes(2);
		expect(rowsMock).toHaveBeenCalledTimes(2);
	});

	it('invalidateCollectionList touches the list but NOT schemas or rows', async () => {
		await client.fetchQuery(collectionsQuery(token));
		await client.fetchQuery(collectionQuery(token, 'a'));
		await client.fetchQuery(itemsQuery(token, 'a', { limit: 25 }));

		await invalidateCollectionList(client);

		await client.fetchQuery(collectionsQuery(token));
		await client.fetchQuery(collectionQuery(token, 'a'));
		await client.fetchQuery(itemsQuery(token, 'a', { limit: 25 }));
		expect(collectionsMock).toHaveBeenCalledTimes(2);
		expect(schemaMock).toHaveBeenCalledTimes(1); // still cached
		expect(rowsMock).toHaveBeenCalledTimes(1); // still cached
	});

	it('an unrelated collection survives another collection’s invalidation', async () => {
		await client.fetchQuery(collectionQuery(token, 'b'));
		await invalidateCollection(client, 'a');
		await client.fetchQuery(collectionQuery(token, 'b'));
		expect(schemaMock).toHaveBeenCalledTimes(1);
		expect(schemaMock.mock.calls[0][1]).toBe('b');
	});
});

describe('invalidation scoping — module + IDP subtrees', () => {
	it('invalidateModuleList refetches the module list but NOT a module detail', async () => {
		await client.fetchQuery(modulesQuery(token));
		await client.fetchQuery(moduleQuery(token, 'a'));
		expect(modulesMock).toHaveBeenCalledTimes(1);
		expect(moduleMock).toHaveBeenCalledTimes(1);

		await invalidateModuleList(client);
		await client.fetchQuery(modulesQuery(token));
		await client.fetchQuery(moduleQuery(token, 'a'));
		expect(modulesMock).toHaveBeenCalledTimes(2);
		expect(moduleMock).toHaveBeenCalledTimes(1); // still cached
	});

	it('invalidateIdp refetches the IDP subtree but leaves the schema plane alone', async () => {
		await client.fetchQuery(idpCatalogQuery(token));
		await client.fetchQuery(idpDeploymentsQuery(token));
		await client.fetchQuery(idpEnvironmentsQuery(token));
		await client.fetchQuery(collectionQuery(token, 'a'));
		expect(idpCatalogMock).toHaveBeenCalledTimes(1);

		await invalidateIdp(client);
		await client.fetchQuery(idpCatalogQuery(token));
		await client.fetchQuery(idpDeploymentsQuery(token));
		await client.fetchQuery(idpEnvironmentsQuery(token));
		await client.fetchQuery(collectionQuery(token, 'a'));

		expect(idpCatalogMock).toHaveBeenCalledTimes(2);
		expect(idpDeploymentsMock).toHaveBeenCalledTimes(2);
		expect(idpEnvironmentsMock).toHaveBeenCalledTimes(2);
		expect(schemaMock).toHaveBeenCalledTimes(1); // untouched — disjoint subtree
	});

	it('the roles registry is ONE shared key — every picker costs a single read', async () => {
		// Workflow, field-permissions and the admin tab all read this same key.
		await Promise.all([client.fetchQuery(rolesQuery(token)), client.fetchQuery(rolesQuery(token)), client.fetchQuery(rolesQuery(token))]);
		expect(rolesMock).toHaveBeenCalledTimes(1);
	});

	it('invalidateRoles refetches the registry but leaves the schema + module planes alone', async () => {
		await client.fetchQuery(rolesQuery(token));
		await client.fetchQuery(collectionQuery(token, 'a'));
		await client.fetchQuery(modulesQuery(token));
		expect(rolesMock).toHaveBeenCalledTimes(1);

		await invalidateRoles(client);
		await client.fetchQuery(rolesQuery(token));
		await client.fetchQuery(collectionQuery(token, 'a'));
		await client.fetchQuery(modulesQuery(token));

		expect(rolesMock).toHaveBeenCalledTimes(2); // refetched
		expect(schemaMock).toHaveBeenCalledTimes(1); // still cached
		expect(modulesMock).toHaveBeenCalledTimes(1); // still cached
	});

	it('the policy document is ONE cached read, shared across every dialog open', async () => {
		await Promise.all([client.fetchQuery(collectionPoliciesQuery(token, 'a')), client.fetchQuery(collectionPoliciesQuery(token, 'a'))]);
		expect(policiesMock).toHaveBeenCalledTimes(1);
	});

	it('invalidateCollectionPolicies refetches the policy AND the schema (both carry it), never rows', async () => {
		await client.fetchQuery(collectionPoliciesQuery(token, 'a'));
		await client.fetchQuery(collectionQuery(token, 'a'));
		await client.fetchQuery(itemsQuery(token, 'a', { limit: 25 }));
		expect(policiesMock).toHaveBeenCalledTimes(1);

		await invalidateCollectionPolicies(client, 'a');
		await client.fetchQuery(collectionPoliciesQuery(token, 'a'));
		await client.fetchQuery(collectionQuery(token, 'a'));
		await client.fetchQuery(itemsQuery(token, 'a', { limit: 25 }));

		expect(policiesMock).toHaveBeenCalledTimes(2); // refetched
		expect(schemaMock).toHaveBeenCalledTimes(2); // revalidated — carries schema_json.policies
		expect(rowsMock).toHaveBeenCalledTimes(1); // rows unchanged by a policy write
	});

	it('admin console reads are cached, and each invalidator touches only its own list', async () => {
		await Promise.all([
			client.fetchQuery(apiKeysQuery(token)),
			client.fetchQuery(designTokensQuery(token)),
			client.fetchQuery(usersQuery(token)),
		]);
		expect(apiKeysMock).toHaveBeenCalledTimes(1);
		expect(designTokensMock).toHaveBeenCalledTimes(1);
		expect(usersMock).toHaveBeenCalledTimes(1);

		await invalidateApiKeys(client);
		await Promise.all([
			client.fetchQuery(apiKeysQuery(token)),
			client.fetchQuery(designTokensQuery(token)),
			client.fetchQuery(usersQuery(token)),
		]);
		expect(apiKeysMock).toHaveBeenCalledTimes(2); // refetched
		expect(designTokensMock).toHaveBeenCalledTimes(1); // untouched
		expect(usersMock).toHaveBeenCalledTimes(1); // untouched

		await invalidateDesignTokens(client);
		await Promise.all([client.fetchQuery(apiKeysQuery(token)), client.fetchQuery(designTokensQuery(token))]);
		expect(apiKeysMock).toHaveBeenCalledTimes(2); // still cached
		expect(designTokensMock).toHaveBeenCalledTimes(2); // refetched
	});
});

describe('live report execution', () => {
	const defA = { collection: 'a', rowDimensions: ['dept'], measures: [{ op: 'count', field: '*', alias: 'c' }] };
	const defB = { collection: 'b', rowDimensions: ['dept'], measures: [{ op: 'count', field: '*', alias: 'c' }] };

	it('one definition is executed ONCE, however many surfaces ask for it', async () => {
		const key = JSON.stringify(defA);
		await Promise.all([
			client.fetchQuery(reportQuery(token, 'a', key, defA)),
			client.fetchQuery(reportQuery(token, 'a', key, defA)),
			client.fetchQuery(reportQuery(token, 'a', key, defA)),
		]);
		expect(reportsMock).toHaveBeenCalledTimes(1);
	});

	it('a row write in the report’s collection drops its cached matrix — and only it', async () => {
		await client.fetchQuery(reportQuery(token, 'a', JSON.stringify(defA), defA));
		await client.fetchQuery(reportQuery(token, 'b', JSON.stringify(defB), defB));
		expect(reportsMock).toHaveBeenCalledTimes(2);

		await invalidateRows(client, 'a');

		await client.fetchQuery(reportQuery(token, 'a', JSON.stringify(defA), defA));
		await client.fetchQuery(reportQuery(token, 'b', JSON.stringify(defB), defB));
		expect(reportsMock).toHaveBeenCalledTimes(3);
		expect(reportsMock.mock.calls.map((c) => (c[1] as { collection: string }).collection)).toEqual(['a', 'b', 'a']);
	});

	it('an empty token / null definition disables the query (no execution)', () => {
		expect(reportQuery('', 'a', '{}', defA).enabled).toBe(false);
		expect(reportQuery(token, 'a', '{}', null).enabled).toBe(false);
		expect(reportQuery(token, 'a', JSON.stringify(defA), defA).enabled).toBe(true);
	});
});

describe('relation-schema hydration', () => {
	it('a focused schema read carries its m2o targets and seeds them — zero extra reads', async () => {
		const focused = await client.fetchQuery(collectionQuery(token, 'a'));
		expect(schemaMock).toHaveBeenCalledTimes(1);
		// The read asks for the bundle (the workbench resolves display leaves from it).
		expect(schemaMock.mock.calls[0][2]).toEqual({ withRelations: true });
		expect(focused.related_schemas).toBeDefined();

		// Seeded under the target's OWN key, so the table's relation lookup is a hit
		// instead of one request per relation.
		expect(client.getQueryData(qk.collection('b'))).toBeDefined();
		await client.fetchQuery(collectionQuery(token, 'b'));
		expect(schemaMock).toHaveBeenCalledTimes(1);
	});

	it('hydration never clobbers an existing (possibly fresher) schema entry', async () => {
		const fresh = { id: 'x', name: 'B fresh', slug: 'b', table_name: 't_b', schema_json: { fields: [] } };
		client.setQueryData(qk.collection('b'), fresh);

		await client.fetchQuery(collectionQuery(token, 'a'));

		expect(client.getQueryData(qk.collection('b'))).toEqual(fresh);
	});

	it('a target write still invalidates its hydrated entry (lifecycle is unchanged)', async () => {
		await client.fetchQuery(collectionQuery(token, 'a'));
		expect(schemaMock).toHaveBeenCalledTimes(1);

		// Hydrated 'b' behaves exactly like a fetched one: a schema write drops it.
		await invalidateCollection(client, 'b');
		await client.fetchQuery(collectionQuery(token, 'b'));
		expect(schemaMock).toHaveBeenCalledTimes(2);
		expect(schemaMock.mock.calls[1][1]).toBe('b');
	});
});

describe('session reset', () => {
	it('resetStudioQueries drops every cached read (new session = cold cache)', async () => {
		await client.fetchQuery(collectionsQuery(token));
		await client.fetchQuery(collectionQuery(token, 'a'));
		await client.fetchQuery(itemsQuery(token, 'a', { limit: 25 }));

		resetStudioQueries(client);

		await client.fetchQuery(collectionsQuery(token));
		await client.fetchQuery(collectionQuery(token, 'a'));
		await client.fetchQuery(itemsQuery(token, 'a', { limit: 25 }));
		expect(collectionsMock).toHaveBeenCalledTimes(2);
		expect(schemaMock).toHaveBeenCalledTimes(2);
		expect(rowsMock).toHaveBeenCalledTimes(2);
	});

	it('the cache is scoped to the studio root key (clear only forgets studio reads)', async () => {
		await client.fetchQuery(itemsQuery(token, 'a', { limit: 25 }));
		expect(client.getQueryData(qk.items('a', { limit: 25 }))).toBeDefined();
		resetStudioQueries(client);
		expect(client.getQueryData(qk.items('a', { limit: 25 }))).toBeUndefined();
	});

	it('KEEPS the shared studio.db catalog — it is not per-user, so a session change must not re-read it', () => {
		// The catalog is identical for every session (the worker serves `/__studio/meta`
		// reads open for exactly this reason). Wiping it would force a ~59 KB / 13-query
		// re-read on the next authed render and blank the shell while it loaded — cost
		// with no privacy gain. Every OTHER key still goes.
		client.setQueryData(qk.studioMeta(), { components: [] });
		client.setQueryData(qk.items('a', { limit: 25 }), { rows: [] });

		resetStudioQueries(client);

		expect(client.getQueryData(qk.studioMeta())).toBeDefined();
		expect(client.getQueryData(qk.items('a', { limit: 25 }))).toBeUndefined();
	});
});
