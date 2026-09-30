import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { StudioMetaProvider } from './lib/studioMeta';
import { isSessionTokenFresh } from './lib/session';
import { setUnauthorizedHandler } from './lib/api';
import { resetStudioQueries } from './lib/query-client';
import { resetStudioUi } from './lib/studio-store';
import LoginPage from './pages/LoginPage';
// Heavy authed pages are code-split: the initial shell no longer ships the whole
// API-docs bundle (@scalar, ~2MB) or every IDP page just to render the login screen.
const AppDetailPage = lazy(() => import('./pages/AppDetailPage'));
const StudioAdminPage = lazy(() => import('./pages/StudioAdminPage'));
const ApiDocsPage = lazy(() => import('./pages/ApiDocsPage'));
const IdpHomePage = lazy(() => import('./pages/IdpHomePage'));
const IdpCatalogPage = lazy(() => import('./pages/IdpCatalogPage'));
const CollectionsWorkbench = lazy(() => import('./pages/CollectionsWorkbench'));
const IdpCreatePage = lazy(() => import('./pages/IdpCreatePage'));
const IdpPoliciesPage = lazy(() => import('./pages/IdpPoliciesPage'));
const IdpAppDetailPage = lazy(() => import('./pages/IdpAppDetailPage'));
const UserRolesPage = lazy(() => import('./pages/UserRolesPage'));
const AccessPoliciesPage = lazy(() => import('./pages/AccessPoliciesPage'));
const IdpUsersPage = lazy(() => import('./pages/IdpUsersPage'));
import { CommandPalette } from './components/CommandPalette';
import { ConfirmDialogHost } from '@mmbix/design-system';
import { useTenantTheme } from './lib/tenant-theme';
import { LogoutProvider } from './lib/session-actions';

/** Suspense fallback for a lazy route chunk. */
const RouteFallback = () => (
	<div style={{ padding: '1.5rem', color: 'var(--mmbix-muted-foreground, #9ca3af)', fontSize: '0.8rem' }}>Loading…</div>
);

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

function AppInner({ token, user, onLogout }: { token: string; user: { email: string; full_name: string }; onLogout: () => void }) {
	// White-label: apply the deployment's effective design tokens as CSS variables.
	useTenantTheme(token);

	// Every authed surface is full-bleed and owns its own shell — the portal
	// (rail + panel), Studio Admin (AppShell) and the App workbench
	// (StudioLayout). The plain padded `<main>` went with the app launcher grid,
	// which `/` used to render; sign-in now lands directly on the portal.
	//
	// The frame IS the viewport, measured in `svh` — the unit the design-system
	// chrome sizes its rail/sidebar with (`h-svh`), so a mobile URL bar can never
	// make the frame taller than the visible area (the `vh` bug: a scrollable
	// document with the bottom bar cut off). The shells fill this frame instead
	// of growing with their content — see `studio.css`.
	return (
		<LogoutProvider logout={onLogout}>
			<div style={{ height: '100svh', display: 'flex', overflow: 'hidden' }}>
				<div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
					<div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
						<Suspense fallback={<RouteFallback />}>
							<Routes>
								<Route
									path="/apps/:slug/*"
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
								<Route path="/idp" element={<IdpHomePage token={token} user={user} />} />
								<Route path="/idp/api-docs" element={<ApiDocsPage token={token} user={user} />} />
								<Route path="/idp/catalog" element={<IdpCatalogPage token={token} user={user} />} />
								<Route path="/idp/collections" element={<CollectionsWorkbench token={token} user={user} />} />
								<Route path="/idp/collections/:slug" element={<CollectionsWorkbench token={token} user={user} />} />
								<Route path="/idp/create" element={<IdpCreatePage token={token} user={user} />} />
								<Route path="/idp/policies" element={<IdpPoliciesPage token={token} user={user} />} />
								<Route path="/idp/access" element={<Navigate to="/idp/access/roles" replace />} />
								<Route path="/idp/access/roles" element={<UserRolesPage token={token} user={user} />} />
								<Route path="/idp/access/policies" element={<AccessPoliciesPage token={token} user={user} />} />
								<Route path="/idp/users" element={<IdpUsersPage token={token} user={user} />} />
								<Route path="/idp/:slug" element={<IdpAppDetailPage token={token} user={user} />} />
								{/* Signed in, `/` IS the portal — the rail + panel shell with Overview
								    active. `replace`: a redirect must not add a history entry (the
								    back arrow leaves the app in one press, per the URL contract). */}
								<Route path="/" element={<Navigate to="/idp" replace />} />
								{/* The API reference moved into the portal (`/idp/api-docs`) so the
								    activity bar can show it; old links and docs still resolve. */}
								<Route path="/api-docs" element={<Navigate to="/idp/api-docs" replace />} />
								<Route path="*" element={<Navigate to="/idp" replace />} />
							</Routes>
						</Suspense>
					</div>
				</div>
				{/* Command palette — mounted once, available on every authed surface. */}
				<CommandPalette token={token} />
				{/* Themed confirm/alert — one host for every imperative confirmation. */}
				<ConfirmDialogHost />
			</div>
		</LogoutProvider>
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
	// tree. The login screen and the IDP portal (the post-login home) therefore
	// issue ZERO `/__studio/meta` reads: the ~59 KB catalog is fetched only where used.
	return (
		<HashRouter>{token && user ? <AppInner token={token} user={user} onLogout={endSession} /> : <LoginPage onLogin={login} />}</HashRouter>
	);
}
