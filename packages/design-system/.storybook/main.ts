import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Alias } from 'vite';
import type { StorybookConfig } from '@storybook/react-vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
	stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)', '../src/**/*.mdx'],

	addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],

	framework: '@storybook/react-vite',

	async viteFinal(config) {
		// Mirror the library's resolve aliases so stories keep working even
		// when the project's vite.config.ts is not merged (stale dev servers,
		// custom setups). Duplicate entries are harmless — first match wins.
		const root = path.resolve(__dirname, '..');
		const aliases: Alias[] = [
			{ find: '@/utils', replacement: path.join(root, 'src/lib/utils') },
			{ find: '@/hooks', replacement: path.join(root, 'src/lib/hooks') },
			{ find: '@/types', replacement: path.join(root, 'src/lib/types') },
			{ find: '@/date', replacement: path.join(root, 'src/lib/date') },
			{ find: '@', replacement: path.join(root, 'src/components') },
		];

		// `resolve.alias` can be an array or a `{ [find]: replacement }` map —
		// normalize it to a plain array so we can inspect and extend it.
		const raw = config.resolve?.alias;
		const existing: Alias[] = Array.isArray(raw)
			? [...raw]
			: raw && typeof raw === 'object'
				? Object.entries(raw).map(([find, replacement]) => ({
						find,
						replacement,
					}))
				: [];

		// Only string finds participate in dedupe — regex finds are left as-is.
		const existingFinds = new Set(
			existing.map((entry) => (typeof entry.find === 'string' ? entry.find : null)).filter((find): find is string => find !== null),
		);

		config.resolve ??= {};
		config.resolve.alias = [...existing, ...aliases.filter((entry) => !existingFinds.has(String(entry.find)))];

		return config;
	},
};

export default config;
