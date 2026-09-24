import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
	Card,
	CardContent,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
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
	Input,
	Label,
	SearchBox,
} from '@mmbix/design-system';
import { DataTable, type ColumnDef, type DataTableInstance, type FetchParams, type FetchResult } from '@mmbix/design-system/datatable';
import {
	ArchiveRestore,
	Braces,
	ChevronLeft,
	Database,
	Download,
	Eye,
	EyeOff,
	Gauge,
	Hash,
	MoreVertical,
	Plus,
	Settings2,
	Table2,
	Trash2,
	X,
	Zap,
} from 'lucide-react';
import AddFieldDialog from '../components/AddFieldDialog';
import FieldTypesPanel from '../components/FieldTypesPanel';
import PolicyPanel from '../components/PolicyPanel';
import RecordDetailView from '../components/RecordDetailView';
import RecordFormDialog from '../components/RecordFormDialog';
import StudioLayout, { SideSection } from '../components/StudioLayout';
import { FieldInspector, FieldTypeIcon } from '../components/formlayout';
import { DataCell } from '../components/DataCell';
import {
	bulkDelete,
	bulkErrorMessage,
	bulkRestore,
	createCollection,
	deleteCollection,
	setCollectionHidden,
	updateCollectionFields,
	updateCollectionMeta,
	SYSTEM_FIELD_NAMES,
	namingSeriesExample,
	type CollectionSummary,
	type EntityListParams,
	type EntitySchema,
	type FieldDefinition,
	type FieldTypeDef,
} from '../lib/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { codeHooksQuery, collectionQuery, collectionsQuery, itemsQuery, serverHooksQuery } from '../lib/queries';
import { invalidateCollectionList, invalidateRows } from '../lib/query-client';
import { qk } from '../lib/query-keys';
import { writeLockOf, isRowFrozen, partitionFrozenRows, frozenRowsReason } from '../lib/write-lock';
import { useStore } from '@tanstack/react-store';
import { setRegistryQuery, setShowHiddenCollections, studioUiStore } from '../lib/studio-store';
import { messageOf } from '../lib/errors';
import { useFieldTypes } from '../lib/use-field-types';
import { isHiddenCollection } from '../lib/idp';
import { popBack, useViewState } from '../lib/view-state';
import { buildTableColumns, serializeTableFilters, useM2oSchemas } from '../lib/collection-table-filters';
import { buildListFields } from '../lib/list-projection';
import ExportDialog from '../components/ExportDialog';
import {
	buildCsv,
	collectAllRows,
	fieldMapOf,
	itemsParamsFromFetch,
	type ExportColumnsScope,
	type ExportRowsScope,
} from '../lib/csv-export';
import { CodeHookCard, CollectionsPaneToggle, parseHookRules } from '../components/collections/workbench-parts';

/**
 * CollectionsWorkbench — the schema registry as a full app-workbench, reusing
 * the SAME layout the catalog details use (StudioLayout 3-pane shell):
 *
 *   left:   all non-system, non-IDP collections + New collection. Collections
 *           flagged meta.hidden (engine list-visibility flag) stay out unless
 *           the eye toggle reveals them — data/schema access is unaffected.
 *   center: the focused collection — table view (records) ⇄ schema view (fields)
 *   right:  the backend field-type palette (add fields straight from here)
 *
 * Module-free on purpose: no app/module reference, collections are real backend
 * tables usable by any app. System (`_`), IDP-internal (`idp_`) and user-hidden
 * (meta.hidden) collections are excluded from the default list.
 */
export default function CollectionsWorkbench({ token }: { token: string }) {
	const navigate = useNavigate();
	const { slug } = useParams<{ slug: string }>();
	// All URL reads/writes go through the shared useViewState hook (lib/view-state.ts):
	// ?collection= & ?view= describe view state on this one route, so writes REPLACE the
	// current history entry instead of pushing — the back arrow leaves the workbench in
	// one press instead of walking back through every collection/view switch.
	const { searchParams, update: updateViewState } = useViewState();

	const queryClient = useQueryClient();
	// Write-action errors only — read errors come from the queries themselves.
	const [actionError, setActionError] = useState<string | null>(null);

	// Left-pane registry filters are CLIENT state (TanStack Store), not server
	// state and not URL state, so they survive a remount / route change without
	// polluting history.
	const modelQuery = useStore(studioUiStore, (s) => s.registryQuery);
	const showHidden = useStore(studioUiStore, (s) => s.showHiddenCollections);

	// Selection + view are URL-backed (?collection= & ?view=) so reloads keep state.
	const selected = searchParams.get('collection');
	const rawView = searchParams.get('view');

	// ── Server state (TanStack Query) ───────────────────────────────────────
	// Every read the view needs is a keyed query: StrictMode/HMR remounts and
	// back-and-forth navigation reuse cache entries instead of re-fetching, and a
	// write invalidates exactly what it changed (see the handlers below). The
	// registry list is the schema truth (backend `_entity_schemas`).
	const collectionsQ = useQuery(collectionsQuery(token));
	const schemaQ = useQuery(collectionQuery(token, selected));
	const serverHooksQ = useQuery(serverHooksQuery(token, selected));
	const codeHooksQ = useQuery(codeHooksQuery(token));

	const collections = useMemo(() => (collectionsQ.data ?? []).filter((c) => !isHiddenCollection(c.slug)), [collectionsQ.data]);
	const selectedSchema = schemaQ.data;
	const hooks = useMemo(() => (serverHooksQ.data ?? []).filter((h) => h.collection_slug === selected), [serverHooksQ.data, selected]);
	const codeHooks = useMemo(() => codeHooksQ.data ?? [], [codeHooksQ.data]);
	const loading = collectionsQ.isPending;
	const hooksLoading = !!selected && serverHooksQ.isPending;
	const hooksError = messageOf(serverHooksQ.error);
	const codeHooksLoading = codeHooksQ.isPending;
	const codeHooksError = messageOf(codeHooksQ.error);
	// A read failure (registry / schema / hooks) OR a write-action failure.
	const error = actionError ?? messageOf(collectionsQ.error) ?? messageOf(schemaQ.error) ?? hooksError ?? codeHooksError;
	// When true, the center's "Back to Collections" keeps the empty "Select a
	// collection" landing instead of auto-picking the first collection again.
	const stayOnCollectionList = useRef(false);
	const [view, setViewState] = useState<'table' | 'schema'>(rawView === 'table' ? 'table' : 'schema');
	const setView = useCallback(
		(v: 'table' | 'schema') => {
			updateViewState((p) => p.set('view', v));
			setViewState(v);
		},
		[updateViewState],
	);

	// Path variant /idp/collections/:slug → normalize into ?collection= (once).
	useEffect(() => {
		if (slug && !searchParams.get('collection')) updateViewState((p) => p.set('collection', slug));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [slug]);

	const selectCollection = useCallback(
		(slug: string | null) => {
			updateViewState((p) => {
				if (slug) {
					p.set('collection', slug);
					stayOnCollectionList.current = false;
				} else {
					p.delete('collection');
				}
				p.delete('row');
			});
			setOpenRecord(null);
			setOpenSchema(null);
			setSelectedRows([]);
			setCreateOpen(false);
			setCreateTarget(null);
			setCreatePrefill(null);
			setHooksOpen(false);
			setPolicyOpen(false);
		},
		[updateViewState],
	);

	/** Center-header "← Collections": clear the focus so the registry list shows. */
	const goBackToCollections = useCallback(() => {
		stayOnCollectionList.current = true;
		selectCollection(null);
	}, [selectCollection]);

	// ── Derived registry rows ──────────────────────────────────
	// Engine-system/IDP collections are excluded above; user-hidden ones
	// (meta.hidden) only surface when the reveal toggle is on.
	const visibleCollections = useMemo(() => (showHidden ? collections : collections.filter((c) => !c.hidden)), [collections, showHidden]);

	// Default-select the first VISIBLE collection (hidden ones must never be auto-opened)
	// — unless the user just asked to go back to the collection list (stay on landing).
	useEffect(() => {
		if (stayOnCollectionList.current) return;
		if (!selected && visibleCollections.length > 0) selectCollection(visibleCollections[0].slug);
	}, [visibleCollections, selected, selectCollection]);

	const selectedModel = collections.find((c) => c.slug === selected) ?? null;
	const collectionName = selectedModel?.name ?? selectedSchema?.name ?? selected ?? '';

	const fields = useMemo<FieldDefinition[]>(() => selectedSchema?.schema_json.fields ?? [], [selectedSchema]);

	// The engine-enforced WRITE policy for the focused collection. A `service`
	// collection has NO generic writes (the generic entity API 403s), so the data
	// table must not offer create / edit / delete; `append_only` blocks update /
	// delete. See `write-lock.ts`.
	const writeLock = useMemo(() => writeLockOf(selectedSchema), [selectedSchema]);
	const visibleFields = useMemo(() => fields.filter((f) => !SYSTEM_FIELD_NAMES.has(f.name)), [fields]);

	// ── record view state (table view) ──────────────────────────────────────
	const [editRecord, setEditRecord] = useState<Record<string, unknown> | null>(null);
	const [createOpen, setCreateOpen] = useState(false);
	// o2m child-create target — when set, RecordFormDialog creates a RELATED child
	// (e.g. a join row whose counterpart must be picked) instead of a record of the
	// focused collection; createPrefill carries the FK back to the parent record.
	const [createTarget, setCreateTarget] = useState<{ collection: { slug: string; name: string }; schema: EntitySchema } | null>(null);
	const [createPrefill, setCreatePrefill] = useState<Record<string, unknown> | null>(null);
	const [openRecord, setOpenRecord] = useState<Record<string, unknown> | null>(null);
	const [openSchema, setOpenSchema] = useState<EntitySchema | null>(null);
	// The lock for the record OPEN in the detail view — it may be a related
	// collection, and a row can be frozen by `freeze_when` (a 403 on update/delete).
	const openWriteLock = useMemo(() => writeLockOf(openSchema ?? selectedSchema), [openSchema, selectedSchema]);
	const [selectedRows, setSelectedRows] = useState<Record<string, unknown>[]>([]);
	// The selection split by the row-level `freeze_when` rule, so the bulk action
	// only targets rows a generic write may touch (and reports the skipped ones).
	const selectedPartition = useMemo(() => partitionFrozenRows(writeLock, selectedRows), [writeLock, selectedRows]);
	// Bump to refetch the rows after a record create/edit/delete.
	const [reloadTick, setReloadTick] = useState(0);
	// Trash view — soft-deleted rows stay in the table and are reachable here
	// (the live list hides them, which can make pagination look "short").
	const [trashMode, setTrashMode] = useState(false);

	// New Collection dialog state.
	const [newOpen, setNewOpen] = useState(false);
	const [newName, setNewName] = useState('');
	const [newDescription, setNewDescription] = useState('');
	const [newNaming, setNewNaming] = useState('');
	const [newBusy, setNewBusy] = useState(false);
	// Doc No. (naming series) editor — per-collection auto-numbering pattern.
	const [docNoOpen, setDocNoOpen] = useState(false);
	const [docNoValue, setDocNoValue] = useState('');
	const [docNoBusy, setDocNoBusy] = useState(false);
	// Lifecycle hooks / code hooks are QUERY state (see the query block above);
	// only the dialog's open flag is local UI state.
	const [hooksOpen, setHooksOpen] = useState(false);
	// Runtime feature policies (auto-index / cache / offline reads) for the focused
	// collection — the same control plane the API exposes via
	// PUT /api/collections/:slug/policies. Managed here, where collections are
	// actually curated, rather than only inside an app module's detail page.
	const [policyOpen, setPolicyOpen] = useState(false);

	// Code hooks grouped for the focused collection — those that FIRE on it, and
	// those that REWRITE it when they fire on ANOTHER collection (e.g. veh-relink
	// keeps fleet pointers fresh from permit/policy writes — so vehicles shows
	// them under "rewrites this collection").
	const codeOnCollection = useMemo(() => codeHooks.filter((h) => h.collection === selected), [codeHooks, selected]);
	const codeAffectingCollection = useMemo(
		() => codeHooks.filter((h) => h.collection !== selected && selected != null && h.writes_to.includes(selected)),
		[codeHooks, selected],
	);
	const hookTotal = hooks.length + codeOnCollection.length + codeAffectingCollection.length;

	// Collection pending deletion — confirmed via AlertDialog before DELETE /api/collections/:slug.
	const [deleteTarget, setDeleteTarget] = useState<CollectionSummary | null>(null);
	const [deleteBusy, setDeleteBusy] = useState(false);

	// Add-field flow — palette pick (right pane) → type-aware property dialog.
	const [draftDef, setDraftDef] = useState<FieldTypeDef | null>(null);

	// Edit-field flow — the field “⋯” menu opens FieldInspector in a dialog so
	// per-field properties (index/unique/required/options/…) can be changed.
	const [editField, setEditField] = useState<FieldDefinition | null>(null);
	const fieldTypes = useFieldTypes(token);
	// The inspector auto-saves on every change — writes are trailing-debounced
	// so typing/toggling never fires overlapping PUTs whose out-of-order
	// responses would clobber newer edits. Refs keep the async writer on the
	// latest schema even when the debounce fires after a re-render.
	const editSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const editVersionRef = useRef(0);
	// The edit version last written to the backend — a flush is only needed when it
	// lags editVersionRef (i.e. there ARE unsaved edits).
	const persistedVersionRef = useRef(0);
	const selectedRef = useRef(selected);
	selectedRef.current = selected;

	// Table columns from the focused collection's schema — typed filter metadata is
	// derived generically from field types (m2o columns filter on the related row's
	// display leaf; related schemas load via useM2oSchemas from the query cache).
	const m2oSchemas = useM2oSchemas(token, fields);
	// Schemas the add-field dialog may look up — every m2o target plus the focused
	// collection, taken from the query cache (no accumulating schema map needed).
	const dialogSchemas = useMemo(() => {
		const out: Record<string, EntitySchema> = { ...m2oSchemas };
		if (selected && selectedSchema) out[selected] = selectedSchema;
		return out;
	}, [m2oSchemas, selected, selectedSchema]);
	const tableColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(
		() =>
			buildTableColumns(fields, m2oSchemas, {
				systemFieldNames: SYSTEM_FIELD_NAMES,
				renderCell: (field, value) => <DataCell field={field} value={value} />,
			}),
		[fields, m2oSchemas],
	);

	// Server-side fetch — cursor pagination, sorting, search, filters. The read
	// goes through Query (`queryClient.fetchQuery`), so it shares the app cache and
	// in-flight dedup, and a row write invalidates it precisely (no remount storm).
	//
	// The closure stays STABLE: the DataTable re-runs its server-fetch effect when
	// `fetchData` identity changes, and `fields`/`m2oSchemas` change as schemas load,
	// so the latest values are read from a ref.
	const fetchCtxRef = useRef({ token, selected, trashMode, fields, m2oSchemas });
	fetchCtxRef.current = { token, selected, trashMode, fields, m2oSchemas };
	// The last `FetchParams` the table asked for — replayed by "export all rows" so
	// the "what you filtered/sorted/searching" the export walks is EXACTLY what the
	// page is showing (the DataTable's instance does not expose filters/sorting).
	const lastFetchParamsRef = useRef<FetchParams | null>(null);

	const fetchData = useCallback(
		async (params: FetchParams): Promise<FetchResult<Record<string, unknown>>> => {
			lastFetchParamsRef.current = params;
			const { token, selected, trashMode, fields, m2oSchemas } = fetchCtxRef.current;
			if (!selected) return { rows: [], nextCursor: null, prevCursor: null };
			// Lean table projection instead of `*.*`: own columns + m2o labels + id-only
			// relation arrays (see lib/list-projection.ts). The DataTable only fetches
			// once the schema is known, so `fields` is never empty here.
			const entityParams: EntityListParams = { limit: params.pagination.pageSize, trashed: trashMode, fields: buildListFields(fields) };
			if (params.cursor) {
				entityParams.cursor = params.cursor;
				entityParams.dir = params.cursorDir ?? 'after';
			}
			if (params.sorting) entityParams.sort = `${params.sorting.direction === 'desc' ? '-' : ''}${params.sorting.id}`;
			if (params.globalFilter) entityParams.search = params.globalFilter;
			entityParams.filters = serializeTableFilters(params.filters, fields, m2oSchemas);
			return await queryClient.fetchQuery(itemsQuery(token, selected, entityParams));
		},
		[queryClient],
	);

	// ── handlers ────────────────────────────────────────────────────────────

	async function createModel(e: React.FormEvent) {
		e.preventDefault();
		if (!newName.trim() || newBusy || namingSeriesExample(newNaming) === false) return;
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
			selectCollection(created.slug);
		} catch (err) {
			setActionError(err instanceof Error ? err.message : 'Create failed');
		} finally {
			setNewBusy(false);
		}
	}

	// Doc No. (naming series) — live previews for the create + existing-collection dialogs.
	const newNamingExample = namingSeriesExample(newNaming);
	const docNoExample = namingSeriesExample(docNoValue);

	// Open the Doc No. editor seeded with the collection's CURRENT pattern.
	async function openDocNoDialog() {
		if (!selected) return;
		try {
			// `fetchQuery` shares the schema cache — no duplicate read, and a fresh
			// one when the entry is stale.
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
			setActionError(null);
		} catch (err) {
			setActionError(err instanceof Error ? err.message : 'Failed to update Doc No.');
		} finally {
			setDocNoBusy(false);
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
			if (selected === removedSlug) selectCollection(null);
			// Drop the deleted collection's cached schema + rows, then refresh the list.
			queryClient.removeQueries({ queryKey: qk.collection(removedSlug) });
			queryClient.removeQueries({ queryKey: qk.rows(removedSlug) });
			await invalidateCollectionList(queryClient);
		} catch (err) {
			setActionError(err instanceof Error ? err.message : 'Delete failed');
			setDeleteTarget(null);
		} finally {
			setDeleteBusy(false);
		}
	}

	/** meta.hidden — hide/show a collection in this schema-registry list (records/schema stay fully editable). */
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

	async function addField(field: FieldDefinition) {
		if (!selected || !selectedSchema) return;
		try {
			const updated = await updateCollectionFields(token, selected, [...fields, field]);
			queryClient.setQueryData(qk.collection(selected), updated);
			// The whole field list was just written — nothing pending to flush.
			persistedVersionRef.current = editVersionRef.current;
			setDraftDef(null);
			setActionError(null);
			// A new column changes the row shape — refetch the visible page.
			await invalidateRows(queryClient, selected);
			setReloadTick((v) => v + 1);
		} catch (e) {
			setActionError(e instanceof Error ? e.message : 'Create failed');
		}
	}

	async function removeField(fieldName: string) {
		if (!selected || !selectedSchema) return;
		// Drop any queued edit-write — the removal PUT below carries the whole
		// latest field list anyway, and a late debounce fire would re-add the field.
		if (editSaveTimer.current) {
			clearTimeout(editSaveTimer.current);
			editSaveTimer.current = null;
		}
		if (!confirm(`Delete field "${fieldName}" from "${collectionName}"? The column is removed from the table.`)) return;
		try {
			const updated = await updateCollectionFields(
				token,
				selected,
				fields.filter((f) => f.name !== fieldName),
			);
			queryClient.setQueryData(qk.collection(selected), updated);
			persistedVersionRef.current = editVersionRef.current;
			setActionError(null);
			// The column is gone — refetch the visible page without it.
			await invalidateRows(queryClient, selected);
			setReloadTick((v) => v + 1);
		} catch (e) {
			setActionError(e instanceof Error ? e.message : 'Delete failed');
		}
	}

	// FieldInspector auto-saves on every change: apply the patch to the local
	// schema immediately (optimistic) and schedule a trailing PUT with the whole
	// new field list. Sending the full list keeps ordering/system-field handling
	// server-side, and the debounce means a fast typist never fires overlapping
	// writes whose responses could arrive out of order and drop edits.
	function updateField(name: string, patch: Partial<FieldDefinition>) {
		const slug = selectedRef.current;
		const schema = slug ? queryClient.getQueryData<EntitySchema>(qk.collection(slug)) : undefined;
		if (!slug || !schema) return;
		const next = schema.schema_json.fields.map((f) => (f.name === name ? { ...f, ...patch } : f));
		queryClient.setQueryData<EntitySchema>(qk.collection(slug), {
			...schema,
			schema_json: { ...schema.schema_json, fields: next },
		});
		// Patch the dialog's copy in the SAME commit so controlled inputs never lag
		// a render behind the optimistic schema (typing stays smooth, no flicker).
		setEditField((prev) => (prev && prev.name === name ? { ...prev, ...patch } : prev));
		editVersionRef.current += 1;
		if (editSaveTimer.current) clearTimeout(editSaveTimer.current);
		editSaveTimer.current = setTimeout(() => void persistFieldChanges(), 350);
	}

	/** Write the latest local field list to the backend (used by the debounce, dialog close and unmount). */
	async function persistFieldChanges() {
		if (editSaveTimer.current) {
			clearTimeout(editSaveTimer.current);
			editSaveTimer.current = null;
		}
		const slug = selectedRef.current;
		const schema = slug ? queryClient.getQueryData<EntitySchema>(qk.collection(slug)) : undefined;
		if (!slug || !schema) return;
		const versionAtSend = editVersionRef.current;
		try {
			const updated = await updateCollectionFields(token, slug, schema.schema_json.fields);
			persistedVersionRef.current = versionAtSend;
			// Only reconcile with the server response when no newer local edit landed
			// while the request was in flight — otherwise the local state already has
			// a fresher field list whose own debounced write will persist it.
			if (editVersionRef.current === versionAtSend) {
				queryClient.setQueryData(qk.collection(slug), updated);
				setActionError(null);
			}
		} catch (e) {
			setActionError(e instanceof Error ? e.message : 'Save failed');
		}
	}

	/** True when field edits are queued / not yet written to the backend. */
	function hasPendingEdits(): boolean {
		return editSaveTimer.current !== null || editVersionRef.current !== persistedVersionRef.current;
	}

	/**
	 * Flush pending field edits, but ONLY when there are any. Leaving the workbench
	 * (or closing the inspector) with no edits must not fire a schema PUT — that
	 * write bumps `_schema_version` and drops the server read caches for every
	 * client even though nothing changed.
	 */
	function flushPendingEdits(): void {
		if (hasPendingEdits()) void persistFieldChanges();
	}

	// Keep the editor dialog on the canonical persisted field: after every PUT
	// the server returns the field list reordered/normalized, so mirror `fields`
	// back into the dialog copy; close the dialog when the field was removed.
	useEffect(() => {
		if (!editField) return;
		const current = fields.find((f) => f.name === editField.name);
		if (!current) setEditField(null);
		else if (current !== editField) setEditField(current);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fields]);

	// Flush any pending edit when the workbench unmounts (navigation away).
	useEffect(() => {
		return () => {
			flushPendingEdits();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function deleteRows(rows: Record<string, unknown>[]) {
		if (!selected || rows.length === 0) return;
		// Defensive: the DataTable hides the delete action when the collection is
		// not generically writable, but the guard stays here too.
		if (!writeLock.canMutate) {
			setActionError(writeLock.reason ?? 'This collection cannot be written through the generic entity API.');
			return;
		}
		// Rows frozen by `freeze_when` (e.g. a confirmed inbound) 403 a generic
		// delete — skip them so one frozen row cannot fail the whole batch.
		const { writable, frozen } = partitionFrozenRows(writeLock, rows);
		if (writable.length === 0) {
			setActionError(frozenRowsReason(writeLock, frozen.length));
			return;
		}
		if (
			!confirm(
				`Delete ${writable.length} record${writable.length === 1 ? '' : 's'}${frozen.length ? ` (${frozen.length} frozen skipped)` : ''}?`,
			)
		)
			return;
		try {
			// ONE bulk request for N rows (the engine runs the per-row pipeline at
			// bounded concurrency) instead of N sequential DELETE round trips.
			const results = await bulkDelete(
				token,
				selected,
				writable.map((r) => String(r.id)),
			);
			setSelectedRows([]);
			// Refetch the visible page (the invalidated query) without reloading the schema.
			await invalidateRows(queryClient, selected);
			setReloadTick((t) => t + 1);
			setActionError(
				[bulkErrorMessage(results), frozen.length > 0 ? frozenRowsReason(writeLock, frozen.length) : ''].filter(Boolean).join(' '),
			);
		} catch (e) {
			setActionError(e instanceof Error ? e.message : 'Delete failed');
		}
	}

	// Restore one or more soft-deleted records (from trash mode).
	async function restoreRows(rows: Record<string, unknown>[]) {
		if (!selected || rows.length === 0) return;
		if (!writeLock.canMutate) {
			setActionError(writeLock.reason ?? 'This collection cannot be written through the generic entity API.');
			return;
		}
		const { writable, frozen } = partitionFrozenRows(writeLock, rows);
		if (writable.length === 0) {
			setActionError(frozenRowsReason(writeLock, frozen.length));
			return;
		}
		try {
			const results = await bulkRestore(
				token,
				selected,
				writable.map((r) => String(r.id)),
			);
			setSelectedRows([]);
			await invalidateRows(queryClient, selected);
			setReloadTick((t) => t + 1);
			setActionError(
				[bulkErrorMessage(results), frozen.length > 0 ? frozenRowsReason(writeLock, frozen.length) : ''].filter(Boolean).join(' '),
			);
		} catch (e) {
			setActionError(e instanceof Error ? e.message : 'Restore failed');
		}
	}

	// ── CSV export ─────────────────────────────────────────────────────────
	// A one-shot: the Export button captures the CURRENT table snapshot (rows in
	// memory + the params the page was fetched with), and the dialog only decides
	// scope — page vs all rows, visible vs all columns.
	const [exportState, setExportState] = useState<{
		pageRows: Record<string, unknown>[];
		visibleIds: Set<string>;
	} | null>(null);

	function openExport(tableInstance: DataTableInstance<Record<string, unknown>>) {
		if (!selected) return;
		const pageRows = tableInstance.table.getFilteredRowModel().rows.map((r) => r.original);
		const visibleIds = new Set<string>();
		const visibility = tableInstance.table.getState().columnVisibility;
		for (const c of tableColumns) {
			if (visibility[c.id] !== false) visibleIds.add(c.id);
		}
		setExportState({ pageRows, visibleIds });
	}

	function closeExport() {
		setExportState(null);
	}

	async function runExport(scope: { rows: ExportRowsScope; columns: ExportColumnsScope }): Promise<string> {
		if (!selected || !exportState) throw new Error('No rows to export');
		const { token, trashMode, fields, m2oSchemas } = fetchCtxRef.current;
		const pageParams = lastFetchParamsRef.current;
		const fieldByName = fieldMapOf(fields);
		const allColumns = tableColumns.filter((c) => c.enableHiding !== false);
		const columns = scope.columns === 'visible' ? allColumns.filter((c) => exportState.visibleIds.has(c.id)) : allColumns;
		const rows =
			scope.rows === 'page'
				? exportState.pageRows
				: await collectAllRows(token, selected, itemsParamsFromFetch(fields, m2oSchemas, pageParams ?? undefined, { trashed: trashMode }));
		return buildCsv(rows, columns, fieldByName);
	}

	function openRecordView(rec: Record<string, unknown>, schema: EntitySchema | undefined) {
		setOpenRecord(rec);
		setOpenSchema(schema ?? null);
	}

	const left =
		loading && collections.length === 0 ? (
			<div style={{ padding: '1rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Loading collections…</div>
		) : (
			<div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
				<SideSection
					title="Collections"
					action={
						<div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
							<CollectionsPaneToggle />
							<Button
								variant="ghost"
								size="icon-xs"
								title={showHidden ? 'Hide hidden collections' : 'Reveal hidden collections'}
								onClick={() => setShowHiddenCollections(!showHidden)}
							>
								{showHidden ? <EyeOff size={14} /> : <Eye size={14} />}
							</Button>
							<Button
								variant="ghost"
								size="icon-xs"
								title="New collection"
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
					}
				>
					<SearchBox
						value={modelQuery}
						onValueChange={setRegistryQuery}
						placeholder="Search collections…"
						style={{ marginBottom: 8, width: '100%' }}
					/>
				</SideSection>
				{visibleCollections.length === 0 ? (
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
				) : (
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
												onClick={() => selectCollection(c.slug)}
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
														style={{ color: active ? 'var(--mmbix-primary-foreground, #ffffff)' : '#9ca3af', flexShrink: 0 }}
													/>
												) : (
													<Database
														size={13}
														style={{ color: active ? 'var(--mmbix-primary-foreground, #ffffff)' : '#9ca3af', flexShrink: 0 }}
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
														color: active ? 'var(--mmbix-primary-foreground, #ffffff)' : '#9ca3af',
														cursor: 'pointer',
														flexShrink: 0,
													}}
												>
													<MoreVertical size={13} />
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end" sideOffset={4} style={{ minWidth: 190 }}>
													{c.hidden ? (
														<DropdownMenuItem onClick={() => void updateCollectionVisibility(c, false)}>
															<Eye size={13} /> Show in collections list
														</DropdownMenuItem>
													) : (
														<DropdownMenuItem onClick={() => void updateCollectionVisibility(c, true)}>
															<EyeOff size={13} /> Hide from collections list
														</DropdownMenuItem>
													)}
													<DropdownMenuSeparator />
													<DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(c)}>
														<Trash2 size={13} /> Delete collection
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</div>
									);
								})}
						</div>
					</div>
				)}
			</div>
		);

	const right = (
		<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
			<FieldTypesPanel
				token={token}
				types={fieldTypes}
				onPick={(def) => {
					// The palette lives in the right pane — picking a type needs a
					// focused collection, otherwise the AddFieldDialog has no target.
					if (!selected) {
						setActionError('Select a collection first, then pick a field type.');
						return;
					}
					setDraftDef(def);
				}}
			/>
		</div>
	);

	const center =
		!selected || !selectedSchema ? (
			!selected ? (
				// No collection focused → the Collections registry overview (the back target).
				<div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', minHeight: 0 }}>
					<div style={{ maxWidth: 860, margin: '0 auto' }}>
						<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem' }}>
							<h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>Collections</h2>
							<Badge variant="outline">{visibleCollections.length}</Badge>
						</div>

						{visibleCollections.length === 0 ? (
							<p style={{ margin: 0, color: 'var(--mmbix-muted-foreground, #6b7280)', fontSize: '0.85rem' }}>
								No collections here yet — create one to start designing fields and records.
							</p>
						) : (
							<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
								{visibleCollections.map((c) => (
									<Card
										key={c.id}
										title={`Open ${c.name}`}
										style={{ padding: 0, cursor: 'pointer' }}
										onClick={() => selectCollection(c.slug)}
									>
										<CardContent style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.7rem 0.75rem' }}>
											<span
												style={{
													width: 32,
													height: 32,
													borderRadius: 8,
													background: 'var(--mmbix-muted, #f3f4f6)',
													color: '#6b7280',
													display: 'inline-flex',
													alignItems: 'center',
													justifyContent: 'center',
													flexShrink: 0,
												}}
											>
												<Database size={15} />
											</span>
											<div style={{ minWidth: 0, flex: 1 }}>
												<div
													style={{
														fontSize: '0.88rem',
														fontWeight: 600,
														whiteSpace: 'nowrap',
														overflow: 'hidden',
														textOverflow: 'ellipsis',
													}}
												>
													{c.name}
												</div>
												<div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{c.slug}</div>
											</div>
										</CardContent>
									</Card>
								))}
							</div>
						)}
					</div>
				</div>
			) : (
				// A collection is chosen but its schema is still loading — lightweight placeholder.
				<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
					<p style={{ color: 'var(--mmbix-muted-foreground, #6b7280)', fontSize: '0.85rem' }}>Loading schema…</p>
				</div>
			)
		) : view === 'table' ? (
			createOpen && (createTarget?.schema ?? selectedSchema) ? (
				<RecordFormDialog
					token={token}
					open={createOpen}
					onOpenChange={(v) => {
						setCreateOpen(v);
						if (!v) {
							setCreateTarget(null);
							setCreatePrefill(null);
						}
					}}
					collection={createTarget?.collection ?? selectedModel ?? { slug: selected, name: collectionName }}
					schema={createTarget?.schema ?? selectedSchema}
					record={editRecord}
					initialValues={createPrefill ?? undefined}
					// A child-create can target a collection whose own policy forbids
					// generic writes — disable submit there too.
					readOnly={!writeLockOf(createTarget?.schema ?? selectedSchema).canCreate}
					onSaved={() => {
						setCreateOpen(false);
						setCreateTarget(null);
						setCreatePrefill(null);
						// Drop the cached page FIRST, then remount: the DataTable's `fetchData`
						// goes through `queryClient.fetchQuery`, so without the invalidation the
						// 30s staleTime served the pre-edit rows until a full page reload.
						void invalidateRows(queryClient, selected).then(() => setReloadTick((t) => t + 1));
						// A child-create (sidebar “add”) returns to the parent record detail —
						// bump the record identity so RecordDetailView re-fetches its rows.
						setOpenRecord((r) => (r ? { ...r } : r));
					}}
					onCreated={(rec) => {
						// o2m children need the parent row to exist first — hop straight into
						// the fresh record's detail view so the related-items sidebar is there.
						if (createTarget) return; // child-create from a parent detail — stay put
						const hasO2m = (selectedSchema?.schema_json.fields ?? []).some((f) => f.type === 'o2m' && f.related_collection);
						if (hasO2m && rec && rec.id != null) {
							setEditRecord(null);
							openRecordView(rec, selectedSchema);
						}
					}}
				/>
			) : openRecord && (openSchema ?? selectedSchema) ? (
				<RecordDetailView
					token={token}
					collection={selectedModel ?? { slug: selected, name: collectionName }}
					schema={openSchema ?? selectedSchema}
					record={openRecord}
					// Browse-only when the OPENED collection (which may be a related one)
					// is not generically writable, or this row is frozen.
					readOnly={!openWriteLock.canMutate || isRowFrozen(openWriteLock, openRecord)}
					onClose={() => {
						setOpenRecord(null);
						setOpenSchema(null);
					}}
					onSaved={() => {
						setOpenRecord(null);
						// Invalidate the collection's cached pages BEFORE the table remounts,
						// otherwise `fetchData`'s `fetchQuery` serves the 30s-stale page and the
						// edit only appeared after a full reload.
						void invalidateRows(queryClient, selected).then(() => setReloadTick((t) => t + 1));
					}}
					onOpenRelated={(coll, schema, rec) => {
						setOpenSchema(schema);
						setOpenRecord(rec);
					}}
					onAddRelated={(coll, schema, prefill) => {
						setEditRecord(null);
						setCreateTarget({ collection: coll, schema });
						setCreatePrefill(prefill);
						setCreateOpen(true);
					}}
				/>
			) : (
				<div
					style={{
						display: 'flex',
						flexDirection: 'column',
						height: '100%',
						padding: '0.75rem',
						maxWidth: 'none',
						margin: 0,
						minHeight: 0,
					}}
				>
					{error && (
						<Alert variant="destructive" style={{ marginBottom: '1rem' }}>
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					)}
					{/* Write policy — say WHY create / edit / delete are unavailable instead
					    of letting the operator hit a 403 on submit. */}
					{writeLock.reason && (
						<Alert style={{ marginBottom: '1rem' }}>
							<AlertDescription>{writeLock.reason}</AlertDescription>
						</Alert>
					)}
					<div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.75rem', paddingLeft: '0.75rem' }}>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							title="Back to Collections"
							aria-label="Back to Collections"
							onClick={goBackToCollections}
						>
							<ChevronLeft size={16} />
						</Button>
						<h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>{collectionName}</h2>
						<Badge variant="outline">{visibleFields.length} fields</Badge>
						<div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
							<Button
								size="sm"
								variant="outline"
								title="Lifecycle hooks for this collection — declarative rules + compiled code hooks (registered in the worker)"
								onClick={() => setHooksOpen(true)}
								style={{ gap: 6 }}
							>
								<Zap size={13} /> Hooks{hooksLoading || codeHooksLoading ? '' : ` (${hookTotal})`}
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={() => void openDocNoDialog()}
								title='Auto-number new records — e.g. "OUT-" (OUT-00001) or "OUT-####" (OUT-0001); empty = off'
								style={{ gap: 6 }}
							>
								<Hash size={13} /> Doc No.
							</Button>
							<Button
								size="sm"
								variant="outline"
								title="Runtime policies — auto-index, response cache, and device offline reads (no code, no redeploy)"
								onClick={() => setPolicyOpen(true)}
								style={{ gap: 6 }}
							>
								<Gauge size={13} /> Policies
							</Button>
						</div>
					</div>
					<div
						style={{
							flex: 1,
							minHeight: 0,
							borderRadius: 10,
							overflow: 'hidden',
							background: 'var(--mmbix-card, #ffffff)',
							display: 'flex',
							flexDirection: 'column',
						}}
					>
						<DataTable
							// Remount ONLY when the focused collection changes (a new collection needs
							// fresh columns + page state). Row writes bump `refreshKey` instead — the
							// table reloads the SAME page/sort/filter/search, where a remount used to
							// silently reset all of them.
							key={`${selected}-${trashMode ? 'trash' : 'live'}`}
							refreshKey={reloadTick}
							columns={tableColumns}
							fetchData={fields.length > 0 ? fetchData : undefined}
							defaultPageSize={25}
							showToolbar
							density="compact"
							borderStyle="row"
							striped
							stickyHeader
							// Row selection drives the bulk DELETE — offered only when the
							// collection is generically writable (a service / append-only
							// collection would 403 every call).
							enableRowSelection={writeLock.canMutate}
							enableColumnResizing
							enableColumnReordering
							onSelectionChange={writeLock.canMutate ? setSelectedRows : undefined}
							onRowClick={(row) => {
								setSelectedRows([]);
								openRecordView(row, selectedSchema);
							}}
							// Create is hidden for a service-only collection (the + button).
							onCreate={
								writeLock.canCreate
									? () => {
											setEditRecord(null);
											setCreateTarget(null);
											setCreatePrefill(null);
											setCreateOpen(true);
										}
									: undefined
							}
							toolbarActions={(tableInstance) => (
								<>
									{writeLock.canMutate && selectedPartition.writable.length > 0 && !trashMode && (
										<Button
											size="sm"
											variant="outline"
											title="Delete selected records"
											onClick={() => void deleteRows(selectedRows)}
											style={{ color: '#dc2626' }}
										>
											<Trash2 size={13} /> Delete ({selectedPartition.writable.length})
										</Button>
									)}
									{writeLock.canMutate && selectedPartition.writable.length > 0 && trashMode && (
										<Button size="sm" variant="outline" title="Restore selected records" onClick={() => void restoreRows(selectedRows)}>
											<ArchiveRestore size={13} /> Restore ({selectedPartition.writable.length})
										</Button>
									)}
									{selectedPartition.frozen.length > 0 && (
										<span
											title={frozenRowsReason(writeLock, selectedPartition.frozen.length)}
											style={{ fontSize: '0.72rem', color: '#9ca3af' }}
										>
											{selectedPartition.frozen.length} frozen
										</span>
									)}
									<Button
										size="sm"
										variant={trashMode ? 'default' : 'outline'}
										title={trashMode ? 'Showing deleted records' : 'Show deleted records'}
										onClick={() => {
											setTrashMode((v) => !v);
											setSelectedRows([]);
										}}
									>
										<Trash2 size={13} /> Trash
									</Button>
									<Button size="sm" variant="outline" title="Export records to CSV" onClick={() => openExport(tableInstance)}>
										<Download size={13} /> Export
									</Button>
								</>
							)}
							labels={{
								searchPlaceholder: 'Search records…',
								empty: trashMode ? 'No deleted records' : 'No records yet',
								noResults: 'No records match your search',
								loading: 'Loading records…',
							}}
						/>
						<ExportDialog
							open={exportState !== null}
							onOpenChange={(open) => {
								if (!open) closeExport();
							}}
							slug={selected}
							pageRowCount={exportState?.pageRows.length ?? 0}
							columnCount={tableColumns.filter((c) => c.enableHiding !== false).length}
							visibleColumnCount={exportState?.visibleIds.size ?? 0}
							onExport={runExport}
						/>
					</div>
				</div>
			)
		) : (
			<div style={{ padding: '1.25rem', maxWidth: 960, margin: '0 auto' }}>
				{error && (
					<Alert variant="destructive" style={{ marginBottom: '1rem' }}>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				<div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '1rem' }}>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						title="Back to Collections"
						aria-label="Back to Collections"
						onClick={goBackToCollections}
					>
						<ChevronLeft size={16} />
					</Button>
					<h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>{collectionName}</h2>
					<Badge variant="outline">{visibleFields.length} fields</Badge>
					<div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
						<Button
							size="sm"
							variant="outline"
							title="Lifecycle hooks for this collection — declarative rules + compiled code hooks (registered in the worker)"
							onClick={() => setHooksOpen(true)}
							style={{ gap: 6 }}
						>
							<Zap size={13} /> Hooks{hooksLoading || codeHooksLoading ? '' : ` (${hookTotal})`}
						</Button>
						<Button
							size="sm"
							variant="outline"
							onClick={() => void openDocNoDialog()}
							title='Auto-number new records — e.g. "OUT-" (OUT-00001) or "OUT-####" (OUT-0001); empty = off'
							style={{ gap: 6 }}
						>
							<Hash size={13} /> Doc No.
						</Button>
						<Button
							size="sm"
							variant="outline"
							title="Runtime policies — auto-index, response cache, and device offline reads (no code, no redeploy)"
							onClick={() => setPolicyOpen(true)}
							style={{ gap: 6 }}
						>
							<Gauge size={13} /> Policies
						</Button>
					</div>
				</div>
				{visibleFields.length === 0 ? (
					<div
						style={{
							border: '1px dashed var(--mmbix-border, #e5e7eb)',
							borderRadius: 10,
							padding: '2rem 1rem',
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							gap: '0.35rem',
							textAlign: 'center',
						}}
					>
						<p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600 }}>No fields yet</p>
						<p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
							Pick a field type from the right panel to design the collection’s columns.
						</p>
					</div>
				) : (
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
						{visibleFields.map((f) => (
							<Card key={f.name} style={{ padding: 0, ...(f.required ? { borderColor: 'var(--mmbix-primary, #0f766e)' } : {}) }}>
								<CardContent style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.38rem 0.6rem' }}>
									<FieldTypeIcon type={f.type} />
									<span
										style={{
											flex: 1,
											minWidth: 0,
											display: 'inline-flex',
											alignItems: 'baseline',
											gap: 2,
											fontSize: '0.82rem',
											fontWeight: 500,
											overflow: 'hidden',
										}}
									>
										<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flexShrink: 1 }}>
											{f.label || f.name}
										</span>
										{f.required && (
											<span title="Required" style={{ color: '#dc2626', flexShrink: 0, lineHeight: 1, fontSize: '0.85rem' }}>
												*
											</span>
										)}
									</span>
									<Badge variant="outline" style={{ fontSize: '0.6rem', fontWeight: 600, textTransform: 'capitalize' }}>
										{f.type}
									</Badge>
									<DropdownMenu>
										<DropdownMenuTrigger
											title="Field options"
											style={{
												display: 'inline-flex',
												alignItems: 'center',
												justifyContent: 'center',
												width: 24,
												height: 24,
												borderRadius: 5,
												border: 'none',
												background: 'transparent',
												color: '#9ca3af',
												cursor: 'pointer',
											}}
										>
											<MoreVertical size={13} />
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end" style={{ minWidth: 180 }}>
											<DropdownMenuItem onClick={() => setEditField(f)}>
												<Settings2 size={13} /> Edit properties
											</DropdownMenuItem>
											<DropdownMenuSeparator />
											<DropdownMenuItem onClick={() => void removeField(f.name)} style={{ color: '#dc2626' }}>
												<Trash2 size={13} /> Delete field
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</CardContent>
							</Card>
						))}
					</div>
				)}
			</div>
		);

	if (loading && collections.length === 0)
		return (
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
				<p style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Loading collections…</p>
			</div>
		);

	return (
		<>
			<StudioLayout
				storageKey="collections-registry"
				header={
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 1rem' }}>
						<Button
							variant="ghost"
							style={{ padding: '0.25rem 0.5rem', marginLeft: '-0.5rem', height: 'auto' }}
							title="Back to IDP"
							aria-label="Back to IDP"
							onClick={() => popBack(navigate, '/idp')}
						>
							<ChevronLeft size={16} style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }} />
							<span
								style={{
									width: 28,
									height: 28,
									borderRadius: 8,
									background: 'var(--mmbix-muted, #f3f4f6)',
									color: '#6b7280',
									display: 'inline-flex',
									alignItems: 'center',
									justifyContent: 'center',
									flexShrink: 0,
								}}
							>
								<Database size={15} />
							</span>
							<span style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Collections</span>
						</Button>

						{/* Right-aligned controls — Table / Schema view toggle appears when a collection is focused */}
						<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
							{selectedModel && (
								<div
									style={{
										display: 'flex',
										gap: 2,
										padding: '0.2rem',
										borderRadius: 8,
										background: 'var(--mmbix-muted, #f3f4f6)',
									}}
								>
									<Button
										variant={view === 'table' ? 'default' : 'ghost'}
										size="sm"
										title="Table view"
										onClick={() => setView('table')}
										style={{ width: 28, padding: 0 }}
									>
										<Table2 size={14} />
									</Button>
									<Button
										variant={view === 'schema' ? 'default' : 'ghost'}
										size="sm"
										title="Schema view"
										onClick={() => setView('schema')}
										style={{ width: 28, padding: 0 }}
									>
										<Braces size={14} />
									</Button>
								</div>
							)}
							{/* Convenience create — same dialog as the left pane "+" */}
							<Button size="sm" title="New collection" onClick={() => setNewOpen(true)} style={{ gap: 6 }}>
								<Plus size={14} /> New collection
							</Button>
						</div>
					</div>
				}
				left={left}
				// Field palette is schema-designer furniture — hide it in table (data)
				// view so records get the full canvas width.
				right={view === 'schema' ? right : undefined}
				footer={
					<div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
						<span>
							<strong>{collections.length}</strong> collections
						</span>
						<span style={{ marginLeft: 'auto' }}>
							The right panel lists every field type the engine supports — every collection is a real backend table.
						</span>
					</div>
				}
			>
				{center}
			</StudioLayout>

			{/* Auto-numbering Doc No. — the collection's naming-series pattern (prefix +
			 * optional `#` counter width). The engine assigns display_number at create;
			 * empty pattern turns numbering off. */}
			<Dialog open={docNoOpen} onOpenChange={setDocNoOpen}>
				<DialogContent style={{ width: 480 }}>
					<DialogHeader>
						<DialogTitle>Doc No. — auto numbering</DialogTitle>
						<DialogDescription>
							New records of “{collectionName}” are numbered from this pattern. Leave it empty to turn Doc No. off.
						</DialogDescription>
					</DialogHeader>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', padding: '0.25rem 0' }}>
						<Label htmlFor="cw-docno-pattern">Pattern</Label>
						<Input
							id="cw-docno-pattern"
							autoFocus
							value={docNoValue}
							onChange={(e) => setDocNoValue(e.target.value)}
							placeholder="e.g. OUT- or OUT-####"
						/>
						<div style={{ fontSize: '0.78rem' }}>
							{docNoExample === null ? (
								<span style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Off — new records get no Doc No.</span>
							) : docNoExample === false ? (
								<span style={{ color: '#dc2626' }}>Invalid — end with “-”, then up to 10 “#” placeholders (e.g. OUT-#### → OUT-0001).</span>
							) : (
								<span>
									First new record → <b>{docNoExample}</b>
								</span>
							)}
						</div>
						<div style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>
							Only new records get numbered from this pattern — existing rows keep their current Doc No.
						</div>
					</div>
					<DialogFooter>
						<Button type="button" variant="ghost" onClick={() => setDocNoOpen(false)}>
							Cancel
						</Button>
						<Button onClick={() => void saveDocNo()} disabled={docNoBusy || docNoExample === false}>
							{docNoBusy ? 'Saving…' : 'Save'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Lifecycle hooks — read-only viewer. TWO kinds of hooks can fire on a
			 * collection: COMPILED code hooks (TS registered in the worker at boot —
			 * e.g. veh-relink, shown from GET /api/hook-registry) and DECLARATIVE
			 * rules (`_server_functions` rows, GET /api/server-functions). Code hooks
			 * that REWRITE the focused collection while firing elsewhere (fleet
			 * relink → vehicles pointers) appear under their own group so the
			 * viewer never answers "Hooks (0)" for a table another hook keeps fresh. */}
			<Dialog open={hooksOpen} onOpenChange={setHooksOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Lifecycle hooks — {collectionName}</DialogTitle>
						<DialogDescription>
							Lifecycle hooks that run as this collection's records are created / updated / deleted — compiled code hooks registered in the
							worker (e.g. the veh-relink fleet pointer hooks), plus declarative JSON rules stored via{' '}
							<code>POST /api/server-functions</code>.
						</DialogDescription>
					</DialogHeader>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '55vh', overflowY: 'auto' }}>
						{hooksLoading || codeHooksLoading ? (
							<p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Loading hooks…</p>
						) : hooksError || codeHooksError ? (
							<p style={{ margin: 0, fontSize: '0.82rem', color: '#dc2626' }}>{hooksError ?? codeHooksError}</p>
						) : hookTotal === 0 ? (
							<div
								style={{
									border: '1px dashed var(--mmbix-border, #e5e7eb)',
									borderRadius: 10,
									padding: '1.5rem 1rem',
									display: 'flex',
									flexDirection: 'column',
									alignItems: 'center',
									gap: '0.3rem',
									textAlign: 'center',
								}}
							>
								<p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600 }}>No lifecycle hooks touch this collection</p>
								<p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
									Declarative rules are created via <code>POST /api/server-functions</code> with <code>collection_slug: {selected}</code>;
									compiled code hooks live in the domain modules / plugins and are registered on the collections they fire on.
								</p>
							</div>
						) : (
							<>
								{/* Code hooks registered ON this collection. */}
								{codeOnCollection.length > 0 && (
									<div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
										<div>
											<p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 700 }}>Code hooks ({codeOnCollection.length})</p>
											<p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
												Compiled TypeScript hooks registered in the worker — they fire on this collection's lifecycle events.
											</p>
										</div>
										{codeOnCollection.map((h, i) => (
											<CodeHookCard key={`${h.plugin_id}-${h.event}-${i}`} hook={h} firingCollection={h.collection} />
										))}
									</div>
								)}
								{/* Code hooks that REWRITE this collection while firing elsewhere. */}
								{codeAffectingCollection.length > 0 && (
									<div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
										<div>
											<p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 700 }}>
												Keep this collection fresh ({codeAffectingCollection.length})
											</p>
											<p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
												Code hooks registered on another collection that rewrite rows of this one when they fire — e.g. the fleet relink
												keeping <code>{selected}</code> pointers current.
											</p>
										</div>
										{codeAffectingCollection.map((h, i) => (
											<CodeHookCard key={`aff-${h.plugin_id}-${h.event}-${i}`} hook={h} firingCollection={h.collection} />
										))}
									</div>
								)}
								{/* Declarative server-function rules. */}
								{hooks.length > 0 && (
									<div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
										<div>
											<p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 700 }}>Declarative rules ({hooks.length})</p>
											<p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
												JSON rules stored in <code>_server_functions</code>, managed through the API.
											</p>
										</div>
										{hooks.map((h) => {
											const rules = parseHookRules(h.rules_text);
											return (
												<div
													key={h.id}
													style={{
														border: '1px solid var(--mmbix-border, #e5e7eb)',
														borderRadius: 8,
														padding: '0.6rem 0.75rem',
														display: 'flex',
														flexDirection: 'column',
														gap: '0.4rem',
													}}
												>
													<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
														<span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{h.name}</span>
														<span
															style={{
																fontSize: '0.62rem',
																fontWeight: 700,
																textTransform: 'uppercase',
																letterSpacing: '0.04em',
																padding: '2px 8px',
																borderRadius: 999,
																background: 'var(--mmbix-primary, #2563eb)',
																color: 'var(--mmbix-primary-foreground, #ffffff)',
															}}
														>
															{h.trigger_event}
														</span>
														{h.enabled ? (
															<Badge
																variant="outline"
																style={{ color: '#15803d', background: '#f0fdf4', borderColor: '#bbf7d0', fontWeight: 600 }}
															>
																Enabled
															</Badge>
														) : (
															<Badge
																variant="outline"
																style={{ color: '#6b7280', background: '#f3f4f6', borderColor: '#e5e7eb', fontWeight: 600 }}
															>
																Disabled
															</Badge>
														)}
														<span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
															Updated {new Date(h.updated_at).toLocaleString()}
														</span>
													</div>
													{rules.length === 0 && h.function_code ? (
														<span style={{ fontSize: '0.72rem', fontStyle: 'italic', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
															Legacy function_code (JS) — kept for reference; never executed on the Workers runtime.
														</span>
													) : rules.length === 0 ? null : (
														<div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
															<span style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
																{rules.length} rule{rules.length === 1 ? '' : 's'}
															</span>
															{rules.map((rule, i) => (
																<span
																	key={i}
																	title={rule.message ?? rule.target ?? rule.action}
																	style={{
																		fontSize: '0.62rem',
																		fontWeight: 700,
																		textTransform: 'uppercase',
																		letterSpacing: '0.04em',
																		padding: '2px 8px',
																		borderRadius: 999,
																		background: 'var(--mmbix-muted, #f1f5f9)',
																		color: 'var(--mmbix-muted-foreground, #64748b)',
																	}}
																>
																	{rule.action}
																	{rule.target ? ` → ${rule.target}` : ''}
																</span>
															))}
														</div>
													)}
												</div>
											);
										})}
									</div>
								)}
							</>
						)}
					</div>
					<DialogFooter>
						<Button type="button" variant="ghost" onClick={() => setHooksOpen(false)}>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Runtime feature policies — the headless control plane. Surfaced here
			 * because this is where collections are curated; the app-module detail page
			 * hosts the same panel. Writes PUT /api/collections/:slug/policies. */}
			<Dialog open={policyOpen} onOpenChange={setPolicyOpen}>
				<DialogContent style={{ width: 480 }}>
					<DialogHeader>
						<DialogTitle>Runtime Policies</DialogTitle>
						<DialogDescription>
							Enable / configure engine behaviors for “{collectionName}” at runtime — no code, no redeploy.
						</DialogDescription>
					</DialogHeader>
					{selected && <PolicyPanel token={token} slug={selected} schema={selectedSchema ?? null} />}
				</DialogContent>
			</Dialog>

			{/* New Collection — module-free: a fresh real table, no app binding. */}
			<Dialog open={newOpen} onOpenChange={setNewOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>New Collection</DialogTitle>
						<DialogDescription>Create a collection — it becomes a real table in the backend, usable by any app.</DialogDescription>
					</DialogHeader>
					<form onSubmit={(e) => void createModel(e)}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.25rem 0' }}>
							<Label htmlFor="cw-name">Name</Label>
							<Input id="cw-name" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Customers" />
							<Label htmlFor="cw-desc">Description</Label>
							<Input id="cw-desc" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Optional" />
							<Label htmlFor="cw-naming">Doc No. format (optional)</Label>
							<Input id="cw-naming" value={newNaming} onChange={(e) => setNewNaming(e.target.value)} placeholder="e.g. OUT- or OUT-####" />
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

			{/* Error banner fallback when no center pane is open */}
			{/* Type-aware field properties — opens after picking a type in the right pane. */}
			<AddFieldDialog
				def={draftDef}
				collectionName={collectionName}
				currentCollection={selected ?? ''}
				collections={collections}
				fields={fields}
				schemas={dialogSchemas}
				token={token}
				onCreate={addField}
				onClose={() => setDraftDef(null)}
			/>

			{/* Edit-field properties — the field “⋯” menu. Directus-style right drawer.
				 Changes auto-save (debounced) to the backend. */}
			<Drawer
				open={editField !== null}
				onOpenChange={(o) => {
					if (!o) {
						flushPendingEdits();
						setEditField(null);
					}
				}}
				swipeDirection="right"
			>
				<DrawerContent
					style={
						{
							// Full-height panel, flush to the screen edge — wider than the default sheet.
							'--drawer-content-width': 'min(680px, 100vw)',
							'--drawer-inset': '0px',
							borderRadius: 0,
						} as React.CSSProperties
					}
				>
					<DrawerHeader
						style={{
							display: 'flex',
							flexDirection: 'row',
							alignItems: 'flex-start',
							justifyContent: 'space-between',
							gap: 12,
							padding: '1rem 1.25rem',
							borderBottom: '1px solid var(--mmbix-border, #e5e7eb)',
						}}
					>
						<div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
							<DrawerTitle>Edit field — {editField?.label || editField?.name}</DrawerTitle>
							<DrawerDescription>Property changes are saved to the collection schema automatically.</DrawerDescription>
						</div>
						<button
							type="button"
							title="Close"
							aria-label="Close field properties"
							onClick={() => {
								flushPendingEdits();
								setEditField(null);
							}}
							style={{
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								width: 28,
								height: 28,
								borderRadius: 6,
								border: 'none',
								background: 'transparent',
								color: '#9ca3af',
								cursor: 'pointer',
								flexShrink: 0,
							}}
						>
							<X size={16} />
						</button>
					</DrawerHeader>
					<div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
						{editField && (
							<FieldInspector
								field={editField}
								fields={fields}
								fieldTypes={fieldTypes}
								token={token}
								update={(patch) => updateField(editField.name, patch)}
								remove={() => {
									if (editSaveTimer.current) {
										clearTimeout(editSaveTimer.current);
										editSaveTimer.current = null;
									}
									void removeField(editField.name);
								}}
							/>
						)}
					</div>
					<DrawerFooter
						style={{
							display: 'flex',
							flexDirection: 'row',
							alignItems: 'center',
							justifyContent: 'flex-end',
							gap: 8,
							padding: '0.9rem 1.25rem',
							borderTop: '1px solid var(--mmbix-border, #e5e7eb)',
						}}
					>
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								flushPendingEdits();
								setEditField(null);
							}}
						>
							Done
						</Button>
					</DrawerFooter>
				</DrawerContent>
			</Drawer>

			{/* Error banner fallback when no center pane is open */}
			{!selected && error && (
				<Alert
					variant="destructive"
					style={{ position: 'fixed', bottom: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 50, maxWidth: 480 }}
				>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

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
		</>
	);
}
