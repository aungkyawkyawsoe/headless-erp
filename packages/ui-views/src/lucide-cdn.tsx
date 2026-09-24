import { Box } from 'lucide-react';

/**
 * Lucide icon library — shared by the Studio icon picker and glyph renderers.
 *
 * NOTE: the runtime CDN fetch (unpkg icon-nodes.json, ~1MB) was REMOVED —
 * the runtime SPA must never pull an icon library from a third-party CDN.
 * Consumers (Studio AppIcon/MenuIcon/IconPicker and the runtime GroupIcon)
 * already fall back to their local curated icon maps when `nodes` is null,
 * so rendering keeps working everywhere without a network round-trip.
 *
 * The exported API is unchanged: `loadLucideNodes` resolves immediately
 * (with no data), `useLucideNodes` reports no data, and `LucideGlyph`
 * renders a generic Box glyph for any name.
 */

type IconNodes = Record<string, unknown>;

/** Resolve (immediately, no network) the icon-node map. Kept for API
 *  compatibility with existing consumers (Studio picker) — always empty. */
export function loadLucideNodes(): Promise<IconNodes | null> {
	return Promise.resolve(null);
}

/** Subscribe to the icon library — reports no data (no CDN fetch anymore). */
export function useLucideNodes(): { nodes: IconNodes | null; error: string | null } {
	return { nodes: null, error: null };
}

/** Render any lucide icon (no node data is loaded — generic Box glyph). */
export function LucideGlyph({ name, size = 24, style }: { name: string; size?: number; style?: React.CSSProperties }) {
	void name;
	return <Box size={size} style={style} />;
}
