/**
 * Generation Plugin — governed design→schema proposals (OFF by default).
 *
 * Routes (all auth + admin; plugin itself is gated by `PLUGINS`):
 *   GET    /api/generation                       list proposals
 *   GET    /api/generation/:id                   one proposal
 *   POST   /api/generation/propose               { collection?, dna } → draft proposal
 *   POST   /api/generation/:id/submit            draft   → review
 *   POST   /api/generation/:id/approve           review  → promoted
 *   POST   /api/generation/:id/reject            draft|review → rejected
 *   POST   /api/generation/:id/apply             promoted → live (creates the collection)
 *   POST   /api/generation/patch                 { tree, ops } → new tree (NO write)
 *
 * The pipeline only PROPOSES; the human gate writes. `apply` is the single
 * write path and it reuses the admin-gated, cache-invalidating SchemaService.
 *
 * Bundle impact: ~6KB.
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono, type Context } from 'hono';
import { D1Client, resolvePolicy } from '@mmbix/core';
import { applyOps, type BlockNode, type PatchOp } from '@mmbix/types';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';
import { CollectionService } from '@/lib/services/collection.service';
import type { AuthContext } from '@/lib/services/auth.service';
import { normalizeDesignDNA } from './design-dna';
import { promptToDesignDNA } from './prompt-dna';
import { buildProposal } from './proposal';
import { GenerationError, GenerationService, GENERATION_CORRECTIONS_DDL, GENERATION_PROPOSALS_DDL } from './service';

const PROMPT_MAX = 4_000;
const DEFAULT_MAX_FIELDS = 40;

function svc(c: Context): GenerationService {
	const db = new D1Client((c.env as { DB: D1Database }).DB);
	const auth = c.get('auth') as AuthContext | undefined;
	return new GenerationService(db, () => auth ?? null);
}

/** The effective generation settings for a target collection (or the defaults). */
async function resolveGenerationSettings(
	c: Context,
	slug: string | undefined,
): Promise<{ requireReview: boolean; maxFields: number; provider: string }> {
	if (!slug) return { requireReview: true, maxFields: DEFAULT_MAX_FIELDS, provider: 'none' };
	try {
		const db = new D1Client((c.env as { DB: D1Database }).DB);
		const auth = c.get('auth') as AuthContext | undefined;
		const info = await new CollectionService(db, auth).getCollection(slug);
		const policy = resolvePolicy(info.policies);
		return {
			requireReview: policy.generation.requireReview,
			maxFields: policy.generation.maxFieldsPerProposal,
			provider: policy.designSource.provider,
		};
	} catch {
		return { requireReview: true, maxFields: DEFAULT_MAX_FIELDS, provider: 'none' };
	}
}

export function generationPlugin(): Plugin {
	return {
		id: 'generation',
		name: 'Governed design→schema generation (propose → review → live)',
		version: '1.0.0',
		migrations: [
			{ name: '038_generation_proposals', up: GENERATION_PROPOSALS_DDL.map((sql) => ({ sql, bindings: [] })) },
			{ name: '039_generation_corrections', up: GENERATION_CORRECTIONS_DDL.map((sql) => ({ sql, bindings: [] })) },
		],
		register(_ctx: PluginContext): PluginRegistration {
			const app = new Hono<{ Bindings: { DB: D1Database }; Variables: { auth: AuthContext } }>();
			app.use('*', requireAuth, requireAdmin);

			const wrap = (c: Context, fn: () => Promise<Response>) =>
				fn().catch((err: unknown) => {
					if (err instanceof GenerationError) return fail(c, err.message, err.status, err.code);
					return fail(c, err instanceof Error ? err.message : 'Generation failed', 500);
				});

			app.get('/', (c) =>
				wrap(c, async () => {
					const limit = Number(c.req.query('limit') ?? '') || 50;
					return success(c, await svc(c).list(limit));
				}),
			);

			app.get('/:id', (c) =>
				wrap(c, async () => {
					const row = await svc(c).get(c.req.param('id'));
					return row ? success(c, row) : fail(c, 'Proposal not found', 404);
				}),
			);

			// Propose — maps DNA → a DRAFT proposal. Never writes a schema.
			app.post('/propose', (c) =>
				wrap(c, async () => {
					const body = (await c.req.json().catch(() => null)) as {
						collection?: { name?: string; slug?: string };
						dna?: unknown;
						prompt?: string;
					} | null;
					if (!body) return fail(c, 'A JSON body is required', 400);
					if (body.prompt && body.prompt.length > PROMPT_MAX) {
						return fail(c, `Prompt too long (max ${PROMPT_MAX} chars)`, 400);
					}
					// A prompt is normalized deterministically (no LLM by default); an
					// explicit DNA is preferred when both are present.
					const parsed =
						body.dna !== undefined ? normalizeDesignDNA(body.dna) : body.prompt ? normalizeDesignDNA(promptToDesignDNA(body.prompt)) : null;
					if (!parsed || !parsed.dna) return fail(c, parsed?.warnings[0]?.message ?? 'Provide a dna or a prompt', 400);
					const { dna, warnings: dnaWarnings } = parsed;

					const settings = await resolveGenerationSettings(c, body.collection?.slug);
					// An explicit provider restriction on the target collection wins.
					if (settings.provider !== 'none' && settings.provider !== 'manual' && dna.source.provider !== settings.provider) {
						return fail(
							c,
							`Design source "${dna.source.provider}" is not allowed (expected "${settings.provider}")`,
							403,
							'SOURCE_NOT_ALLOWED',
						);
					}

					const proposal = buildProposal({ collection: body.collection, dna }, { maxFields: settings.maxFields });
					proposal.warnings.unshift(...dnaWarnings);
					const auth = c.get('auth') as AuthContext | undefined;
					const record = await svc(c).create(proposal, { requireReview: settings.requireReview, actor: auth?.user_id ?? null });
					return success(c, record, 201);
				}),
			);

			for (const action of ['submit', 'approve', 'reject', 'apply'] as const) {
				app.post(`/:id/${action}`, (c) => wrap(c, async () => success(c, await svc(c).transition(c.req.param('id'), action))));
			}

			// Review edits — change a proposed field's type; the change is LEARNED.
			app.patch('/:id/fields', (c) =>
				wrap(c, async () => {
					const body = (await c.req.json().catch(() => null)) as { fields?: unknown } | null;
					const raw = Array.isArray(body?.fields) ? body.fields : [];
					const overrides = raw
						.filter((f): f is { name: string; type: string; required?: boolean } => {
							const o = f as { name?: unknown; type?: unknown };
							return typeof o?.name === 'string' && typeof o?.type === 'string';
						})
						.slice(0, 200);
					if (overrides.length === 0) return fail(c, 'fields must be a non-empty array of { name, type }', 400);
					return success(c, await svc(c).updateFields(c.req.param('id'), overrides));
				}),
			);

			// apply_patch (dry-run) — a pure tree edit; validates types, writes nothing.
			app.post('/patch', (c) =>
				wrap(c, async () => {
					const body = (await c.req.json().catch(() => null)) as { tree?: unknown; ops?: unknown } | null;
					const tree = Array.isArray(body?.tree) ? (body.tree as BlockNode[]) : [];
					const ops = Array.isArray(body?.ops) ? (body.ops as PatchOp[]) : [];
					if (ops.length > 500) return fail(c, 'Too many ops (max 500)', 400);
					return success(c, { tree: applyOps(tree, ops) });
				}),
			);

			return { routes: [{ path: '/api/generation', handler: app as unknown as Hono }] };
		},
	};
}
