/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '@/plugins/mcp/capabilities';
import { TOOLS } from '@/plugins/mcp/plugin';

/**
 * The capability registry must not drift from the tool catalog. `CAPABILITIES`
 * is finer-grained than `TOOLS` (several capabilities are served by one verb,
 * and the proposal gate spans two), so instead of deriving the catalog we pin
 * the LINK: every `tools` reference must exist in `TOOLS`, and every `TOOLS`
 * entry must be advertised by ≥1 capability. A new tool with no capability —
 * or a stale capability naming a removed tool — fails here.
 */
describe('MCP capability registry ↔ tool catalog', () => {
	it('every capability tool reference exists in TOOLS', () => {
		const names = new Set<string>(TOOLS.map((t) => t.name));
		for (const c of CAPABILITIES) {
			for (const t of c.tools ?? []) expect(names.has(t), `${c.id} → ${t}`).toBe(true);
		}
	});

	it('every TOOL is advertised by at least one capability (a new tool cannot drift)', () => {
		const referenced = new Set(CAPABILITIES.flatMap((c) => c.tools ?? []));
		const missing = TOOLS.map((t) => t.name).filter((n) => !referenced.has(n));
		expect(missing).toEqual([]);
	});

	it('does not catalogue the same page-blocks resource twice', () => {
		const ids = CAPABILITIES.map((c) => c.id);
		expect(ids).toContain('pages.components.registry');
		expect(ids).not.toContain('pages.blocks.registry');
	});
});
