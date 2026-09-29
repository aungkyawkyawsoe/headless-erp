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
	/** What `theme` actually is right now — `'system'` already resolved. */
	resolvedTheme: ResolvedTheme;
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

function getSystemThemeSnapshot(): ResolvedTheme {
	if (window.matchMedia(COLOR_SCHEME_QUERY).matches) {
		return 'dark';
	}

	return 'light';
}

function getSystemThemeServerSnapshot(): ResolvedTheme {
	return 'light';
}

/** The OS preference as an external store, so every consumer re-renders on change. */
function subscribeToSystemTheme(callback: () => void) {
	const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY);
	mediaQuery.addEventListener('change', callback);

	return () => {
		mediaQuery.removeEventListener('change', callback);
	};
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

	const systemTheme = React.useSyncExternalStore(
		subscribeToSystemTheme,
		getSystemThemeSnapshot,
		getSystemThemeServerSnapshot,
	);

	// The ONE place `'system'` is resolved: consumers (e.g. an embedded Scalar API
	// reference) read this instead of re-deriving the rule from `matchMedia`.
	const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme;

	const setTheme = React.useCallback(
		(nextTheme: Theme) => {
			localStorage.setItem(storageKey, nextTheme);
			// storage events don't fire in the same tab — notify the store.
			window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
		},
		[storageKey],
	);

	const applyTheme = React.useCallback(
		(nextTheme: ResolvedTheme) => {
			const root = document.documentElement;
			const restoreTransitions = disableTransitionOnChange ? disableTransitionsTemporarily() : null;

			root.classList.remove('light', 'dark');
			root.classList.add(nextTheme);

			if (restoreTransitions) {
				restoreTransitions();
			}
		},
		[disableTransitionOnChange],
	);

	// Depends on the RESOLVED theme: an OS change re-runs this too, which is what the
	// separate media listener used to do.
	React.useEffect(() => {
		applyTheme(resolvedTheme);
	}, [resolvedTheme, applyTheme]);

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

			setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
		};

		window.addEventListener('keydown', handleKeyDown);

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [resolvedTheme, setTheme]);

	const value = React.useMemo(
		() => ({
			theme,
			resolvedTheme,
			setTheme,
		}),
		[theme, resolvedTheme, setTheme],
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
