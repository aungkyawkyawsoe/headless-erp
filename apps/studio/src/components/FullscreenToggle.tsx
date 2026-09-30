import { useEffect, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';

/**
 * Fullscreen toggle — same styling as the design-system AppShell's built-in
 * button (maximize/minimize icon, hover accent), placed at the left of the
 * studio shell bar. The DS AppShell does this internally via
 * `showFullscreenToggle`; the Studio renders its own shell, so it gets the
 * equivalent here.
 */
export default function FullscreenToggle() {
	const [isFullscreen, setFullscreen] = useState(() => !!document.fullscreenElement);

	useEffect(() => {
		const onFullscreenChange = () => setFullscreen(!!document.fullscreenElement);
		document.addEventListener('fullscreenchange', onFullscreenChange);
		return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
	}, []);

	function toggle() {
		if (document.fullscreenElement) {
			void document.exitFullscreen();
		} else {
			void document.documentElement.requestFullscreen();
		}
	}

	return (
		<button
			type="button"
			onClick={toggle}
			title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
			aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
			className="flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
		>
			{isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
		</button>
	);
}
