import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { SearchBox } from '@mmbix/design-system';
import MenuIcon from './MenuIcon';
import { useStudioMeta } from '../lib/studioMeta';
import type { Node } from './MenuBuilder';

function PreviewItem({ node, selectedId, onSelect }: { node: Node; selectedId: string | null; onSelect: (id: string) => void }) {
	const isGroup = node.type === 'group';
	const active = selectedId === node.id;
	// A group with its own target is a workspace (Frappe-style): clicking it opens
	// the work-card page, but its children STAY visible as sub-items in the nav.
	const isWorkspace = isGroup && !!node.target && node.target !== '#';
	// Groups are always expanded — no expand/collapse toggle; a click selects the
	// row (the builder opens its target in the middle column).
	const expanded = isGroup;
	// Per-menu template label (e.g. "Table with Card & Form") — the builder applies
	// each menu item's own template; the badge makes the choice visible.
	const { templates } = useStudioMeta();
	const templateLabel = node.template ? (templates.find((t) => t.key === node.template)?.label ?? node.template) : null;
	return (
		<div>
			<button
				type="button"
				onClick={() => onSelect(node.id)}
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 6,
					width: '100%',
					padding: '0.4rem 0.45rem',
					borderRadius: 6,
					cursor: 'pointer',
					border: 'none',
					textAlign: 'left',
					fontSize: '0.75rem',
					background: active ? 'var(--mmbix-primary, #0f766e)' : 'transparent',
					color: active ? 'var(--mmbix-primary-foreground, #ffffff)' : 'var(--mmbix-foreground, #374151)',
				}}
			>
				{isGroup ? (
					<span style={{ display: 'inline-flex', color: active ? 'rgba(255,255,255,0.8)' : '#9ca3af', flexShrink: 0 }}>
						<ChevronDown size={12} />
					</span>
				) : (
					<span style={{ width: 12, flexShrink: 0 }} />
				)}
				<MenuIcon
					name={node.icon}
					type={node.type}
					size={13}
					style={{ color: isGroup ? '#f59e0b' : active ? 'var(--mmbix-primary-foreground, #ffffff)' : '#6b7280', flexShrink: 0 }}
				/>
				<span
					style={{
						flex: 1,
						minWidth: 0,
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
						fontWeight: isGroup ? 600 : 400,
					}}
				>
					{node.label}
				</span>
				{isWorkspace && (
					<span
						style={{
							fontSize: '0.62rem',
							padding: '0.1rem 0.35rem',
							borderRadius: 4,
							background: active ? 'rgba(255,255,255,0.25)' : 'var(--mmbix-muted, #f3f4f6)',
							color: active ? 'var(--mmbix-primary-foreground, #ffffff)' : '#9ca3af',
							flexShrink: 0,
							fontWeight: 500,
						}}
					>
						page
					</span>
				)}
				{!isWorkspace && templateLabel && (
					<span
						title={`Template: ${templateLabel}`}
						style={{
							fontSize: '0.6rem',
							padding: '0.1rem 0.35rem',
							borderRadius: 4,
							background: active ? 'rgba(255,255,255,0.25)' : 'var(--mmbix-muted, #f3f4f6)',
							color: active ? 'var(--mmbix-primary-foreground, #ffffff)' : '#9ca3af',
							flexShrink: 0,
							fontWeight: 500,
							maxWidth: 120,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
					>
						{templateLabel}
					</span>
				)}
			</button>
			{isGroup && expanded && node.children.length > 0 && (
				<div style={{ paddingLeft: 14 }}>
					{node.children.map((c) => (
						<PreviewItem key={c.id} node={c} selectedId={selectedId} onSelect={onSelect} />
					))}
				</div>
			)}
		</div>
	);
}

/**
 * MenuPreview — a mockup of how the app's navigation renders at runtime.
 * Groups become folders, links become nav items with icon + label.
 * Groups with a `target` render as flat workspace items (Frappe-style).
 * A search box filters items by label.
 */
export default function MenuPreview({
	tree,
	selectedId,
	onSelect,
}: {
	tree: Node[];
	selectedId: string | null;
	onSelect: (id: string) => void;
}) {
	const [query, setQuery] = useState('');
	const q = query.trim().toLowerCase();
	const searching = q.length > 0;

	// Filter the tree by label: a group matches if its own label matches
	// (then all its children stay) or if any descendant matches.
	const visible = useMemo(() => {
		if (!searching) return tree;
		const match = (n: Node): Node | null => {
			if (n.type === 'group') {
				const labelMatch = n.label.toLowerCase().includes(q);
				const children = labelMatch ? (n.children ?? []) : (n.children ?? []).map(match).filter((c): c is Node => c !== null);
				if (labelMatch || children.length > 0) return { ...n, children };
				return null;
			}
			return n.label.toLowerCase().includes(q) ? n : null;
		};
		return tree.map(match).filter((n): n is Node => n !== null);
	}, [tree, q, searching]);

	return (
		<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: '0.75rem 0.9rem' }}>
			{tree.length === 0 ? (
				<p style={{ fontSize: '0.75rem', color: '#9ca3af', padding: '0.5rem' }}>No menus yet — the nav will be empty.</p>
			) : (
				<div
					style={{
						border: '1px solid var(--mmbix-border, #e5e7eb)',
						borderRadius: 10,
						background: 'var(--mmbix-card, #ffffff)',
						overflow: 'hidden',
						display: 'flex',
						flexDirection: 'column',
					}}
				>
					<div style={{ padding: '0.5rem 0.6rem', borderBottom: '1px solid var(--mmbix-border, #e5e7eb)' }}>
						<SearchBox value={query} onValueChange={setQuery} placeholder="Search menu…" style={{ width: '100%' }} />
					</div>
					<div style={{ padding: '0.4rem' }}>
						{visible.length === 0 ? (
							<p style={{ fontSize: '0.75rem', color: '#9ca3af', padding: '0.5rem' }}>No menu items match “{query}”.</p>
						) : (
							visible.map((n) => <PreviewItem key={n.id} node={n} selectedId={selectedId} onSelect={onSelect} />)
						)}
					</div>
				</div>
			)}
		</div>
	);
}
