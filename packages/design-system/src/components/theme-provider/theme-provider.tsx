'use client';

import * as React from 'react';

type Theme = 'dark' | 'light' | 'system';
type ResolvedTheme = 'dark' | 'light';

type ThemeProviderProps = {
	children: React.ReactNode;
	defaultTheme?: Theme;
	storageKey?: string;
	disableTransitionOnChange?: boolean;
};

type ThemeProviderState = {
	theme: Theme;
	setTheme: (theme: Theme) => void;
};

const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';
const THEME_VALUES: Theme[] = ['dark', 'light', 'system'];

/** Fired on window when the theme changes in the current tab. */
const THEME_CHANGE_EVENT = 'mmbix:theme-change';

const ThemeProviderContext = React.createContext<ThemeProviderState | undefined>(undefined);

function isTheme(value: string | null): value is Theme {
	if (value === null) {
		return false;
	}

	return THEME_VALUES.includes(value as Theme);
}

function getSystemTheme(): ResolvedTheme {
	if (window.matchMedia(COLOR_SCHEME_QUERY).matches) {
		return 'dark';
	}

	return 'light';
}

function disableTransitionsTemporarily() {
	const style = document.createElement('style');
	style.appendChild(document.createTextNode('*,*::before,*::after{-webkit-transition:none!important;transition:none!important}'));
	document.head.appendChild(style);

	return () => {
		window.getComputedStyle(document.body);
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				style.remove();
			});
		});
	};
}

function isEditableTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	if (target.isContentEditable) {
		return true;
	}

	const editableParent = target.closest("input, textarea, select, [contenteditable='true']");
	if (editableParent) {
		return true;
	}

	return false;
}

/** Re-render whenever the theme changes: same tab (custom event) or another tab (storage). */
function subscribeToThemeChanges(callback: () => void) {
	window.addEventListener('storage', callback);
	window.addEventListener(THEME_CHANGE_EVENT, callback);

	return () => {
		window.removeEventListener('storage', callback);
		window.removeEventListener(THEME_CHANGE_EVENT, callback);
	};
}

export function ThemeProvider({
	children,
	defaultTheme = 'system',
	storageKey = 'theme',
	disableTransitionOnChange = true,
	...props
}: ThemeProviderProps) {
	// localStorage is the single source of truth, observed via
	// useSyncExternalStore. During SSR (and hydration's first render) the
	// server snapshot (defaultTheme) is used, so there's no hydration
	// mismatch and no setState-in-effect — the store re-renders the
	// component when the stored theme changes.
	const getSnapshot = React.useCallback((): Theme => {
		const storedTheme = localStorage.getItem(storageKey);
		return isTheme(storedTheme) ? storedTheme : defaultTheme;
	}, [storageKey, defaultTheme]);

	const getServerSnapshot = React.useCallback((): Theme => defaultTheme, [defaultTheme]);

	const theme = React.useSyncExternalStore(subscribeToThemeChanges, getSnapshot, getServerSnapshot);

	const setTheme = React.useCallback(
		(nextTheme: Theme) => {
			localStorage.setItem(storageKey, nextTheme);
			// storage events don't fire in the same tab — notify the store.
			window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
		},
		[storageKey],
	);

	const applyTheme = React.useCallback(
		(nextTheme: Theme) => {
			const root = document.documentElement;
			const resolvedTheme = nextTheme === 'system' ? getSystemTheme() : nextTheme;
			const restoreTransitions = disableTransitionOnChange ? disableTransitionsTemporarily() : null;

			root.classList.remove('light', 'dark');
			root.classList.add(resolvedTheme);

			if (restoreTransitions) {
				restoreTransitions();
			}
		},
		[disableTransitionOnChange],
	);

	React.useEffect(() => {
		applyTheme(theme);

		if (theme !== 'system') {
			return undefined;
		}

		const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY);
		const handleChange = () => {
			applyTheme('system');
		};

		mediaQuery.addEventListener('change', handleChange);

		return () => {
			mediaQuery.removeEventListener('change', handleChange);
		};
	}, [theme, applyTheme]);

	React.useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.repeat) {
				return;
			}

			if (event.metaKey || event.ctrlKey || event.altKey) {
				return;
			}

			if (isEditableTarget(event.target)) {
				return;
			}

			if (event.key.toLowerCase() !== 'd') {
				return;
			}

			const resolvedTheme = theme === 'system' ? getSystemTheme() : theme;
			setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
		};

		window.addEventListener('keydown', handleKeyDown);

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [theme, setTheme]);

	const value = React.useMemo(
		() => ({
			theme,
			setTheme,
		}),
		[theme, setTheme],
	);

	return (
		<ThemeProviderContext.Provider {...props} value={value}>
			{children}
		</ThemeProviderContext.Provider>
	);
}

export const useTheme = () => {
	const context = React.useContext(ThemeProviderContext);

	if (context === undefined) {
		throw new Error('useTheme must be used within a ThemeProvider');
	}

	return context;
};
