/**
 * Tenant theme (white-label) — apply a deployment's effective design tokens as
 * CSS custom properties on `:root`.
 *
 * The tokens are a flat `{ key: value }` map edited in the Studio (Design Tokens
 * tab); applying them as CSS variables lets one deployment rebrand the whole
 * console without a code change. The mapping is pure so it is testable without a
 * DOM; the apply step is a thin `setProperty` loop.
 *
 * A key that already looks like a custom property (`--x`) is used verbatim; a
 * bare key (`primary`) becomes `--primary`. Blank keys/values are dropped — a
 * malformed token must never blank a live variable.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getEffectiveTokens } from './api';

export function tokensToCssVars(tokens: Record<string, unknown> | null | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!tokens || typeof tokens !== 'object') return out;
	for (const [rawKey, rawValue] of Object.entries(tokens)) {
		const key = String(rawKey).trim();
		if (!key || typeof rawValue !== 'string' || !rawValue.trim()) continue;
		out[key.startsWith('--') ? key : `--${key}`] = rawValue.trim();
	}
	return out;
}

export function applyCssVars(
	vars: Record<string, string>,
	root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null,
): void {
	if (!root) return;
	for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}

/** Read + apply the deployment's effective tokens once (and on refetch). */
export function useTenantTheme(token: string, app?: string): void {
	const { data } = useQuery({
		queryKey: ['tenant-theme', app ?? 'global'],
		queryFn: () => getEffectiveTokens(token, app),
		enabled: !!token,
		staleTime: 5 * 60_000,
	});
	useEffect(() => {
		if (data) applyCssVars(tokensToCssVars(data.tokens));
	}, [data]);
}
