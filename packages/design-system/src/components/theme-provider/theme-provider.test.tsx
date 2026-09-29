import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider, useTheme } from './theme-provider';

// `vitest.setup.ts` stubs matchMedia with a fixed `matches: false` and no-op listeners.
// These tests need a controllable OS preference whose listeners actually fire, so they
// install their own stub and restore the shared one afterwards.
const originalMatchMedia = window.matchMedia;

function installSystemPreference(initiallyDark: boolean) {
	let dark = initiallyDark;
	const listeners = new Set<() => void>();

	window.matchMedia = ((query: string) =>
		({
			get matches() {
				return dark;
			},
			media: query,
			onchange: null,
			addEventListener: (_type: string, listener: () => void) => {
				listeners.add(listener);
			},
			removeEventListener: (_type: string, listener: () => void) => {
				listeners.delete(listener);
			},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false,
		}) as unknown as MediaQueryList) as typeof window.matchMedia;

	return {
		listenerCount: () => listeners.size,
		flip(next: boolean) {
			dark = next;
			act(() => {
				for (const listener of listeners) {
					listener();
				}
			});
		},
	};
}

function Probe() {
	const { theme, resolvedTheme } = useTheme();

	return <span>{`${theme}/${resolvedTheme}`}</span>;
}

function renderProbe(defaultTheme: 'dark' | 'light' | 'system') {
	return render(
		<ThemeProvider defaultTheme={defaultTheme}>
			<Probe />
		</ThemeProvider>,
	);
}

beforeEach(() => {
	localStorage.clear();
	document.documentElement.className = '';
});

afterEach(() => {
	window.matchMedia = originalMatchMedia;
	document.documentElement.className = '';
	localStorage.clear();
});

describe('ThemeProvider resolvedTheme', () => {
	it('resolves an explicit dark theme to dark', () => {
		renderProbe('dark');

		expect(screen.getByText('dark/dark')).toBeTruthy();
	});

	it('resolves an explicit light theme to light', () => {
		renderProbe('light');

		expect(screen.getByText('light/light')).toBeTruthy();
	});

	it('follows the OS when the theme is system', () => {
		installSystemPreference(true);
		renderProbe('system');

		expect(screen.getByText('system/dark')).toBeTruthy();
	});

	it('follows a light OS when the theme is system', () => {
		installSystemPreference(false);
		renderProbe('system');

		expect(screen.getByText('system/light')).toBeTruthy();
	});

	it('re-renders when the OS preference changes under system', () => {
		const system = installSystemPreference(true);
		renderProbe('system');

		expect(screen.getByText('system/dark')).toBeTruthy();

		system.flip(false);

		expect(screen.getByText('system/light')).toBeTruthy();
	});

	it('ignores the OS while the theme is explicit', () => {
		const system = installSystemPreference(true);
		renderProbe('light');

		system.flip(true);

		expect(screen.getByText('light/light')).toBeTruthy();
	});

	it('flips from the RESOLVED value on the d shortcut, not from system', () => {
		const system = installSystemPreference(true);
		renderProbe('system');
		expect(localStorage.getItem('theme')).toBeNull();

		fireEvent.keyDown(window, { key: 'd' });

		// system + dark OS → the next theme is light, never the literal 'dark'.
		expect(localStorage.getItem('theme')).toBe('light');
		expect(screen.getByText('light/light')).toBeTruthy();

		fireEvent.keyDown(window, { key: 'd' });

		expect(localStorage.getItem('theme')).toBe('dark');
		expect(screen.getByText('dark/dark')).toBeTruthy();

		// The explicit theme now wins over the OS.
		system.flip(true);

		expect(screen.getByText('dark/dark')).toBeTruthy();
	});

	it('puts the resolved theme on <html> and follows an OS change there too', () => {
		const system = installSystemPreference(true);
		renderProbe('system');

		expect(document.documentElement.classList.contains('dark')).toBe(true);
		expect(document.documentElement.classList.contains('light')).toBe(false);

		system.flip(false);

		expect(document.documentElement.classList.contains('light')).toBe(true);
		expect(document.documentElement.classList.contains('dark')).toBe(false);
	});

	it('unsubscribes from the OS preference on unmount', () => {
		const system = installSystemPreference(true);
		const { unmount } = renderProbe('system');

		expect(system.listenerCount()).toBe(1);

		unmount();

		expect(system.listenerCount()).toBe(0);
	});
});
