/**
 * Native marketplace handlers — trusted in-process plugin code.
 *
 * Native plugins are compiled TypeScript registered at startup (or in tests):
 *
 *   import { registerNativePlugin } from '@/plugins/marketplace/native-handlers';
 *   registerNativePlugin('tax-calc', async (doc, ctx) => {
 *     return { ...doc, tax_amount: Math.round((doc.total as number) * 0.1) };
 *   });
 *
 * The handler receives the current document and returns the (possibly new)
 * document — Odoo/SAP interceptor semantics. Returning undefined keeps the doc.
 */

import type { D1Client } from '@mmbix/core';
import type { AuthContext } from '@/lib/services/auth.service';

export interface NativePluginContext {
	collection: string;
	event: string;
	db: D1Client;
	auth?: AuthContext | null;
	plugin: { id: string; version: string };
}

export type NativePluginHandler = (doc: Record<string, unknown>, ctx: NativePluginContext) => Promise<Record<string, unknown> | void>;

const handlers = new Map<string, NativePluginHandler>();

/** Register (or replace) a native plugin handler for a plugin id. */
export function registerNativePlugin(id: string, handler: NativePluginHandler): void {
	handlers.set(id, handler);
}

export function getNativeHandler(id: string): NativePluginHandler | undefined {
	return handlers.get(id);
}

export function listNativePlugins(): string[] {
	return [...handlers.keys()];
}

export function clearNativePlugins(): void {
	handlers.clear();
}
