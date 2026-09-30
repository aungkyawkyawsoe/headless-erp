import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
	Button,
	confirmDialog,
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
	SearchBox,
} from '@mmbix/design-system';
import { Database, Plus, Trash2 } from 'lucide-react';
import {
	updateCollectionMeta,
	deleteCollection,
	updateCollectionFields,
	SYSTEM_FIELD_NAMES,
	namingSeriesExample,
	type CollectionSummary,
	type EntitySchema,
	type FieldDefinition,
	type FieldTypeDef,
} from '../lib/api';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { collectionQuery, menusQuery, moduleQuery, modulesQuery, pagesQuery } from '../lib/queries';
import { invalidateCollection, invalidateCollectionList, invalidateModule, invalidateRows } from '../lib/query-client';
import { qk } from '../lib/query-keys';
import { messageOf } from '../lib/errors';
import { writeLockOf } from '../lib/write-lock';
import { useViewState } from '../lib/view-state';
import { appSectionPath, legacySectionTarget, normalizeSectionParams } from '../lib/app-sections';
import { useAppSectionRoute } from '../lib/use-app-section-route';
import { useM2oSchemas } from '../lib/collection-table-filters';
import StudioLayout, { SideSection } from '../components/StudioLayout';
import ErrorBoundary from '../components/ErrorBoundary';
import MenuBuilder, { type Node as MenuNode, defaultMenuTree } from '../components/MenuBuilder';
import MenuPreview from '../components/MenuPreview';
import MenuInspector from '../components/MenuInspector';
import FieldTypesPanel from '../components/FieldTypesPanel';
import PermissionsPanel from '../components/PermissionsPanel';
import WorkflowPanel from '../components/WorkflowPanel';
import AuditPanel from '../components/AuditPanel';
import PolicyPanel from '../components/PolicyPanel';
import GenerationPanel from '../components/GenerationPanel';
import AddFieldDialog from '../components/AddFieldDialog';
import { PageBuilderProvider, PageCanvas } from '../components/PageBuilder';
import ManageAppDialog from '../components/ManageAppDialog';
import { BuilderFormLayout, BuilderLeftPane, BuilderRightPane, toMenuTree } from '../components/builder/builder-parts';
import { AppWorkbenchHeader } from '../components/builder/AppWorkbenchHeader';
import { AppCollectionList } from '../components/builder/AppCollectionList';
import { AppDataPane } from '../components/app/AppDataPane';
import { AppSchemaPane, type AppSchemaPanel } from '../components/app/AppSchemaPane';
import { DocNoDialog } from '../components/collections/DocNoDialog';
import { PanelDialog } from '../components/collections/PanelDialog';
import { NewCollectionDialog } from '../components/builder/NewCollectionDialog';

export default function AppDetailPage({ token }: { token: string }) {
	const params = useParams();
	const slug = params.slug;
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	// Write-action errors only — read errors come from the queries below.
	const [actionError, setActionError] = useState<string | null>(null);
	const [manageOpen, setManageOpen] = useState(false);
	const [modelQuery, setModelQuery] = useState('');
	const [permOpen, setPermOpen] = useState(false);
	const [wfOpen, setWfOpen] = useState(false);
	const [auditOpen, setAuditOpen] = useState(false);
	const [policyOpen, setPolicyOpen] = useState(false);
	const [generationOpen, setGenerationOpen] = useState(false);
	const [newOpen, setNewOpen] = useState(false);
	// Doc No. (naming series) editor — per-collection auto-numbering pattern.
	const [docNoOpen, setDocNoOpen] = useState(false);
	const [docNoValue, setDocNoValue] = useState('');
	const [docNoBusy, setDocNoBusy] = useState(false);
	// Rows-only reload tick — a DataTable remount key. Row-level writes (create /
	// edit / delete / restore / import / batch edit) change DATA, never the schema
	// or the module wiring, so they bump this instead of `refresh()` (which reloads
	// the module + pages + menus + EVERY collection schema — O(collections)).
	const [tableReload, setTableReload] = useState(0);
	const reloadTable = useCallback(() => setTableReload((v) => v + 1), []);
	// A ROW write (create / edit / delete / restore / import / batch) moved DATA only —
	// refetch this collection's cached pages (so the next read is fresh, not a
	// staleTime hit) and remount the DataTable so it re-runs `fetchData`. Nothing else
	// in the app changed, so nothing else is touched. O(1) invalidations, not O(collections).
	// Awaits the invalidation BEFORE remounting: `invalidateQueries` marks the
	// cached page stale, but remounting first would let the DataTable's
	// `fetchData` read the still-cached (30s staleTime) bytes — the row edit
	// looked like it never took until a full page reload. Chaining the remount
	// off the invalidation promise makes the refetch see fresh data.
	const refreshRows = useCallback(
		(slug: string | null | undefined) => {
			if (slug) void invalidateRows(queryClient, slug).then(reloadTable);
			else reloadTable();
		},
		[queryClient, reloadTable],
	);
	// App-WIRING writes (module / menus) — revalidate exactly the wiring queries.
	const refreshModule = useCallback(() => {
		if (slug) void invalidateModule(queryClient, slug);
	}, [queryClient, slug]);
	// PAGE writes — pages are their own query set, independent of the module wiring.
	const refreshPages = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: qk.pages() });
	}, [queryClient]);
	// Collection pending deletion — confirmed via AlertDialog before DELETE /api/collections/:slug.
	const [deleteTarget, setDeleteTarget] = useState<CollectionSummary | null>(null);
	const [deleteBusy, setDeleteBusy] = useState(false);

	// Section + view + focused collection/row/page/template are kept in the URL so a reload
	// keeps the same view. All reads/writes go through the shared useViewState hook — the
	// ONE sanctioned way to touch URL params in the Studio: writes REPLACE the current
	// history entry (never push), so this workbench keeps exactly one history entry and the
	// back arrow leaves the app in one press instead of walking back through every
	// section/collection/row/template switch. See lib/view-state.ts for the contract.
	const { searchParams, update: updateViewState, commit: commitViewState } = useViewState();
	// The active MODE is a real route segment (`/apps/:slug/<mode>`) — see
	// lib/use-app-section-route.ts for the ONE place that is derived and switched.
	// Within a mode the focused collection / view / row stay QUERY PARAMS (view state).
	const { section, setSection } = useAppSectionRoute(slug);
	// The ?view= param is SHARED with the page builder (table|form|kanban|…) — a stale
	// builder value (e.g. view=form) must not bleed into the collection section, where
	// only table/schema exist. Clamp anything else to 'schema' so the right-hand field
	// type panel keeps rendering after switching sections.
	const rawView = searchParams.get('view') ?? 'schema';
	const view = (section === 'models' ? (rawView === 'table' ? 'table' : 'schema') : rawView) as 'table' | 'schema';
	// Selected collection + open page are URL-backed too (?collection= & ?page=).
	const selected = searchParams.get('collection');
	const selectCollection = useCallback(
		(slug: string | null) => {
			updateViewState((p) => {
				if (slug) p.set('collection', slug);
				else p.delete('collection');
				// A collection switch invalidates any open record — drop its row id so we
				// never show a stale record under the new schema. The data pane (keyed by
				// slug) resets its own record/selection/trash state on the same switch.
				p.delete('row');
			});
		},
		[updateViewState],
	);
	function setView(v: 'table' | 'schema') {
		updateViewState((p) => p.set('view', v));
	}
	// Self-heal the URL: a LEGACY ?section= link (a pre-mode-route bookmark) is translated to
	// the mode path, and stale params (e.g. view=form from the pages mode) are rewritten for
	// the active mode so pasted links behave and share cleanly. A no-op when already valid.
	useEffect(() => {
		if (!slug) return;
		const target = legacySectionTarget(searchParams.get('section'));
		if (target) {
			const next = new URLSearchParams(searchParams);
			next.delete('section');
			const qs = next.toString();
			navigate(`${appSectionPath(slug, target)}${qs ? `?${qs}` : ''}`, { replace: true });
			return;
		}
		const { params: next, changed } = normalizeSectionParams(section, searchParams);
		if (changed) commitViewState(next);
	}, [searchParams, section, slug, navigate, commitViewState]);
	// Menu-section state shared between the tree (center), preview (left) and inspector (right).
	const [menuSelected, setMenuSelected] = useState<MenuNode | null>(null);
	const [menuTree, setMenuTree] = useState<MenuNode[]>([]);
	// Bump to tell the self-loading MenuBuilder to re-read the menu tree after the
	// inspector saves (it owns its own draft and reports back via `onTreeChange`).
	const [menuReload, setMenuReload] = useState(0);
	// ── Server state (TanStack Query) ────────────────────────────
	// Module wiring, the module list, pages and menus are keyed queries; the
	// `config_version` poll rides `refetchInterval` (paused while the tab is
	// hidden — Query's default, matching the old `document.hidden` guard).
	//
	// Cadence is a deliberate cost/precision trade: 15s + an immediate re-sync
	// when the window regains focus, instead of a flat 5s tick. What this buys:
	// a D1 read per open workbench drops ~3× (5s ≈ 12/min → 15s ≈ 4/min), and the
	// focus refetch covers the case the poll was really for — the user was away
	// and comes back. `config_version` is a single-row read; it is the ONLY poll
	// in the Studio, and this is the slowest tick that still feels live.
	const moduleQ = useQuery({ ...moduleQuery(token, slug), refetchInterval: 15_000, refetchOnWindowFocus: true });
	const modulesQ = useQuery(modulesQuery(token));
	const pagesQ = useQuery(pagesQuery(token));
	const menusQ = useQuery(menusQuery(token, slug));

	const mod = moduleQ.data ?? null;
	const modules = modulesQ.data ?? [];
	const pages = pagesQ.data ?? [];
	const loading = moduleQ.isPending;
	const error = actionError ?? messageOf(moduleQ.error);

	// Field schemas for the attached models — one Query cache entry per slug, so a
	// collection already open anywhere in the Studio costs ZERO extra requests.
	const attachedSlugs = useMemo(() => (mod?.collections ?? []).map((c) => c.slug), [mod]);
	const attachedQ = useQueries({ queries: attachedSlugs.map((s) => collectionQuery(token, s)) });
	const attachedVersion = attachedQ.map((r) => (r.data ? `${r.dataUpdatedAt}` : '0')).join('|');
	const schemas = useMemo(() => {
		const out: Record<string, EntitySchema> = {};
		attachedQ.forEach((r, i) => {
			if (r.data) out[attachedSlugs[i]] = r.data;
		});
		return out;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [attachedSlugs, attachedVersion]);

	// Live-sync: the backend bumps `config_version` on every module/menu/page/view
	// mutation; when it moves, the wiring queries revalidate.
	const configVersionRef = useRef<number | null>(null);
	useEffect(() => {
		const v = mod?.config_version ?? 0;
		if (configVersionRef.current !== null && v !== configVersionRef.current) {
			void queryClient.invalidateQueries({ queryKey: qk.modules() });
			void queryClient.invalidateQueries({ queryKey: qk.pages() });
			if (slug) void queryClient.invalidateQueries({ queryKey: qk.menus(slug) });
		}
		configVersionRef.current = v;
	}, [mod, queryClient, slug]);

	// Seed the locally-editable menu tree from the menus query (no menus designed
	// yet → derive a default tree from the attached collections so it isn't empty).
	useEffect(() => {
		if (!mod || !menusQ.data) return;
		setMenuTree(menusQ.data.length > 0 ? toMenuTree(menusQ.data, null) : defaultMenuTree(mod.collections ?? [], mod.slug));
	}, [menusQ.data, mod]);

	// Default-select the first attached model.
	useEffect(() => {
		if (!selected && (mod?.collections?.length ?? 0) > 0) selectCollection(mod!.collections![0].slug);
	}, [mod, selected, selectCollection]);

	const selectedModel = mod?.collections?.find((c) => c.slug === selected) ?? null;
	const selectedSchema = selected ? schemas[selected] : undefined;
	// The engine-enforced WRITE policy — a `service` collection has NO generic
	// writes, so the data table must not offer create / edit / delete / import.
	const writeLock = useMemo(() => writeLockOf(selectedSchema), [selectedSchema]);
	// Stable identity — the `?? []` fallback would otherwise mint a new array on
	// every render and force the table-columns useMemo to rebuild each time.
	const fields = useMemo(() => selectedSchema?.schema_json.fields ?? [], [selectedSchema]);
	// Engine-managed system fields are hidden by default (id, timestamps, owners, …).
	const visibleFields = fields.filter((f) => !SYSTEM_FIELD_NAMES.has(f.name));

	// Related schemas for the focused collection's m2o fields — the data pane's
	// table filters and the AddFieldDialog's relation picker both read them from
	// the shared query cache (already-open targets cost zero requests).
	const m2oSchemas = useM2oSchemas(token, fields);
	// AddFieldDialog resolves relation targets — merge the app's attached schemas with
	// any m2o target the table lazily loaded (both live in the same query cache).
	const dialogSchemas = useMemo(() => ({ ...schemas, ...m2oSchemas }), [schemas, m2oSchemas]);

	// Doc No. (naming series) — live preview for the existing-model dialog.
	const docNoExample = namingSeriesExample(docNoValue);

	// Open the Doc No. editor seeded with the collection's CURRENT pattern.
	async function openDocNoDialog() {
		if (!selected) return;
		try {
			const detail = await queryClient.fetchQuery(collectionQuery(token, selected));
			setDocNoValue(detail?.naming_series ?? '');
		} catch {
			// Fall back to the in-memory schema (may be stale, still better than blank).
			setDocNoValue(selectedSchema?.naming_series ?? '');
		}
		setDocNoOpen(true);
	}

	// Persist the pattern (empty → clears numbering). Only NEW records are numbered
	// from it — existing rows keep their current Doc No. (the engine never renumbers).
	async function saveDocNo() {
		if (!selected || docNoExample === false) return;
		setDocNoBusy(true);
		try {
			const value = docNoValue.trim();
			const updated = await updateCollectionMeta(token, selected, { naming_series: value ? value : null });
			queryClient.setQueryData(qk.collection(selected), updated);
			setDocNoOpen(false);
		} catch (err) {
			setActionError(err instanceof Error ? err.message : 'Failed to update Doc No.');
		} finally {
			setDocNoBusy(false);
		}
	}

	async function removeField(fieldName: string) {
		if (!selectedModel || !selectedSchema) return;
		if (
			!(await confirmDialog({
				title: 'Delete field',
				description: `Delete field "${fieldName}" from "${selectedModel.name}"? The column is removed from the table.`,
				destructive: true,
				confirmLabel: 'Delete field',
			}))
		)
			return;
		try {
			const next = selectedSchema.schema_json.fields.filter((f) => f.name !== fieldName);
			// Single-field save — patch just this collection's cache entry instead of
			// refetching the whole app (module + pages + menus + every schema).
			const updated = await updateCollectionFields(token, selectedModel.slug, next);
			queryClient.setQueryData(qk.collection(selectedModel.slug), updated);
			// The column is gone — refetch the visible page without it.
			refreshRows(selectedModel.slug);
		} catch (e) {
			setActionError(e instanceof Error ? e.message : 'Delete failed');
		}
	}

	// Delete a collection from this app (schema + data table dropped server-side).
	async function confirmDeleteCollection() {
		if (!deleteTarget || deleteBusy) return;
		setDeleteBusy(true);
		try {
			const removedSlug = deleteTarget.slug;
			await deleteCollection(token, removedSlug);
			setDeleteTarget(null);
			// If the deleted collection was focused, clear the selection before refreshing.
			if (selected === removedSlug) selectCollection(null);
			// Drop the deleted collection's cached schema + rows, then revalidate the
			// app wiring + the registry list.
			queryClient.removeQueries({ queryKey: qk.collection(removedSlug) });
			queryClient.removeQueries({ queryKey: qk.rows(removedSlug) });
			if (slug) await invalidateModule(queryClient, slug);
			await invalidateCollectionList(queryClient);
		} catch (err) {
			setActionError(err instanceof Error ? err.message : 'Delete failed');
			setDeleteTarget(null);
		} finally {
			setDeleteBusy(false);
		}
	}

	// Create a field from the right-pane type catalog — the type-aware property dialog.
	const [draftDef, setDraftDef] = useState<FieldTypeDef | null>(null);
	async function createField(field: FieldDefinition) {
		if (!selectedModel || !selectedSchema) return;
		try {
			const next: FieldDefinition[] = [...fields, field];
			// Single-field save — patch just this collection's cache entry instead of
			// refetching the whole app (module + pages + menus + every schema).
			const updated = await updateCollectionFields(token, selectedModel.slug, next);
			queryClient.setQueryData(qk.collection(selectedModel.slug), updated);
			setDraftDef(null);
			// A new column changes the row shape — refetch the visible page.
			refreshRows(selectedModel.slug);
		} catch (e) {
			setActionError(e instanceof Error ? e.message : 'Create failed');
		}
	}

	// The schema pane reports which governance panel to open; the page owns them.
	function openSchemaPanel(panel: AppSchemaPanel) {
		switch (panel) {
			case 'workflow':
				setWfOpen(true);
				break;
			case 'permissions':
				setPermOpen(true);
				break;
			case 'audit':
				setAuditOpen(true);
				break;
			case 'policies':
				setPolicyOpen(true);
				break;
			case 'generation':
				setGenerationOpen(true);
				break;
			case 'docno':
				void openDocNoDialog();
				break;
		}
	}

	if (loading)
		return (
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
				<p style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Loading app…</p>
			</div>
		);
	if (!mod) return <div style={{ padding: '2rem' }}>{error ?? 'App not found'}</div>;

	return (
		<>
			<PageBuilderProvider
				token={token}
				pages={pages}
				moduleSlug={mod.slug}
				onSaved={refreshPages}
				initialPageId={searchParams.get('page')}
				initialTemplate={searchParams.get('template')}
				initialMode={section === 'pages' ? (searchParams.get('view') ?? undefined) : undefined}
				initialCollection={searchParams.get('collection')}
				onTemplateChange={(t) => {
					updateViewState((p) => p.set('template', t));
				}}
				onModeChange={(m) => {
					if (section !== 'pages') return;
					updateViewState((p) => p.set('view', m));
				}}
				onPageOpen={(id) => {
					updateViewState((p) => {
						if (id && id !== 'new') p.set('page', id);
						else p.delete('page');
					});
				}}
			>
				<BuilderFormLayout token={token}>
					<ErrorBoundary>
						<StudioLayout
							storageKey={mod ? `app:${mod.slug}` : undefined}
							header={
								<AppWorkbenchHeader
									mod={mod}
									section={section}
									hasSelectedModel={!!selectedModel}
									view={view}
									onSectionChange={setSection}
									onViewChange={setView}
									onManage={() => setManageOpen(true)}
								/>
							}
							left={
								section === 'models' ? (
									<div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
										<SideSection
											title="Collections"
											action={
												<Button variant="ghost" size="icon-xs" title="New collection" onClick={() => setNewOpen(true)}>
													<Plus size={14} />
												</Button>
											}
										>
											<SearchBox
												value={modelQuery}
												onValueChange={setModelQuery}
												placeholder="Search collections…"
												style={{ marginBottom: 8, width: '100%' }}
											/>
										</SideSection>
										<AppCollectionList
											collections={mod.collections ?? []}
											selected={selected}
											modelQuery={modelQuery}
											onSelect={selectCollection}
											onRequestDelete={(c) => setDeleteTarget(c)}
										/>
									</div>
								) : section === 'menus' ? (
									<MenuPreview
										tree={menuTree}
										selectedId={menuSelected?.id ?? null}
										onSelect={(id) => {
											const find = (list: MenuNode[]): MenuNode | null => {
												for (const n of list) {
													if (n.id === id) return n;
													const c = find(n.children);
													if (c) return c;
												}
												return null;
											};
											setMenuSelected(find(menuTree));
										}}
									/>
								) : section === 'pages' ? (
									<BuilderLeftPane tree={menuTree} />
								) : undefined
							}
							right={
								section === 'models' && view === 'schema' ? (
									<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
										<FieldTypesPanel token={token} onPick={setDraftDef} />
									</div>
								) : section === 'menus' ? (
									<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
										<MenuInspector
											token={token}
											moduleSlug={mod.slug}
											node={menuSelected}
											targetOptions={[
												...new Set([
													...(mod.collections ?? []).map((c) => `/${mod.slug}/${c.slug}`),
													...pages.map((p) => `/${p.path.replace(/^\//, '')}`),
												]),
											]}
											onSaved={() => setMenuReload((v) => v + 1)}
										/>
									</div>
								) : section === 'pages' ? (
									<BuilderRightPane />
								) : undefined
							}
							footer={
								<div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
									<span>
										<strong>{mod.collections?.length ?? 0}</strong> models
									</span>
									<span style={{ marginLeft: 'auto' }}>
										The right panel lists every field type the engine supports — design models in the Form Builder.
									</span>
								</div>
							}
						>
							{section === 'models' ? (
								<div
									style={
										view === 'table'
											? {
													display: 'flex',
													flexDirection: 'column',
													height: '100%',
													padding: '0.75rem',
													maxWidth: 'none',
													margin: 0,
													minHeight: 0,
												}
											: { padding: '1.25rem', maxWidth: 960, margin: '0 auto' }
									}
								>
									{error && (
										<Alert variant="destructive" style={{ marginBottom: '1rem' }}>
											<AlertDescription>{error}</AlertDescription>
										</Alert>
									)}

									{selectedModel ? (
										view === 'table' ? (
											<AppDataPane
												key={selectedModel.slug}
												token={token}
												model={selectedModel}
												schema={selectedSchema}
												fields={fields}
												writeLock={writeLock}
												m2oSchemas={m2oSchemas}
												refreshRows={refreshRows}
												tableReload={tableReload}
												onError={setActionError}
											/>
										) : (
											<AppSchemaPane
												model={selectedModel}
												visibleFields={visibleFields}
												onRemoveField={(name) => void removeField(name)}
												onOpenPanel={openSchemaPanel}
											/>
										)
									) : (
										<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
											<Empty>
												<EmptyHeader>
													<EmptyMedia variant="icon">
														<Database size={32} />
													</EmptyMedia>
													<EmptyTitle>Select a model</EmptyTitle>
													<EmptyDescription>Pick a model from the left to see its fields.</EmptyDescription>
												</EmptyHeader>
											</Empty>
										</div>
									)}
								</div>
							) : section === 'menus' ? (
								<div style={{ padding: '1.25rem', maxWidth: 'none' }}>
									<h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.75rem' }}>Menu Editor</h2>
									{error && (
										<Alert variant="destructive" style={{ marginBottom: '1rem' }}>
											<AlertDescription>{error}</AlertDescription>
										</Alert>
									)}
									<MenuBuilder
										token={token}
										slug={mod.slug}
										collections={mod.collections ?? []}
										selectedId={menuSelected?.id ?? null}
										onSelect={setMenuSelected}
										onTreeChange={setMenuTree}
										reloadKey={menuReload}
									/>
								</div>
							) : section === 'pages' ? (
								<ErrorBoundary>
									<PageCanvas />
								</ErrorBoundary>
							) : undefined}
						</StudioLayout>
					</ErrorBoundary>
				</BuilderFormLayout>
			</PageBuilderProvider>

			<ManageAppDialog
				token={token}
				open={manageOpen}
				onOpenChange={setManageOpen}
				modules={modules}
				initialMode="existing"
				initialSlug={mod.slug}
				onSaved={refreshModule}
			/>

			<NewCollectionDialog
				open={newOpen}
				onOpenChange={setNewOpen}
				token={token}
				moduleSlug={slug ?? ''}
				attachedSlugs={attachedSlugs}
				onCreated={async (created) => {
					queryClient.setQueryData(qk.collection(created.slug), created);
					if (slug) await invalidateModule(queryClient, slug);
					await invalidateCollectionList(queryClient);
					selectCollection(created.slug);
				}}
				onBound={async (bound) => {
					if (slug) await invalidateModule(queryClient, slug);
					selectCollection(bound);
				}}
				onError={(message) => setActionError(message)}
			/>

			<AddFieldDialog
				def={draftDef}
				collectionName={selectedModel?.name ?? selected ?? ''}
				currentCollection={selected ?? ''}
				collections={mod?.collections ?? []}
				fields={fields}
				schemas={dialogSchemas}
				token={token}
				onCreate={createField}
				onClose={() => setDraftDef(null)}
			/>

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

			{/* Role-based field visibility — the RBAC panel (was part of the standalone Form Builder page). */}
			<PanelDialog
				open={permOpen}
				onOpenChange={setPermOpen}
				title="Field Permissions"
				description={<>Control which fields each role can see for “{selectedModel?.name ?? selected ?? 'this collection'}”.</>}
				contentStyle={{ width: 460, maxHeight: '82vh', overflowY: 'auto' }}
			>
				{selected && <PermissionsPanel token={token} slug={selected} fields={fields} />}
			</PanelDialog>

			{/* Multi-level approval workflow designer — engine-enforced on submit/approve/reject. */}
			<PanelDialog
				open={wfOpen}
				onOpenChange={setWfOpen}
				title="Approval Workflow"
				description={
					<>Submit routes documents through role-gated approval levels for “{selectedModel?.name ?? selected ?? 'this collection'}”.</>
				}
				contentStyle={{ width: 560, maxHeight: '82vh', overflowY: 'auto' }}
			>
				{selected && <WorkflowPanel token={token} slug={selected} fields={fields} schema={selectedSchema} />}
			</PanelDialog>

			{/* Per-collection audit toggle (Directus-style) — schema_json.audit_enabled. */}
			<PanelDialog
				open={auditOpen}
				onOpenChange={setAuditOpen}
				title="Audit Log"
				description={
					<>Control whether changes to “{selectedModel?.name ?? selected ?? 'this collection'}” are recorded in the audit trail.</>
				}
				contentStyle={{ width: 480 }}
			>
				{selected && (
					<AuditPanel
						token={token}
						slug={selected}
						schema={selectedSchema}
						onSaved={() => {
							void invalidateCollection(queryClient, selected);
						}}
					/>
				)}
			</PanelDialog>

			{/* Runtime feature policies — headless control plane (schema_json.policies). */}
			<PanelDialog
				open={policyOpen}
				onOpenChange={setPolicyOpen}
				title="Runtime Policies"
				description={
					<>
						Enable / configure engine behaviors for “{selectedModel?.name ?? selected ?? 'this collection'}” at runtime — no code, no
						redeploy.
					</>
				}
				contentStyle={{ width: 480 }}
			>
				{selected && <PolicyPanel token={token} slug={selected} schema={selectedSchema} />}
			</PanelDialog>

			{/* Governed generation — propose fields from a design, review the visible
			 * inference, then apply. Nothing is written until Apply. */}
			<PanelDialog
				open={generationOpen}
				onOpenChange={setGenerationOpen}
				title="Generate Schema"
				description={
					<>Propose a collection’s fields from a DesignDNA, review the inference, then apply. Proposals never write until you apply.</>
				}
				contentStyle={{ width: 720 }}
			>
				<GenerationPanel
					token={token}
					defaultName={selectedModel?.name}
					defaultSlug={selected ?? ''}
					onApplied={() => queryClient.invalidateQueries()}
				/>
			</PanelDialog>

			{/* Auto-numbering Doc No. — the collection's naming-series pattern (prefix +
			 * optional `#` counter width). The engine assigns display_number at create;
			 * empty pattern turns numbering off. */}
			<DocNoDialog
				open={docNoOpen}
				onOpenChange={setDocNoOpen}
				id="docno-pattern"
				name={selectedModel?.name ?? selected ?? 'this collection'}
				value={docNoValue}
				onValueChange={setDocNoValue}
				example={docNoExample}
				busy={docNoBusy}
				onCancel={() => setDocNoOpen(false)}
				onSave={() => void saveDocNo()}
			/>
		</>
	);
}
