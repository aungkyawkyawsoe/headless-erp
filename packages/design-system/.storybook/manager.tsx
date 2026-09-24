// ── Suppress Storybook v10 internal channel routing noise ──────
// These styled %c messages are not errors — they are logged when the
// channel manager receives events from the docs page but can't trace
// them to a specific story source (cosmetic, Storybook bug).
const _origError = console.error;
console.error = (...args: unknown[]) => {
	const message = typeof args[0] === 'string' ? args[0] : typeof args[0] === 'object' && args[0] instanceof Error ? args[0].message : '';
	if (
		message.includes('unable to determine the source') ||
		message.includes('storyRenderPhaseChanged') ||
		message.includes('storybook/instrumenter')
	) {
		return;
	}
	_origError.apply(console, args);
};

import React, { useEffect, useRef } from 'react';
import { addons, types, useGlobals } from 'storybook/manager-api';
import { Button } from 'storybook/internal/components';
import { create } from 'storybook/theming';
import { Sun, Moon } from 'lucide-react';

const ADDON_ID = 'theme-toggle';
const TOOL_ID = `${ADDON_ID}/tool`;

const lightUI = create({
	base: 'light',
	brandTitle: '🎨 Design System',
	brandUrl: '/',
	brandTarget: '_self',
});

const darkUI = create({
	base: 'dark',
	brandTitle: '🎨 Design System',
	brandUrl: '/',
	brandTarget: '_self',
});

addons.setConfig({ theme: lightUI });

addons.register(ADDON_ID, () => {
	addons.add(TOOL_ID, {
		type: types.TOOL,
		title: 'Toggle theme',
		match: ({ viewMode }) => !!viewMode?.match(/^(story|docs)$/),
		render: () => {
			// Storybook renders this callback as a React component, so the hooks
			// below are called at component top level (the standard addon pattern).
			// eslint-disable-next-line react-hooks/rules-of-hooks
			const [{ theme }, updateGlobals] = useGlobals();
			// eslint-disable-next-line react-hooks/rules-of-hooks
			const prev = useRef<string>('light');

			// eslint-disable-next-line react-hooks/rules-of-hooks
			useEffect(() => {
				const t = (theme as string) ?? 'light';
				if (t !== prev.current) {
					prev.current = t;
					addons.setConfig({ theme: t === 'dark' ? darkUI : lightUI });
				}
			}, [theme]);

			const isDark = theme === 'dark';

			const toggleTheme = () => {
				const next = isDark ? 'light' : 'dark';
				updateGlobals({ theme: next });
			};

			return React.createElement(
				Button,
				{
					variant: 'ghost',
					ariaLabel: false,
					title: isDark ? 'Switch to light theme' : 'Switch to dark theme',
					onClick: toggleTheme,
					key: TOOL_ID,
				},
				React.createElement(isDark ? Sun : Moon, { size: 16 }),
			);
		},
	});
});
