import { lazy, Suspense } from 'react';
import IdpShell from '../components/IdpShell';

// Lazy-loaded — Scalar is heavy and only needed when the API docs page is opened.
const ApiDocsTab = lazy(() => import('../components/ApiDocsTab'));

/**
 * The Scalar API reference as a portal SECTION (`/idp/api-docs`) — the
 * `api-docs` entry in `lib/idp-nav.ts` gives it the rail icon, its route and the
 * ⌘K row, so the page carries no chrome of its own. It also renders the shell
 * WITHOUT its header (no breadcrumbs, no fullscreen toggle) and without the
 * status bar: the reference is the whole destination, so the canvas is Scalar's
 * — a crumb row on top and 28px of empty bar below would only shrink it
 * (Data-Ink Ratio). Navigation stays on the rail, whose footer carries the theme
 * toggle, and the page used to be a standalone route at `/api-docs`, outside it.
 */
export default function ApiDocsPage({ token, user }: { token: string; user: { email: string; full_name: string } }) {
	return (
		<IdpShell token={token} user={user} showHeader={false} showStatusBar={false}>
			<Suspense
				fallback={
					<p style={{ padding: '1rem', color: 'var(--mmbix-muted-foreground, #6b7280)', fontSize: '0.8rem' }}>Loading API docs…</p>
				}
			>
				<ApiDocsTab token={token} />
			</Suspense>
		</IdpShell>
	);
}
