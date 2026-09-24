import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, esmExternalRequirePlugin } from 'vite';
import dts from 'vite-plugin-dts';

// Packages externalized from the library bundle. Consumers install these
// themselves (they're declared in dependencies/peerDependencies) and their
// bundler tree-shakes only the parts actually used.
const HEAVY_EXTERNALS = new Set([
	'@tanstack/react-table',
	'@dnd-kit/core',
	'@dnd-kit/sortable',
	'@dnd-kit/utilities',
	'cmdk',
	'embla-carousel-react',
	'lucide-react',
]);

const entry = {
	// Core bundle — light/medium components only (no heavy deps).
	index: path.resolve(import.meta.dirname, 'src/index.ts'),
	// Heavy components — opt-in via subpath imports so edge bundles stay lean.
	datatable: path.resolve(import.meta.dirname, 'src/components/datatable/index.tsx'),
	kanban: path.resolve(import.meta.dirname, 'src/components/kanban/index.tsx'),
	scheduler: path.resolve(import.meta.dirname, 'src/components/scheduler/index.tsx'),
	datepicker: path.resolve(import.meta.dirname, 'src/components/datepicker/index.tsx'),
	calendar: path.resolve(import.meta.dirname, 'src/components/calendar/index.tsx'),
	command: path.resolve(import.meta.dirname, 'src/components/command/index.tsx'),
	carousel: path.resolve(import.meta.dirname, 'src/components/carousel/index.tsx'),
	pivot: path.resolve(import.meta.dirname, 'src/components/pivot/index.tsx'),
	// Light components also get subpath entries. They are re-exported by the core
	// bundle too, but a lean consumer (e.g. the Telegram Mini App) can import the
	// exact subpaths it uses and never touch the core barrel — which otherwise
	// drags in every other component (form, media-panel, menubar, …) plus their
	// @base-ui modules. Purely additive: the barrel keeps working unchanged.
	avatar: path.resolve(import.meta.dirname, 'src/components/avatar/index.tsx'),
	badge: path.resolve(import.meta.dirname, 'src/components/badge/index.tsx'),
	button: path.resolve(import.meta.dirname, 'src/components/button/index.tsx'),
	dialog: path.resolve(import.meta.dirname, 'src/components/dialog/index.tsx'),
	'dropdown-menu': path.resolve(import.meta.dirname, 'src/components/dropdown-menu/index.tsx'),
	field: path.resolve(import.meta.dirname, 'src/components/field/index.tsx'),
	input: path.resolve(import.meta.dirname, 'src/components/input/index.tsx'),
	'radio-group': path.resolve(import.meta.dirname, 'src/components/radio-group/index.tsx'),
	'scroll-area': path.resolve(import.meta.dirname, 'src/components/scroll-area/index.tsx'),
	'search-box': path.resolve(import.meta.dirname, 'src/components/search-box/index.tsx'),
	select: path.resolve(import.meta.dirname, 'src/components/select/index.tsx'),
	sheet: path.resolve(import.meta.dirname, 'src/components/sheet/index.tsx'),
	textarea: path.resolve(import.meta.dirname, 'src/components/textarea/index.tsx'),
	toast: path.resolve(import.meta.dirname, 'src/components/toast/index.tsx'),
	'toggle-group': path.resolve(import.meta.dirname, 'src/components/toggle-group/index.tsx'),
	// Rich-text editor — opt-in via subpath so mobile bundles stay lean.
	'rich-text-editor': path.resolve(import.meta.dirname, 'src/components/rich-text-editor/index.tsx'),
	// Code widgets — opt-in via `@mmbix/design-system/widgets` so the heavy
	// Scheduler widget stays out of the core bundle (subpath-only invariant).
	widgets: path.resolve(import.meta.dirname, 'src/components/widgets/index.ts'),
};

export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		// Convert CJS `require()` of externalized React in inlined CJS deps
		// (e.g. `use-sync-external-store` pulled in via @base-ui/utils) into
		// ESM `import`s. Without this, Rolldown leaves the raw `require` in a
		// browser-targeted bundle and it throws at runtime. React must NOT also
		// appear in rollupOptions.external below — the plugin owns it. See
		// https://rolldown.rs/builtin-plugins/esm-external-require
		esmExternalRequirePlugin({
			external: ['react', 'react-dom', 'react/jsx-runtime'],
		}),
		dts({
			tsconfigPath: path.resolve(import.meta.dirname, './tsconfig.dts.json'),
			outDirs: ['dist'],
			include: ['src'],
			exclude: ['src/**/*.css', 'src/**/*.stories.*'],
		}),
	],

	// Longest-prefix alias so library imports keep working after the
	// src/components + src/lib split:
	//   @/utils → src/lib/utils, @/hooks → src/lib/hooks, @/types → src/lib/types
	//   @/button (any component) → src/components/button
	resolve: {
		alias: [
			{
				find: '@/utils',
				replacement: path.resolve(import.meta.dirname, './src/lib/utils'),
			},
			{
				find: '@/hooks',
				replacement: path.resolve(import.meta.dirname, './src/lib/hooks'),
			},
			{
				find: '@/types',
				replacement: path.resolve(import.meta.dirname, './src/lib/types'),
			},
			{
				find: '@/date',
				replacement: path.resolve(import.meta.dirname, './src/lib/date'),
			},
			{
				find: '@',
				replacement: path.resolve(import.meta.dirname, './src/components'),
			},
		],
	},

	build: {
		lib: {
			entry,
			formats: ['es'],
			fileName: (_format, entryName) => `${entryName}.js`,
		},
		rollupOptions: {
			external: (id) => {
				// NOTE: react / react-dom / react/jsx-runtime are deliberately NOT
				// externalized here — the esmExternalRequirePlugin above owns them
				// (they must never be in both places) and rewrites the internal
				// `require()` calls that reference them into ESM imports.
				if (id === 'class-variance-authority' || id === 'clsx' || id === 'tailwind-merge') {
					return true;
				}
				// Base UI is a primitive library — externalize so consumers share it.
				if (id.startsWith('@base-ui/react')) {
					return true;
				}
				// Primitives declared in `dependencies`: externalize so consumers
				// share a single instance — avoids duplicate React contexts when the
				// CLI also installs them as direct consumer dependencies.
				if (id === 'input-otp' || id === 'react-resizable-panels') {
					return true;
				}
				if (HEAVY_EXTERNALS.has(id)) {
					return true;
				}
				return false;
			},
		},
		cssCodeSplit: false,
	},
});
