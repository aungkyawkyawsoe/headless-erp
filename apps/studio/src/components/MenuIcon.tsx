import type { CSSProperties } from 'react';
import { FolderOpen, Link2 } from 'lucide-react';
import { APP_ICONS } from '../lib/icons';
import { LucideGlyph } from '@mmbix/ui-views';

/**
 * Renders a menu item's icon anywhere in the studio.
 * - Stored icon (e.g. "building-2") → local lucide component if known, else the
 *   CDN glyph (any of the 1756 lucide icons).
 * - No icon → folder for groups, link glyph for links.
 */
export default function MenuIcon({
	name,
	type,
	size = 14,
	style,
}: {
	name?: string | null;
	type: string;
	size?: number;
	style?: CSSProperties;
}) {
	const clean = (name ?? '').replace(/^lucide:/, '');
	const Local = clean ? APP_ICONS[clean] : null;
	if (Local) return <Local size={size} style={style} />;
	if (clean) return <LucideGlyph name={clean} size={size} style={style} />;
	const Fallback = type === 'group' ? FolderOpen : Link2;
	return <Fallback size={size} style={style} />;
}
