/**
 * Cloudflare Worker-specific types
 *
 * Only import from here in Workers/API code, NOT in browser/UI code.
 * These types depend on @cloudflare/workers-types.
 */
export type { Plugin, PluginMigration, PluginContext, PluginRegistration } from './plugin';
