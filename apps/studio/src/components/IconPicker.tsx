import { useState } from 'react';
import { SearchBox } from '@mmbix/design-system';
import { Box } from 'lucide-react';
import { useLucideNodes, LucideGlyph } from '@mmbix/ui-views';
import { APP_ICONS, ICON_OPTIONS } from '../lib/icons';

// Icon library comes from the CDN (see lib/lucide-cdn.tsx).

/** One icon button — uses the built-in map when available, otherwise the CDN glyph. */
function IconCell({ name, active, onClick }: { name: string; active: boolean; onClick: () => void }) {
	const { nodes } = useLucideNodes();
	const Local = APP_ICONS[name];
	return (
		<button
			type="button"
			title={name}
			onClick={onClick}
			style={{
				aspectRatio: '1',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				borderRadius: 6,
				cursor: 'pointer',
				background: active ? 'var(--mmbix-primary, #0f766e)' : 'var(--mmbix-muted, #f3f4f6)',
				color: active ? 'var(--mmbix-primary-foreground, #ffffff)' : '#6b7280',
				border: active ? '1px solid var(--mmbix-primary, #0f766e)' : '1px solid transparent',
			}}
		>
			{Local ? <Local size={16} /> : nodes?.[name] ? <LucideGlyph name={name} size={16} /> : <Box size={16} />}
		</button>
	);
}

/**
 * Icon picker for the New App dialog — loads the full lucide library from the
 * CDN (icon-nodes.json). While the library loads (or on failure) it falls back
 * to the small built-in set so the dialog stays usable.
 */
export default function IconPicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
	const { nodes, error } = useLucideNodes();
	const [query, setQuery] = useState('');

	const ready = !!nodes;
	const allNames: string[] = ready ? Object.keys(nodes!).sort() : ICON_OPTIONS.map((o) => o.name);
	const q = query.trim().toLowerCase();
	const visible = q ? allNames.filter((n) => n.includes(q)) : allNames;

	return (
		<div>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
				<SearchBox value={query} onValueChange={setQuery} placeholder="Search icons…" style={{ flex: 1 }} />
				<span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{visible.length}</span>
			</div>
			{!ready && (
				<p style={{ fontSize: '0.72rem', color: error ? '#dc2626' : '#9ca3af', margin: '0 0 6px' }}>
					{error ? `Icon library unavailable (${error}) — showing built-in set.` : 'Loading icon library from CDN…'}
				</p>
			)}
			<div
				style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(auto-fill, minmax(38px, 1fr))',
					gap: 4,
					maxHeight: 220,
					overflowY: 'auto',
					padding: 2,
				}}
			>
				{visible.map((name) => (
					<IconCell key={name} name={name} active={value === name} onClick={() => onChange(name)} />
				))}
				{visible.length === 0 && (
					<p style={{ gridColumn: '1 / -1', fontSize: '0.75rem', color: '#9ca3af', textAlign: 'center', padding: '0.5rem' }}>
						No icons match “{query}”.
					</p>
				)}
			</div>
		</div>
	);
}
