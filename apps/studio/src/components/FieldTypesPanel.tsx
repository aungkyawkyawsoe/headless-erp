import { useMemo, useState } from 'react';
import { Badge, Button, Card, CardContent, SearchBox } from '@mmbix/design-system';
import { ChevronsRight } from 'lucide-react';
import type { FieldTypeDef } from '../lib/api';
import { useFieldTypeCatalog } from '../lib/use-field-types';
import { useRightPane } from './StudioLayout';
import { FieldTypeIcon } from './formlayout';

/**
 * FieldTypesPanel — the full field-type catalog the backend supports (40 types,
 * grouped), rendered as compact icon+label cards with a search filter. Used in
 * the right pane of the App workbench, mirroring how Odoo Studio shows its
 * field palette. When `onPick` is provided the cards are clickable and create
 * a field of that type in the focused collection.
 */
export default function FieldTypesPanel({
	token,
	onPick,
	types,
}: {
	token: string;
	onPick?: (def: FieldTypeDef) => void;
	/** Pre-fetched catalog — when supplied (e.g. the workbench already fetched it for
	 *  the add-field dialog) the palette renders it instead of issuing a SECOND
	 *  `GET /api/field-types`. */
	types?: FieldTypeDef[];
}) {
	const rightPane = useRightPane();
	const supplied = !!types && types.length > 0;
	// Shares the app-wide catalog query. When the caller already holds the catalog
	// the query is disabled and we group locally — one source of truth either way.
	const catalog = useFieldTypeCatalog(supplied ? '' : token);
	const [query, setQuery] = useState('');

	// Group the supplied catalog client-side (same shape the API returns).
	const groups = useMemo(() => {
		if (!supplied) return catalog.data?.groups ?? {};
		const grouped: Record<string, FieldTypeDef[]> = {};
		for (const t of types!) (grouped[t.group] ??= []).push(t);
		return grouped;
	}, [supplied, types, catalog.data]);
	const total = supplied ? types!.length : (catalog.data?.types.length ?? 0);
	const loading = !supplied && catalog.isPending;
	const error = !supplied && catalog.error ? (catalog.error instanceof Error ? catalog.error.message : 'Failed to load field types') : null;

	const q = query.trim().toLowerCase();
	const visible: Record<string, FieldTypeDef[]> = {};
	if (q) {
		for (const [group, items] of Object.entries(groups)) {
			const matched = items.filter(
				(t) => t.label.toLowerCase().includes(q) || t.type.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q),
			);
			if (matched.length > 0) visible[group] = matched;
		}
	} else {
		Object.assign(visible, groups);
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.75rem 0.9rem 0.5rem' }}>
				<span
					style={{
						fontSize: '0.72rem',
						fontWeight: 700,
						textTransform: 'uppercase',
						letterSpacing: '0.05em',
						color: 'var(--mmbix-muted-foreground, #6b7280)',
					}}
				>
					Field Types
				</span>
				{!loading && !error && (
					<Badge variant="outline" style={{ fontSize: '0.62rem', fontWeight: 600 }}>
						{total}
					</Badge>
				)}
				{rightPane && (
					<Button
						variant="ghost"
						size="icon-xs"
						title="Collapse pane"
						aria-label="Collapse field types panel"
						onClick={rightPane.toggle}
						style={{ marginLeft: 'auto' }}
					>
						<ChevronsRight size={13} />
					</Button>
				)}
			</div>
			{!loading && !error && (
				<SearchBox
					value={query}
					onValueChange={setQuery}
					placeholder="Search field types…"
					style={{ margin: '0 0.9rem 0.5rem', width: 'calc(100% - 1.8rem)' }}
				/>
			)}
			{!loading && !error && onPick && (
				<p style={{ fontSize: '0.68rem', color: '#9ca3af', margin: '0 0.9rem 0.5rem' }}>Click a field type to add it to the collection.</p>
			)}
			{loading && <p style={{ fontSize: '0.78rem', color: '#9ca3af', padding: '0.5rem 0.9rem' }}>Loading field types…</p>}
			{error && <p style={{ fontSize: '0.78rem', color: '#dc2626', padding: '0.5rem 0.9rem' }}>{error}</p>}
			{!loading && !error && (
				<div
					style={{
						flex: 1,
						overflowY: 'auto',
						minHeight: 0,
						padding: '0.25rem 0.75rem 0.75rem',
						display: 'flex',
						flexDirection: 'column',
						gap: '0.85rem',
					}}
				>
					{Object.entries(visible).map(([group, items]) => (
						<div key={group}>
							<div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
								<span
									style={{
										fontSize: '0.68rem',
										fontWeight: 700,
										textTransform: 'uppercase',
										letterSpacing: '0.05em',
										color: 'var(--mmbix-muted-foreground, #6b7280)',
									}}
								>
									{group}
								</span>
								<Badge variant="outline" style={{ marginLeft: 'auto', fontSize: '0.58rem', fontWeight: 600 }}>
									{items.length}
								</Badge>
							</div>
							<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 4 }}>
								{items.map((t) => (
									<Card
										key={t.type}
										title={onPick ? `Add a ${t.label} field to the collection` : t.description}
										onClick={onPick ? () => onPick(t) : undefined}
										style={{ cursor: onPick ? 'pointer' : 'default', transition: 'border-color 0.15s, box-shadow 0.15s' }}
									>
										<CardContent
											style={{
												display: 'flex',
												flexDirection: 'column',
												alignItems: 'center',
												gap: 5,
												padding: '0.65rem 0.25rem',
												textAlign: 'center',
											}}
										>
											<span style={{ display: 'inline-flex' }}>
												<FieldTypeIcon type={t.type} size={24} />
											</span>
											<span
												style={{
													fontSize: '0.72rem',
													fontWeight: 500,
													lineHeight: 1.2,
													overflow: 'hidden',
													textOverflow: 'ellipsis',
													display: '-webkit-box',
													WebkitLineClamp: 2,
													WebkitBoxOrient: 'vertical',
												}}
											>
												{t.label}
											</span>
										</CardContent>
									</Card>
								))}
							</div>
						</div>
					))}
					{Object.keys(visible).length === 0 && (
						<p style={{ fontSize: '0.75rem', color: '#9ca3af', textAlign: 'center', padding: '1.5rem 0.5rem' }}>
							No field types match “{query}”.
						</p>
					)}
				</div>
			)}
		</div>
	);
}
