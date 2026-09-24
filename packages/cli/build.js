import * as esbuild from 'esbuild';

await esbuild.build({
	entryPoints: ['bin/cli.ts'],
	bundle: true,
	platform: 'node',
	target: 'node20',
	format: 'esm',
	outfile: 'bin/cli.js',
	banner: {
		js: '#!/usr/bin/env node',
	},
	// esbuild 0.21 can't parse the "es2024" target in tsconfig.base.json —
	// override what it reads so the warning disappears (output unchanged)
	tsconfigRaw: { compilerOptions: {} },
	external: [
		// CJS interop — keep as external to avoid dynamic require issues
		'commander',
		'@clack/prompts',
		'picocolors',
		// Native / optional deps
		'fsevents',
	],
});

console.log('CLI built → bin/cli.js');
