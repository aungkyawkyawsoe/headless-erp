import type { Preview, Decorator } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useGlobals } from 'storybook/preview-api';
// Storybook font loading (not bundled into the library — consumers install their own)
import './fonts.css';

// Import the design system's Tailwind CSS
import '../src/index.css';

// Global Toaster singleton — renders once for all stories so toast
// notifications appear in a single viewport instead of duplicating.
import { Toaster } from '../src/components/toast';

/**
 * Applies `.dark` class to <html> using Storybook's official
 * `useGlobals()` hook — works on both story AND docs pages.
 */
const ThemeDecorator: Decorator = (Story, context) => {
	const [globals] = useGlobals();
	const theme = (globals?.theme as string) ?? 'light';
	const isDark = theme === 'dark';

	document.documentElement.classList.toggle('dark', isDark);

	useEffect(() => {
		document.documentElement.classList.toggle('dark', isDark);

		const docsStories = document.querySelectorAll('.docs-story');
		docsStories.forEach((el) => {
			el.classList.toggle('dark', isDark);
		});
	}, [isDark, context.viewMode]);

	return <Story />;
};

// ── Singleton Toaster ───────────────────────────────────
// Module-level flag: only the first decorator invocation renders
// <Toaster />; subsequent calls are no-ops. This prevents duplicate
// toast viewports when docs mode renders every story inline.
// (Storybook does not use StrictMode, so double-mount is not a concern.)

let toasterRendered = false;

const ToasterDecorator: Decorator = (Story) => {
	const [mounted] = useState(() => {
		if (!toasterRendered) {
			toasterRendered = true;
			return true;
		}
		return false;
	});

	return (
		<>
			<Story />
			{mounted && <Toaster />}
		</>
	);
};

const preview: Preview = {
	globalTypes: {
		theme: {
			name: 'Theme',
			description: 'Component theme (light/dark)',
			defaultValue: 'light',
		},
	},

	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
		a11y: {
			test: 'todo',
		},

		docs: {
			story: { inline: true },
		},

		options: {
			storySort: {
				order: ['Getting Started', 'Guides', 'Foundations', 'Components'],
				method: 'alphabetical',
			},
		},
	},

	decorators: [ThemeDecorator, ToasterDecorator],
};

export default preview;
