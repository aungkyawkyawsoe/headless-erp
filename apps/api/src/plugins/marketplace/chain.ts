/**
 * Plugin Chain — the runtime interceptor pipeline.
 *
 * `runForEvent(collection, event, doc, db, auth)` threads a document through
 * every active marketplace plugin that declared the event, in install order —
 * the Odoo/SAP "interceptor chain". Each plugin may return a new document; the
 * final document is what the entity pipeline persists.
 *
 * Execution homes:
 *   native   → in-process handler (native-handlers.ts)
 *   binding  → separate worker via service binding env.<binding_name>
 *
 * The env is captured per-request by index.ts (setChainEnv) so the chain can
 * reach service bindings without plumbing env everywhere.
 */

import { D1Client } from '@mmbix/core';
import { ValidationError } from '@mmbix/utils';
import type { AuthContext } from '@/lib/services/auth.service';
import { MarketplaceRegistry, type MarketplacePluginRow } from './registry';
import { getNativeHandler } from './native-handlers';

// ─── Env holder (wired once per request in index.ts) ────
let currentEnv: Record<string, unknown> = {};
export function setChainEnv(env: Record<string, unknown>): void {
	currentEnv = env;
}

// ─── Per-event resolution cache (30s TTL; invalidated on registry writes) ──
interface CacheEntry {
	at: number;
	rows: MarketplacePluginRow[];
}
const CACHE_TTL_MS = 30_000;
const eventCache = new Map<string, CacheEntry>();

/** Called by marketplace routes after any install/update/toggle. */
export function invalidateChainCache(): void {
	eventCache.clear();
}

export interface ChainInput {
	collection: string;
	event: string;
	doc: Record<string, unknown>;
	workflow?: Record<string, unknown>;
}

/**
 * Thread the doc through all active plugins for (collection, event).
 *
 * Failure policy is per-plugin (`manifest.on_error`):
 *   'skip'  (default) — log the error and continue; a broken plugin never blocks a write
 *   'abort'           — throw a ValidationError that propagates to the caller, so the
 *                       operation is rejected (fail-closed for critical business rules)
 *
 * Binding calls are bounded by `manifest.fetch_timeout_ms` (default 5s) with a real
 * AbortController — the fetch is cancelled, not just timed out.
 */
export async function runForEvent(
	collection: string,
	event: string,
	doc: Record<string, unknown>,
	db: D1Client,
	auth?: AuthContext | null,
): Promise<Record<string, unknown>> {
	const plugins = await resolvePlugins(collection, event, db);
	let current = doc;
	for (const plugin of plugins) {
		try {
			current = await runPlugin(plugin, { collection, event, doc: current }, db, auth);
		} catch (err) {
			if (err instanceof ValidationError) throw err; // on_error: 'abort' — fail-closed
			const onError = plugin.manifest.on_error ?? 'skip';
			if (onError === 'abort') {
				throw new ValidationError(
					`Plugin "${plugin.name}" failed on ${collection}.${event}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
			console.error(`[marketplace] plugin "${plugin.id}" failed on ${collection}.${event}:`, err instanceof Error ? err.message : err);
		}
	}
	return current;
}

/** Run a single marketplace plugin by id (used by workflow trigger_plugins). */
export async function runPluginById(pluginId: string, input: ChainInput): Promise<Record<string, unknown>> {
	const db = new D1Client((currentEnv as { DB?: D1Database }).DB as D1Database);
	const plugin = await new MarketplaceRegistry(db).get(pluginId);
	if (!plugin) throw new Error(`Marketplace plugin "${pluginId}" not found`);
	if (plugin.enabled !== 1) return input.doc;
	return runPlugin(plugin, input, db, null);
}

async function resolvePlugins(collection: string, event: string, db: D1Client): Promise<MarketplacePluginRow[]> {
	const key = `${collection}.${event}`;
	const cached = eventCache.get(key);
	if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;
	const rows = await new MarketplaceRegistry(db).getActivePluginsForEvent(collection, event);
	eventCache.set(key, { at: Date.now(), rows });
	return rows;
}

async function runPlugin(
	plugin: MarketplacePluginRow,
	input: ChainInput,
	db: D1Client,
	auth?: AuthContext | null,
): Promise<Record<string, unknown>> {
	switch (plugin.execution_mode) {
		case 'native': {
			const handler = getNativeHandler(plugin.id);
			if (!handler) {
				console.error(`[marketplace] native handler not registered for "${plugin.id}"`);
				return input.doc;
			}
			const next = await handler(input.doc, {
				collection: input.collection,
				event: input.event,
				db,
				auth,
				plugin: { id: plugin.id, version: plugin.version },
			});
			return next ?? input.doc;
		}
		case 'binding': {
			const bindingName = plugin.manifest.binding_name || plugin.id.toUpperCase().replace(/-/g, '_');
			const target = (currentEnv as Record<string, unknown>)[bindingName] as { fetch?: (req: Request) => Promise<Response> } | undefined;
			if (!target?.fetch) {
				console.error(`[marketplace] service binding "${bindingName}" not configured for "${plugin.id}"`);
				return input.doc;
			}
			// Real cancellation: AbortController bounds the remote call (default 5s,
			// per-plugin override via manifest.fetch_timeout_ms). Timeouts fail the
			// call instead of letting a stuck plugin burn CPU in the background.
			const timeoutMs = Number(plugin.manifest.fetch_timeout_ms ?? 5_000);
			const res = await target.fetch(
				new Request('https://internal/run', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(input),
					signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5_000),
				}),
			);
			if (!res.ok) {
				throw new Error(`binding worker responded ${res.status}`);
			}
			const json = (await res.json().catch(() => ({}))) as { doc?: Record<string, unknown> };
			return json.doc ?? input.doc;
		}
		default: {
			// Unknown mode (e.g. a legacy 'sandbox' row) — never block the pipeline.
			console.warn(`[marketplace] plugin "${plugin.id}" has unsupported execution_mode "${plugin.execution_mode}" — skipped`);
			return input.doc;
		}
	}
}
