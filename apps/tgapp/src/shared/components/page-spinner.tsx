/**
 * The app's loading spinner — ONE ring for every full-screen / panel boot state.
 *
 * Previously the same three utility classes were copied into the route fallback,
 * the auth gate and the launcher's own boot states. `SpinnerGlyph` is the ring
 * alone (for a caller that owns its wrapper); `PageSpinner` is the full-screen
 * surface for the boot screens.
 */

/** The spinner ring — size via `className` (defaults to the boot size). `tone`
 *  `inverse` is the white ring for a dark/gradient surface (launcher tiles). */
export function SpinnerGlyph({ className = 'h-8 w-8', tone = 'default' }: { className?: string; tone?: 'default' | 'inverse' }) {
	const colors = tone === 'inverse' ? 'border-white/35 border-t-white' : 'border-muted border-t-primary';
	return <div aria-hidden className={`${className} animate-spin rounded-full border-2 ${colors}`} />;
}

/** A full-screen loading surface on the launcher background. */
export function PageSpinner() {
	return (
		<div className="launcher-bg flex min-h-dvh items-center justify-center">
			<SpinnerGlyph />
		</div>
	);
}
