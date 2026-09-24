import { fileURLToPath, URL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig, type Connect, type HtmlTagDescriptor, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// Telegram Mini App frontend — mobile-first, Tailwind v4 via the official Vite
// plugin. Dev proxy: /api + /trpc → the core API worker (wrangler dev, 8788).

/**
 * Dev-only SPA fallback for deep links (direct navigation / reload).
 *
 * The Cloudflare Vite plugin's dev asset router only rewrites unmatched
 * requests to index.html when the request carries `Sec-Fetch-Mode: navigate`
 * (the `assets_navigation_prefers_asset_serving` compat behavior). Reloads
 * from webviews/clients that omit that header fall through to the user worker,
 * whose ASSETS binding is the raw Vite middleware — which has no SPA fallback —
 * so react-router routes 404 with "Cannot GET …" on reload.
 *
 * Production is unaffected: the deployed assets edge serves index.html for
 * every miss (wrangler.jsonc `not_found_handling: single-page-application`).
 * This middleware only bridges the dev gap, and only for extensionless
 * HTML-accepting GET/HEAD requests — real files (/src/*.tsx, /@vite/*) and the
 * /api + /trpc proxies are already handled by earlier middlewares.
 */
/**
 * Preload the HOME route's chunk closure from index.html.
 *
 * The launcher is a lazy chunk, so the browser only discovers its file name
 * after the entry bundle has downloaded AND executed — a serial hop worth a
 * whole round trip on a mobile link (measured at 1.6 Mbps / 150 ms RTT: entry
 * done at 1.31 s → launcher chunk only requested at 1.31 s → first tile at
 * 1.81 s). Emitting `modulepreload` hints lets the browser fetch the chunk and
 * its static imports IN PARALLEL with the entry. The closure is walked from the
 * chunk's own `imports` so the browser does not re-discover it one round trip at
 * a time. Build-only: dev serves modules unbundled.
 */
function preloadHomeChunks(): Plugin {
	return {
		name: 'tgapp-preload-home-chunks',
		apply: 'build',
		transformIndexHtml(_html, ctx) {
			const bundle = ctx.bundle ?? {};
			const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
			const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));

			// The entry's static closure is already preloaded by Vite — mark it so the
			// tags below never duplicate a hint.
			const preloaded = new Set<string>();
			const markPreloaded = (fileName: string) => {
				if (preloaded.has(fileName)) return;
				preloaded.add(fileName);
				for (const dep of byFile.get(fileName)?.imports ?? []) markPreloaded(dep);
			};
			for (const chunk of chunks) if (chunk.isEntry) markPreloaded(chunk.fileName);

			const home = chunks.find((chunk) => chunk.facadeModuleId?.includes('/modules/launcher/launcher-page'));
			if (!home) return [];

			const seen = new Set<string>();
			const tags: HtmlTagDescriptor[] = [];
			const walk = (fileName: string) => {
				if (preloaded.has(fileName) || seen.has(fileName)) return;
				seen.add(fileName);
				tags.push({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: '', href: `/${fileName}` }, injectTo: 'head' });
				for (const dep of byFile.get(fileName)?.imports ?? []) walk(dep);
			};
			walk(home.fileName);
			return tags;
		},
	};
}

function spaDeepLinkFallback(): Plugin {
	return {
		name: 'tgapp-spa-deep-link-fallback',
		configureServer(server) {
			// Post-hook runs before the Cloudflare plugin's request dispatcher because
			// this plugin is listed BEFORE cloudflare() — Vite runs configureServer
			// post-hooks in plugin order — so SPA routes are answered here instead of
			// falling through to the worker 404.
			return () => {
				server.middlewares.use(async (req: Connect.IncomingMessage, res, next) => {
					if (req.method !== 'GET' && req.method !== 'HEAD') return next();
					if (req.headers.upgrade) return next(); // WebSocket upgrade (HMR) — passthrough
					const pathname = (req.url ?? '/').split('?')[0];
					if (pathname === '/health') return next(); // worker-owned endpoint
					const lastSegment = pathname.split('/').filter(Boolean).pop() ?? '';
					if (lastSegment.includes('.')) return next(); // real file request (JS/CSS/images)
					const accept = req.headers.accept ?? '';
					if (accept && !accept.includes('text/html') && !accept.includes('*/*')) return next();
					const html = await readFile(join(server.config.root, 'index.html'), 'utf-8');
					const transformed = await server.transformIndexHtml(pathname, html);
					res.statusCode = 200;
					res.setHeader('Content-Type', 'text/html');
					res.end(req.method === 'HEAD' ? undefined : transformed);
				});
			};
		},
	};
}

export default defineConfig({
	// spaDeepLinkFallback must sit BEFORE cloudflare(): Vite runs configureServer
	// post-hooks in plugin order, so this plugin's middleware is registered before
	// the Cloudflare request dispatcher and can answer SPA deep links first.
	//
	// The cloudflare() plugin is skipped under vitest — it boots a workerd runtime
	// + inspector (EADDRINUSE against the running `wrangler dev` API) that tests
	// don't need.
	plugins: [
		react(),
		tailwindcss(),
		spaDeepLinkFallback(),
		preloadHomeChunks(),
		...(process.env.VITEST === 'true' ? [] : [cloudflare({ inspectorPort: Number(process.env.VITE_INSPECTOR_PORT ?? 9232) })]),
	],
	resolve: {
		alias: [{ find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) }],
	},
	build: {
		rollupOptions: {
			output: {
				// Rollup's default splitting emits one chunk per tiny SHARED module, so
				// this app built ~220 chunks, 116 of them ≤4 kB — individual lucide icons,
				// per-module `query-keys`/`api` files. Every one is a separate request,
				// and on a mobile link each request pays a full round trip. The icon set
				// is shared by nearly every lazy route, so Rollup split it 20+ ways; keep
				// it in ONE chunk, fetched once on demand and cached for the session.
				manualChunks(id) {
					if (id.includes('node_modules/lucide-react')) return 'icons';
					return undefined;
				},
			},
		},
	},
	// Workspace packages consumed as SOURCE (@mmbix/sdk, @mmbix/sdk-react,
	// @mmbix/types) are symlinked — never pre-bundle them so edits hot-reload
	// instead of serving a stale optimized copy. @mmbix/design-system ships a
	// built dist and IS pre-bundled.
	optimizeDeps: {
		exclude: ['@mmbix/sdk', '@mmbix/sdk-react', '@mmbix/types'],
	},
	server: {
		host: true, // listen on 0.0.0.0 so phones on the LAN can reach the dev server
		port: 5175,
		strictPort: true,
		allowedHosts: ['aungs-macbook-pro.local'],
		proxy: {
			'/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:8788', changeOrigin: true },
			'/trpc': { target: process.env.VITE_API_PROXY ?? 'http://localhost:8788', changeOrigin: true },
		},
	},
});
