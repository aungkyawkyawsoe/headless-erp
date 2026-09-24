/**
 * AI Routes — /api/ai
 *
 * Prompt → block JSON metadata generation for the Studio's AI panel.
 *
 * POST /api/ai/generate-page
 *   Body: { prompt, existing_blocks?: Array<...> }
 *   Response: { blocks, warnings? } — block tree validated against the registry
 *
 * The response is a DRAFT — the Studio renders it on the canvas and the user
 * edits/accepts. Nothing is persisted here; saving happens via POST /api/pages.
 */
import { Hono } from 'hono';
import { generateBlocks, validateAIBlocks } from '@/lib/services/ai.service';
import { requireAuth } from './auth';
import { success, fail } from '@/lib/api/response';

type Ctx = {
	Bindings: {
		DB: D1Database;
		AI?: {
			run(model: string, input: unknown): Promise<unknown>;
		};
		AI_PROVIDER?: string;
		AI_MODEL?: string;
		AI_API_URL?: string;
		AI_API_KEY?: string;
	};
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
};

const app = new Hono<Ctx>();
app.use('*', requireAuth);

app.post('/generate-page', async (c) => {
	try {
		const body = (await c.req.json().catch(() => null)) as { prompt?: string } | null;
		const prompt = String(body?.prompt ?? '').trim();
		if (!prompt) return fail(c, 'Prompt is required', 400);
		if (prompt.length > 4000) return fail(c, 'Prompt too long (max 4000 chars)', 400);

		const env = c.env as unknown as Parameters<typeof generateBlocks>[1];
		const result = await generateBlocks(prompt, env);
		return success(c, { blocks: result.blocks, warnings: result.warnings ?? [] });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'AI generation failed';
		if (/not configured/i.test(msg)) return fail(c, msg, 503);
		return fail(c, msg, 500);
	}
});

// POST /api/ai/validate — client-side safety net: validate any block tree (AI or manual)
app.post('/validate', async (c) => {
	try {
		const body = (await c.req.json().catch(() => null)) as { blocks?: Array<Record<string, unknown>> } | null;
		const blocks = Array.isArray(body?.blocks) ? body.blocks : [];
		const { valid, warnings } = validateAIBlocks(blocks);
		return success(c, { valid, warnings });
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Validation failed', 500);
	}
});

export { app as aiRoutes };
