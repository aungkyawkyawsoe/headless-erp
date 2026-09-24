// @ts-check
/**
 * Monorepo ESLint — one shared flat config for every package. Covers src AND
 * test files, so lint-staged never emits "File ignored" for a staged .ts file.
 *
 * Rules split:
 *   - src: full hygiene (prettier, unused-vars, no-explicit-any warn, hooks)
 *   - test/__tests__: same, but no-explicit-any is OFF — tests legitimately
 *     poke at internals / assert with `any`; keeping it off avoids hundreds of
 *     noise sites in existing spec files. Unused vars and formatting still
 *     enforce.
 */
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import eslintPluginPrettier from 'eslint-plugin-prettier';
import eslintPluginReactHooks from 'eslint-plugin-react-hooks';

const BASE_RULES = {
	'prettier/prettier': [
		'error',
		{
			printWidth: 140,
			singleQuote: true,
			semi: true,
			useTabs: true,
		},
	],
	'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
	'prefer-const': 'error',
	'no-var': 'error',
	// React hooks hygiene — catches real bugs (rules-of-hooks is an error; the
	// deps lint is a warning so exhaustive-deps noise never blocks a build).
	'react-hooks/rules-of-hooks': 'error',
	'react-hooks/exhaustive-deps': 'warn',
};

const TS_PLUGINS = {
	'@typescript-eslint': tseslint,
	prettier: eslintPluginPrettier,
	'react-hooks': eslintPluginReactHooks,
};

export default [
	{
		ignores: [
			'**/node_modules/**',
			'**/dist/**',
			'**/.wrangler/**',
			'**/.turbo/**',
			// Built CLI bundles (bin/*.js) — bin/*.ts sources ARE linted
			'**/bin/**/*.js',
			'**/coverage/**',
			'**/storybook-static/**',
			'**/worker-configuration.d.ts',
			// Generated artifacts
			'packages/design-system/src/components/widgets/index.ts',
			'apps/tgapp/src/generated/**',
		],
	},
	{
		files: ['**/src/**/*.{ts,tsx}', '**/bin/**/*.{ts,tsx}'],
		languageOptions: { parser: tsparser, parserOptions: { ecmaVersion: 2024, sourceType: 'module' } },
		plugins: TS_PLUGINS,
		rules: {
			...BASE_RULES,
			'@typescript-eslint/no-explicit-any': 'warn',
		},
	},
	{
		// Tests: same rules minus no-explicit-any (assertions poke at internals).
		files: ['**/test/**/*.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
		languageOptions: { parser: tsparser, parserOptions: { ecmaVersion: 2024, sourceType: 'module' } },
		plugins: TS_PLUGINS,
		rules: BASE_RULES,
	},
	{
		// Build/tooling configs (vite.config.ts, vitest.config.mts, build scripts) —
		// full src hygiene, so lint-staged never emits 'File ignored' for a staged
		// config (.mts/.cts included — vitest.config.mts is a common case).
		files: ['**/*.config.{ts,tsx,mts,cts}', '**/build.{ts,tsx,mts,cts}'],
		languageOptions: { parser: tsparser, parserOptions: { ecmaVersion: 2024, sourceType: 'module' } },
		plugins: TS_PLUGINS,
		rules: { ...BASE_RULES, '@typescript-eslint/no-explicit-any': 'warn' },
	},
	{
		// tgapp module screens — forbid re-implementing the shared primitives.
		//
		// The biggest consistency defects came from copy-paste: ~10 modules
		// hand-rolled the search kiosk (`searchPill` + a suggestions state machine)
		// instead of using the shared `<SearchKiosk>`, and a list page re-declared
		// its own `EmptyState`. Both are now errors so the drift cannot return; a
		// genuine exception must carry an `eslint-disable-next-line` with a reason.
		files: ['apps/tgapp/src/modules/**/*.{ts,tsx}'],
		languageOptions: { parser: tsparser, parserOptions: { ecmaVersion: 2024, sourceType: 'module' } },
		plugins: TS_PLUGINS,
		rules: {
			...BASE_RULES,
			'@typescript-eslint/no-explicit-any': 'warn',
			'no-restricted-syntax': [
				'error',
				{
					selector: "VariableDeclarator[id.name='searchPill'], FunctionDeclaration[id.name='searchPill']",
					message:
						'Hand-rolled search kiosk — use the shared <SearchKiosk> (shared/components/search-kiosk.tsx) instead of a local searchPill.',
				},
				{
					selector: "FunctionDeclaration[id.name='EmptyState'], FunctionDeclaration[id.name='FilteredEmptyState']",
					message:
						'Use the shared EmptyState / FilteredEmptyState (shared/components/empty-state.tsx) instead of a local copy.',
				},
				{
					// The card frame literal — the SSOT is CARD_FRAME / DENSE_CARD_FRAME
					// (shared/components/card.tsx). The negative lookahead allows the
					// intentionally-different translucent surfaces (`bg-card/50`…).
					selector: 'Literal[value=/rounded-(2xl|xl) border border-border bg-card(?!\\/)/]',
					message:
						'Card frame literal — use CARD_FRAME (rounded-2xl) or DENSE_CARD_FRAME (rounded-xl) from shared/components/card.tsx.',
				},
			],
		},
	},
	{
		// Storybook stories legitimately call hooks inside lowercase `render`/`Template`
		// functions (the pattern Storybook itself documents) — exempt them.
		files: ['**/*.stories.tsx'],
		rules: {
			'react-hooks/rules-of-hooks': 'off',
		},
	},
];
