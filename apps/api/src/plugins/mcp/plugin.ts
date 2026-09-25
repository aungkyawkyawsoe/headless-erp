/**
 * MCP Plugin — a least-privilege INBOUND MCP server (read-only in v1).
 *
 * The factory is drivable by an AI agent over the Model Context Protocol. This
 * is a port at the boundary: the agent speaks MCP tools to `/api/mcp`, and the
 * Worker answers by calling the SAME engine services the REST API uses. No tool
 * here writes — write tools are deliberately absent until a scoped key model
 * lands (see the design's §4.6). Transport is Streamable-HTTP-style JSON-RPC
 * over POST; `stdio` is impossible in a Worker, which is exactly why the AGENT
 * is the MCP client (it can also reach external design sources the Worker can't).
 *
 * MCP keys are ordinary API keys / the session bearer; new keys should start
 * read-only. The plugin itself is gated by `PLUGINS`.
 *
 * Bundle impact: ~3KB.
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { applyOps, type BlockNode, type PatchOp, type FieldDefinition } from '@mmbix/types';
import { blockVocabulary, normalizeBlocks } from '@/lib/services/block-validation';
import { decodeApp } from '@mmbix/types';
import { Hono, type Context } from 'hono';
import { D1Client, getIndexAdvisor, resolvePolicy } from '@mmbix/core';
import { requireAuth } from '@/routes/auth';
import { csvToRecords } from '@/lib/csv';
import { poolMap } from '@/lib/utils/pool';
import { CollectionService } from '@/lib/services/collection.service';
import { IntegrityService } from '@/lib/services/integrity.service';
import { PageService, type PageBlocks } from '@/lib/services/page.service';
import { AuditService } from '@/lib/services/audit.service';
import type { AuthContext } from '@/lib/services/auth.service';
import { normalizeDesignDNA } from '@/plugins/generation/design-dna';
import { promptToDesignDNA } from '@/plugins/generation/prompt-dna';
import { buildProposal } from '@/plugins/generation/proposal';
import { GenerationService } from '@/plugins/generation/service';
import { CAPABILITIES, getCapability, searchCapabilities } from './capabilities';
import { listHandlers, registerBuiltinHandlers } from '@mmbix/scheduler';
import { applyManifest, normalizeFields, planManifest, validateManifest, type ManifestEnv } from './manifest';
import type { CapabilityQuery } from '@mmbix/types';

const PROTOCOL_VERSION = '2025-06-18';

/** A short, on-demand guide served as an MCP resource (Tier-0 knowledge). */
const GUIDE = [
	'# Factory control plane',
	'',
	'Build with the Manifest primitive, not one call per field:',
	'1. `search_capabilities` / read `factory://capabilities` to discover verbs.',
	'2. `plan_manifest` { app } — diff, writes nothing.',
	'3. `apply_manifest` { app } — the only write (admin + write scope).',
	'',
	'Prefer the COMPACT `app` DSL (fewer tokens than the full manifest; both feed the same validator):',
	'{ v:1, cols:[{ s:"po", n:"Purchase Order", f:["code:text!","total:currency","supplier:m2o>supplier","status:select(draft,approved)"] }],',
	'  pages:[{ p:"/orders", t:"Orders", b:[{ id:"t1", type:"table", layout:{order:0}, config:{collection:"po"} }] }],',
	'  roles:["Clerk"], grants:[{ r:"Clerk", c:"po", can:"rwc" }], menus:[{ m:"finance", l:"Orders", target:"po" }],',
	'  kpis:[{ n:"PO Count", c:"po", agg:"count" }] }',
	'Field shorthand: name:type with ! required, # unique, >target relation, (a,b,c) options. Types: text/currency/number/date/select/m2o/… (aliases: str num int cur pct bool dt ts sel fk).',
	'Permission letters: r read, w write, c create, d delete, s submit, a approve.',
	'4. `query` { requests:[{collection,params}] } — bounded reads.',
	'',
	'Full manifest shape: { version:1, collections:[…], pages:[…], roles:[…], permissions:[…], workflows:[…], menus:[…], kpis:[…], serverFunctions:[…], apiKeys:[…], schedules:[…], reports:[…] }',
	'collection: { slug, name?, naming_series?, fields:[{name,type,required?,related_collection?,options?,unique?}], policies? }',
	'page: { module?, path, title, blocks? } · permission: { role, collection, can_read?, can_write?, can_create?, can_delete?, can_approve?, can_submit? }',
	'workflow: { name, collection, initial, states[], transitions[] } · menu: { module, label, type?, target?, icon?, roles? }',
	'kpi: { name, collection, agg, field?, group_by?, period?, schedule? } · serverFunction: { name, collection, trigger_event, rules? }',
	'apiKey: { name, user_id, role_id?, scope? } — the plaintext secret is returned ONCE in the result.',
	'schedule: { name, type, cron?|repeat_ms?, timezone?, payload? } — `type` MUST be a handler from list_handlers.',
	'report: { name, collection, format? } — a saved export, materialized by POST /api/scheduled-reports/schedule/:id/generate.',
	'Field types are the 41-type SSOT. Identifiers are sanitized and validated.',
	"Blocks: every `type` MUST come from `factory://blocks` (it carries each block's `defaults` + nesting rules); an unknown block is dropped with a warning, never written.",
].join('\n');

interface JsonRpcRequest {
	jsonrpc?: string;
	id?: string | number | null;
	method?: string;
	params?: Record<string, unknown>;
}

/** The read-only tool catalog. Names/descriptions are the agent's whole vocabulary. */
const TOOLS = [
	{
		name: 'list_collections',
		description: 'List the collections in this deployment (name, slug, description).',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	},
	{
		name: 'describe_collection',
		description: 'Describe one collection’s fields (name, type, required, relation).',
		inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'], additionalProperties: false },
	},
	{
		name: 'propose_schema',
		description: 'Map a DesignDNA or a prompt to a DRAFT schema proposal. Never writes a schema — a human must review and apply it.',
		inputSchema: {
			type: 'object',
			properties: {
				collection: { type: 'object', properties: { name: { type: 'string' }, slug: { type: 'string' } } },
				dna: { type: 'object' },
				prompt: { type: 'string' },
			},
			additionalProperties: false,
		},
	},
	{
		name: 'submit_for_review',
		description: 'Move a generation proposal from draft to review (admin; write scope required).',
		inputSchema: {
			type: 'object',
			properties: { proposal_id: { type: 'string' } },
			required: ['proposal_id'],
			additionalProperties: false,
		},
	},
	{
		name: 'promote',
		description: 'Approve a reviewed proposal (moves it to promoted). Applying it live is a separate admin action.',
		inputSchema: {
			type: 'object',
			properties: { proposal_id: { type: 'string' } },
			required: ['proposal_id'],
			additionalProperties: false,
		},
	},
	{
		name: 'apply_patch',
		description: 'Apply structural patch ops to a stored page and persist it (admin; write scope required).',
		inputSchema: {
			type: 'object',
			properties: { page_id: { type: 'string' }, ops: { type: 'array' } },
			required: ['page_id', 'ops'],
			additionalProperties: false,
		},
	},
	{
		name: 'search_capabilities',
		description: 'Search the capability catalog (the factory’s self-description). Read-only.',
		inputSchema: {
			type: 'object',
			properties: { q: { type: 'string' }, domain: { type: 'string' }, class: { type: 'string' }, available_only: { type: 'boolean' } },
			additionalProperties: false,
		},
	},
	{
		name: 'describe_capability',
		description: 'Describe one capability by id.',
		inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
	},
	{
		name: 'plan_manifest',
		description: 'Diff an app/manifest against the live factory. WRITES NOTHING. Pass `manifest` (full JSON) or `app` (compact DSL).',
		inputSchema: {
			type: 'object',
			properties: { manifest: { type: 'object' }, app: { type: 'object' } },
			additionalProperties: false,
		},
	},
	{
		name: 'apply_manifest',
		description: 'Apply an app/manifest — the only write (admin; write scope). Pass `manifest` (full JSON) or `app` (compact DSL).',
		inputSchema: {
			type: 'object',
			properties: { manifest: { type: 'object' }, app: { type: 'object' } },
			additionalProperties: false,
		},
	},
	{
		name: 'validate_fields',
		description: 'Dry-run a field list against the field-type SSOT. WRITES NOTHING — same validator apply_manifest uses.',
		inputSchema: {
			type: 'object',
			properties: { collection: { type: 'string' }, fields: { type: 'array' } },
			required: ['fields'],
			additionalProperties: false,
		},
	},
	{
		name: 'list_handlers',
		description: 'The scheduler handler types a manifest `schedules[]` entry may reference.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	},
	{
		name: 'query',
		description: 'Bounded multi-collection read. requests[] = { collection, params? }.',
		inputSchema: {
			type: 'object',
			properties: { requests: { type: 'array' } },
			required: ['requests'],
			additionalProperties: false,
		},
	},
	{
		name: 'get_audit',
		description: 'Read a collection’s audit trail, or one document’s history.',
		inputSchema: {
			type: 'object',
			properties: { collection: { type: 'string' }, document_id: { type: 'string' }, limit: { type: 'number' } },
			required: ['collection'],
			additionalProperties: false,
		},
	},
	{
		name: 'mutate',
		description:
			'Batched data writes. requests[] = { op: create|update|delete|import, collection, id?, body?, format?, data? }. Admin; write scope.',
		inputSchema: {
			type: 'object',
			properties: { requests: { type: 'array' } },
			required: ['requests'],
			additionalProperties: false,
		},
	},
	{
		name: 'get_operations',
		description: 'Engine telemetry: index advisor (default) or declared jobs with their last result/error. Read-only.',
		inputSchema: { type: 'object', properties: { domain: { type: 'string', enum: ['indexes', 'jobs'] } }, additionalProperties: false },
	},
	{
		name: 'run_integrity',
		description: 'Run a collection’s declared integrity rules (bounded data-quality read).',
		inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'], additionalProperties: false },
	},
] as const;

/**
 * Which tools mutate state — the class a scoped API key must be allowed to call.
 * A `read` key is refused a write tool (PoLP); sessions carry no scope and are
 * already role-gated, and a legacy key (null → resolved `admin`) keeps access.
 */
const TOOL_CLASS: Record<string, 'read' | 'write'> = {
	list_collections: 'read',
	describe_collection: 'read',
	propose_schema: 'write',
	submit_for_review: 'write',
	promote: 'write',
	apply_patch: 'write',
	search_capabilities: 'read',
	describe_capability: 'read',
	plan_manifest: 'read',
	apply_manifest: 'write',
	validate_fields: 'read',
	list_handlers: 'read',
	query: 'read',
	get_audit: 'read',
	mutate: 'write',
	get_operations: 'read',
	run_integrity: 'read',
};

export function mcpScopeAllows(scope: string | null | undefined, tool: string): boolean {
	if (TOOL_CLASS[tool] !== 'write') return true;
	if (scope === undefined || scope === null || scope === '') return true;
	return scope === 'write' || scope === 'admin';
}

/**
 * Declared jobs + their health. Bounded and ordered, and `payload_json` is NOT
 * returned (it can be large and is operator data, not telemetry). `last_error` is
 * included on purpose: a job that silently stopped is the failure mode this exists
 * to make visible.
 */
async function safeTaskList(db: D1Client): Promise<
	Array<{
		id: string;
		name: string | null;
		type: string;
		status: string;
		cron: string | null;
		run_at: string;
		run_count: number;
		attempts: number;
		last_run_at: string | null;
		last_error: string | null;
		last_result: string | null;
	}>
> {
	return db.all({
		sql: `SELECT id, name, type, status, cron, run_at, run_count, attempts, last_run_at, last_error, last_result
			FROM _scheduler_tasks ORDER BY COALESCE(run_at, created_at) ASC LIMIT 100`,
		bindings: [],
	});
}

function rpcResult(id: JsonRpcRequest['id'], result: unknown) {
	return { jsonrpc: '2.0', id: id ?? null, result };
}
function rpcError(id: JsonRpcRequest['id'], code: number, message: string) {
	return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function callTool(c: Context, name: string, args: Record<string, unknown>): Promise<unknown> {
	const db = new D1Client((c.env as { DB: D1Database }).DB);
	const auth = c.get('auth') as AuthContext | undefined;
	const svc = new CollectionService(db, auth);

	if (name === 'list_collections') {
		const rows = await svc.getCollectionSummaries();
		return rows.map((r) => ({ slug: r.slug, name: r.name, description: r.description ?? null }));
	}
	if (name === 'describe_collection') {
		const slug = String(args.slug ?? '');
		if (!slug) throw new Error('slug is required');
		const info = await svc.getCollection(slug);
		return {
			slug,
			table_name: info.table_name,
			fields: info.schemaFields.map((f) => ({
				name: f.name,
				type: f.type,
				required: f.required ?? true,
				...(f.related_collection ? { related_collection: f.related_collection } : {}),
			})),
		};
	}
	if (name === 'propose_schema') {
		// Creating a proposal is a D1 row, not a schema write — but it is still a
		// mutation, so it requires an admin session (PoLP; no scoped keys yet).
		if (!auth?.is_admin) throw new Error('Admin access required to propose a schema');
		const parsed =
			args.dna !== undefined
				? normalizeDesignDNA(args.dna)
				: args.prompt
					? normalizeDesignDNA(promptToDesignDNA(String(args.prompt)))
					: null;
		if (!parsed || !parsed.dna) throw new Error(parsed?.warnings[0]?.message ?? 'Provide dna or prompt');
		const collection = (args.collection as { name?: string; slug?: string } | undefined) ?? undefined;
		const proposal = buildProposal({ collection, dna: parsed.dna }, { maxFields: 40 });
		proposal.warnings.unshift(...parsed.warnings);
		const record = await new GenerationService(db, () => auth ?? null).create(proposal, {
			requireReview: true,
			actor: auth.user_id ?? null,
		});
		return {
			id: record.id,
			status: record.status,
			collection_slug: record.collection_slug,
			fields: record.proposal.collection.fields,
			pages: record.proposal.pages ?? [],
		};
	}
	if (name === 'submit_for_review' || name === 'promote') {
		if (!auth?.is_admin) throw new Error('Admin access required');
		const id = String(args.proposal_id ?? '');
		if (!id) throw new Error('proposal_id is required');
		const record = await new GenerationService(db, () => auth ?? null).transition(id, name === 'promote' ? 'approve' : 'submit');
		return { id: record.id, status: record.status };
	}
	if (name === 'apply_patch') {
		if (!auth?.is_admin) throw new Error('Admin access required to patch a page');
		const pageId = String(args.page_id ?? '');
		if (!pageId) throw new Error('page_id is required');
		const ops = Array.isArray(args.ops) ? (args.ops as PatchOp[]) : [];
		if (ops.length > 500) throw new Error('Too many ops (max 500)');
		const pages = new PageService(db, auth);
		const page = await pages.getById(pageId);
		if (!page) throw new Error('Page not found');
		const tree = applyOps((page.blocks ?? []) as unknown as BlockNode[], ops);
		// Structure is not enough: a patch can name any `type` string. Validate the
		// RESULT against the block registry before it is persisted, and report what
		// was dropped (an unknown block would render as nothing).
		const warnings: string[] = [];
		const validated = normalizeBlocks(`page "${page.path}"`, tree, warnings);
		const saved = await pages.save({
			module_id: page.module_id,
			path: page.path,
			title: page.title,
			blocks: validated as unknown as PageBlocks[],
			globalFilter: page.globalFilter,
			is_published: page.isPublished,
		});
		return { id: saved.id, blocks: saved.blocks, ...(warnings.length ? { warnings } : {}) };
	}
	if (name === 'search_capabilities') {
		const query: CapabilityQuery = {};
		if (typeof args.q === 'string' && args.q) query.q = args.q;
		if (typeof args.domain === 'string' && args.domain) query.domain = args.domain as CapabilityQuery['domain'];
		if (typeof args.class === 'string' && args.class) query.class = args.class as CapabilityQuery['class'];
		if (args.available_only === true) query.availableOnly = true;
		return { capabilities: searchCapabilities(query) };
	}
	if (name === 'describe_capability') {
		const id = String(args.id ?? '');
		const capability = getCapability(id);
		if (!capability) throw new Error(`Unknown capability "${id}"`);
		return capability;
	}
	if (name === 'plan_manifest' || name === 'apply_manifest') {
		if (name === 'apply_manifest' && !auth?.is_admin) throw new Error('Admin access required to apply a manifest');
		// Two encodings, ONE write path: `app` is the compact DSL (fewer tokens),
		// `manifest` is the full JSON. Both decode to the same manifest and then run
		// the SAME validator — so they cannot disagree on what is valid.
		const decoded = args.app !== undefined ? decodeApp(args.app) : null;
		const { manifest, warnings } = validateManifest(decoded ? decoded.manifest : args.manifest);
		const allWarnings = [...(decoded?.warnings ?? []), ...warnings];
		if (!manifest) throw new Error(allWarnings[0] ?? 'Invalid manifest');
		if (name === 'plan_manifest') {
			const plan = await planManifest(db, manifest);
			plan.warnings.unshift(...allWarnings);
			return plan;
		}
		const applied = await applyManifest(db, auth!, manifest, c.env as unknown as ManifestEnv);
		applied.plan.warnings.unshift(...allWarnings);
		return applied;
	}
	if (name === 'validate_fields') {
		// The SAME validator apply_manifest runs — a dry run can never disagree
		// with the real thing, because there is only one implementation.
		const warnings: string[] = [];
		const collection = typeof args.collection === 'string' ? args.collection : 'fields';
		const fields = normalizeFields(`collection "${collection}"`, args.fields, warnings);
		return { collection, valid: fields, warnings, count: fields.length };
	}
	if (name === 'list_handlers') {
		registerBuiltinHandlers();
		return { handlers: listHandlers() };
	}
	if (name === 'query') {
		const requests = Array.isArray(args.requests) ? args.requests.slice(0, 12) : [];
		const results: unknown[] = [];
		for (const raw of requests) {
			const r = (raw ?? {}) as { collection?: unknown; params?: Record<string, unknown> };
			const collection = typeof r.collection === 'string' ? r.collection : '';
			if (!collection) {
				results.push({ collection, error: 'collection is required' });
				continue;
			}
			try {
				const url = new URL(`http://internal/api/entities/${collection}`);
				for (const [k, v] of Object.entries(r.params ?? {})) {
					if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
				}
				results.push({ collection, ...(await svc.listItems(collection, url)) });
			} catch (err) {
				results.push({ collection, error: err instanceof Error ? err.message : 'query failed' });
			}
		}
		return { results };
	}
	if (name === 'get_audit') {
		const collection = String(args.collection ?? '');
		if (!collection) throw new Error('collection is required');
		const audit = new AuditService(db);
		const documentId = typeof args.document_id === 'string' ? args.document_id : '';
		if (documentId) return { entries: await audit.getDocumentHistory(collection, documentId) };
		const limit = typeof args.limit === 'number' ? Math.min(Math.max(Math.floor(args.limit), 1), 200) : 50;
		return { entries: await audit.getCollectionHistory(collection, limit) };
	}
	if (name === 'mutate') {
		const requests = Array.isArray(args.requests) ? args.requests.slice(0, 20) : [];
		const results: unknown[] = [];
		for (const raw of requests) {
			const r = (raw ?? {}) as { op?: unknown; collection?: unknown; id?: unknown; body?: unknown; format?: unknown; data?: unknown };
			const op = typeof r.op === 'string' ? r.op : '';
			const collection = typeof r.collection === 'string' ? r.collection : '';
			const id = typeof r.id === 'string' ? r.id : '';
			if (!collection || !['create', 'update', 'delete', 'import'].includes(op)) {
				results.push({ collection, op, error: 'op must be create|update|delete|import and collection is required' });
				continue;
			}
			try {
				if (op === 'import') {
					// CSV/JSON bulk import — reuses the SAME parser + per-row isolation
					// as POST /api/entities/:collection/import.
					const format = r.format === 'csv' ? 'csv' : 'json';
					let rows: Array<Record<string, unknown>>;
					if (Array.isArray(r.data)) {
						if (format === 'csv') throw new Error('CSV format expects data as text, not an array');
						rows = r.data as Array<Record<string, unknown>>;
					} else if (typeof r.data === 'string') {
						if (format === 'csv') rows = csvToRecords(r.data);
						else {
							const parsed: unknown = JSON.parse(r.data);
							if (!Array.isArray(parsed)) throw new Error('JSON data must be an array of objects');
							rows = parsed as Array<Record<string, unknown>>;
						}
					} else {
						throw new Error('data must be a JSON array or a JSON/CSV string');
					}
					if (rows.length === 0 || rows.length > 5000) throw new Error('import must have 1–5000 rows');
					let concurrency = 4;
					try {
						const info = await svc.getCollection(collection);
						if (info.naming_series) concurrency = 1; // claim numbers in row order
					} catch {
						/* unknown collection → per-row failures below */
					}
					const outcomes = await poolMap(rows, concurrency, async (row) => {
						try {
							await svc.createItem(collection, row);
							return null;
						} catch (e) {
							return e instanceof Error ? e.message : 'Failed';
						}
					});
					const errors: Array<{ row: number; error: string }> = [];
					let imported = 0;
					outcomes.forEach((o, i) => {
						if (o === null) imported++;
						else errors.push({ row: format === 'csv' ? i + 2 : i + 1, error: o });
					});
					results.push({ collection, op, imported, errors });
				} else if (op === 'create') {
					const item = (await svc.createItem(collection, (r.body ?? {}) as Record<string, unknown>)) as { id?: string };
					results.push({ collection, op, id: item.id });
				} else if (op === 'update') {
					if (!id) throw new Error('id is required for update');
					const item = (await svc.updateItem(collection, id, (r.body ?? {}) as Record<string, unknown>)) as { id?: string };
					results.push({ collection, op, id: item.id ?? id });
				} else {
					if (!id) throw new Error('id is required for delete');
					await svc.softDeleteItem(collection, id);
					results.push({ collection, op, id });
				}
			} catch (err) {
				results.push({ collection, op, error: err instanceof Error ? err.message : 'mutate failed' });
			}
		}
		return { results };
	}
	if (name === 'get_operations') {
		// One telemetry verb, selected by domain — the control plane stays small
		// while an agent can still see what the jobs it declared are doing.
		if (args.domain === 'jobs') {
			const tasks = await safeTaskList(db);
			return { domain: 'jobs', tasks };
		}
		return { domain: 'indexes', ...getIndexAdvisor().report() };
	}
	if (name === 'run_integrity') {
		const slug = String(args.slug ?? '');
		if (!slug) throw new Error('slug is required');
		const all = await svc.getCollections();
		const map = new Map<string, { fields: FieldDefinition[]; policies: unknown }>();
		for (const row of all) {
			try {
				const parsed = JSON.parse(row.schema_json || '{}') as { fields?: FieldDefinition[]; policies?: unknown };
				map.set(row.slug, { fields: Array.isArray(parsed.fields) ? parsed.fields : [], policies: parsed.policies ?? {} });
			} catch {
				map.set(row.slug, { fields: [], policies: {} });
			}
		}
		const self = map.get(slug);
		if (!self) throw new Error('Collection not found');
		const policy = resolvePolicy(self.policies as never);
		if (!policy.integrity.enabled || policy.integrity.rules.length === 0) {
			return { enabled: false, checked: 0, violations: 0, results: [], errors: [] };
		}
		const report = await new IntegrityService(db).run(
			slug,
			self.fields,
			(s) => map.get(s)?.fields ?? null,
			policy.integrity.rules,
			policy.integrity.limit,
		);
		return { enabled: true, ...report };
	}
	throw new Error(`Unknown tool "${name}"`);
}

export function mcpPlugin(): Plugin {
	return {
		id: 'mcp',
		name: 'Inbound MCP server — factory control plane (discovery + manifest verbs)',
		version: '1.0.0',
		register(_ctx: PluginContext): PluginRegistration {
			const app = new Hono<{ Bindings: { DB: D1Database }; Variables: { auth: AuthContext } }>();
			app.use('*', requireAuth);

			const handle = async (c: Context): Promise<Response> => {
				const body = (await c.req.json().catch(() => null)) as JsonRpcRequest | null;
				if (!body || typeof body.method !== 'string') return c.json(rpcError(body?.id ?? null, -32600, 'Invalid Request'), 200);

				// Notifications carry no id and expect no response body.
				if (body.method.startsWith('notifications/')) return c.body(null, 202);

				switch (body.method) {
					case 'initialize':
						return c.json(
							rpcResult(body.id, {
								protocolVersion: PROTOCOL_VERSION,
								capabilities: { tools: { listChanged: false } },
								serverInfo: { name: 'headless-erp-factory', version: '1.0.0' },
							}),
							200,
						);
					case 'ping':
						return c.json(rpcResult(body.id, {}), 200);
					case 'resources/list':
						return c.json(
							rpcResult(body.id, {
								resources: [
									{ uri: 'factory://capabilities', name: 'Capability catalog', mimeType: 'application/json' },
									{ uri: 'factory://guide', name: 'Factory builder guide', mimeType: 'text/markdown' },
									{ uri: 'factory://blocks', name: 'Page block vocabulary', mimeType: 'application/json' },
								],
							}),
							200,
						);
					case 'resources/read': {
						const uri = String((body.params as { uri?: unknown } | undefined)?.uri ?? '');
						if (uri === 'factory://capabilities') {
							return c.json(
								rpcResult(body.id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(CAPABILITIES) }] }),
								200,
							);
						}
						if (uri === 'factory://guide') {
							return c.json(rpcResult(body.id, { contents: [{ uri, mimeType: 'text/markdown', text: GUIDE }] }), 200);
						}
						if (uri === 'factory://blocks') {
							// The FULL vocabulary — defaults (how to configure a block) and
							// nesting rules, not just names. Generated from BLOCK_REGISTRY,
							// so it cannot drift from what the renderer draws.
							return c.json(
								rpcResult(body.id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(blockVocabulary()) }] }),
								200,
							);
						}
						return c.json(rpcError(body.id, -32602, `Unknown resource "${uri}"`), 200);
					}
					case 'tools/list':
						return c.json(rpcResult(body.id, { tools: TOOLS }), 200);
					case 'tools/call': {
						const params = (body.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
						if (!params.name) return c.json(rpcError(body.id, -32602, 'params.name is required'), 200);
						if (!TOOLS.some((t) => t.name === params.name)) {
							return c.json(rpcError(body.id, -32601, `Unknown tool "${params.name}"`), 200);
						}
						// PoLP — a read-scoped key can never invoke a mutating tool.
						const scope = (c.get('auth') as AuthContext | undefined)?.api_key_scope;
						if (!mcpScopeAllows(scope, params.name)) {
							return c.json(rpcError(body.id, -32002, `Insufficient scope for tool "${params.name}" (key scope: read)`), 200);
						}
						try {
							const result = await callTool(c, params.name, params.arguments ?? {});
							return c.json(rpcResult(body.id, { content: [{ type: 'text', text: JSON.stringify(result) }] }), 200);
						} catch (err) {
							return c.json(
								rpcResult(body.id, {
									content: [{ type: 'text', text: err instanceof Error ? err.message : 'Tool failed' }],
									isError: true,
								}),
								200,
							);
						}
					}
					default:
						return c.json(rpcError(body.id, -32601, `Method not found: ${body.method}`), 200);
				}
			};

			app.post('/', handle);
			// Some MCP clients probe GET for SSE; answer 405 until streaming is needed.
			app.get('/', (c) => c.json({ error: 'Use POST for MCP JSON-RPC' }, 405));

			return { routes: [{ path: '/api/mcp', handler: app as unknown as Hono }] };
		},
	};
}
