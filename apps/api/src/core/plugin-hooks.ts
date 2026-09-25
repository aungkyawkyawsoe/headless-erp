/**
 * Plugin Hook Registry
 *
 * Singleton registry that collects lifecycle hooks registered by compiled
 * TypeScript plugins, and dispatches them from the entity pipeline.
 *
 * Features:
 *   - Priority ordering (lower number = first, default 50)
 *   - Per-hook timeout (default 5000ms)
 *
 * Usage in plugins:
 *   // Legacy (backward compatible)
 *   ctx.hooks.on('invoices', 'after_insert', async (doc, db, auth) => { ... });
 *
 *   // New: with priority & timeout
 *   ctx.hooks.on({ collection: 'invoices', event: 'after_insert', handler: fn, priority: 40, timeoutMs: 5000 });
 *
 * Usage in entity pipeline (CollectionService):
 *   const result = await pluginHookRegistry.dispatch('invoices', 'before_insert', doc, db, auth);
 *   if (result?.abort) throw new ValidationError(result.error);
 *
 * Bundle impact: ~1KB
 */

import type { D1Client } from '@mmbix/core';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthContext } from '@/lib/services/auth.service';
import { recordChange } from '@/lib/change-scope';
import { backgroundTask } from '@/lib/request-tasks';

// ─── Types ──────────────────────────────────────────────

/**
 * A plugin hook handler — receives the document, a D1Client for DB
 * operations, and the auth context.
 *
 * Return semantics (Odoo/SAP interceptor style):
 *   - void            → success, document unchanged (in-place mutation respected)
 *   - { abort, error } → reject the operation
 *   - <object>        → the (possibly transformed) document — threaded into
 *                        the pipeline when dispatched via `dispatchTransform`
 */
export type PluginHookHandler = (
	doc: Record<string, unknown>,
	db: D1Client,
	auth?: AuthContext | null,
) => Promise<void | PluginHookAbort | Record<string, unknown>>;

export interface PluginHookAbort {
	abort: true;
	error: string;
	field?: string;
}

export interface HookRegistration {
	collection: string;
	event: string;
	handler: PluginHookHandler;
	pluginId: string;
	/** Execution priority (lower = first). Default 50. */
	priority: number;
	/** Max execution time in ms. Default 5000. */
	timeoutMs: number;
	/** Human-readable purpose — surfaced by the Studio hooks viewer (code hooks). */
	description?: string;
	/** Collections this hook REWRITES (not the one it fires on) — lets tooling
	 *  show hooks that keep OTHER collections in sync (e.g. a doc-collection hook
	 *  that refreshes a parent record's pointer). */
	writesTo?: string[];
}

/** Options-based hook registration (new API). */
export interface HookRegistrationOptions {
	collection: string;
	event: string;
	handler: PluginHookHandler;
	/** Execution priority (lower = first). Default 50. */
	priority?: number;
	/** Max execution time in ms. Default 5000. */
	timeoutMs?: number;
	/** Human-readable purpose — surfaced by the Studio hooks viewer (code hooks). */
	description?: string;
	/** Collections this hook REWRITES (see `HookRegistration.writesTo`). */
	writesTo?: string[];
}

// ─── Hook API exposed to plugins ────────────────────────

export interface PluginHookAPI {
	/**
	 * Register a lifecycle hook on a collection (legacy signature).
	 *
	 * @param collection - Collection slug (e.g. "invoices")
	 * @param event - Lifecycle event — a member of the canonical
	 *   `LIFECYCLE_EVENTS` catalog in `@mmbix/types` (`hooks.ts`). The registry
	 *   keeps the parameter `string` because the outbox replays event names from
	 *   the database, but every NEW registration here MUST use a catalog member.
	 *   `after_delete` fires after a soft OR hard delete; `after_restore` after a
	 *   trashed row is restored. Both are fire-and-forget, like the other after_*.
	 *   (`after_delete` / `after_restore` are code-hook-only — a declarative rule
	 *   cannot be registered on them; see `DECLARATIVE_TRIGGER_EVENTS`.)
	 * @param handler - Async function. Return void on success,
	 *   or { abort: true, error: "..." } to reject the operation.
	 */
	on(collection: string, event: string, handler: PluginHookHandler): void;

	/**
	 * Register a lifecycle hook on a collection (options-based).
	 *
	 * @param opts - Registration options with priority & timeout.
	 */
	on(opts: HookRegistrationOptions): void;
}

// ─── Singleton Registry ─────────────────────────────────

/** Default values for hook registration. */
const DEFAULT_PRIORITY = 50;
const DEFAULT_TIMEOUT_MS = 5_000;

// ─── Safety limits (ERP-grade hook spine) ──────────────────

/** Max nested dispatch depth — a hook that writes again must not loop forever. */
export const MAX_HOOK_DEPTH = 3;
/** Max hooks executed per dispatch — a noisy event must not starve a request. */
export const MAX_HOOKS_PER_EVENT = 20;

/**
 * Reentrancy guard, scoped to the ASYNC CAUSAL CHAIN (not the isolate). A hook
 * chain increments its own depth; a hook that re-enters the pipeline
 * (after_insert → update → before_update) sees its parent's depth and beyond
 * `MAX_HOOK_DEPTH` the dispatch rejects with a clear error instead of recursing
 * forever.
 *
 * Chain-scoped rather than a module-level counter on purpose: `after_*` hooks are
 * dispatched FIRE-AND-FORGET, so they keep running after their response is sent.
 * A shared counter therefore let a hook backlog from one request inflate the
 * depth a LATER, unrelated request observed — "Hook recursion cap reached" on a
 * write that had no recursion at all (surfaced by a domain denorm hook,
 * which fire on every ledger write). Two independent chains must not share a
 * budget; a genuinely recursive chain still trips the cap.
 */

const hookDepth = new AsyncLocalStorage<number>();

/** Wrap a dispatch chain with the depth guard; throws past the cap. */
function withDepthGuard<T>(label: string, fn: () => Promise<T>): Promise<T> {
	const depth = hookDepth.getStore() ?? 0;
	if (depth >= MAX_HOOK_DEPTH) {
		const err = new Error(`Hook recursion cap reached (${MAX_HOOK_DEPTH}) — a hook is re-entering the pipeline too deeply: ${label}`);
		return Promise.reject(err);
	}
	return hookDepth.run(depth + 1, fn);
}

/** Result of running a single hook — abort, transformed doc, or nothing. */
export type HookRunResult = { kind: 'abort'; abort: PluginHookAbort } | { kind: 'doc'; doc: Record<string, unknown> } | null;

/** Result of a transform dispatch — the threaded doc, plus an optional abort. */
export interface TransformDispatchResult {
	doc: Record<string, unknown>;
	abort?: PluginHookAbort;
}
/**
 * Execute a handler with a timeout. If the handler exceeds timeoutMs,
 * the promise rejects with a timeout error. The original promise continues
 * executing (no true cancellation in JS), but the result is discarded.
 */
function executeWithTimeout<T>(handler: () => Promise<T>, timeoutMs: number): Promise<T> {
	if (timeoutMs <= 0) return handler();

	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`Hook timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		handler()
			.then((result) => {
				clearTimeout(timer);
				resolve(result);
			})
			.catch((err) => {
				clearTimeout(timer);
				reject(err);
			});
	});
}

class PluginHookRegistry {
	private hooks: HookRegistration[] = [];

	/**
	 * Register a hook with full options.
	 */
	register(hook: HookRegistration): void {
		this.hooks.push(hook);
	}

	/**
	 * Remove every hook registered under `pluginId`, returning how many were
	 * removed.
	 *
	 * Registration happens ONCE per isolate (`bootModuleHooks`), so without this
	 * a module UNINSTALLED at runtime would keep its compiled hooks live — and
	 * keep writing their collections — until the isolate recycles. The reconciler
	 * in `bootModuleHooks` calls it when the `_addons` state flips to off.
	 */
	unregisterPlugin(pluginId: string): number {
		const before = this.hooks.length;
		this.hooks = this.hooks.filter((h) => h.pluginId !== pluginId);
		return before - this.hooks.length;
	}

	/**
	 * Create a PluginHookAPI scoped to a specific plugin.
	 * The pluginId is embedded in every registration for debugging.
	 *
	 * Supports both legacy and options-based registration:
	 *   api.on('coll', 'event', handler)  // legacy
	 *   api.on({ collection, event, handler, priority, timeoutMs })  // new
	 */
	createAPI(pluginId: string): PluginHookAPI {
		const self = this;

		function on(collectionOrOpts: string | HookRegistrationOptions, event?: string, handler?: PluginHookHandler): void {
			if (typeof collectionOrOpts === 'string') {
				// Legacy signature: on(collection, event, handler)
				self.register({
					collection: collectionOrOpts,
					event: event!,
					handler: handler!,
					pluginId,
					priority: DEFAULT_PRIORITY,
					timeoutMs: DEFAULT_TIMEOUT_MS,
				});
			} else {
				// Options-based signature: on({ collection, event, handler, priority?, timeoutMs? })
				self.register({
					collection: collectionOrOpts.collection,
					event: collectionOrOpts.event,
					handler: collectionOrOpts.handler,
					pluginId,
					priority: collectionOrOpts.priority ?? DEFAULT_PRIORITY,
					timeoutMs: collectionOrOpts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
					description: collectionOrOpts.description,
					writesTo: collectionOrOpts.writesTo,
				});
			}
		}

		return { on };
	}

	/**
	 * Read-only introspection — every registered hook WITHOUT its handler, for
	 * admin tooling (Studio's per-collection lifecycle-hook viewer). A snapshot:
	 * the live array is replaced only by register() pushes, never mutated in
	 * place, so the copy is already race-free per isolate.
	 */
	listMeta(): Array<{
		pluginId: string;
		collection: string;
		event: string;
		description: string;
		writesTo: string[];
		priority: number;
		timeoutMs: number;
	}> {
		return this.hooks.map((h) => ({
			pluginId: h.pluginId,
			collection: h.collection,
			event: h.event,
			description: h.description ?? '',
			writesTo: [...(h.writesTo ?? [])],
			priority: h.priority,
			timeoutMs: h.timeoutMs,
		}));
	}

	/**
	 * Get hooks matching collection+event, sorted by priority (ascending),
	 * bounded by the per-event budget (defense in depth for noisy events).
	 */
	private getSorted(collection: string, event: string): HookRegistration[] {
		return this.hooks
			.filter((h) => h.collection === collection && h.event === event)
			.sort((a, b) => a.priority - b.priority)
			.slice(0, MAX_HOOKS_PER_EVENT);
	}

	/**
	 * Report a hook's declared `writesTo` collections to the request's change
	 * envelope. Called SYNCHRONOUSLY at dispatch time — before the handler runs —
	 * so fire-and-forget hooks (which finish after the response is built) still
	 * appear in `meta.changed`. Writing a collection from a hook is an intent
	 * declared at registration; over-reporting is harmless (a client refetch),
	 * under-reporting leaves derived masters stale.
	 */
	private markWrites(hooks: HookRegistration[]): void {
		for (const hook of hooks) {
			if (!hook.writesTo) continue;
			for (const collection of hook.writesTo) recordChange(collection);
		}
	}

	/**
	 * Run a single hook with timeout protection.
	 * Returns the hook result (abort / transformed doc), or null if it timed
	 * out / errored (non-abort).
	 */
	private async runHook(
		hook: HookRegistration,
		doc: Record<string, unknown>,
		db: D1Client,
		auth?: AuthContext | null,
	): Promise<HookRunResult> {
		try {
			const result = await executeWithTimeout(() => hook.handler(doc, db, auth), hook.timeoutMs);
			if (result && typeof result === 'object' && !Array.isArray(result)) {
				if ((result as PluginHookAbort).abort === true) {
					return { kind: 'abort', abort: result as PluginHookAbort };
				}
				// Any other object is a transformed document.
				return { kind: 'doc', doc: result as Record<string, unknown> };
			}
		} catch (err) {
			const isTimeout = err instanceof Error && err.message.includes('timed out');
			const label = isTimeout ? 'timed out' : 'failed';
			console.error(`[plugin-hooks] ${hook.pluginId}.${hook.collection}.${hook.event} ${label}:`, err instanceof Error ? err.message : err);
			// Timeouts and thrown errors are logged but don't abort the pipeline
		}
		return null;
	}

	// ─── Existing dispatch methods (preserved) ────────────

	/**
	 * Dispatch all hooks for a given collection+event, threading the document
	 * through every handler (transform semantics). Handlers run in priority
	 * order; each may return a new document. The first abort stops the chain.
	 */
	async dispatchTransform(
		collection: string,
		event: string,
		doc: Record<string, unknown>,
		db: D1Client,
		auth?: AuthContext | null,
	): Promise<TransformDispatchResult> {
		return withDepthGuard(`${collection}.${event}`, async () => {
			const matching = this.getSorted(collection, event);
			this.markWrites(matching);
			let current = doc;
			for (const hook of matching) {
				const result = await this.runHook(hook, current, db, auth);
				if (result?.kind === 'abort') return { doc: current, abort: result.abort };
				if (result?.kind === 'doc') current = result.doc;
			}
			return { doc: current };
		});
	}

	/**
	 * Dispatch all hooks for a given collection+event (abort-only semantics,
	 * backward compatible). Returns the first abort result if any hook rejects
	 * the operation. Hooks run in priority order.
	 */
	async dispatch(
		collection: string,
		event: string,
		doc: Record<string, unknown>,
		db: D1Client,
		auth?: AuthContext | null,
	): Promise<PluginHookAbort | null> {
		const { abort } = await this.dispatchTransform(collection, event, doc, db, auth);
		return abort ?? null;
	}

	/**
	 * Dispatch all hooks for a given collection+event (fire-and-forget).
	 * Errors, timeouts and depth-cap rejections are logged but never block —
	 * for after_* hooks. Hooks run in priority order.
	 *
	 * The work is ALSO registered with `backgroundTask` (`lib/request-tasks.ts`),
	 * which hands it to the request's `ctx.waitUntil`. An un-awaited async call can
	 * be CANCELED when the invocation ends — the isolate has no reason to stay alive
	 * once the response is sent, so the promise is dropped with no error and no log.
	 * The mutation service deliberately does NOT await the after_insert/after_update
	 * dispatches, so without this a denormalizing hook (domain denorm hooks)
	 * could be torn down mid-flight and the mirror silently never written — a stale
	 * derived value indistinguishable from a correct one, the worst outcome.
	 * Awaiting the returned promise still works: it is the SAME promise being
	 * registered, never a second copy of the work.
	 */
	dispatchFireAndForget(
		collection: string,
		event: string,
		doc: Record<string, unknown>,
		db: D1Client,
		auth?: AuthContext | null,
	): Promise<void> {
		const work = this.runFireAndForget(collection, event, doc, db, auth);
		backgroundTask(work);
		return work;
	}

	private async runFireAndForget(
		collection: string,
		event: string,
		doc: Record<string, unknown>,
		db: D1Client,
		auth?: AuthContext | null,
	): Promise<void> {
		try {
			await withDepthGuard(`${collection}.${event}`, async () => {
				const matching = this.getSorted(collection, event);
				this.markWrites(matching);
				// Fire all hooks concurrently (fire-and-forget semantics)
				await Promise.allSettled(matching.map((hook) => this.runHook(hook, doc, db, auth)));
			});
		} catch (err) {
			// Depth-cap rejection must never crash the request — log and move on.
			console.error(`[plugin-hooks] ${collection}.${event} dispatch rejected:`, err instanceof Error ? err.message : err);
		}
	}
}

/** Singleton instance — populated during plugin registration in index.ts */
export const pluginHookRegistry = new PluginHookRegistry();
