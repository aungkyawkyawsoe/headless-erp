/**
 * OpenAPI Spec Generator
 *
 * Scans entity schemas and generates OpenAPI 3.0 specification.
 * Zero dependencies — pure TypeScript JSON generation.
 *
 * Auto-generates:
 *   - Paths for each entity (full CRUD + bulk + import + workflow + actions)
 *   - Shared bulk / read-batch paths
 *   - Schemas from field definitions
 *   - Query parameter documentation
 *   - Error response documentation
 */

import type { EntitySchema, FieldDefinition } from '@mmbix/types';

const TYPE_MAP: Record<string, string> = {
	text: 'string',
	integer: 'integer',
	number: 'number',
	boolean: 'boolean',
	timestamp: 'string',
	json: 'object',
	slug: 'string',
	m2o: 'string',
	o2m: 'array',
	m2m: 'array',
	table: 'array',
	file: 'string',
};

const DOC_STATUS = ['draft', 'submitted', 'approved', 'cancelled'];

interface OpenAPISpec {
	openapi: string;
	info: { title: string; version: string; description?: string };
	servers: Array<{ url: string }>;
	paths: Record<string, unknown>;
	components: { schemas: Record<string, unknown> };
}

export class OpenAPIGenerator {
	private baseUrl: string;

	constructor(baseUrl = 'https://your-worker.workers.dev') {
		this.baseUrl = baseUrl;
	}

	generate(collections: EntitySchema[]): OpenAPISpec {
		const spec: OpenAPISpec = {
			openapi: '3.0.3',
			info: { title: 'Entity Engine API', version: '1.0.0', description: 'Auto-generated from entity schemas' },
			servers: [{ url: this.baseUrl }],
			paths: {},
			components: { schemas: {} },
		};

		// Generate paths for each entity
		for (const c of collections) {
			this._addCollectionPaths(spec, c);
			this._addSchema(spec, c);
		}

		// Add system + shared paths
		this._addSystemPaths(spec);

		return spec;
	}

	private _addCollectionPaths(spec: OpenAPISpec, c: EntitySchema) {
		const tag = c.name;
		const base = `/api/entities/${c.slug}`;

		// ── Item CRUD ─────────────────────────────────────────────
		spec.paths[base] = {
			get: {
				tags: [tag],
				summary: `List ${c.name}`,
				parameters: this._queryParams(),
				responses: this._listResponse(tag),
				'x-codeSamples': this._sdkSample(
					`const { data, meta } = await client.items('${c.slug}').list({\n  limit: 25,\n  sort: '-created_at',\n  filter: { status: { _eq: 'active' } },\n});`,
				),
			},
			post: {
				tags: [tag],
				summary: `Create ${c.name}`,
				requestBody: this._jsonBody(tag),
				responses: { '201': { description: 'Created' } },
				'x-codeSamples': this._sdkSample(`const item = await client.items('${c.slug}').create({\n  title: 'Item A',\n  price: 5,\n});`),
			},
		};

		spec.paths[`${base}/{id}`] = {
			get: {
				tags: [tag],
				summary: `Get ${c.name}`,
				parameters: this._idParam(),
				responses: { '200': { description: 'Success' } },
				'x-codeSamples': this._sdkSample(`const item = await client.items('${c.slug}').get(id);`),
			},
			put: {
				tags: [tag],
				summary: `Update ${c.name}`,
				parameters: this._idParam(),
				requestBody: this._jsonBody(tag),
				responses: { '200': { description: 'Updated' } },
				'x-codeSamples': this._sdkSample(`const item = await client.items('${c.slug}').update(id, {\n  price: 20,\n});`),
			},
			delete: {
				tags: [tag],
				summary: `Soft delete ${c.name}`,
				parameters: this._idParam(),
				responses: { '200': { description: 'Deleted (moved to trash)' } },
				'x-codeSamples': this._sdkSample(`await client.items('${c.slug}').remove(id);`),
			},
		};

		// ── Bulk create / import ──────────────────────────────────
		spec.paths[`${base}/import`] = {
			post: {
				tags: [tag],
				summary: `Bulk import ${c.name} (JSON array or CSV)`,
				description:
					'Creates many records in one call. Each row runs the full pipeline (linkage, defaults, validation, row-filter); per-row errors are reported without failing the batch.',
				requestBody: {
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									format: { type: 'string', enum: ['json', 'csv'], description: 'Input format (default json)' },
									data: { type: 'string', description: 'JSON array of objects, or CSV text' },
								},
								required: ['data'],
							},
						},
					},
				},
				responses: { '200': { description: 'Import result — { imported, errors[] }' } },
				'x-codeSamples': this._sdkSample(
					`const { imported, errors } = await client.request('/entities/${c.slug}/import', {\n  method: 'POST',\n  body: {\n    format: 'json',\n    data: JSON.stringify([{ title: 'Item A' }, { title: 'Item B' }]),\n  },\n});`,
				),
			},
		};

		// ── Bulk status transition ────────────────────────────────
		spec.paths[`${base}/bulk/transition`] = {
			post: {
				tags: [tag],
				summary: `Bulk status transition for ${c.name}`,
				description: 'Moves many records to a new doc_status in one call.',
				requestBody: this._jsonBodyLiteral({
					type: 'object',
					properties: {
						ids: { type: 'array', items: { type: 'string' }, description: 'Record IDs' },
						to_status: { type: 'string', enum: DOC_STATUS },
					},
					required: ['ids', 'to_status'],
				}),
				responses: { '200': { description: 'Transition result — { total, succeeded, failed, results[] }' } },
				'x-codeSamples': this._sdkSample(
					`const result = await client.request('/entities/${c.slug}/bulk/transition', {\n  method: 'POST',\n  body: { ids: [id1, id2], to_status: 'approved' },\n});`,
				),
			},
		};

		// ── Declarative collection actions ────────────────────────
		spec.paths[`${base}/action/{action}`] = {
			post: {
				tags: [tag],
				summary: `Run a declarative action on ${c.name}`,
				description: 'Runs a server-side action (update / delete / webhook) declared in the collection schema.',
				parameters: [
					{ name: 'action', in: 'path', required: true, schema: { type: 'string' }, description: 'Action name from the collection schema' },
				],
				requestBody: this._jsonBodyLiteral({
					type: 'object',
					properties: {
						ids: { type: 'array', items: { type: 'string' }, description: 'Record IDs to act on' },
						data: { type: 'object', description: 'Extra data merged over the action payload' },
					},
				}),
				responses: { '200': { description: 'Action result — { action, processed, results[] }' } },
				'x-codeSamples': this._sdkSample(
					`const result = await client.request('/entities/${c.slug}/action/mark_paid', {\n  method: 'POST',\n  body: { ids: [id1, id2] },\n});`,
				),
			},
		};

		// ── Trash / restore / hard delete ─────────────────────────
		spec.paths[`${base}/{id}/restore`] = {
			post: {
				tags: [tag],
				summary: `Restore ${c.name} from trash`,
				parameters: this._idParam(),
				responses: { '200': { description: 'Restored' } },
				'x-codeSamples': this._sdkSample(`await client.request('/entities/${c.slug}/' + id + '/restore', { method: 'POST' });`),
			},
		};
		spec.paths[`${base}/{id}/force`] = {
			delete: {
				tags: [tag],
				summary: `Hard delete ${c.name} (admin only)`,
				parameters: this._idParam(),
				responses: { '200': { description: 'Permanently deleted' } },
				'x-codeSamples': this._sdkSample(`await client.request('/entities/${c.slug}/' + id + '/force', { method: 'DELETE' });`),
			},
		};

		// ── Approval workflow ─────────────────────────────────────
		spec.paths[`${base}/{id}/approve`] = {
			post: {
				tags: [tag],
				summary: `Approve ${c.name}`,
				parameters: this._idParam(),
				requestBody: this._jsonBodyLiteral({ type: 'object', properties: { comment: { type: 'string' } } }),
				responses: { '200': { description: 'Approved' } },
				'x-codeSamples': this._sdkSample(
					`await client.request('/entities/${c.slug}/' + id + '/approve', {\n  method: 'POST',\n  body: { comment: 'Looks good' },\n});`,
				),
			},
		};
		spec.paths[`${base}/{id}/reject`] = {
			post: {
				tags: [tag],
				summary: `Reject ${c.name}`,
				parameters: this._idParam(),
				requestBody: this._jsonBodyLiteral({ type: 'object', properties: { comment: { type: 'string' } } }),
				responses: { '200': { description: 'Rejected' } },
				'x-codeSamples': this._sdkSample(
					`await client.request('/entities/${c.slug}/' + id + '/reject', {\n  method: 'POST',\n  body: { comment: 'Needs changes' },\n});`,
				),
			},
		};
		spec.paths[`${base}/{id}/approvals`] = {
			get: {
				tags: [tag],
				summary: `Approval history for ${c.name}`,
				parameters: this._idParam(),
				responses: { '200': { description: 'Approval history' } },
				'x-codeSamples': this._sdkSample(`const history = await client.request('/entities/${c.slug}/' + id + '/approvals');`),
			},
		};
	}

	private _addSchema(spec: OpenAPISpec, c: EntitySchema) {
		let fields: FieldDefinition[];
		try {
			const p = JSON.parse(c.schema_json);
			fields = p.fields || [];
		} catch {
			return;
		}

		const props: Record<string, unknown> = {
			id: { type: 'string', description: 'UUID primary key' },
			doc_status: { type: 'string', enum: DOC_STATUS },
			created_at: { type: 'string', format: 'date-time' },
			updated_at: { type: 'string', format: 'date-time' },
		};

		for (const f of fields) {
			const type = TYPE_MAP[f.type] || 'string';
			props[f.name] = { type, description: f.label || f.name };
			if (f.required) (props[f.name] as Record<string, unknown>).required = true;
		}

		spec.components.schemas[c.name] = { type: 'object', properties: props };
	}

	private _addSystemPaths(spec: OpenAPISpec) {
		spec.paths['/api/health'] = { get: { tags: ['System'], summary: 'Health check', responses: { '200': { description: 'OK' } } } };
		spec.paths['/api/auth/login'] = { post: { tags: ['Auth'], summary: 'Login', responses: { '200': { description: 'Token' } } } };

		// ── Bulk create / update / delete (RBAC) ──────────────────
		spec.paths['/api/bulk/{collection}'] = {
			post: {
				tags: ['Bulk'],
				summary: 'Bulk create / update / delete records',
				description:
					'Performs a bulk action on a collection. `action` is one of create | update | delete. `items` is an array of records (updates/deletes need an `id`). Failures are captured per item without aborting the batch. Supports the Idempotency-Key header.',
				parameters: [{ name: 'collection', in: 'path', required: true, schema: { type: 'string' }, description: 'Collection slug' }],
				requestBody: this._jsonBodyLiteral({
					type: 'object',
					properties: {
						action: { type: 'string', enum: ['create', 'update', 'delete'] },
						items: {
							type: 'array',
							description: 'Records to process (create: full objects; update/delete: must include `id`)',
							items: { type: 'object' },
						},
					},
					required: ['action', 'items'],
				}),
				responses: { '200': { description: 'Bulk result — { action, processed, results[] }' } },
				'x-codeSamples': this._sdkSample(
					`const result = await client.request('/bulk/' + collection, {\n  method: 'POST',\n  body: {\n    action: 'create',\n    items: [{ title: 'Item A' }, { title: 'Item B' }],\n  },\n});`,
				),
			},
		};

		// ── Read batch ────────────────────────────────────────────
		spec.paths['/api/query'] = {
			post: {
				tags: ['Query'],
				summary: 'Read batch — one view, one round trip',
				description:
					'Executes up to 12 keyed { collection, params } read specs in parallel through the entity engine. Per-key error isolation: a failing key yields ok:false without failing the rest.',
				requestBody: this._jsonBodyLiteral({
					type: 'object',
					properties: {
						queries: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									key: { type: 'string', description: 'Response key (defaults to collection)' },
									collection: { type: 'string' },
									params: { type: 'object', additionalProperties: { type: 'string' }, description: 'Serialized URL search params' },
								},
								required: ['collection'],
							},
						},
					},
					required: ['queries'],
				}),
				responses: { '200': { description: 'Keyed results — { results: [{ key, ok, data?, meta? | error? }] }' } },
				'x-codeSamples': this._sdkSample(
					`const { results } = await client.queryMany([\n  { key: 'products', collection: 'products', query: { limit: 25 } },\n  { key: 'orders', collection: 'orders', query: { limit: 10, sort: '-created_at' } },\n]);`,
				),
			},
		};

		// ── Schema plane (Directus-style separation) ──────────────
		spec.paths['/api/collections'] = {
			get: {
				tags: ['Schema'],
				summary: 'List all collections',
				responses: { '200': { description: 'Collection list' } },
				'x-codeSamples': this._sdkSample(`const collections = await client.request('/collections');`),
			},
			post: {
				tags: ['Schema'],
				summary: 'Create collection',
				responses: { '201': { description: 'Created' } },
				'x-codeSamples': this._sdkSample(
					`const collection = await client.request('/collections', {\n  method: 'POST',\n  body: { name: 'Products', slug: 'products' },\n});`,
				),
			},
		};
		spec.paths['/api/collections/{slug}'] = {
			get: {
				tags: ['Schema'],
				summary: 'Get collection + full schema',
				responses: { '200': { description: 'Collection detail' } },
				'x-codeSamples': this._sdkSample(`const schema = await client.request('/collections/' + slug);`),
			},
			put: {
				tags: ['Schema'],
				summary: 'Update collection schema',
				responses: { '200': { description: 'Updated' } },
				'x-codeSamples': this._sdkSample(
					`const updated = await client.request('/collections/' + slug, {\n  method: 'PUT',\n  body: { fields: [/* ... */] },\n});`,
				),
			},
			delete: {
				tags: ['Schema'],
				summary: 'Delete collection',
				responses: { '200': { description: 'Deleted' } },
				'x-codeSamples': this._sdkSample(`await client.request('/collections/' + slug, { method: 'DELETE' });`),
			},
		};
		spec.paths['/api/field-types'] = {
			get: { tags: ['Schema'], summary: 'Field-type catalog (40 types, grouped)', responses: { '200': { description: 'Field types' } } },
		};

		// ── Search ────────────────────────────────────────────────
		spec.paths['/api/search/global'] = {
			get: {
				tags: ['Search'],
				summary: 'Global full-text search across collections',
				parameters: [
					{ name: 'q', in: 'query', schema: { type: 'string' }, required: true },
					{ name: 'collections', in: 'query', schema: { type: 'string' } },
					{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
				],
				responses: { '200': { description: 'Results' } },
				'x-codeSamples': this._sdkSample(
					`const results = await client.request('/search/global', {\n  query: { q: 'laptop', limit: 20 },\n});`,
				),
			},
		};

		// ── Users / me ────────────────────────────────────────────
		spec.paths['/api/users'] = {
			get: {
				tags: ['Users'],
				summary: 'List users',
				responses: { '200': { description: 'User list' } },
				'x-codeSamples': this._sdkSample(`const users = await client.request('/users');`),
			},
			post: {
				tags: ['Users'],
				summary: 'Create user',
				responses: { '201': { description: 'Created' } },
				'x-codeSamples': this._sdkSample(
					`const user = await client.request('/users', {\n  method: 'POST',\n  body: { email: 'a@b.com', name: 'A' },\n});`,
				),
			},
		};
		spec.paths['/api/me'] = {
			get: {
				tags: ['Users'],
				summary: 'Current user profile',
				responses: { '200': { description: 'Profile' } },
				'x-codeSamples': this._sdkSample(`const me = await client.request('/me');`),
			},
		};

		// ── Media ─────────────────────────────────────────────────
		spec.paths['/api/media'] = {
			post: {
				tags: ['Media'],
				summary: 'Upload a file to R2',
				responses: { '201': { description: 'Uploaded' } },
				'x-codeSamples': this._sdkSample(
					`const uploaded = await client.request('/media', {\n  method: 'POST',\n  body: formData, // FormData with the file\n});`,
				),
			},
		};

		// ── Governance & automation ───────────────────────────────
		spec.paths['/api/audit'] = {
			get: {
				tags: ['Audit'],
				summary: 'Audit trail',
				responses: { '200': { description: 'Audit entries' } },
				'x-codeSamples': this._sdkSample(`const entries = await client.request('/audit');`),
			},
		};
		spec.paths['/api/reports'] = {
			get: {
				tags: ['Reports'],
				summary: 'List reports',
				responses: { '200': { description: 'Reports' } },
				'x-codeSamples': this._sdkSample(`const reports = await client.request('/reports');`),
			},
		};
		spec.paths['/api/webhooks'] = {
			get: {
				tags: ['Webhooks'],
				summary: 'List webhooks',
				responses: { '200': { description: 'Webhooks' } },
				'x-codeSamples': this._sdkSample(`const webhooks = await client.request('/webhooks');`),
			},
			post: {
				tags: ['Webhooks'],
				summary: 'Create webhook',
				responses: { '201': { description: 'Created' } },
				'x-codeSamples': this._sdkSample(
					`const webhook = await client.request('/webhooks', {\n  method: 'POST',\n  body: { url: 'https://hooks.example.com', events: ['create'] },\n});`,
				),
			},
		};
		spec.paths['/api/scheduler'] = {
			get: {
				tags: ['Scheduler'],
				summary: 'List scheduled jobs',
				responses: { '200': { description: 'Jobs' } },
				'x-codeSamples': this._sdkSample(`const jobs = await client.request('/scheduler');`),
			},
			post: {
				tags: ['Scheduler'],
				summary: 'Create scheduled job',
				responses: { '201': { description: 'Created' } },
				'x-codeSamples': this._sdkSample(
					`const job = await client.request('/scheduler', {\n  method: 'POST',\n  body: { cron: '0 9 * * *', action: '...' },\n});`,
				),
			},
		};
		spec.paths['/api/views'] = {
			get: {
				tags: ['Views'],
				summary: 'List saved views',
				responses: { '200': { description: 'Views' } },
				'x-codeSamples': this._sdkSample(`const views = await client.request('/views');`),
			},
			post: {
				tags: ['Views'],
				summary: 'Create saved view',
				responses: { '201': { description: 'Created' } },
				'x-codeSamples': this._sdkSample(
					`const view = await client.request('/views', {\n  method: 'POST',\n  body: { name: 'My View', filters: {} },\n});`,
				),
			},
		};
		spec.paths['/api/modules'] = {
			get: {
				tags: ['Modules'],
				summary: 'List modules (menus, views)',
				responses: { '200': { description: 'Modules' } },
				'x-codeSamples': this._sdkSample(`const modules = await client.request('/modules');`),
			},
		};
	}

	private _queryParams() {
		return [
			{ name: 'limit', in: 'query', schema: { type: 'integer', default: 25 } },
			{ name: 'cursor', in: 'query', schema: { type: 'string' } },
			{ name: 'fields', in: 'query', schema: { type: 'string' } },
			{ name: 'sort', in: 'query', schema: { type: 'string' } },
			{ name: 'search', in: 'query', schema: { type: 'string' } },
		];
	}
	private _idParam() {
		return [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }];
	}
	/**
	 * Build an `x-codeSamples` entry (Redocly/Scalar standard) that shows the
	 * `@mmbix/sdk` usage for an operation. Scalar renders this as an extra tab
	 * (labelled "@mmbix/sdk") alongside the auto-generated HTTP/Dart/etc. samples.
	 */
	private _sdkSample(source: string) {
		return [
			{
				lang: 'JavaScript',
				label: '@mmbix/sdk',
				source: [
					"import { createClient } from '@mmbix/sdk';",
					'',
					"const client = createClient({ baseUrl: 'http://localhost:8788' });",
					'await client.devLogin(); // dev only — use client.login(email, password) in production',
					'',
					source,
				].join('\n'),
			},
		];
	}

	private _jsonBody(tag: string) {
		return { content: { 'application/json': { schema: { $ref: `#/components/schemas/${tag}` } } } };
	}
	private _jsonBodyLiteral(schema: Record<string, unknown>) {
		return { content: { 'application/json': { schema } } };
	}
	private _listResponse(tag: string) {
		return {
			'200': {
				description: 'Success',
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								success: { type: 'boolean' },
								data: { type: 'array', items: { $ref: `#/components/schemas/${tag}` } },
								meta: { type: 'object' },
							},
						},
					},
				},
			},
		};
	}
}
