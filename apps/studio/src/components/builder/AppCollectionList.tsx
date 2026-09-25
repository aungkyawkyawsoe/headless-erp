/**
 * The app builder's left Collections pane body — the models attached to this
 * app, with its search filter and the per-row options menu (delete). Extracted
 * out of the AppDetailPage; behaviour unchanged.
 */
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@mmbix/design-system';
import { Database, MoreVertical, Trash2 } from 'lucide-react';
import type { CollectionSummary } from '../../lib/api';

export function AppCollectionList({
	collections,
	selected,
	modelQuery,
	onSelect,
	onRequestDelete,
}: {
	/** The collections attached to this app (mod.collections). */
	collections: CollectionSummary[];
	selected: string | null;
	modelQuery: string;
	onSelect: (slug: string) => void;
	onRequestDelete: (collection: CollectionSummary) => void;
}) {
	if (collections.length === 0) {
		return (
			<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Database size={32} />
						</EmptyMedia>
						<EmptyTitle>No collections yet</EmptyTitle>
						<EmptyDescription>Press the + button to create one.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</div>
		);
	}
	return (
		<div style={{ flex: 1, padding: '0.5rem', overflowY: 'auto', minHeight: 0 }}>
			<div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
				{collections
					.filter((c) => {
						const q = modelQuery.trim().toLowerCase();
						return !q || c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q);
					})
					.map((c) => {
						const active = selected === c.slug;
						return (
							<div
								key={c.slug}
								style={{
									display: 'flex',
									alignItems: 'center',
									width: '100%',
									borderRadius: 6,
									background: active ? 'var(--mmbix-primary, #2563eb)' : 'transparent',
									color: active ? 'var(--mmbix-primary-foreground, #ffffff)' : 'inherit',
								}}
							>
								<button
									onClick={() => onSelect(c.slug)}
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: 8,
										padding: '0.45rem 0.5rem',
										cursor: 'pointer',
										textAlign: 'left',
										flex: 1,
										minWidth: 0,
										background: 'transparent',
										color: 'inherit',
										border: 'none',
									}}
								>
									<Database
										size={13}
										style={{
											color: active ? 'var(--mmbix-primary-foreground, #ffffff)' : 'var(--mmbix-muted-foreground, #9ca3af)',
											flexShrink: 0,
										}}
									/>
									<span
										style={{
											flex: 1,
											minWidth: 0,
											fontSize: '0.82rem',
											fontWeight: active ? 700 : 500,
											overflow: 'hidden',
											textOverflow: 'ellipsis',
											whiteSpace: 'nowrap',
										}}
									>
										{c.name}
									</span>
								</button>
								<DropdownMenu>
									<DropdownMenuTrigger
										title="Collection options"
										aria-label={`Options for ${c.name}`}
										style={{
											display: 'inline-flex',
											alignItems: 'center',
											justifyContent: 'center',
											width: 24,
											height: 24,
											borderRadius: 5,
											border: 'none',
											background: 'transparent',
											color: active ? 'var(--mmbix-primary-foreground, #ffffff)' : 'var(--mmbix-muted-foreground, #9ca3af)',
											cursor: 'pointer',
											flexShrink: 0,
										}}
									>
										<MoreVertical size={13} />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" sideOffset={4} style={{ minWidth: 190 }}>
										<DropdownMenuItem variant="destructive" onClick={() => onRequestDelete(c)}>
											<Trash2 size={13} /> Delete collection
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						);
					})}
			</div>
		</div>
	);
}
