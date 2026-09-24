import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { studioDbPlugin } from './studio.db/vitePlugin.ts';

// Vendor chunk splitter — separate the heavy, rarely-changing npm packages into
// their own cacheable chunks so the app entry stays small.
function manualChunks(id: string): string | undefined {
	if (!id.includes('node_modules')) return undefined;
	if (id.includes('@base-ui') || id.includes('@floating-ui') || id.includes('@radix-ui')) return 'base-ui';
	if (id.includes('lucide-react')) return 'lucide';
	if (id.includes('@tanstack')) return 'tanstack';
	if (id.includes('@dnd-kit')) return 'dnd-kit';
	if (id.includes('react-router') || id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/'))
		return 'react-vendor';
	if (id.includes('embla') || id.includes('cmdk') || id.includes('input-otp') || id.includes('react-resizable-panels')) return 'ui-extras';
	return undefined;
}

export default defineConfig({
	plugins: [react(), tailwindcss(), studioDbPlugin()],
	resolve: {
		alias: [{ find: '@', replacement: new URL('./src', import.meta.url).pathname }],
	},
	// Workspace packages (@mmbix/ui-views, @mmbix/types) are symlinked SOURCE —
	// never pre-bundle them so shared-editor edits hot-reload reliably.
	optimizeDeps: {
		exclude: ['@mmbix/ui-views', '@mmbix/types', '@mmbix/utils'],
	},
	server: {
		host: true, // listen on 0.0.0.0 so other PCs on the LAN can reach the dev server
		port: 5174,
		strictPort: true,
		allowedHosts: ['aungs-macbook-pro.local'],
		proxy: {
			'/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:8788', changeOrigin: true },
		},
	},
	build: {
		// The app entry is ~785 kB raw (197 kB gzip) — real app code already
		// vendor-split above (base-ui/react-vendor/tanstack/…) — so the advisory
		// 500 kB default limit is raised consciously rather than left as noise.
		chunkSizeWarningLimit: 800,
		rollupOptions: {
			output: { manualChunks },
		},
	},
});
