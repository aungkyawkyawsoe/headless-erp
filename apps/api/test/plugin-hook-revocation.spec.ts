/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, expect, it } from 'vitest';
import { pluginHookRegistry } from '@/core/plugin-hooks';

/**
 * A domain module / add-on's compiled hooks are registered ONCE per isolate by
 * `bootModuleHooks`. Without a way to revoke them, UNINSTALLING the module at
 * runtime left its hooks live — still firing on engine collections and still
 * writing their rows — until the isolate recycled. `unregisterPlugin` is the
 * release, and `bootModuleHooks` now reconciles install state on every request
 * (register on install, revoke on uninstall).
 *
 * Pinned here because the registry is a process-wide singleton: a regression is
 * invisible in the unit path and would only surface as a disabled module's side
 * effects continuing to run in production.
 */

describe('pluginHookRegistry.unregisterPlugin', () => {
	const MODULE_A = '__revocation_probe_a';
	const MODULE_B = '__revocation_probe_b';

	it('removes exactly the target module’s hooks and leaves others registered', () => {
		pluginHookRegistry.createAPI(MODULE_A).on('probe_collection', 'after_insert', async () => {});
		pluginHookRegistry.createAPI(MODULE_B).on('probe_collection', 'after_insert', async () => {});

		expect(pluginHookRegistry.listMeta().filter((h) => h.pluginId === MODULE_A)).toHaveLength(1);

		const removed = pluginHookRegistry.unregisterPlugin(MODULE_A);

		expect(removed).toBe(1);
		expect(pluginHookRegistry.listMeta().filter((h) => h.pluginId === MODULE_A)).toHaveLength(0);
		// The sibling module is untouched.
		expect(pluginHookRegistry.listMeta().filter((h) => h.pluginId === MODULE_B)).toHaveLength(1);

		// A second call is a no-op, not an error.
		expect(pluginHookRegistry.unregisterPlugin(MODULE_A)).toBe(0);

		pluginHookRegistry.unregisterPlugin(MODULE_B);
	});
});
