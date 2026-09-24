import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { AppHeader } from './app-header';
import { hapticImpact } from '@/shared/platform/haptics';
import { popBack } from '@/shared/platform/history';
import { isTelegramApp, versionAtLeast } from '@/shared/platform/telegram';
import { useLiveWebApp } from '@/shared/platform/use-live-web-app';

const pill =
	'flex items-center rounded-full bg-card/95 px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface ModuleShellProps {
	/** Centered app-bar title (e.g. "ရုံးတက်"). */
	title: string;
	/** Optional second line under the title (e.g. "Enterprise Workspace"). */
	subtitle?: string;
	/** Optional right-hand control in the bar — a screen's own view switch (e.g. the
	 *  wheel rig ↔ list toggle). NOT navigation chrome: the native Telegram ✕/⋮ live
	 *  in the `pt-tg` strip ABOVE this row, so a functional control here never clashes. */
	trailing?: ReactNode;
	/** KIOSK layout: lock the screen to exactly ONE viewport (nothing scrolls out of
	 *  `main`) so a page that owns internal scrolling — a wheel rig whose rail and KPI
	 *  footer must stay put — can do so. Default `false`: the document scrolls, which is
	 *  what every form/list page wants. The bottom clearance follows: a kiosk has no
	 *  scroll, so the extra `--shell-bottom` reserved for the Telegram MainButton is
	 *  replaced by the plain safe-area inset. */
	fill?: boolean;
	/** Where the back affordance leads — the dashboard by default. */
	backTo?: string;
	children: ReactNode;
}

/**
 * Standard module page shell — the fixed app bar + safe-area handling that every
 * module screen shares:
 *  - `document.title` follows the module label (Telegram tabs read it);
 *  - the TELEGRAM NATIVE BackButton is owned by the app-level
 *    `TelegramBackButtonController` (single owner — per-page show()/hide()
 *    ping-pong made Telegram drop the show and fall back to the ✕ close
 *    button when navigating module → module);
 *  - the in-page pill only appears where the native back chevron does NOT
 *    exist: plain browsers, or Telegram clients older than Bot API 6.1 (their
 *    SDK stub has no real BackButton — the controller version-gates it away) —
 *    never both.
 */
export function ModuleShell({ title, subtitle, trailing, fill = false, backTo = '/app', children }: ModuleShellProps) {
	const navigate = useNavigate();
	// The native BackButton requires a Bot API 6.1+ client; on older clients the
	// controller never touches it, so THIS page must render the back pill or the
	// screen would have no back affordance at all.
	const wa = useLiveWebApp();
	const nativeBackAvailable = !!wa && versionAtLeast(wa, '6.1');

	useEffect(() => {
		document.title = title;
		return () => {
			document.title = 'MMBIX';
		};
	}, [title]);

	const goBack = () => {
		hapticImpact('soft');
		// A real pop — NEVER a push. The old `navigate(backTo)` grew the session
		// history on every press (each round trip left the sub-page entry AND added
		// a duplicate dashboard entry), so the browser's back button later walked
		// back through stale pages (leave / early-leave) instead of the dashboard.
		// Pop when an entry exists; a cold open falls back to backTo (replace).
		popBack(navigate, backTo);
	};

	return (
		<div className={`launcher-bg flex flex-col ${fill ? 'h-dvh overflow-hidden' : 'min-h-dvh'}`}>
			<div className={`mx-auto flex w-full max-w-md flex-1 flex-col ${fill ? 'min-h-0' : ''}`}>
				<AppHeader
					title={<span className="leading-myanmar">{title}</span>}
					subtitle={subtitle}
					left={
						(!isTelegramApp() || !nativeBackAvailable) && (
							<button type="button" onClick={goBack} className={pill}>
								<ArrowLeft className="size-4" aria-hidden />
								<span className="leading-none">Back</span>
							</button>
						)
					}
					right={trailing}
				/>
				<main className={`flex flex-1 flex-col px-4 py-4 ${fill ? 'min-h-0 overflow-hidden pb-safe' : 'pb-shell'}`}>{children}</main>
			</div>
		</div>
	);
}
