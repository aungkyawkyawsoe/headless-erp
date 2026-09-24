import * as esbuild from 'esbuild';

// Bundles the typegen CLI — the library itself is source-first (consumers
// import src/index.ts directly, like @mmbix/core / @mmbix/types). Only the
// node bin needs a real bundle.
await esbuild.build({
	entryPoints: ['bin/typegen.ts'],
	bundle: true,
	platform: 'node',
	target: 'node20',
	format: 'esm',
	outfile: 'bin/typegen.js',
	banner: {
		js: '#!/usr/bin/env node',
	},
	// esbuild 0.21 can't parse the "es2024" target in tsconfig.base.json —
	// override what it reads so the warning disappears (output unchanged).
	tsconfigRaw: { compilerOptions: {} },
	external: ['zod'],
});

console.log('SDK typegen built → bin/typegen.js');
