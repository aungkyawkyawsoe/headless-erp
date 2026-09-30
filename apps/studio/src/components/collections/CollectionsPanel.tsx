/**
 * CollectionsPanel — the Collections section's side panel (tier 2 of the
 * three-tier shell): the live schema registry plus the actions that manage it
 * (create / hide / delete).
 *
 * This list used to be the workbench's LEFT pane, so it existed only while you
 * were already on `/idp/collections`. It is now the shell's panel body, so it
 * follows every route of the section — and stays the ONE copy (the workbench's
 * left pane is gone).
 *
 * Selection is VIEW state — `?collection=<slug>`, written with `useViewState`
 * (replace, never a history entry) — the same param the workbench reads, so the
 * panel and the page cannot disagree about what is focused.
 */
import { useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@tanstack/react-store';
import {
	Alert,
	AlertDescription,
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
	Badge,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	SearchBox,
} from '@mmbix/design-system';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { createCollection, deleteCollection, namingSeriesExample, setCollectionHidden, type CollectionSummary } from '../../lib/api';
import { collectionsQuery } from '../../lib/queries';
import { invalidateCollectionList } from '../../lib/query-client';
import { qk } from '../../lib/query-keys';
import { isHiddenCollection } from '../../lib/idp';
import { messageOf } from '../../lib/errors';
import { setRegistryQuery, setShowHiddenCollections, studioUiStore } from '../../lib/studio-store';
import { useViewState } from '../../lib/view-state';
import { CollectionsRegistryList } from './RegistryList';

export function CollectionsPanel({ token }: { token: string }) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { pathname } = useLocation();
	// Selection + navigation are view state (?collection=) — see lib/view-state.ts.
	const { searchParams, update: updateViewState, commit } = useViewState();
	const selected = searchParams.get('collection');

	// Registry filters are CLIENT state (TanStack Store), not server state and not
	// URL state, so they survive a remount / route change without polluting history.
	const modelQuery = useStore(studioUiStore, (s) => s.registryQuery);
	const showHidden = useStore(studioUiStore, (s) => s.showHiddenCollections);

	const collectionsQ = useQuery(collectionsQuery(token));
	// Engine-system (`_`) and IDP-internal (`idp_`) collections never appear here;
	// user-hidden ones (meta.hidden) only when the reveal toggle is on.
	const collections = useMemo(() => (collectionsQ.data ?? []).filter((c) => !isHiddenCollection(c.slug)), [collectionsQ.data]);
	const visibleCollections = useMemo(() => (showHidden ? collections : collections.filter((c) => !c.hidden)), [collections, showHidden]);

	// Write-action errors only — read errors come from the query itself.
	const [actionError, setActionError] = useState<string | null>(null);

	// New Collection dialog.
	const [newOpen, setNewOpen] = useState(false);
	const [newName, setNewName] = useState('');
	const [newDescription, setNewDescription] = useState('');
	const [newNaming, setNewNaming] = useState('');
	const [newBusy, setNewBusy] = useState(false);

	// Collection pending deletion — confirmed before DELETE /api/collections/:slug.
	const [deleteTarget, setDeleteTarget] = useState<CollectionSummary | null>(null);
	const [deleteBusy, setDeleteBusy] = useState(false);

	const readError = messageOf(collectionsQ.error);
	const error = actionError ?? readError;

	const select = useCallback(
		(slug: string) => {
			const next = new URLSearchParams(searchParams);
			next.set('collection', slug);
			// The deep-link variant carries the slug in the PATH — once a new collection
			// is picked, that segment is stale, so land on the canonical path in the SAME
			// replace (never a push: switching collections is view state, not navigation).
			if (pathname === '/idp/collections') commit(next);
			else navigate(`/idp/collections?${next.toString()}`, { replace: true });
		},
		[searchParams, pathname, commit, navigate],
	);

	const newNamingExample = namingSeriesExample(newNaming);

	async function createModel(e: React.FormEvent) {
		e.preventDefault();
		if (!newName.trim() || newBusy || newNamingExample === false) return;
		setNewBusy(true);
		try {
			const created = await createCollection(token, newName.trim(), {
				description: newDescription.trim() || undefined,
				naming_series: newNaming.trim() || undefined,
			});
			setNewName('');
			setNewDescription('');
			setNewNaming('');
			setNewOpen(false);
			// Seed the new collection's cache so focusing it renders instantly, then
			// refresh the registry list (the ONLY thing this write changed).
			queryClient.setQueryData(qk.collection(created.slug), created);
			await invalidateCollectionList(queryClient);
			select(created.slug);
			setActionError(null);
		} catch (err) {
			setActionError(err instanceof Error ? err.message : 'Create failed');
		} finally {
			setNewBusy(false);
		}
	}

	// Permanently delete a collection (schema + data table dropped server-side).
	async function confirmDeleteCollection() {
		if (!deleteTarget || deleteBusy) return;
		setDeleteBusy(true);
		try {
			const removedSlug = deleteTarget.slug;
			await deleteCollection(token, removedSlug);
			setDeleteTarget(null);
			// If the deleted collection was focused, clear the selection before refreshing.
			if (selected === removedSlug) updateViewState((p) => p.delete('collection'));
			// Drop the deleted collection's cached schema + rows, then refresh the list.
			queryClient.removeQueries({ queryKey: qk.collection(removedSlug) });
			queryClient.removeQueries({ queryKey: qk.rows(removedSlug) });
			await invalidateCollectionList(queryClient);
			setActionError(null);
		} catch (err) {
			setActionError(err instanceof Error ? err.message : 'Delete failed');
			setDeleteTarget(null);
		} finally {
			setDeleteBusy(false);
		}
	}

	/** meta.hidden — hide/show a collection in this list (records/schema stay fully editable). */
	async function updateCollectionVisibility(c: CollectionSummary, hidden: boolean) {
		try {
			await setCollectionHidden(token, c.slug, hidden);
			// Optimistic: the toggle is instant, and the authoritative list + schema
			// revalidate in the background.
			queryClient.setQueryData<CollectionSummary[]>(qk.collections(), (prev) =>
				prev?.map((x) => (x.slug === c.slug ? { ...x, hidden } : x)),
			);
			void queryClient.invalidateQueries({ queryKey: qk.collection(c.slug) });
			setActionError(null);
		} catch (e) {
			setActionError(e instanceof Error ? e.message : 'Update failed');
		}
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
			{/* Panel header — the section's title, its size, and the two actions that
			    manage the list right below them. */}
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					gap: 8,
					padding: '0.6rem 0.75rem 0.6rem',
					borderBottom: '1px solid var(--mmbix-border, #e5e7eb)',
				}}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
					<span
						style={{
							fontSize: '0.72rem',
							fontWeight: 700,
							textTransform: 'uppercase',
							letterSpacing: '0.05em',
							color: 'var(--mmbix-muted-foreground, #6b7280)',
						}}
					>
						Collections
					</span>
					<Badge variant="outline">{visibleCollections.length}</Badge>
					<div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
						<Button
							variant="ghost"
							size="icon-xs"
							title={showHidden ? 'Hide hidden collections' : 'Reveal hidden collections'}
							aria-label={showHidden ? 'Hide hidden collections' : 'Reveal hidden collections'}
							onClick={() => setShowHiddenCollections(!showHidden)}
						>
							{showHidden ? <EyeOff size={14} /> : <Eye size={14} />}
						</Button>
						<Button
							variant="ghost"
							size="icon-xs"
							title="New collection"
							aria-label="New collection"
							onClick={() => {
								setNewName('');
								setNewDescription('');
								setNewNaming('');
								setNewOpen(true);
							}}
						>
							<Plus size={14} />
						</Button>
					</div>
				</div>
				<SearchBox
					value={modelQuery}
					onValueChange={setRegistryQuery}
					placeholder="Search collections…"
					aria-label="Search collections"
					style={{ width: '100%' }}
				/>
			</div>

			{error && (
				<div style={{ padding: '0.5rem 0.75rem' }}>
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				</div>
			)}

			{collectionsQ.isPending ? (
				<div style={{ padding: '1rem', color: 'var(--mmbix-muted-foreground, #6b7280)', fontSize: '0.8rem' }}>Loading collections…</div>
			) : (
				<CollectionsRegistryList
					collections={collections}
					visibleCollections={visibleCollections}
					selected={selected}
					modelQuery={modelQuery}
					onSelect={select}
					onToggleVisibility={(c, hidden) => void updateCollectionVisibility(c, hidden)}
					onRequestDelete={(c) => setDeleteTarget(c)}
				/>
			)}

			{/* New Collection — module-free: a fresh real table, no app binding. */}
			<Dialog open={newOpen} onOpenChange={setNewOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>New Collection</DialogTitle>
						<DialogDescription>Create a collection — it becomes a real table in the backend, usable by any app.</DialogDescription>
					</DialogHeader>
					<form onSubmit={(e) => void createModel(e)}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.25rem 0' }}>
							<Label htmlFor="cp-name">Name</Label>
							<Input id="cp-name" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Customers" />
							<Label htmlFor="cp-desc">Description</Label>
							<Input id="cp-desc" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Optional" />
							<Label htmlFor="cp-naming">Doc No. format (optional)</Label>
							<Input id="cp-naming" value={newNaming} onChange={(e) => setNewNaming(e.target.value)} placeholder="e.g. OUT- or OUT-####" />
							<div style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #64748b)', lineHeight: 1.4 }}>
								{newNamingExample === null
									? 'Off — new records get no Doc No.'
									: newNamingExample === false
										? 'Invalid — end with “-”, then up to 10 “#” (e.g. OUT-#### → OUT-0001).'
										: `First new record → ${newNamingExample}`}
							</div>
						</div>
						<DialogFooter>
							<Button type="button" variant="ghost" onClick={() => setNewOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={!newName.trim() || newBusy || newNamingExample === false}>
								{newBusy ? 'Creating…' : 'Create collection'}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Delete collection — destructive: drops the schema + data table server-side. */}
			<AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
				<AlertDialogContent size="sm">
					<AlertDialogHeader>
						<AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
							<Trash2 />
						</AlertDialogMedia>
						<AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes the “{deleteTarget?.name}” collection and its data table (all records) from the system. This action
							cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction variant="destructive" disabled={deleteBusy} onClick={() => void confirmDeleteCollection()}>
							{deleteBusy ? 'Deleting…' : 'Delete collection'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
