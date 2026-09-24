import type { CSSProperties } from 'react';
import { APP_ICONS } from '../lib/icons';
import { LucideGlyph } from '@mmbix/ui-views';

// NOTE: keep this file imported extensionless so vite resolves lucide-cdn.tsx.
/** Renders an app's stored icon ("lucide:<name>" or "<name>") anywhere in the studio. */
export default function AppIcon({ name, size = 24, style }: { name?: string | null; size?: number; style?: CSSProperties }) {
	const clean = (name ?? 'box').replace(/^lucide:/, '');
	const Local = APP_ICONS[clean];
	if (Local) return <Local size={size} style={style} />;
	return <LucideGlyph name={clean} size={size} style={style} />;
}
