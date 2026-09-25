/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * POST /api/ocr — the honest OCR contract.
 *
 * The feature is deliberately NOT faked: this deployment has no vision path
 * (the AI provider seam is text-only and no Workers AI binding is present), so
 * the route must (a) never run without auth, and (b) answer a configured
 * caller with a machine-readable `NOT_CONFIGURED` failure — NEVER a 200 with
 * invented text and never a silent empty success. These two facts are the
 * whole point: an integration can trust that a 200 means real text.
 *
 * The test env (wrangler.testco.jsonc) runs IS_DEV=true, so `dev-token` is a
 * full admin on a local Host.
 */

const BASE_URL = 'http://localhost';
const AUTH = { Authorization: 'Bearer dev-token' };

interface Envelope {
	success: boolean;
	error?: string;
	code?: string;
	data?: { text?: string };
}

/** A minimal, well-formed image upload — the route never parses it, but send a real one anyway. */
function imageForm(): FormData {
	const form = new FormData();
	form.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'scan.png', { type: 'image/png' }));
	return form;
}

describe('POST /api/ocr', () => {
	it('requires authentication', async () => {
		const res = await SELF.fetch(`${BASE_URL}/api/ocr`, { method: 'POST', body: imageForm() });
		expect(res.status).toBe(401);
		const body = (await res.json()) as Envelope;
		expect(body.success).toBe(false);
		expect(body.code).toBe('UNAUTHORIZED');
	});

	it('returns an honest NOT_CONFIGURED failure — never a 200 with fabricated text', async () => {
		const res = await SELF.fetch(`${BASE_URL}/api/ocr`, { method: 'POST', headers: AUTH, body: imageForm() });
		expect(res.status).toBe(501);
		const body = (await res.json()) as Envelope;
		expect(body.success).toBe(false);
		expect(body.code).toBe('NOT_CONFIGURED');
		expect(body.error).toMatch(/not configured/i);
		// The message is ACTIONABLE — it names what to configure, not just "failed".
		expect(body.error).toMatch(/vision/i);
		expect(body.error).toMatch(/ai\.service\.ts/i);
		// And critically: no `data.text` was invented.
		expect(body.data).toBeUndefined();
	});
});
