/**
 * IDP Collections — entity definitions for the Internal Developer Platform.
 *
 * These are plain entity-engine collections (data, not code), provisioned via
 * the same `POST /api/collections` path the Studio schema designer uses, so DDL
 * + cache invalidation are handled server-side. They are the IDP's data plane:
 *
 *   idp_environment — a deploy target (dev / staging / prod)
 *   idp_deployment  — one release of a module to an environment
 *   idp_ownership   — who owns / maintains / views a module
 *
 * NOTE on relations: `module_id` references the SYSTEM table `_modules` (not an
 * entity collection), so it is stored as a plain `text` FK rather than an m2o
 * relation. `environment_id` is likewise `text` for symmetry — the catalog
 * service resolves both via SQL joins. This keeps Phase 1 free of relation-
 * resolution complexity; m2o can be introduced later if a real need appears.
 */

import type { FieldDefinition } from '@mmbix/types';

export interface IdpCollectionDef {
	name: string;
	slug: string;
	description: string;
	fields: FieldDefinition[];
}

export const IDP_COLLECTIONS: IdpCollectionDef[] = [
	{
		name: 'IDP Environments',
		slug: 'idp_environment',
		description: 'Deploy targets (dev / staging / prod) for Studio apps.',
		fields: [
			{ name: 'name', type: 'text', label: 'Name', required: true },
			{ name: 'slug', type: 'text', label: 'Slug', required: true },
			{
				name: 'kind',
				type: 'select',
				label: 'Kind',
				required: false,
				options: ['dev', 'staging', 'prod'],
			},
			{ name: 'url', type: 'text', label: 'URL', required: false },
			{ name: 'is_default', type: 'boolean', label: 'Default', required: false },
			// GitOps: the git ref (commit/tag) currently deployed to this environment.
			{ name: 'git_ref', type: 'text', label: 'Git Ref', required: false },
		],
	},
	{
		name: 'IDP Deployments',
		slug: 'idp_deployment',
		description: 'One release of a module to an environment.',
		fields: [
			{ name: 'module_id', type: 'text', label: 'Module', required: true },
			{ name: 'environment_id', type: 'text', label: 'Environment', required: true },
			{ name: 'version', type: 'text', label: 'Version', required: false },
			{
				name: 'status',
				type: 'select',
				label: 'Status',
				required: false,
				options: ['draft', 'review', 'promoted', 'live', 'rolled_back'],
			},
			{ name: 'deployed_at', type: 'datetime', label: 'Deployed At', required: false },
			{ name: 'deployed_by', type: 'text', label: 'Deployed By', required: false },
			// GitOps: the git ref (commit/tag) this deployment pins.
			{ name: 'git_ref', type: 'text', label: 'Git Ref', required: false },
			// Data lineage: the exact module manifest (collections + fields) captured
			// at promote-to-live time — the single version of the truth for a release.
			{ name: 'manifest_json', type: 'json', label: 'Manifest', required: false },
			// GitOps: the full schema snapshot (from git export) that this deployment
			// applies to the target environment — the source of truth for the migration.
			{ name: 'snapshot_json', type: 'json', label: 'Snapshot', required: false },
		],
	},
	{
		name: 'IDP Ownership',
		slug: 'idp_ownership',
		description: 'Who owns / maintains / views a module.',
		fields: [
			{ name: 'module_id', type: 'text', label: 'Module', required: true },
			{
				name: 'owner_type',
				type: 'select',
				label: 'Owner Type',
				required: false,
				options: ['user'],
			},
			{ name: 'owner_id', type: 'text', label: 'Owner', required: true },
			{
				name: 'role',
				type: 'select',
				label: 'Role',
				required: false,
				options: ['owner', 'maintainer', 'viewer'],
			},
		],
	},
	{
		name: 'IDP Template Usage',
		slug: 'idp_template_usage',
		description: 'Golden-path template adoption — which template produced which module (software-factory usage).',
		fields: [
			{ name: 'template_name', type: 'text', label: 'Template', required: true },
			{ name: 'module_id', type: 'text', label: 'Module', required: true },
			{ name: 'created_by_email', type: 'text', label: 'Created By', required: false },
		],
	},
	{
		name: 'IDP Audit',
		slug: 'idp_audit',
		description: 'Append-only trail of every IDP governance action (env/deployment/ownership/template).',
		// One row per action, written by `IdpService.recordAudit`. Deliberately a
		// plain collection (not a bespoke table) so it inherits soft-delete,
		// timestamps, the change envelope and the response cache for free — and so
		// a read can be gated by `canRead('idp_audit')` like any other collection.
		fields: [
			{ name: 'action', type: 'text', label: 'Action', required: true },
			{ name: 'entity', type: 'text', label: 'Entity', required: true },
			{ name: 'entity_id', type: 'text', label: 'Entity ID', required: false },
			{ name: 'actor_email', type: 'text', label: 'Actor', required: false },
			{ name: 'detail_json', type: 'json', label: 'Detail', required: false },
		],
	},
];
