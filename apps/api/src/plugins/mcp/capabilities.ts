/**
 * Capability registry — the factory's self-description (SSOT).
 *
 * Agents discover this through `search_capabilities` / the `factory://capabilities`
 * resource rather than through a tool schema per action. `available` is honest:
 * false means the capability is catalogued but not yet wired to a verb.
 */

import type { CapabilityDescriptor, CapabilityQuery } from '@mmbix/types';

export const CAPABILITIES: readonly CapabilityDescriptor[] = [
	// ── meta ────────────────────────────────────────────────
	{
		id: 'meta.capabilities.search',
		domain: 'meta',
		class: 'read',
		summary: 'Search the capability catalog.',
		params: 'q?, domain?, class?',
		available: true,
	},
	{ id: 'meta.capabilities.describe', domain: 'meta', class: 'read', summary: 'Describe one capability.', params: 'id', available: true },
	{ id: 'meta.collections.list', domain: 'meta', class: 'read', summary: 'List collections.', params: '', available: true },
	{
		id: 'meta.collection.describe',
		domain: 'meta',
		class: 'read',
		summary: 'Describe a collection’s fields.',
		params: 'slug',
		available: true,
	},

	// ── schema (Brain) ──────────────────────────────────────
	{
		id: 'schema.manifest.plan',
		domain: 'schema',
		class: 'plan',
		summary: 'Plan a manifest (collections + pages) without writing.',
		params: 'manifest',
		available: true,
	},
	{
		id: 'schema.manifest.apply',
		domain: 'schema',
		class: 'apply',
		summary: 'Apply a manifest — creates collections + upserts pages.',
		params: 'manifest',
		available: true,
	},
	{
		id: 'schema.collection.create',
		domain: 'schema',
		class: 'apply',
		summary: 'Create one collection from a manifest entry.',
		params: 'collection',
		available: true,
	},
	{
		id: 'schema.collection.add_fields',
		domain: 'schema',
		class: 'apply',
		summary: 'Add missing fields to an existing collection (manifest `collections`).',
		params: 'slug, fields',
		available: true,
	},
	{
		id: 'schema.collection.policies',
		domain: 'schema',
		class: 'apply',
		summary: 'Set runtime policies on a collection.',
		params: 'slug, policies',
		available: true,
	},
	{
		id: 'schema.field.validate',
		domain: 'schema',
		class: 'read',
		summary: 'Dry-run a field list against the 41-type SSOT (`validate_fields` — the same validator apply uses).',
		params: 'collection?, fields',
		available: true,
	},

	// ── pages (Face) ────────────────────────────────────────
	{
		id: 'pages.manifest.apply',
		domain: 'pages',
		class: 'apply',
		summary: 'Upsert pages from a manifest entry.',
		params: 'pages[]',
		available: true,
	},
	{
		id: 'pages.patch',
		domain: 'pages',
		class: 'apply',
		summary: 'Apply structural patch ops to a stored page.',
		params: 'page_id, ops',
		available: true,
	},
	{
		id: 'pages.menu.create',
		domain: 'pages',
		class: 'apply',
		summary: 'Create a menu item under an existing module.',
		params: 'module, label, type?, target?',
		available: true,
	},
	{
		id: 'pages.components.registry',
		domain: 'pages',
		class: 'read',
		summary: 'The block vocabulary with defaults + nesting rules (`factory://blocks`) — how to configure a real UI block.',
		params: '—',
		available: true,
	},
	{
		id: 'pages.blocks.registry',
		domain: 'pages',
		class: 'read',
		summary: 'The block vocabulary (BLOCK_REGISTRY).',
		params: '',
		available: true,
	},

	// ── data ────────────────────────────────────────────────
	{
		id: 'data.query',
		domain: 'data',
		class: 'read',
		summary: 'Bounded multi-collection read.',
		params: 'requests[] = { collection, params }',
		available: true,
	},
	{
		id: 'data.item.create',
		domain: 'data',
		class: 'apply',
		summary: 'Create an item (via `mutate`).',
		params: 'collection, body',
		available: true,
	},
	{
		id: 'data.item.update',
		domain: 'data',
		class: 'apply',
		summary: 'Update an item (via `mutate`).',
		params: 'collection, id, body',
		available: true,
	},
	{
		id: 'data.item.delete',
		domain: 'data',
		class: 'apply',
		summary: 'Soft-delete an item (via `mutate`).',
		params: 'collection, id',
		available: true,
	},
	{
		id: 'data.import',
		domain: 'data',
		class: 'apply',
		summary: 'Bulk import records (via `mutate` op import).',
		params: 'collection, format, data',
		available: true,
	},

	// ── governance ──────────────────────────────────────────
	{
		id: 'governance.role.create',
		domain: 'governance',
		class: 'apply',
		summary: 'Create a role.',
		params: 'name, description',
		available: true,
	},
	{
		id: 'governance.permission.grant',
		domain: 'governance',
		class: 'apply',
		summary: 'Grant a role permission on a collection.',
		params: 'role, collection, flags',
		available: true,
	},
	{
		id: 'governance.apikey.create',
		domain: 'governance',
		class: 'apply',
		summary: 'Provision a scoped machine key (manifest `apiKeys`; plaintext returned once).',
		params: 'name, user_id, scope',
		available: true,
	},
	{
		id: 'governance.audit.read',
		domain: 'governance',
		class: 'read',
		summary: 'Read the audit trail.',
		params: 'collection, document_id?, limit?',
		available: true,
	},

	// ── automation ──────────────────────────────────────────
	{
		id: 'automation.workflow.define',
		domain: 'automation',
		class: 'apply',
		summary: 'Define a workflow.',
		params: 'collection, states, transitions',
		available: true,
	},
	{
		id: 'automation.serverFunction.define',
		domain: 'automation',
		class: 'apply',
		summary: 'Define a declarative server function (manifest `serverFunctions`).',
		params: 'name, collection, trigger_event, rules',
		available: true,
	},
	{
		id: 'automation.schedule.define',
		domain: 'automation',
		class: 'apply',
		summary:
			'Schedule a recurring job (manifest `schedules`). The work is a registered handler — see `list_handlers`; an unknown type is refused.',
		params: 'name, type, cron|repeat_ms, timezone?, payload?',
		available: true,
	},

	// ── analytics ───────────────────────────────────────────
	{
		id: 'analytics.report.define',
		domain: 'analytics',
		class: 'apply',
		summary:
			'Define a saved report (manifest `reports`) — a named on-demand export, materialized by the scheduled-reports route. Aggregates live on `analytics.kpi.define`.',
		params: 'name, collection, format',
		available: true,
	},
	{
		id: 'analytics.kpi.define',
		domain: 'analytics',
		class: 'apply',
		summary: 'Define a KPI.',
		params: 'name, collection, agg',
		available: true,
	},

	// ── ops ─────────────────────────────────────────────────
	{ id: 'ops.indexAdvisor.read', domain: 'ops', class: 'read', summary: 'Index-advisor telemetry.', params: '', available: true },
	{
		id: 'ops.integrity.run',
		domain: 'ops',
		class: 'read',
		summary: 'Run a collection’s integrity rules.',
		params: 'slug',
		available: true,
	},

	// ── generation ──────────────────────────────────────────
	{
		id: 'generation.schema.propose',
		domain: 'generation',
		class: 'plan',
		summary: 'Map a DesignDNA or prompt to a schema proposal.',
		params: 'collection, dna | prompt',
		available: true,
	},
	{
		id: 'generation.proposal.gate',
		domain: 'generation',
		class: 'apply',
		summary: 'Advance a proposal through the human gate.',
		params: 'proposal_id, action',
		available: true,
	},
];

/** Pure filter over the registry. Deterministic order (catalog order). */
export function searchCapabilities(query: CapabilityQuery = {}): CapabilityDescriptor[] {
	const q = query.q?.trim().toLowerCase();
	return CAPABILITIES.filter((c) => {
		if (query.domain && c.domain !== query.domain) return false;
		if (query.class && c.class !== query.class) return false;
		if (query.availableOnly && !c.available) return false;
		if (q && !`${c.id} ${c.summary}`.toLowerCase().includes(q)) return false;
		return true;
	});
}

export function getCapability(id: string): CapabilityDescriptor | null {
	return CAPABILITIES.find((c) => c.id === id) ?? null;
}
