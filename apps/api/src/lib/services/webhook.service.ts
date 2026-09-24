/**
 * Webhook Service
 *
 * Triggers HTTP callbacks when documents are created, updated, or deleted.
 * Webhooks fire asynchronously (fire-and-forget) to not block API responses.
 *
 * Flow:
 *   Document create/update/delete → WebhookService.fire(col, event, data)
 *     → Filter matching webhooks → fetch(url) with HMAC signature → log
 *
 * Security:
 *   - SSRF Protection: blocks internal/metadata endpoints (localhost, 169.254.x.x)
 *   - HTTPS enforcement in production
 *   - HMAC-SHA256 payload signatures
 */

import { D1Client } from '@mmbix/core';
import { Repository } from '@mmbix/core';
import { cache } from '@mmbix/core';
import { ValidationError } from '@mmbix/utils';
import type { WebhookRecord } from '@mmbix/types';
import type { WebhookQueueMessage } from '@/queue/webhook-queue';

export type WebhookEvent = 'create' | 'update' | 'delete' | 'submit' | 'approve';

// ─── SSRF Protection ────────────────────────────────────

/** Internal/private hosts blocked from webhook targets (compared lowercase, trailing dot stripped) */
const SSRF_BLOCKLIST = new Set([
	'localhost',
	'127.0.0.1',
	'0.0.0.0',
	'::1',
	'::',
	'169.254.169.254', // Cloudflare/AWS/GCP metadata endpoint
	'metadata.google.internal',
]);

/** Always-blocked IP ranges (loopback, unspecified, metadata, IPv6 link-local). */
function isAlwaysBlockedIp(ip: { type: 'v4'; value: number } | { type: 'v6'; text: string }): boolean {
	if (ip.type === 'v6') {
		const t = ip.text.toLowerCase();
		if (t === '::1' || t === '::') return true;
		// IPv6 link-local fe80::/10 → first hextet 0xfe80–0xfebf
		return /^fe[89ab][0-9a-f]/i.test(t);
	}
	const v = ip.value;
	if (v === 0) return true; // 0.0.0.0
	if (v >= 0x7f000000 && v <= 0x7fffffff) return true; // 127.0.0.0/8 loopback
	if (v >= 0xa9fe0000 && v <= 0xa9feffff) return true; // 169.254.0.0/16 link-local / metadata
	return false;
}

/** RFC1918 private ranges + IPv6 ULA (fc00::/7) — blocked in production only. */
function isPrivateIp(ip: { type: 'v4'; value: number } | { type: 'v6'; text: string }): boolean {
	if (ip.type === 'v6') {
		// Unique local address fc00::/7 → first hextet starts with fc or fd
		const t = ip.text.toLowerCase();
		return t.startsWith('fc') || t.startsWith('fd');
	}
	const v = ip.value;
	if (v >= 0x0a000000 && v <= 0x0affffff) return true; // 10.0.0.0/8
	if (v >= 0xac100000 && v <= 0xac1fffff) return true; // 172.16.0.0/12
	if (v >= 0xc0a80000 && v <= 0xc0a8ffff) return true; // 192.168.0.0/16
	return false;
}

/**
 * Parse a host into an IP literal, defeating textual evasions:
 *   - dotted decimal / hex / octal parts (127.0.0.1, 0x7f000001, 0177.0.0.1)
 *   - bare integer form (2130706433)
 *   - IPv4-mapped IPv6 (::ffff:127.0.0.1)
 * Returns null when the host is a hostname (not an IP literal).
 */
function parseIpLiteral(host: string): { type: 'v4'; value: number } | { type: 'v6'; text: string } | null {
	const h = host.toLowerCase();

	// IPv4-mapped IPv6: ::ffff:a.b.c.d
	const mapped = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
	if (mapped) {
		const v4 = parseIPv4(mapped[1]);
		if (v4 !== null) return { type: 'v4', value: v4 };
	}

	if (h.includes(':')) return { type: 'v6', text: h };

	const v4 = parseIPv4(h);
	if (v4 !== null) return { type: 'v4', value: v4 };
	return null;
}

/** Parse dotted (decimal/hex/octal parts) or bare-integer IPv4 → 32-bit int, or null. */
function parseIPv4(s: string): number | null {
	if (!s || s.length === 0 || s.length > 64) return null;
	const parts = s.split('.');
	if (parts.length > 4) return null;
	const octets: number[] = [];
	for (const p of parts) {
		if (!p) return null;
		let v: number | null = null;
		if (/^0x[0-9a-f]+$/i.test(p)) v = parseInt(p, 16);
		else if (/^0[0-7]+$/.test(p)) v = parseInt(p, 8);
		else if (/^\d+$/.test(p)) v = parseInt(p, 10);
		if (v === null || !Number.isFinite(v) || v < 0) return null;
		if (parts.length > 1 && v > 255) return null; // dotted parts must be bytes
		octets.push(v);
	}
	if (parts.length === 1) {
		// Bare integer form (decimal/hex/octal) — the whole value is the address
		return octets[0] > 0xffffffff ? null : octets[0];
	}
	while (octets.length < 4) octets.push(0); // legacy short forms: 127.1 → 127.0.0.1
	return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

/**
 * Validate a webhook URL against SSRF attacks.
 * - Blocks internal hosts (localhost, 0.0.0.0, metadata endpoint)
 * - Rejects loopback/unspecified/link-local IP literals in any encoding
 *   (decimal, hex, octal, bare-integer, IPv4-mapped IPv6) — always
 * - Blocks RFC1918 private ranges + IPv6 ULA in production
 * - Requires HTTPS in production
 */
export function validateWebhookUrl(raw: string, isDev = false): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new ValidationError('Invalid webhook URL format');
	}

	// Only allow http/https protocols
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new ValidationError('Webhook URL must use https:// protocol');
	}

	// Production: HTTPS only
	if (!isDev && url.protocol !== 'https:') {
		throw new ValidationError('Webhook URLs must use HTTPS in production');
	}

	// Normalize: lowercase + strip trailing dot (DNS root) so `LOCALHOST.` cannot evade
	let host = url.hostname.toLowerCase().replace(/\.$/, '');
	// Strip brackets from IPv6 literals: [::1] → ::1
	if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);

	if (SSRF_BLOCKLIST.has(host)) {
		throw new ValidationError(`Webhook URL host "${host}" is not allowed`);
	}

	const ip = parseIpLiteral(host);
	if (ip) {
		// Loopback/metadata/link-local/unspecified — always blocked, any encoding
		if (isAlwaysBlockedIp(ip)) {
			throw new ValidationError(`Webhook URL host "${host}" is not allowed`);
		}
		// Private ranges — blocked in production (dev may need local services)
		if (!isDev && isPrivateIp(ip)) {
			throw new ValidationError(`Webhook URL must use a public hostname (private IP "${host}" blocked)`);
		}
	}

	return url.toString();
}

export class WebhookService {
	private webhooks: Repository<WebhookRecord>;
	private db: D1Client;

	constructor(db: D1Client) {
		this.db = db;
		this.webhooks = new Repository<WebhookRecord>(db, '_webhooks');
	}

	// ── Webhook CRUD ──────────────────────────────────

	async create(input: {
		name: string;
		url: string;
		collection_slug: string;
		events: WebhookEvent[];
		secret?: string;
	}): Promise<WebhookRecord> {
		const record = await this.webhooks.create({
			name: input.name,
			url: input.url,
			collection_slug: input.collection_slug,
			events: JSON.stringify(input.events),
			secret: input.secret || null,
			enabled: true,
		} as Partial<WebhookRecord>);
		this._invalidateCache();
		return record; // create echoes the full record (incl. secret) exactly once
	}

	async list(): Promise<WebhookRecord[]> {
		const rows = await this.webhooks.findAll({ orderBy: { created_at: 'desc' } });
		return rows.map((r) => WebhookService._withoutSecret(r));
	}

	async getById(id: string): Promise<WebhookRecord | null> {
		try {
			const row = await this.webhooks.findById(id);
			return row ? WebhookService._withoutSecret(row) : null;
		} catch {
			return null;
		}
	}

	async update(id: string, input: Partial<Pick<WebhookRecord, 'url' | 'events' | 'secret' | 'enabled'>>): Promise<WebhookRecord> {
		// Normalize events array → JSON string (same as create)
		const normalized = { ...input } as Record<string, unknown>;
		if (Array.isArray(input.events)) normalized.events = JSON.stringify(input.events);
		const record = await this.webhooks.update(id, normalized as Partial<WebhookRecord>);
		this._invalidateCache();
		return WebhookService._withoutSecret(record); // secret only ever echoes on create
	}

	/**
	 * 🔒 Strip the HMAC signing secret from outgoing records. The secret must
	 * never be returned by list/get/update — it is only echoed once on create.
	 */
	private static _withoutSecret(record: WebhookRecord): WebhookRecord {
		const { secret: _secret, ...safe } = record;
		return safe as WebhookRecord;
	}

	async delete(id: string): Promise<void> {
		await this.webhooks.delete(id);
		this._invalidateCache();
	}

	// ── Webhook Firing ────────────────────────────────

	/**
	 * Fire webhooks for a document event.
	 * Non-blocking — runs in background via waitUntil().
	 *
	 * @param ctx - The Hono execution context (for waitUntil)
	 * @param collection_slug - The collection that triggered the event
	 * @param event - The type of event
	 * @param data - The document data (will be sent as JSON body)
	 */
	async fire(
		ctx: {
			executionCtx?: { waitUntil: (p: Promise<unknown>) => void };
			env?: { WEBHOOK_QUEUE?: { send: (m: unknown) => Promise<void> } };
		},
		collection_slug: string,
		event: WebhookEvent,
		data: Record<string, unknown>,
	): Promise<void> {
		// Find all enabled webhooks for this collection + event.
		// Cached per collection (60s TTL) so writes don't pay a _webhooks read
		// on every create/update/delete; CRUD operations invalidate the cache.
		const cacheKey = `webhooks:${collection_slug}`;
		let all = cache.get<WebhookRecord[]>(cacheKey);
		if (all === undefined) {
			all = await this.webhooks.findAll({
				where: { collection_slug, enabled: true },
			});
			cache.set(cacheKey, all);
		}

		const matching = all.filter((w) => {
			try {
				const events = JSON.parse(w.events) as WebhookEvent[];
				return events.includes(event);
			} catch {
				return false;
			}
		});

		if (matching.length === 0) return;

		const queue = ctx?.env?.WEBHOOK_QUEUE;

		// Fire all webhooks in parallel
		const promises = matching.map(async (webhook) => {
			try {
				let delivered: boolean;

				if (queue) {
					// Queue binding present — enqueue for async delivery instead of fetching directly
					const message: WebhookQueueMessage = {
						webhookId: webhook.id,
						url: webhook.url,
						secret: webhook.secret,
						event,
						collection: collection_slug,
						data,
						attempt: 1,
					};
					await queue.send(message);
					delivered = true; // Enqueued — actual delivery happens in the queue consumer
				} else {
					// No queue binding — direct fire with retries
					delivered = await this._deliver(webhook, event, collection_slug, data);
				}

				// Update last_triggered on success
				if (delivered) {
					await this.webhooks.update(webhook.id, {
						last_triggered: new Date().toISOString(),
					} as Partial<WebhookRecord>);
					console.log(`[webhook] ${webhook.name}: fired successfully`);
				} else {
					console.error(`[webhook] ${webhook.name}: failed after all attempts`);
				}
			} catch (err) {
				console.error(`[webhook] ${webhook.name}: failed — ${err instanceof Error ? err.message : String(err)}`);
			}
		});

		// Use waitUntil if available (Cloudflare Workers pattern)
		if (ctx?.executionCtx?.waitUntil) {
			ctx.executionCtx.waitUntil(Promise.allSettled(promises));
		} else {
			// Fire-and-forget (don't block response)
			Promise.allSettled(promises).catch((err) => console.error('[webhook] fire-and-forget failed:', err));
		}
	}

	// ── Cache Management ───────────────────────────────

	/** Invalidate cached webhook lookups (webhook CRUD is rare — pattern-wide is cheap). */
	private _invalidateCache(): void {
		cache.invalidatePattern('webhooks:*');
	}

	// ── Delivery ────────────────────────────────────────

	/**
	 * Deliver a webhook with retries and exponential backoff.
	 *
	 * Builds HMAC-signed headers (when a secret is set) and POSTs
	 * `{ event, collection, data }` to the webhook URL. Retries up to
	 * `attempts` total tries (default 3; no `retries` column exists on
	 * `_webhooks`), waiting `1000ms * 2^attempt` (±300ms jitter) between
	 * attempts. Returns true if any attempt succeeded.
	 */
	private async _deliver(
		webhook: WebhookRecord,
		event: WebhookEvent,
		collection_slug: string,
		data: Record<string, unknown>,
		attempts = 3,
	): Promise<boolean> {
		const payload = JSON.stringify({ event, collection: collection_slug, data });
		const deliveryId = crypto.randomUUID();

		for (let attempt = 1; attempt <= attempts; attempt++) {
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				'X-Webhook-Event': event,
				'X-Webhook-Collection': collection_slug,
				'X-Webhook-Delivery-Id': deliveryId,
			};

			if (webhook.secret) {
				// Add HMAC signature for verification
				headers['X-Webhook-Signature'] = await this._sign(webhook.secret, payload);
			}

			try {
				// `redirect: 'error'` — a webhook endpoint that redirects must never
				// be followed: the redirect target is NOT the URL validated at
				// creation time (SSRF re-entry after validation).
				const response = await fetch(webhook.url, {
					method: 'POST',
					headers,
					body: payload,
					redirect: 'error',
				});

				if (response.ok) return true;
				console.warn(`[webhook] ${webhook.name}: attempt ${attempt} failed — ${response.status} ${response.statusText}`);
			} catch (err) {
				console.warn(`[webhook] ${webhook.name}: attempt ${attempt} failed — ${err instanceof Error ? err.message : String(err)}`);
			}

			if (attempt < attempts) {
				// Exponential backoff: 1000ms * 2^attempt with ±300ms jitter
				const delay = 1000 * Math.pow(2, attempt) + (Math.random() * 600 - 300);
				await new Promise((r) => setTimeout(r, Math.max(0, delay)));
			}
		}

		return false;
	}

	private async _sign(secret: string, payload: string): Promise<string> {
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
		const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
		return Array.from(new Uint8Array(signature))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}
}
