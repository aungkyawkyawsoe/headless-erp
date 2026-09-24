/**
 * i18n — the pure lookup + the React binding.
 *
 * The backend serves a nested bundle (`module → namespace → key → string`) from
 * `/api/translations`. We FLATTEN it to dotted keys once so a screen can call
 * `t('studio.shell.theme', 'Theme')` — a missing key falls back to the literal,
 * so an untranslated string renders English rather than a raw key.
 *
 * `interpolate` supports `{name}` placeholders. Pure, so both are testable
 * without a DOM.
 */
import { useQuery } from '@tanstack/react-query';
import { getTranslations, type TranslationBundle } from './api';

export function flattenTranslations(bundle: TranslationBundle | null | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!bundle || typeof bundle !== 'object') return out;
	for (const [mod, namespaces] of Object.entries(bundle)) {
		if (!namespaces || typeof namespaces !== 'object') continue;
		for (const [ns, keys] of Object.entries(namespaces)) {
			if (!keys || typeof keys !== 'object') continue;
			for (const [key, value] of Object.entries(keys)) {
				if (typeof value === 'string') out[`${mod}.${ns}.${key}`] = value;
			}
		}
	}
	return out;
}

export function interpolate(template: string, vars?: Record<string, string | number>): string {
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** Look up `key` (dotted) in a flat dictionary; fall back to `fallback`/`key`. */
export function translate(dict: Record<string, string>, key: string, fallback?: string, vars?: Record<string, string | number>): string {
	return interpolate(dict[key] ?? fallback ?? key, vars);
}

/** Load a language bundle and return a `t()` bound to it. */
export function useTranslation(token: string, lang = 'en', module?: string) {
	const { data } = useQuery({
		queryKey: ['translations', lang, module ?? 'all'],
		queryFn: () => getTranslations(token, lang, module),
		enabled: !!token,
		staleTime: 5 * 60_000,
	});
	const dict = flattenTranslations(data?.translations);
	return {
		dict,
		t: (key: string, fallback?: string, vars?: Record<string, string | number>) => translate(dict, key, fallback, vars),
	};
}
