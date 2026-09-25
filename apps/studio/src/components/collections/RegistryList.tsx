/**
 * The left Collections pane body — the registry list with its search filter,
 * the hidden-collection reveal, and the per-row options menu (show/hide,
 * delete). Extracted out of the Collections workbench; behaviour unchanged.
 */
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@mmbix/design-system';
import { Database, Eye, EyeOff, MoreVertical, Trash2 } from 'lucide-react';
import type { CollectionSummary } from '../../lib/api';

export function CollectionsRegistryList({
	collections,
	visibleCollections,
	selected,
	modelQuery,
	onSelect,
	onToggleVisibility,
	onRequestDelete,
}: {
	/** Every non-system collection (regardless of the reveal toggle). */
	collections: CollectionSummary[];
	/** The subset to render (hidden ones only when revealed). */
	visibleCollections: CollectionSummary[];
	selected: string | null;
	modelQuery: string;
	onSelect: (slug: string) => void;
	onToggleVisibility: (collection: CollectionSummary, hidden: boolean) => void;
	onRequestDelete: (collection: CollectionSummary) => void;
}) {
	if (visibleCollections.length === 0) {
		return (
			<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
				<Empty>
					<EmptyHeader>
						{collections.length > 0 ? (
							<>
								<EmptyMedia variant="icon">
									<EyeOff size={32} />
								</EmptyMedia>
								<EmptyTitle>All collections hidden</EmptyTitle>
								<EmptyDescription>Hidden collections exist — use the eye toggle to reveal them.</EmptyDescription>
							</>
						) : (
							<>
								<EmptyMedia variant="icon">
									<Database size={32} />
								</EmptyMedia>
								<EmptyTitle>No collections yet</EmptyTitle>
								<EmptyDescription>Press the + button to create the first backend table.</EmptyDescription>
							</>
						)}
					</EmptyHeader>
				</Empty>
			</div>
		);
	}
	return (
		<div style={{ flex: 1, padding: '0.5rem', overflowY: 'auto', minHeight: 0 }}>
			<div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
				{visibleCollections
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
									title={c.hidden ? `${c.name} (hidden from this list)` : c.name}
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
										opacity: c.hidden && !active ? 0.6 : 1,
									}}
								>
									{c.hidden ? (
										<EyeOff
											size={13}
											style={{
												color: active ? 'var(--mmbix-primary-foreground, #ffffff)' : 'var(--mmbix-muted-foreground, #9ca3af)',
												flexShrink: 0,
											}}
										/>
									) : (
										<Database
											size={13}
											style={{
												color: active ? 'var(--mmbix-primary-foreground, #ffffff)' : 'var(--mmbix-muted-foreground, #9ca3af)',
												flexShrink: 0,
											}}
										/>
									)}
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
										{c.hidden ? (
											<DropdownMenuItem onClick={() => onToggleVisibility(c, false)}>
												<Eye size={13} /> Show in collections list
											</DropdownMenuItem>
										) : (
											<DropdownMenuItem onClick={() => onToggleVisibility(c, true)}>
												<EyeOff size={13} /> Hide from collections list
											</DropdownMenuItem>
										)}
										<DropdownMenuSeparator />
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
