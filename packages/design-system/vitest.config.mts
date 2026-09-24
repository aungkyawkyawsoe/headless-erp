import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// DS unit tests — jsdom for component tests (DataTable footer/grouping render).
// Picked up automatically by the root vitest.workspace.ts (`packages/*`).
export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: [
			{
				find: '@/utils',
				replacement: path.resolve(import.meta.dirname, './src/lib/utils'),
			},
			{
				find: '@/hooks',
				replacement: path.resolve(import.meta.dirname, './src/lib/hooks'),
			},
			{
				find: '@/types',
				replacement: path.resolve(import.meta.dirname, './src/lib/types'),
			},
			{
				find: '@/date',
				replacement: path.resolve(import.meta.dirname, './src/lib/date'),
			},
			{
				find: '@',
				replacement: path.resolve(import.meta.dirname, './src/components'),
			},
		],
	},
	test: {
		environment: 'jsdom',
		// globals:true lets @testing-library/react register its afterEach cleanup
		// (without it, rendered DOM leaks between tests in the same file).
		globals: true,
		setupFiles: ['./vitest.setup.ts'],
		include: ['src/**/*.test.{ts,tsx}'],
	},
});
