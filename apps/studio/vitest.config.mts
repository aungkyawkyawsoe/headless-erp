import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Studio unit tests.
//
// Default environment is `node` — most of what is worth testing here is PURE
// logic (form-layout tree ops, policy-form mapping, serialization, history).
// A component test opts into a DOM per file with the docblock
//
//     // @vitest-environment jsdom
//
// (kept per-file rather than global so the node suite stays fast).
export default defineConfig({
	plugins: [react()],
	test: {
		include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
		environment: 'node',
	},
});
