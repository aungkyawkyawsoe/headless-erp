import { Moon, Sun } from 'lucide-react';
import { Button, useTheme } from '@mmbix/design-system';

/**
 * Single-icon light/dark toggle for the studio's thin bottom toolbar — ONE
 * icon (the mode you will switch TO), one click. The resolved theme is read
 * from the `ThemeProvider`; 'system' resolves against the OS so the icon always
 * shows the mode actually on screen. Stored theme stays whatever the user last
 * picked (light/dark/system all preserved).
 */
export default function ThemeToggle() {
	const { theme, setTheme } = useTheme();
	// Resolve 'system' to the OS preference so the icon matches the screen.
	const isDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
	const resolvedDark = theme === 'dark' || (theme === 'system' && isDark);
	const next = resolvedDark ? 'light' : 'dark';

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			aria-label={`Switch to ${next} mode`}
			title={next === 'dark' ? 'Switch to dark mode' : 'Switch to light mode'}
			onClick={() => setTheme(next)}
		>
			{resolvedDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
		</Button>
	);
}