import { useEffect } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { getAppByPath } from './registry';
import { AppHeader } from '@/shared/components/app-header';
import { hapticImpact } from '@/shared/platform/haptics';
import { popBack } from '@/shared/platform/history';
import { isTelegramApp } from '@/shared/platform/telegram';

const pill =
	'flex items-center rounded-full bg-card/95 px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Per-app placeholder page (`/app/:appId`) — shown until the app gets its own
 * real screen. Renders the app's tile + label; the Telegram native back
 * affordance is owned by the app-level `TelegramBackButtonController`.
 *
 * The fixed app bar shows the MODULE's label (the launcher home keeps the
 * default "MMBIX") — the title changes per module, `document.title` follows.
 */
export default function AppPlaceholderPage() {
	const { appId } = useParams<{ appId: string }>();
	const navigate = useNavigate();
	const app = appId ? getAppByPath(appId) : undefined;

	// Keep the document title in step with the module label (Telegram
	// Desktop/tablet tabs and history entries read it); restore on leave.
	useEffect(() => {
		if (!app) return;
		document.title = app.label;
		return () => {
			document.title = 'MMBIX';
		};
	}, [app]);

	if (!app) return <Navigate to="/app" replace />;

	const Icon = app.icon;
	const goHome = () => {
		hapticImpact('soft');
		// Same pop-not-push rule as ModuleShell's Back pill — a push here would
		// leave the placeholder beneath the launcher and back would return to it.
		popBack(navigate, '/app');
	};

	return (
		<div className="launcher-bg flex min-h-dvh flex-col">
			<div className="mx-auto flex w-full max-w-md flex-1 flex-col">
				{/* Fixed app bar — title = THIS module's label (home keeps "MMBIX").
				 *  In Telegram the native BackButton (shown below) IS the back
				 *  affordance — an in-app pill would duplicate it. Browsers get
				 *  the pill in the header's left slot (no native back control). */}
				<AppHeader
					title={<span className="leading-myanmar">{app.label}</span>}
					left={
						!isTelegramApp() && (
							<button type="button" onClick={goHome} className={pill}>
								<ArrowLeft className="size-4" aria-hidden />
								<span className="leading-none">Back</span>
							</button>
						)
					}
				/>
				<main className="flex flex-1 flex-col items-center justify-center gap-5 pb-24 text-center">
					<span
						className={`${app.gradient} flex size-24 items-center justify-center rounded-4xl bg-linear-to-br text-white shadow-lg shadow-black/20`}
					>
						<Icon className="size-11" strokeWidth={1.8} aria-hidden />
					</span>
					<div>
						<h1 className="text-xl font-bold leading-myanmar">{app.label}</h1>
						<p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">{app.id}</p>
					</div>
					<p className="max-w-[16rem] text-sm leading-myanmar text-muted-foreground">This app's screen is coming soon.</p>
				</main>
			</div>
		</div>
	);
}
