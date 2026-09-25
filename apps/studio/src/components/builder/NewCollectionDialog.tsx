/**
 * New Collection dialog for an app — create a fresh model and attach it, or bind
 * an existing system collection. Owns its own input/mode state and the
 * create/bind API calls; the calling page supplies only the app-level
 * consequences (cache invalidation, selection) and the error sink. Extracted
 * out of the AppDetailPage; behaviour unchanged.
 */
import { useEffect, useState } from 'react';
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
} from '@mmbix/design-system';
import { useQueryClient } from '@tanstack/react-query';
import { attachCollectionToModule, createCollection, namingSeriesExample, type CollectionSummary, type EntitySchema } from '../../lib/api';
import { collectionsQuery } from '../../lib/queries';

export function NewCollectionDialog({
	open,
	onOpenChange,
	token,
	moduleSlug,
	attachedSlugs,
	onCreated,
	onBound,
	onError,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	token: string;
	moduleSlug: string;
	/** Slugs already attached to this app — excluded from the bind list. */
	attachedSlugs: string[];
	/** Page-side work after a new model is created + attached (seed cache, revalidate, select). */
	onCreated: (created: EntitySchema) => void | Promise<void>;
	/** Page-side work after an existing collection is attached (revalidate, select). */
	onBound: (slug: string) => void | Promise<void>;
	onError: (message: string) => void;
}) {
	const queryClient = useQueryClient();
	// New Collection dialog mode: 'create' a fresh model, or 'bind' an existing one.
	const [mode, setMode] = useState<'create' | 'bind'>('create');
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [naming, setNaming] = useState('');
	const [busy, setBusy] = useState(false);
	// All system collections (fetched when the dialog opens) — used to pick one to bind.
	const [allCollections, setAllCollections] = useState<CollectionSummary[]>([]);
	const [bindSlug, setBindSlug] = useState('');
	const [bindBusy, setBindBusy] = useState(false);

	const namingExample = namingSeriesExample(naming);

	// Reset the form and load the bind list whenever the dialog opens. In 'bind'
	// mode we need the full list of system collections so the user can pick one
	// that isn't already attached to this module.
	useEffect(() => {
		if (!open) return;
		setName('');
		setDescription('');
		setNaming('');
		setMode('create');
		setBindSlug('');
		setAllCollections([]);
		let alive = true;
		queryClient
			.fetchQuery(collectionsQuery(token))
			.then((rows) => {
				if (alive) setAllCollections(rows);
			})
			.catch(() => {
				/* the bind list is best-effort — create mode still works */
			});
		return () => {
			alive = false;
		};
	}, [open, token, queryClient]);

	async function handleCreate(e: React.FormEvent) {
		e.preventDefault();
		if (!moduleSlug || !name.trim() || busy || namingSeriesExample(naming) === false) return;
		setBusy(true);
		try {
			const created = await createCollection(token, name.trim(), {
				description: description.trim() || undefined,
				naming_series: naming.trim() || undefined,
			});
			await attachCollectionToModule(token, moduleSlug, created.slug);
			setName('');
			setDescription('');
			setNaming('');
			onOpenChange(false);
			// Seed the new schema so focusing it renders instantly, then revalidate the
			// only things this write touched: the app wiring + the registry list.
			await onCreated(created);
		} catch (err) {
			onError(err instanceof Error ? err.message : 'Create failed');
		} finally {
			setBusy(false);
		}
	}

	// Attach an existing system collection to this module without creating a new one.
	async function handleBind(e: React.FormEvent) {
		e.preventDefault();
		if (!moduleSlug || !bindSlug || bindBusy) return;
		setBindBusy(true);
		try {
			await attachCollectionToModule(token, moduleSlug, bindSlug);
			const bound = bindSlug;
			setBindSlug('');
			onOpenChange(false);
			await onBound(bound);
		} catch (err) {
			onError(err instanceof Error ? err.message : 'Bind failed');
		} finally {
			setBindBusy(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>New Collection</DialogTitle>
					<DialogDescription>Create a model and attach it to this app, or bind an existing one from the system.</DialogDescription>
				</DialogHeader>
				{/* Mode toggle — create a fresh model vs. bind an existing system collection. */}
				<div style={{ display: 'flex', gap: 6, marginBottom: '0.75rem' }}>
					<Button size="sm" variant={mode === 'create' ? 'default' : 'outline'} onClick={() => setMode('create')} style={{ flex: 1 }}>
						Create new
					</Button>
					<Button size="sm" variant={mode === 'bind' ? 'default' : 'outline'} onClick={() => setMode('bind')} style={{ flex: 1 }}>
						Bind existing
					</Button>
				</div>
				{mode === 'create' ? (
					<form onSubmit={handleCreate}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.25rem 0' }}>
							<Label htmlFor="nc-name">Name</Label>
							<Input id="nc-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Customers" />
							<Label htmlFor="nc-desc">Description</Label>
							<Input id="nc-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
							<Label htmlFor="nc-naming">Doc No. format (optional)</Label>
							<Input id="nc-naming" value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="e.g. OUT- or OUT-####" />
							<div style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #64748b)', lineHeight: 1.4 }}>
								{namingExample === null
									? 'Off — new records get no Doc No.'
									: namingExample === false
										? 'Invalid — end with “-”, then up to 10 “#” (e.g. OUT-#### → OUT-0001).'
										: `First new record → ${namingExample}`}
							</div>
						</div>
						<DialogFooter>
							<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={!name.trim() || busy || namingExample === false}>
								{busy ? 'Creating…' : 'Create & attach'}
							</Button>
						</DialogFooter>
					</form>
				) : (
					<form onSubmit={handleBind}>
						{(() => {
							const available = allCollections.filter((c) => !attachedSlugs.includes(c.slug));
							if (available.length === 0) {
								return (
									<div style={{ padding: '0.75rem 0', color: 'var(--mmbix-muted-foreground, #64748b)', fontSize: '0.85rem' }}>
										No other collections available — every system collection is already attached to this app.
									</div>
								);
							}
							return (
								<div
									style={{
										display: 'flex',
										flexDirection: 'column',
										gap: 4,
										maxHeight: 260,
										overflowY: 'auto',
										padding: '0.25rem 0',
									}}
								>
									{available.map((c) => {
										const active = bindSlug === c.slug;
										return (
											<button
												key={c.slug}
												type="button"
												onClick={() => setBindSlug(c.slug)}
												style={{
													display: 'flex',
													alignItems: 'center',
													gap: 8,
													width: '100%',
													padding: '0.5rem 0.6rem',
													borderRadius: 8,
													border: active ? '1px solid var(--mmbix-primary, #2563eb)' : '1px solid transparent',
													background: active ? 'var(--mmbix-primary-soft, rgba(37,99,235,0.08))' : 'transparent',
													cursor: 'pointer',
													textAlign: 'left',
													font: 'inherit',
												}}
											>
												<span style={{ flex: 1, minWidth: 0 }}>
													<span
														style={{
															display: 'block',
															fontSize: '0.9rem',
															fontWeight: 600,
															overflow: 'hidden',
															textOverflow: 'ellipsis',
															whiteSpace: 'nowrap',
														}}
													>
														{c.name}
													</span>
													<span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--mmbix-muted-foreground, #64748b)' }}>
														{c.slug}
													</span>
												</span>
											</button>
										);
									})}
								</div>
							);
						})()}
						<DialogFooter>
							<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={!bindSlug || bindBusy}>
								{bindBusy ? 'Attaching…' : 'Attach to app'}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
