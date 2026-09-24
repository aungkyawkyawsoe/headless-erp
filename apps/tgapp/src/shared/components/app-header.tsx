import type { ReactNode } from 'react';

interface AppHeaderProps {
	/** Centered title — "MMBIX" on the launcher, the module label on detail pages. */
	title: ReactNode;
	/** Optional second line under the title (e.g. the attendance workspace's
	 *  "Enterprise Workspace"). Absent ⇒ the classic single-line bar. */
	subtitle?: string;
	/** Left control (browser only — inside Telegram the native chrome owns it). */
	left?: ReactNode;
	/** Right controls (browser only). */
	right?: ReactNode;
}

/**
 * Fixed top app bar — the BotFather-style centered title that stays pinned
 * while content scrolls, on every phone screen.
 *
 * The safe-area clearance (`pt-tg`: device notch / Telegram fullscreen native
 * header strip) lives HERE and ONLY here — every screen renders this bar as
 * its first element, so the top padding is identical app-wide. `app-header-bg`
 * is on the <header> ITSELF (not the inner row) so the translucent tint +
 * backdrop blur ALSO paint across the `pt-tg` padding strip — otherwise that
 * strip stays transparent and scrolled content bleeds through the gap between
 * the screen top and the bar (both Android and iOS).
 *
 * Inside Telegram the native header (✕ close, ⋮ menu, back chevron) sits in
 * the strip above — rendering in-app duplicates would clash, so the left/right
 * slots are for plain browsers (dev/external) only.
 */
export function AppHeader({ title, subtitle, left, right }: AppHeaderProps) {
	return (
		<header className="sticky top-0 z-30 app-header-bg pt-tg">
			<div className={`relative flex items-center justify-center ${subtitle ? 'h-14' : 'h-12'}`}>
				{left ? <div className="absolute left-3 flex items-center">{left}</div> : null}
				{subtitle ? (
					<div className="flex min-w-0 flex-col items-center px-2">
						<h1 className="max-w-full truncate text-base font-semibold leading-tight tracking-wide">{title}</h1>
						<span className="max-w-full truncate text-meta font-medium leading-tight text-muted-foreground">{subtitle}</span>
					</div>
				) : (
					<h1 className="truncate text-base font-semibold tracking-wide">{title}</h1>
				)}
				{right ? <div className="absolute right-3 flex items-center">{right}</div> : null}
			</div>
		</header>
	);
}
