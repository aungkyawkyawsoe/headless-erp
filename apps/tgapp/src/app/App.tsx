import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { SdkProvider } from '@mmbix/sdk-react';

import { getLiveWebApp, initTelegramApp } from '@/shared/platform/telegram';
import { applyScheme, loadThemePreference, onSystemSchemeChange, resolveScheme } from '@/shared/platform/theme';
import { sdk } from '@/shared/api/sdk';
import { queryClient } from '@/shared/api/query-client';
import { useKeyboardInsetVar } from '@/shared/platform/keyboard-inset';
import { useOfflineSync } from '@/shared/hooks/use-offline';
import { OfflineBanner } from '@/shared/components/offline-banner';
import { Router } from './router';

/**
 * The toast viewport is code-split and mounted AFTER the first paint.
 *
 * A static import pulled `@base-ui/react/toast` (toast manager + FloatingPortal +
 * useRenderElement, ~15–20 kB gz) into the ENTRY chunk — JS the pre-auth boot
 * must download and parse for a screen whose only toast surface is hidden. The
 * manager itself lives in the DS module scope, so a toast raised before the
 * viewport mounts is still rendered once it does; a first-paint rAF is far
 * earlier than any network write can resolve, so nothing can be missed.
 */
const Toaster = lazy(() => import('@mmbix/design-system/toast').then((m) => ({ default: m.Toaster })));

/**
 * Telegram Mini App — mobile-first frontend for the Mmbix entity engine.
 *
 * The backend is reachable same-origin via `/api` (Vite dev proxy → 8788, or
 * the tgapp worker's `API` service binding in production). Every data
 * operation flows through the app-wide SDK client (src/shared/api/sdk.ts).
 *
 * `NuqsAdapter` (react-router v7 adapter) makes UI state URL-driven:
 * search `?q=` and page `?page=` survive reloads and deep links.
 */
export default function App() {
	// Replay writes captured while offline and refresh the read cache the moment
	// the API is reachable again. Mounted here, once, above every screen.
	useOfflineSync();

	// Mirror the on-screen-keyboard inset to a CSS variable so every bottom sheet
	// lifts above the keyboard (see index.css) — one observer, app-wide.
	useKeyboardInsetVar();

	// Mount the toast viewport one frame after the first paint (see `Toaster`).
	const [toasterReady, setToasterReady] = useState(false);
	useEffect(() => {
		const raf = requestAnimationFrame(() => setToasterReady(true));
		return () => cancelAnimationFrame(raf);
	}, []);

	useEffect(() => {
		// Returns a dispose: StrictMode/HMR double mounts must release the
		// Telegram listeners instead of stacking a second set (see telegram.ts).
		const disposeInit = initTelegramApp();
		// Discover the BACKEND's page-size contract (GET /api/meta) so this app
		// adjusts its page sizes within what the server allows — the backend is the
		// single source of truth; the SDK falls back to the mirror defaults (25/100)
		// when unreachable. Fire-and-forget: failures keep the defaults.
		void sdk.loadLimits().catch(() => {});
		return disposeInit;
	}, []);

	// Keep `system` followers in step with the CLIENT's scheme app-wide: OS
	// flips (browser matchMedia) and Telegram's `themeChanged` re-apply the
	// resolved scheme to the app tokens from ANY page (explicit light/dark
	// picks never follow the client). The change guard prevents apply ↔
	// event ping-pong, and `applyScheme` — not `applyThemePreference` — is
	// deliberate: the client has ALREADY flipped itself, only our tokens lag.
	useEffect(() => {
		const sync = () => {
			if (loadThemePreference() !== 'system') return;
			const next = resolveScheme('system');
			if (typeof document !== 'undefined' && document.documentElement.dataset.theme === next) return;
			applyScheme(next);
		};
		const unlisten = onSystemSchemeChange(sync);
		const wa = getLiveWebApp();
		wa?.onEvent('themeChanged', sync);
		return () => {
			unlisten();
			wa?.offEvent('themeChanged', sync);
		};
	}, []);

	return (
		// The app-wide SDK provider — makes the typed client + server-state hooks
		// (@mmbix/sdk-react) available to every page: dedupe, caching, write-
		// invalidation, one-view-one-request batches.
		<SdkProvider client={sdk} queryClient={queryClient}>
			<BrowserRouter>
				<NuqsAdapter>
					<Router />
					{/* Offline / pending-sync indicator — app-wide, and inert while online. */}
					<OfflineBanner />
					{/* The app-wide toast viewport — one mount for every page; modules fire
						success/error toasts via the DS `toast` manager. Deferred one frame
						so its base-ui bundle stays off the boot path. */}
					{toasterReady ? (
						<Suspense fallback={null}>
							<Toaster />
						</Suspense>
					) : null}
				</NuqsAdapter>
			</BrowserRouter>
		</SdkProvider>
	);
}
