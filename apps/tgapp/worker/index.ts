/**
 * Telegram Mini App worker (BFF + SPA assets).
 *
 * - SPA routes → Cloudflare Assets (`not_found_handling: single-page-application`)
 * - a MISS on a static-asset path (a previous deploy's chunk hash) → 404,
 *   never the HTML shell — see `isShellForAssetPath`
 * - /api/* + /trpc/* → proxied to the core API worker (the `API` service
 *   binding → `WORKER_API` from `infra/env.prod`, today `mff-sys-api`) via the
 *   private `API` service binding — no CORS, no public exposure of the API.
 * - /health → worker status
 *
 * Local dev: the Vite dev proxy (vite.config.ts) routes /api + /trpc → 8788
 * instead, so this worker only runs in `wrangler deploy` (and `wrangler dev`
 * served through the Cloudflare Vite plugin).
 */

/**
 * Paths that name a STATIC FILE rather than an SPA route: Vite emits every
 * hashed chunk/style/binary under `/assets/`, plus a few extension-tagged files
 * at the root (favicon, manifest, …). A HIT on one of these never reaches this
 * Worker — Cloudflare's asset layer serves existing files directly — so by the
 * time such a path gets here, the file is GONE: almost always a previous
 * deploy's chunk hash, requested by a Telegram WebView still running the old
 * bundle. Known extensions only — an SPA route whose last segment contains a
 * dot (a licence number, a version) must never match.
 */
const STATIC_ASSET_EXT = /\.(?:js|mjs|cjs|css|map|json|svg|png|jpe?g|webp|avif|ico|woff2?|ttf|otf|txt|webmanifest)$/i;

export function isStaticAssetPath(pathname: string): boolean {
	return pathname.startsWith('/assets/') || STATIC_ASSET_EXT.test(pathname);
}

/**
 * The SPA shell answering a static-file URL — the shape to REJECT with 404.
 *
 * `not_found_handling: single-page-application` replies `200 index.html`
 * (text/html) to a missing `/assets/x-OLD.js`, and the browser's module loader
 * rejects it as `TypeError: 'text/html' is not a valid JavaScript MIME type` —
 * a dead end whose panel "Retry" re-imports the same dead URL (React `lazy()`
 * caches the rejection for the page's lifetime). A real 404 produces the
 * standard chunk-load rejection instead, which every browser words in a form
 * the client ErrorBoundary already recovers from with ONE guarded reload of
 * the fresh shell. Extensionless SPA routes keep the HTML fallback untouched.
 */
export function isShellForAssetPath(pathname: string, contentType: string | null): boolean {
	return isStaticAssetPath(pathname) && (contentType ?? '').includes('text/html');
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// Health-check endpoint.
		if (url.pathname === '/health') {
			return Response.json({ status: 'ok', worker: 'tgapp' });
		}

		// Core API proxy (REST + tRPC) — private service binding. Exact-segment
		// match: `/api/…`, `/trpc` or `/trpc/…`, never `/apifoo`.
		if ((url.pathname.startsWith('/api/') || url.pathname === '/trpc' || url.pathname.startsWith('/trpc/')) && env.API) {
			return env.API.fetch(request);
		}

		// SPA routes → Cloudflare Assets (not_found_handling:
		// single-page-application). A missing STATIC file must stay a 404 — see
		// `isShellForAssetPath`.
		if (env.ASSETS) {
			const res = await env.ASSETS.fetch(request);
			if (isShellForAssetPath(url.pathname, res.headers.get('content-type'))) {
				return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
			}
			return res;
		}
		return new Response(null, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
