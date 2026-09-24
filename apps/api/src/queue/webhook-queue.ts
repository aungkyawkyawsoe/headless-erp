/**
 * Webhook Queue Delivery
 *
 * Delivers webhook messages via Cloudflare Queues, decoupled from the request
 * lifecycle. Each message carries the full delivery context (URL, secret,
 * event, payload) so the consumer needs no database access.
 *
 * Delivery semantics:
 *   - Each queue delivery runs up to `MAX_ATTEMPTS` HTTP attempts with
 *     exponential backoff (mirrors WebhookService._deliver).
 *   - The queue consumer may re-queue a failed message up to `MAX_ATTEMPTS`
 *     total queue deliveries (tracked via `msg.attempts` or the message body).
 */

import { validateWebhookUrl } from '@/lib/services/webhook.service';

export interface WebhookQueueMessage {
	webhookId: string;
	url: string;
	secret: string | null;
	event: string;
	collection: string;
	data: Record<string, unknown>;
	/** Queue delivery attempt, starts at 1 (max MAX_ATTEMPTS) */
	attempt: number;
}

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;

/** HMAC-SHA256 signature (hex) — same scheme as WebhookService._sign */
async function sign(secret: string, payload: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
	return Array.from(new Uint8Array(signature))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Deliver a webhook message with up to MAX_ATTEMPTS HTTP attempts and
 * exponential backoff (1000ms * 2^attempt, ±300ms jitter) between attempts.
 * `isDev` relaxes the private-range/HTTPS rules exactly like creation-time
 * validation (routes/webhooks.ts) so dev-local webhooks keep working.
 */
async function deliver(message: WebhookQueueMessage, _isDev = false): Promise<boolean> {
	const payload = JSON.stringify({ event: message.event, collection: message.collection, data: message.data });
	const deliveryId = crypto.randomUUID();

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'X-Webhook-Event': message.event,
			'X-Webhook-Collection': message.collection,
			'X-Webhook-Delivery-Id': deliveryId,
		};
		if (message.secret) {
			headers['X-Webhook-Signature'] = await sign(message.secret, payload);
		}

		try {
			// 10s cap per attempt — a hanging endpoint must never stall the queue
			// consumer (AbortSignal.timeout aborts the fetch, surfacing as a catch
			// below and triggering the normal retry/backoff path).
			// `redirect: 'error'` — never follow redirects (the target was not
			// validated; see WebhookService._deliver).
			const response = await fetch(message.url, {
				method: 'POST',
				headers,
				body: payload,
				signal: AbortSignal.timeout(10_000),
				redirect: 'error',
			});
			if (response.ok) return true;
			console.warn(`[webhook] ${message.webhookId}: attempt ${attempt} failed — ${response.status} ${response.statusText}`);
		} catch (err) {
			console.warn(`[webhook] ${message.webhookId}: attempt ${attempt} failed — ${err instanceof Error ? err.message : String(err)}`);
		}

		if (attempt < MAX_ATTEMPTS) {
			const delay = BASE_DELAY_MS * Math.pow(2, attempt) + (Math.random() * 600 - 300);
			await new Promise((r) => setTimeout(r, Math.max(0, delay)));
		}
	}

	return false;
}

/**
 * Process a single webhook queue message.
 *
 * @returns `{ delivered: true, retry: false }` on success, or
 *          `{ delivered: false, retry: <queue-level retry still possible?> }`
 *          after all internal attempts fail. `retry` is false once the
 *          message's `attempt` counter reaches MAX_ATTEMPTS (final failure).
 */
async function processWebhookMessage(message: WebhookQueueMessage, isDev = false): Promise<{ delivered: boolean; retry: boolean }> {
	// Delivery-time SSRF validation — the stored URL may predate creation-time
	// validation or have been tampered with. A URL that fails hostname validation
	// is a permanent config error: fail immediately, never retry.
	try {
		validateWebhookUrl(message.url, isDev);
	} catch (err) {
		console.error(`[webhook] ${message.webhookId}: delivery URL rejected — ${err instanceof Error ? err.message : String(err)}`);
		return { delivered: false, retry: false };
	}
	const delivered = await deliver(message, isDev);
	if (delivered) {
		console.info(`[webhook] ${message.webhookId}: delivered via queue`);
		return { delivered: true, retry: false };
	}

	if (message.attempt >= MAX_ATTEMPTS) {
		console.error(`[webhook] ${message.webhookId}: final failure — giving up after ${message.attempt} queue attempts`);
		return { delivered: false, retry: false };
	}

	console.warn(`[webhook] ${message.webhookId}: delivery failed (queue attempt ${message.attempt}) — will retry`);
	return { delivered: false, retry: true };
}

/**
 * Cloudflare Queues `queue` batch handler.
 *
 * Usage (wired in index.ts):
 *   export default { async queue(batch, env, ctx) { await webhookQueueConsumer(env, batch); } }
 *
 * For each message: deliver via processWebhookMessage; `ack()` on success.
 * On failure, re-queue (`retry()`) up to MAX_ATTEMPTS total deliveries —
 * using `msg.attempts` from the batch API when available, otherwise the
 * message body `attempt` counter — then `ack()` and log a final failure.
 */
export async function webhookQueueConsumer(_env: Record<string, unknown>, batch: MessageBatch<WebhookQueueMessage>): Promise<void> {
	const isDev = (_env.IS_DEV as string) === 'true';
	for (const msg of batch?.messages ?? []) {
		try {
			const result = await processWebhookMessage(msg.body, isDev);

			if (result.delivered) {
				msg.ack();
				continue;
			}

			// Queue-level retry budget: up to MAX_ATTEMPTS total deliveries.
			const attemptsUsed = typeof msg.attempts === 'number' ? msg.attempts : (msg.body.attempt ?? 1);
			if (attemptsUsed < MAX_ATTEMPTS) {
				msg.body.attempt = attemptsUsed + 1;
				msg.retry();
			} else {
				msg.ack();
				console.error(`[webhook] ${msg.body.webhookId}: final failure after ${attemptsUsed} attempts — giving up`);
			}
		} catch (err) {
			console.error(`[webhook] queue processing error: ${err instanceof Error ? err.message : String(err)}`);
			const attemptsUsed = typeof msg.attempts === 'number' ? msg.attempts : (msg.body?.attempt ?? 1);
			if (attemptsUsed < MAX_ATTEMPTS) {
				msg.body.attempt = attemptsUsed + 1;
				msg.retry();
			} else {
				msg.ack();
			}
		}
	}
}
