import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// sdk-react hooks tests — jsdom (React rendering) + the react plugin for TSX.
export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: [{ find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) }],
	},
	test: {
		environment: 'jsdom',
		include: ['test/**/*.test.{ts,tsx}'],
	},
});
