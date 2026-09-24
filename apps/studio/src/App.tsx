import { useState, useEffect, useCallback } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { StudioMetaProvider } from './lib/studioMeta';
import { isSessionTokenFresh } from './lib/session';
import { setUnauthorizedHandler } from './lib/api';
import { resetStudioQueries } from './lib/query-client';
import { resetStudioUi } from './lib/studio-store';
import LoginPage from './pages/LoginPage';
import AppsPage from './pages/AppsPage';
import AppDetailPage from './pages/AppDetailPage';
import StudioAdminPage from './pages/StudioAdminPage';
import ApiDocsPage from './pages/ApiDocsPage';
import IdpHomePage from './pages/IdpHomePage';
import IdpCatalogPage from './pages/IdpCatalogPage';
import CollectionsWorkbench from './pages/CollectionsWorkbench';
import IdpCreatePage from './pages/IdpCreatePage';
import IdpEnvironmentsPage from './pages/IdpEnvironmentsPage';
import IdpDeploymentsPage from './pages/IdpDeploymentsPage';
import IdpUsagePage from './pages/IdpUsagePage';
import IdpAppDetailPage from './pages/IdpAppDetailPage';
import IdpAccessPage from './pages/IdpAccessPage';
import IdpUsersPage from './pages/IdpUsersPage';
import ThemeToggle from './components/ThemeToggle';

const TOKEN_KEY = 'studio_token';
const USER_KEY = 'studio_user';

/** The persisted session — a token and the user it belongs to travel together. */
type Session = { token: string; user: { email: string; full_name: string } };

/**
 * Read the persisted session ONCE, dropping it whole when the token provably
 * expired.
 *
 * Adopting a dead token renders the authed shell, which fires one doomed
 * `GET /api/modules` before the 401 handler falls back to login — so every
 * post-expiry visit would pay a wasted round trip plus a console 401. Evicting
 * here makes that path cost ZERO requests. The server stays the authority: an
 * unparseable or signature-invalid token is still adopted and still adjudicated
 * by its 401 (see `lib/session.ts`).
 */
function readStoredSession(): Session | null {
	try {
		const token = localStorage.getItem(TOKEN_KEY);
		if (!token || !isSessionTokenFresh(token)) return null;
		const raw = localStorage.getItem(USER_KEY);
		if (!raw) return null;
		return { token, user: JSON.parse(raw) as Session['user'] };
	} catch {
		return null;
	}
}

/** Full-viewport builder route — the App workbench renders its own StudioLayout shell
 *  (header + 3 panes + footer) and must NOT be wrapped in the App chrome. */
const STUDIO_ROUTE = /^\/apps\/[^/]+$/;

// IDP portal (catalog + app detail) is a full-bleed read surface — it renders
// its own header/back-nav and must NOT be wrapped in the plain app bar.
const IDP_ROUTE = /^\/idp(\/.*)?$/;

function AppInner({ token, user, onLogout }: { token: string; user: { email: string; full_name: string }; onLogout: () => void }) {
	const location = useLocation();
	const isStudio = STUDIO_ROUTE.test(location.pathname);
	const isStudioAdmin = location.pathname.startsWith('/studio') || location.pathname.startsWith('/api-docs');
	const isIdp = IDP_ROUTE.test(location.pathname);

	// Full-bleed routes own the whole viewport: the module workbench (its own
	// StudioLayout) and the Studio Admin (its own design-system AppShell with
	// sidebar + status bar). Plain pages get the main area + bottom app bar.
	return (
		<div style={{ height: '100vh', display: 'flex', overflow: 'hidden' }}>
			<div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
				{isStudio || isStudioAdmin || isIdp ? (
					<div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
						<Routes>
							<Route
								path="/apps/:slug"
								element={
									<StudioMetaProvider>
										<AppDetailPage token={token} />
									</StudioMetaProvider>
								}
							/>
							<Route
								path="/studio"
								element={
									<StudioMetaProvider>
										<StudioAdminPage token={token} user={user} />
									</StudioMetaProvider>
								}
							/>
							<Route path="/api-docs" element={<ApiDocsPage token={token} />} />
							<Route path="/idp" element={<IdpHomePage token={token} user={user} />} />
							<Route path="/idp/catalog" element={<IdpCatalogPage token={token} user={user} />} />
							<Route path="/idp/collections" element={<CollectionsWorkbench token={token} />} />
							<Route path="/idp/collections/:slug" element={<CollectionsWorkbench token={token} />} />
							<Route path="/idp/create" element={<IdpCreatePage token={token} user={user} />} />
							<Route path="/idp/environments" element={<IdpEnvironmentsPage token={token} user={user} />} />
							<Route path="/idp/deployments" element={<IdpDeploymentsPage token={token} user={user} />} />
							<Route path="/idp/usage" element={<IdpUsagePage token={token} user={user} />} />
							<Route path="/idp/access" element={<IdpAccessPage token={token} user={user} />} />
							<Route path="/idp/users" element={<IdpUsersPage token={token} user={user} />} />
							<Route path="/idp/:slug" element={<IdpAppDetailPage token={token} user={user} />} />
						</Routes>
					</div>
				) : (
					<>
						<main style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', width: '100%', boxSizing: 'border-box' }}>
							<Routes>
								<Route path="/" element={<AppsPage token={token} user={user} onLogout={onLogout} />} />
								<Route path="*" element={<Navigate to="/" replace />} />
							</Routes>
						</main>
					</>
				)}

				{/* Thin studio toolbar — one small bar under every authed surface. The
				 * theme control rides its right edge so light/dark is one click away. */}
				<div
					style={{
						flexShrink: 0,
						height: 30,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'flex-end',
						gap: '0.5rem',
						padding: '0 0.6rem',
						borderTop: '1px solid var(--mmbix-border, #e5e7eb)',
						background: 'var(--mmbix-card, #ffffff)',
					}}
				>
					<span style={{ fontSize: '0.68rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Theme</span>
					<ThemeToggle />
				</div>
			</div>
		</div>
	);
}

export default function App() {
	// One value, not two pieces of state: a token without its user (or vice versa)
	// is not a session, and login/logout/401 always move them together.
	const [session, setSession] = useState<Session | null>(readStoredSession);
	const token = session?.token ?? null;
	const user = session?.user ?? null;
	const queryClient = useQueryClient();

	// A session change (login, logout, 401) must never serve the previous user's
	// cached reads. The reset runs at the three call sites, BEFORE the state flips —
	// not in an effect keyed on the token. An effect fires only AFTER the authed tree
	// has mounted and started its reads, so it used to destroy those in-flight
	// queries (every one refetching: a duplicate round trip per login) and blank the
	// shell while the catalog re-loaded. Clearing first means the authed tree mounts
	// into a cache that is already correct, so each read starts exactly once.
	const endSession = useCallback(() => {
		resetStudioQueries(queryClient);
		resetStudioUi();
		localStorage.removeItem(TOKEN_KEY);
		localStorage.removeItem(USER_KEY);
		setSession(null);
	}, [queryClient]);

	// Token expired / invalid (any authed call returns 401) → drop the session
	// and let the login screen show again automatically.
	useEffect(() => {
		setUnauthorizedHandler(endSession);
		return () => setUnauthorizedHandler(null);
	}, [endSession]);

	function login(t: string, u: { email: string; full_name: string }) {
		// A fresh sign-in starts from a cache scoped to the NEW session.
		resetStudioQueries(queryClient);
		resetStudioUi();
		localStorage.setItem(TOKEN_KEY, t);
		localStorage.setItem(USER_KEY, JSON.stringify(u));
		setSession({ token: t, user: u });
	}

	// The studio.db catalog is needed ONLY by the two screens that read it — the App
	// workbench (schema designer + page builder) and the Studio Admin page — so its
	// provider is mounted per-route (see AppInner), not around the whole authed
	// tree. The login screen, the apps gallery and the IDP portal therefore issue
	// ZERO `/__studio/meta` reads: the ~59 KB catalog is fetched only where used.
	return (
		<HashRouter>{token && user ? <AppInner token={token} user={user} onLogout={endSession} /> : <LoginPage onLogin={login} />}</HashRouter>
	);
}
