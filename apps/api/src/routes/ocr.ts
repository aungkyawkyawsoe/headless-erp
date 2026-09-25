/**
 * OCR Routes — /api/ocr
 *
 * POST /api/ocr — accept an image and return the text extracted from it.
 *
 * HONEST BY CONSTRUCTION: this route adds NO new infrastructure and does NOT
 * pretend to read an image. Text OCR is only possible through the AI provider
 * seam (`apps/api/src/lib/services/ai.service.ts`), and that seam is TEXT-ONLY
 * today — every branch (`mock`, `workers-ai`, `openai`) builds a chat-completion
 * request from a text prompt and parses block JSON; none accepts an image. This
 * deployment also has no Workers AI (`AI`) binding, so a vision call would have
 * nowhere to go. Rather than return fabricated text (or a silent empty success),
 * the route answers 501 with a canonical `NOT_CONFIGURED` code and an
 * actionable message naming exactly what to configure.
 *
 * ⚠️ FOLLOW-UP (one line): add a vision branch to `ai.service.ts` (Workers AI
 * with a vision model via an `AI` binding, or an OpenAI-compatible vision
 * endpoint through the existing `AI_PROVIDER=openai` + `AI_API_URL`/`AI_API_KEY`
 * env), then call it here and return its text — no route change beyond that.
 *
 * Mounted at `/api/ocr` in `apps/api/src/index.ts` (sibling of `/api/ai`).
 */
import { Hono } from 'hono';
import { requireAuth } from './auth';
import { fail } from '@/lib/api/response';

type Ctx = {
	Bindings: {
		DB: D1Database;
		AI?: { run(model: string, input: unknown): Promise<unknown> };
		AI_PROVIDER?: string;
		AI_API_URL?: string;
		AI_API_KEY?: string;
	};
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
};

const app = new Hono<Ctx>();

// Every OCR request is a privileged action over a user-supplied image.
app.use('*', requireAuth);

/**
 * The seam has no vision path, so OCR is unavailable on this deployment. The
 * reason is spelled out (rather than a bare "not implemented") so a caller — and
 * the operator wiring it up — sees exactly which knob to turn.
 */
function ocrUnavailableReason(): string {
	return [
		'Text OCR is not configured for this deployment.',
		'The AI provider seam (apps/api/src/lib/services/ai.service.ts) is text-only — it has no vision/OCR branch — and no Workers AI vision model is bound.',
		'To enable it, bind Cloudflare Workers AI with a vision-capable model (and add a vision branch to ai.service.ts),',
		'or point AI_PROVIDER=openai at a vision-capable OpenAI-compatible endpoint (AI_API_URL + AI_API_KEY) and have the seam read the image there.',
	].join(' ');
}

// POST /api/ocr — { multipart file } → { text }
//
// Capability is checked FIRST, before the body is read: if OCR is unavailable we
// never parse the upload, so a large image is not transferred only to be thrown
// away. The caller still gets a specific, machine-readable failure.
app.post('/', async (c) => {
	// `requireAuth` already rejected anonymous callers with 401 UNAUTHORIZED.
	return fail(c, ocrUnavailableReason(), 501, 'NOT_CONFIGURED');
});

export { app as ocrRoutes };
