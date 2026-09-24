import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Tests run against wrangler.testco.jsonc (NOT wrangler.jsonc) so the suite is
// self-contained: test-only vars (IS_DEV=true, ADMIN_*, JWT_SECRET) live in the
// test config and never ship to production, and no local .dev.vars is required
// (CI has none).
export default defineConfig({
	plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.testco.jsonc' } }), tsconfigPaths()],
	test: {
		include: ['test/**/*.spec.ts'],
		// Files run SEQUENTIALLY. The Workers pool isolates STORAGE per test file
		// but runs files CONCURRENTLY by default, and every Worker in a workerd
		// process SHARES one module cache — so two files interleaving in one
		// isolate also interleave the module-level singletons the engine keeps
		// there (the schema `CacheLayer`, the plugin-hook registry, the per-isolate
		// authz-version stamp). The suite is written for sequential semantics — see
		// the "same worker, sequential" note in `mro-inventory.spec.ts` — and under
		// the default concurrency it produced a rotating set of spurious failures
		// (11 one run, 0 the next, identical code), which is worse than slow: a
		// suite that cries wolf gets ignored. This keeps per-file storage isolation
		// and only removes the interleaving.
		fileParallelism: false,
	},
});
