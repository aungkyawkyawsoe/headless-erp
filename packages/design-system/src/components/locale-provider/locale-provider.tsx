'use client';

import * as React from 'react';

type LocaleProviderProps = {
	children: React.ReactNode;
	/**
	 * Locale used before the user makes a choice (and during SSR). Also used
	 * when nothing is stored. Defaults to `"en"`.
	 */
	defaultLocale?: string;
	/** localStorage key used to persist the locale. Defaults to `"locale"`. */
	storageKey?: string;
};

type LocaleProviderState = {
	locale: string;
	setLocale: (locale: string) => void;
};

/** Fired on window when the locale changes in the current tab. */
const LOCALE_CHANGE_EVENT = 'mmbix:locale-change';

const LocaleProviderContext = React.createContext<LocaleProviderState | undefined>(undefined);

/** Re-render whenever the locale changes: same tab (custom event) or another tab (storage). */
function subscribeToLocaleChanges(callback: () => void) {
	window.addEventListener('storage', callback);
	window.addEventListener(LOCALE_CHANGE_EVENT, callback);

	return () => {
		window.removeEventListener('storage', callback);
		window.removeEventListener(LOCALE_CHANGE_EVENT, callback);
	};
}

export function LocaleProvider({ children, defaultLocale = 'en', storageKey = 'locale', ...props }: LocaleProviderProps) {
	// localStorage is the single source of truth, observed via
	// useSyncExternalStore. During SSR (and hydration's first render) the
	// server snapshot (defaultLocale) is used, so there's no hydration
	// mismatch — the store re-renders the component when the stored locale
	// changes.
	const getSnapshot = React.useCallback((): string => {
		return localStorage.getItem(storageKey) ?? defaultLocale;
	}, [storageKey, defaultLocale]);

	const getServerSnapshot = React.useCallback((): string => defaultLocale, [defaultLocale]);

	const locale = React.useSyncExternalStore(subscribeToLocaleChanges, getSnapshot, getServerSnapshot);

	const setLocale = React.useCallback(
		(nextLocale: string) => {
			localStorage.setItem(storageKey, nextLocale);
			// storage events don't fire in the same tab — notify the store.
			window.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT));
		},
		[storageKey],
	);

	React.useEffect(() => {
		document.documentElement.lang = locale;
	}, [locale]);

	const value = React.useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

	return (
		<LocaleProviderContext.Provider {...props} value={value}>
			{children}
		</LocaleProviderContext.Provider>
	);
}

export const useLocale = () => {
	const context = React.useContext(LocaleProviderContext);

	if (context === undefined) {
		throw new Error('useLocale must be used within a LocaleProvider');
	}

	return context;
};
