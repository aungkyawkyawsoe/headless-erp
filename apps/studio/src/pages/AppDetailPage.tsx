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
	Avatar,
	AvatarFallback,
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
	Braces,
	ChevronLeft,
	Database,
	Download,
	Gauge,
	Hash,
	History,
	MoreVertical,
	Plus,
	Settings,
	ShieldCheck,
	Table2,
	Trash2,
	Upload,
	Workflow,
} from 'lucide-react';
import {
	attachCollectionToModule,
	createCollection,
	updateCollectionMeta,
	deleteCollection,
	updateCollectionFields,
	importRecords,
	bulkDelete,
	bulkRestore,
	bulkErrorMessage,
	SYSTEM_FIELD_NAMES,
	namingSeriesExample,
	type CollectionSummary,
	type EntitySchema,
	type FieldDefinition,
	type FieldTypeDef,
	type EntityListParams,
} from '../lib/api';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { collectionQuery, collectionsQuery, itemsQuery, menusQuery, moduleQuery, modulesQuery, pagesQuery } from '../lib/queries';
import { invalidateCollection, invalidateCollectionList, invalidateModule, invalidateRows } from '../lib/query-client';
import { qk } from '../lib/query-keys';
import { messageOf } from '../lib/errors';
import { isIdpManagedModule } from '../lib/idp';
import { writeLockOf, isRowFrozen, partitionFrozenRows, frozenRowsReason } from '../lib/write-lock';
import { popBack, useViewState } from '../lib/view-state';
import { buildTableColumns, serializeTableFilters, useM2oSchemas } from '../lib/collection-table-filters';
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
import AddFieldDialog from '../components/AddFieldDialog';
import { PageBuilderProvider, PageCanvas } from '../components/PageBuilder';
import { FieldTypeIcon } from '../components/formlayout';
import ManageAppDialog from '../components/ManageAppDialog';
import RecordFormDialog from '../components/RecordFormDialog';
import RecordDetailView from '../components/RecordDetailView';
import BatchEditDialog from '../components/BatchEditDialog';
import AppIcon from '../components/AppIcon';
import { appColor } from '@mmbix/ui-views';
import { renderCell } from '../lib/cell-render';
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
import { DataCell } from '../components/DataCell';
import { BuilderFormLayout, BuilderLeftPane, BuilderRightPane, BuilderSaveButton, toMenuTree } from '../components/builder/builder-parts';

/** Valid Studio sections — the AppDetailPage left/center/right panes. */
type AppSection = 'collection' | 'menu' | 'builder';

export default function AppDetailPage({ token }: { token: string }) {
	const { slug } = useParams<{ slug: string }>();
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
	const [importMsg, setImportMsg] = useState<string | null>(null);
	const importRef = useRef<HTMLInputElement>(null);
	const [newOpen, setNewOpen] = useState(false);
	const [newName, setNewName] = useState('');
	const [newDescription, setNewDescription] = useState('');
	const [newNaming, setNewNaming] = useState('');
	const [newBusy, setNewBusy] = useState(false);
	// New Collection dialog mode: 'create' a fresh model, or 'bind' an existing one.
	const [newMode, setNewMode] = useState<'create' | 'bind'>('create');
	// All system collections (fetched when the dialog opens) — used to pick one to bind.
	const [allCollections, setAllCollections] = useState<CollectionSummary[]>([]);
	const [bindSlug, setBindSlug] = useState('');
	const [bindBusy, setBindBusy] = useState(false);
	// Doc No. (naming series) editor — per-collection auto-numbering pattern.
	const [docNoOpen, setDocNoOpen] = useState(false);
	const [docNoValue, setDocNoValue] = useState('');
	const [docNoBusy, setDocNoBusy] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	// The record being edited (null = create mode).
	const [editRecord, setEditRecord] = useState<Record<string, unknown> | null>(null);
	// o2m child-create target — when set, RecordFormDialog creates a RELATED child
	// (e.g. a join row whose counterpart must be picked) instead of a record of the
	// current collection; createPrefill carries the FK back to the parent record.
	const [createTarget, setCreateTarget] = useState<{ collection: { slug: string; name: string }; schema: EntitySchema } | null>(null);
	const [createPrefill, setCreatePrefill] = useState<Record<string, unknown> | null>(null);
	// The record open in the Directus-style detail view (row click).
	const [openRecord, setOpenRecord] = useState<Record<string, unknown> | null>(null);
	// The schema for the open record — may differ from the current collection when a
	// related (o2m) record is opened recursively.
	const [openSchema, setOpenSchema] = useState<EntitySchema | null>(null);
	// Rows checked in the table for bulk delete / batch edit.
	const [selectedRows, setSelectedRows] = useState<Record<string, unknown>[]>([]);
	// Trash mode — list soft-deleted records and allow restore.
	const [trashMode, setTrashMode] = useState(false);
	// Batch edit dialog state.
	const [batchOpen, setBatchOpen] = useState(false);
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
	// Old URLs may say ?section=pages — normalise it to 'builder'; any other invalid
	// value falls back to 'collection' instead of blanking the whole layout.
	const rawSection = searchParams.get('section') ?? 'collection';
	const normalizedSection = rawSection === 'pages' ? 'builder' : rawSection;
	const section: AppSection =
		normalizedSection === 'collection' || normalizedSection === 'menu' || normalizedSection === 'builder'
			? normalizedSection
			: 'collection';
	// The ?view= param is SHARED with the page builder (table|form|kanban|…) — a stale
	// builder value (e.g. view=form) must not bleed into the collection section, where
	// only table/schema exist. Clamp anything else to 'schema' so the right-hand field
	// type panel keeps rendering after switching sections.
	const rawView = searchParams.get('view') ?? 'schema';
	const view = (section === 'collection' ? (rawView === 'table' ? 'table' : 'schema') : rawView) as 'table' | 'schema';
	// Selected collection + open page are URL-backed too (?collection= & ?page=).
	const selected = searchParams.get('collection');
	const selectCollection = useCallback(
		(slug: string | null) => {
			updateViewState((p) => {
				if (slug) p.set('collection', slug);
				else p.delete('collection');
				// A collection switch invalidates any open record — drop its row id and
				// close the edit view so we never show a stale record under the new schema.
				p.delete('row');
			});
			setOpenRecord(null);
			setOpenSchema(null);
			setSelectedRows([]);
		},
		[updateViewState],
	);
	function setSection(s: AppSection) {
		updateViewState((p) => p.set('section', s));
	}
	function setView(v: 'table' | 'schema') {
		updateViewState((p) => p.set('view', v));
	}
	// Self-heal the URL: stale/foreign params (e.g. view=form from the builder, a
	// leftover ?page=) are rewritten for the active section so pasted links behave
	// and share cleanly. No-op when the params are already valid for this section.
	useEffect(() => {
		const next = new URLSearchParams(searchParams);
		let dirty = false;
		const rawSec = next.get('section') ?? 'collection';
		const sec = rawSec === 'pages' ? 'builder' : rawSec;
		// Normalize the section param (legacy 'pages' alias; invalid values → 'collection').
		if (rawSec === 'pages') {
			next.set('section', 'builder');
			dirty = true;
		} else if (sec !== 'collection' && sec !== 'menu' && sec !== 'builder') {
			next.set('section', 'collection');
			dirty = true;
		}
		// Builder-only params — dropped in every other section.
		if (sec !== 'builder' && (next.has('page') || next.has('template'))) {
			next.delete('page');
			next.delete('template');
			dirty = true;
		}
		// The collection section only knows table/schema — clamp a stale builder view.
		if (sec === 'collection' && next.has('view') && next.get('view') !== 'table' && next.get('view') !== 'schema') {
			next.set('view', 'schema');
			dirty = true;
		}
		if (dirty) commitViewState(next);
	}, [searchParams, commitViewState]);
	// Menu-section state shared between the tree (center), preview (left) and inspector (right).
	const [menuSelected, setMenuSelected] = useState<MenuNode | null>(null);
	const [menuTree, setMenuTree] = useState<MenuNode[]>([]);
	// Bump to tell the self-loading MenuBuilder to re-read the menu tree after the
	// inspector saves (it owns its own draft and reports back via `onTreeChange`).
	const [menuReload, setMenuReload] = useState(0);
	// ── Server state (TanStack Query) ────────────────────────────
	// ── Server state (TanStack Query) ────────────
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
	// The lock for the record OPEN in the detail view — a related collection may
	// differ, and a row frozen by `freeze_when` 403s any update/delete.
	const openWriteLock = useMemo(() => writeLockOf(openSchema ?? selectedSchema), [openSchema, selectedSchema]);
	// The current selection split by the row-level `freeze_when` rule, so a bulk
	// action only ever targets rows a generic write may touch.
	const selectedPartition = useMemo(() => partitionFrozenRows(writeLock, selectedRows), [writeLock, selectedRows]);

	// ── URL-backed record detail ────────────────────────────────────────────────
	// The id of the record open in the edit view lives in ?row= so pasted links and
	// reloads re-open the same record. Row-click writes it; closing removes it; the
	// effect below re-fetches it when a ?row= deep link lands on the page.
	const openRecordView = useCallback(
		(rec: Record<string, unknown>, schema: EntitySchema | undefined) => {
			setOpenRecord(rec);
			setOpenSchema(schema ?? null);
			// Detail view is opened/closed inside the collection pane (not a separate page) —
			// it only touches ?row=, so update() replaces instead of pushing a history entry.
			updateViewState((p) => {
				if (rec && rec.id != null) p.set('row', String(rec.id));
				else p.delete('row');
			});
		},
		[updateViewState],
	);
	const closeRecordView = useCallback(() => {
		setOpenRecord(null);
		setOpenSchema(null);
		updateViewState((p) => p.delete('row'));
	}, [updateViewState]);

	// Deep link: when the URL carries ?row= (and the matching record isn't already
	// open), fetch that single record by id and show it in the edit view.
	useEffect(() => {
		const rowId = searchParams.get('row');
		if (!selected || !rowId || !schemas[selected]) return;
		if (view !== 'table') return;
		if (openRecord && String(openRecord.id) === rowId) return;
		let alive = true;
		queryClient
			.fetchQuery(itemsQuery(token, selected, { limit: 1, filters: { id: { operator: '_eq', value: rowId } } }))
			.then((res) => {
				if (!alive) return;
				const row = res.rows[0];
				if (row) {
					setOpenSchema(schemas[selected] ?? null);
					setOpenRecord(row);
				} else {
					// Stale id (deleted / moved) — drop it from the URL so the table shows.
					updateViewState((p) => p.delete('row'));
				}
			})
			.catch(() => {
				/* transient — leave the URL alone for the next tick */
			});
		return () => {
			alive = false;
		};
	}, [searchParams, selected, schemas, openRecord, view, token, updateViewState, queryClient]);
	// Stable identity — the `?? []` fallback would otherwise mint a new array on
	// every render and force the table-columns useMemo to rebuild each time.
	const fields = useMemo(() => selectedSchema?.schema_json.fields ?? [], [selectedSchema]);
	// Engine-managed system fields are hidden by default (id, timestamps, owners, …).
	const visibleFields = fields.filter((f) => !SYSTEM_FIELD_NAMES.has(f.name));

	// Table columns built from the focused collection's schema fields — typed filter
	// metadata is derived generically from field types (m2o columns filter on the
	// related row's display leaf; related schemas load lazily via useM2oSchemas).
	// No per-row action column — clicking a row opens the Directus-style detail view (edit).
	const m2oSchemas = useM2oSchemas(token, fields);
	// AddFieldDialog resolves relation targets — merge the app's attached schemas with
	// any m2o target the table lazily loaded (both live in the same query cache).
	const dialogSchemas = useMemo(() => ({ ...schemas, ...m2oSchemas }), [schemas, m2oSchemas]);
	const tableColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(
		() =>
			buildTableColumns(fields, m2oSchemas, {
				systemFieldNames: SYSTEM_FIELD_NAMES,
				renderCell: (field, value) => <DataCell field={field} value={value} />,
			}),
		[fields, m2oSchemas],
	);

	// Soft-delete one or more records (bulk delete from row selection).
	async function handleDelete(rows: Record<string, unknown>[]) {
		if (!selectedModel || rows.length === 0) return;
		if (!writeLock.canMutate) {
			setActionError(writeLock.reason ?? 'This collection cannot be written through the generic entity API.');
			return;
		}
		// Rows frozen by `freeze_when` 403 a generic delete — skip them so one frozen
		// row cannot fail the whole batch.
		const { writable, frozen } = partitionFrozenRows(writeLock, rows);
		if (writable.length === 0) {
			setActionError(frozenRowsReason(writeLock, frozen.length));
			return;
		}
		const label =
			writable.length === 1
				? `“${renderCell(fields.find((f) => f.name === 'name_en') ?? fields[0], writable[0].name_en ?? writable[0].name ?? writable[0].id)}”`
				: `${writable.length} records`;
		if (!confirm(`Delete ${label}?${frozen.length ? ` (${frozen.length} frozen skipped)` : ''}`)) return;
		try {
			// ONE bulk request for N rows instead of N sequential DELETE round trips.
			const results = await bulkDelete(
				token,
				selectedModel.slug,
				writable.map((r) => String(r.id)),
			);
			setSelectedRows([]);
			setActionError(
				[bulkErrorMessage(results), frozen.length > 0 ? frozenRowsReason(writeLock, frozen.length) : ''].filter(Boolean).join(' '),
			);
			refreshRows(selectedModel.slug);
		} catch (e) {
			setActionError(e instanceof Error ? e.message : 'Delete failed');
		}
	}

	// Restore one or more soft-deleted records (from trash mode).
	async function handleRestore(rows: Record<string, unknown>[]) {
		if (!selectedModel || rows.length === 0) return;
		if (!writeLock.canMutate) return;
		// A frozen row rejects a generic write — skip restore for it too.
		const { writable, frozen } = partitionFrozenRows(writeLock, rows);
		if (writable.length === 0) {
			setActionError(frozenRowsReason(writeLock, frozen.length));
			return;
		}
		try {
			const results = await bulkRestore(
				token,
				selectedModel.slug,
				writable.map((r) => String(r.id)),
			);
			setSelectedRows([]);
			setActionError(
				[bulkErrorMessage(results), frozen.length > 0 ? frozenRowsReason(writeLock, frozen.length) : ''].filter(Boolean).join(' '),
			);
			refreshRows(selectedModel.slug);
		} catch (e) {
			setActionError(e instanceof Error ? e.message : 'Restore failed');
		}
	}

	// ── CSV export ─────────────────────────────────────────────────────────
	// A one-shot: the Export button captures the CURRENT table snapshot (rows in
	// memory + the params the page was fetched with), and the dialog only decides
	// scope — page vs all rows, visible vs all columns. Dialog errors surface
	// inside the dialog; the page's actionError stays for write failures.
	const [exportState, setExportState] = useState<{
		pageRows: Record<string, unknown>[];
		visibleIds: Set<string>;
	} | null>(null);

	function openExport(tableInstance: DataTableInstance<Record<string, unknown>>) {
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
		const { token, selected, trashMode, fields, m2oSchemas } = fetchCtxRef.current;
		if (!selected || !exportState) throw new Error('No rows to export');
		const fieldByName = fieldMapOf(fields);
		const allColumns = tableColumns.filter((c) => c.enableHiding !== false);
		const columns = scope.columns === 'visible' ? allColumns.filter((c) => exportState.visibleIds.has(c.id)) : allColumns;
		const rows =
			scope.rows === 'page'
				? exportState.pageRows
				: await collectAllRows(
						token,
						selected,
						itemsParamsFromFetch(fields, m2oSchemas, lastFetchParamsRef.current ?? undefined, { trashed: trashMode }),
					);
		return buildCsv(rows, columns, fieldByName);
	}

	// Server-side fetch — cursor pagination, sorting, search, filters against the API.
	//
	// STABLE identity on purpose: DataTable re-runs its server effect whenever
	// `fetchData` changes, and `fields`/`m2oSchemas` change on every schema load /
	// related-schema resolution / field save — so depending on them re-fetched the
	// rows once per event. `selected` and `trashMode` are DataTable REMOUNT keys
	// (see `key={selectedModel.slug + trashMode}`), so those still refetch.
	const fetchCtxRef = useRef({ token, selected, trashMode, fields, m2oSchemas });
	fetchCtxRef.current = { token, selected, trashMode, fields, m2oSchemas };
	// The last `FetchParams` the table asked for — replayed by "export all rows" so
	// the export walks EXACTLY the filter/sort/search the page is showing.
	const lastFetchParamsRef = useRef<FetchParams | null>(null);

	const fetchData = useCallback(
		async (params: FetchParams): Promise<FetchResult<Record<string, unknown>>> => {
			lastFetchParamsRef.current = params;
			const { token, selected, trashMode, fields, m2oSchemas } = fetchCtxRef.current;
			if (!selected) return { rows: [], nextCursor: null, prevCursor: null };
			// Lean table projection instead of `*.*` — own columns + m2o labels + id-only
			// relation arrays. Gated on the schema (see the DataTable `fetchData` prop).
			const entityParams: EntityListParams = { limit: params.pagination.pageSize, trashed: trashMode, fields: buildListFields(fields) };
			if (params.cursor) {
				entityParams.cursor = params.cursor;
				entityParams.dir = params.cursorDir ?? 'after';
			}
			if (params.sorting) entityParams.sort = `${params.sorting.direction === 'desc' ? '-' : ''}${params.sorting.id}`;
			if (params.globalFilter) entityParams.search = params.globalFilter;
			entityParams.filters = serializeTableFilters(params.filters, fields, m2oSchemas);
			// Through Query: shares the app cache + in-flight dedup, so a remount or a
			// repeated page/sort/filter within staleTime costs ZERO requests.
			return await queryClient.fetchQuery(itemsQuery(token, selected, entityParams));
		},
		[queryClient],
	);

	async function createModel(e: React.FormEvent) {
		e.preventDefault();
		if (!slug || !newName.trim() || newBusy || namingSeriesExample(newNaming) === false) return;
		setNewBusy(true);
		try {
			const created = await createCollection(token, newName.trim(), {
				description: newDescription.trim() || undefined,
				naming_series: newNaming.trim() || undefined,
			});
			await attachCollectionToModule(token, slug, created.slug);
			setNewName('');
			setNewDescription('');
			setNewNaming('');
			setNewOpen(false);
			// Seed the new schema so focusing it renders instantly, then revalidate the
			// only things this write touched: the app wiring + the registry list.
			queryClient.setQueryData(qk.collection(created.slug), created);
			await invalidateModule(queryClient, slug);
			await invalidateCollectionList(queryClient);
			selectCollection(created.slug);
		} catch (err) {
			setActionError(err instanceof Error ? err.message : 'Create failed');
		} finally {
			setNewBusy(false);
		}
	}

	// Open the New Collection dialog. In 'bind' mode we need the full list of system
	// collections so the user can pick one that isn't already attached to this module.
	async function openNewDialog() {
		setNewName('');
		setNewDescription('');
		setNewNaming('');
		setNewMode('create');
		setBindSlug('');
		setAllCollections([]);
		setNewOpen(true);
		try {
			setAllCollections(await queryClient.fetchQuery(collectionsQuery(token)));
		} catch {
			/* the bind list is best-effort — create mode still works */
		}
	}

	// Attach an existing system collection to this module without creating a new one.
	async function bindCollection(e: React.FormEvent) {
		e.preventDefault();
		if (!slug || !bindSlug || bindBusy) return;
		setBindBusy(true);
		try {
			await attachCollectionToModule(token, slug, bindSlug);
			setBindSlug('');
			setNewOpen(false);
			await invalidateModule(queryClient, slug);
			selectCollection(bindSlug);
		} catch (err) {
			setActionError(err instanceof Error ? err.message : 'Bind failed');
		} finally {
			setBindBusy(false);
		}
	}

	// Doc No. (naming series) — live previews for the create + existing-model dialogs.
	const newNamingExample = namingSeriesExample(newNaming);
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
		if (!confirm(`Delete field "${fieldName}" from "${selectedModel.name}"? The column is removed from the table.`)) return;
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

	// Import records from a CSV/JSON file — row errors reported, not fatal.
	async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		e.target.value = '';
		if (!file || !selectedModel) return;
		if (!writeLock.canCreate) return;
		try {
			const text = await file.text();
			const format: 'json' | 'csv' = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json';
			const result = await importRecords(token, selectedModel.slug, format, text);
			const errText =
				result.errors.length > 0
					? ` · ${result.errors.length} row error${result.errors.length === 1 ? '' : 's'} (first: ${result.errors[0].error.slice(0, 60)})`
					: '';
			setImportMsg(`Imported ${result.imported} record${result.imported === 1 ? '' : 's'}${errText}`);
			refreshRows(selectedModel.slug);
		} catch (err) {
			setImportMsg(null);
			setActionError(err instanceof Error ? err.message : 'Import failed');
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

	if (loading)
		return (
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
				<p style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Loading app…</p>
			</div>
		);
	if (!mod) return <div style={{ padding: '2rem' }}>{error ?? 'App not found'}</div>;

	const bg = mod.bg_color ?? appColor(mod.slug);
	const fg = mod.icon_color ?? '#ffffff';

	return (
		<>
			<PageBuilderProvider
				token={token}
				pages={pages}
				moduleSlug={mod.slug}
				onSaved={refreshPages}
				initialPageId={searchParams.get('page')}
				initialTemplate={searchParams.get('template')}
				initialMode={section === 'builder' ? (searchParams.get('view') ?? undefined) : undefined}
				initialCollection={searchParams.get('collection')}
				onTemplateChange={(t) => {
					updateViewState((p) => p.set('template', t));
				}}
				onModeChange={(m) => {
					if (section !== 'builder') return;
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
								<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 1rem' }}>
									{/* Top-left back control — clicking the module identity (or the chevron)
									 * leaves the workbench for the Apps ModuleGrid (or the IDP catalog for
									 * IDP-managed modules). popBack pops the entry we were pushed from when
									 * one exists (grid/catalog), else replaces to the destination — it never
									 * stacks a second copy of the destination under this screen. */}
									<Button
										variant="ghost"
										style={{ padding: '0.25rem 0.5rem', marginLeft: '-0.5rem', height: 'auto' }}
										title={isIdpManagedModule(mod.slug) ? 'Back to IDP catalog' : 'Back to apps'}
										aria-label={isIdpManagedModule(mod.slug) ? 'Back to IDP catalog' : 'Back to apps'}
										onClick={() => popBack(navigate, isIdpManagedModule(mod.slug) ? '/idp/catalog' : '/')}
									>
										<ChevronLeft size={16} style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }} />
										<Avatar size="default" variant="square">
											<AvatarFallback style={{ background: bg, color: fg, fontWeight: 700 }}>
												<AppIcon name={mod.icon} size={18} />
											</AvatarFallback>
										</Avatar>
										<span style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>{mod.name}</span>
									</Button>
									{/* App section switcher — same segmented style as the form builder view selector */}
									<div
										style={{
											display: 'flex',
											gap: 2,
											marginLeft: '1rem',
											padding: '0.2rem',
											borderRadius: 8,
											background: 'var(--mmbix-muted, #f3f4f6)',
											flexWrap: 'wrap',
										}}
									>
										{(['collection', 'menu', 'builder'] as const).map((v) => (
											<Button
												key={v}
												variant={section === v ? 'default' : 'ghost'}
												size="sm"
												onClick={() => setSection(v)}
												style={{ textTransform: 'capitalize' }}
											>
												{v}
											</Button>
										))}
									</div>
									{/* Right-aligned controls — view toggle, builder save, and manage app stay
									 * grouped flush against the right edge (single margin-left:auto). */}
									<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
										{/* Table / Schema view toggle — icon-only, appears when a collection is focused */}
										{section === 'collection' && selectedModel && (
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
										{/* Builder save — page drafts persist from the app bar */}
										{section === 'builder' && <BuilderSaveButton />}
										{/* Manage app — rename / icon / colours for THIS module (same dialog the
										 * Apps grid uses, preloaded with the current module). */}
										<Button variant="ghost" size="sm" title="Manage app" onClick={() => setManageOpen(true)} style={{ gap: 6 }}>
											<Settings size={14} /> Manage
										</Button>
									</div>
								</div>
							}
							left={
								section === 'collection' ? (
									<div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
										<SideSection
											title="Collections"
											action={
												<Button variant="ghost" size="icon-xs" title="New collection" onClick={() => void openNewDialog()}>
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
										{(mod.collections?.length ?? 0) === 0 ? (
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
										) : (
											<div style={{ flex: 1, padding: '0.5rem', overflowY: 'auto', minHeight: 0 }}>
												<div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
													{(mod.collections ?? [])
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
																			style={{ color: active ? 'var(--mmbix-primary-foreground, #ffffff)' : '#9ca3af', flexShrink: 0 }}
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
																				color: active ? 'var(--mmbix-primary-foreground, #ffffff)' : '#9ca3af',
																				cursor: 'pointer',
																				flexShrink: 0,
																			}}
																		>
																			<MoreVertical size={13} />
																		</DropdownMenuTrigger>
																		<DropdownMenuContent align="end" sideOffset={4} style={{ minWidth: 190 }}>
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
								) : section === 'menu' ? (
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
								) : section === 'builder' ? (
									<BuilderLeftPane tree={menuTree} />
								) : undefined
							}
							right={
								section === 'collection' && view === 'schema' ? (
									<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
										<FieldTypesPanel token={token} onPick={setDraftDef} />
									</div>
								) : section === 'menu' ? (
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
								) : section === 'builder' ? (
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
							{section === 'collection' ? (
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
													collection={createTarget?.collection ?? selectedModel}
													schema={createTarget?.schema ?? selectedSchema!}
													record={editRecord}
													initialValues={createPrefill ?? undefined}
													readOnly={!writeLockOf(createTarget?.schema ?? selectedSchema).canCreate}
													onSaved={() => {
														// Refresh the table so the new/edited row appears (rows-only).
														setCreateTarget(null);
														setCreatePrefill(null);
														refreshRows(selectedModel.slug);
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
													collection={selectedModel}
													schema={openSchema ?? selectedSchema!}
													record={openRecord}
													readOnly={!openWriteLock.canMutate || isRowFrozen(openWriteLock, openRecord)}
													onClose={() => {
														closeRecordView();
													}}
													onSaved={() => {
														// Refresh the table so the edited row reflects the change (rows-only).
														refreshRows(selectedModel.slug);
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
												<>
													<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem', paddingLeft: '0.75rem' }}>
														<h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>{selectedModel.name}</h2>
														{importMsg && <span style={{ fontSize: '0.7rem', color: '#16a34a' }}>{importMsg}</span>}
														{writeLock.canCreate && (
															<Button
																size="sm"
																variant="outline"
																style={{ marginLeft: 'auto' }}
																onClick={() => importRef.current?.click()}
																title="Import records from a CSV or JSON file"
															>
																<Upload size={13} /> Import
															</Button>
														)}
														<input
															ref={importRef}
															type="file"
															accept=".csv,.json,application/json,text/csv"
															hidden
															onChange={(e) => void handleImportFile(e)}
														/>
													</div>
													{/* Write policy — say WHY create / edit / delete / import are
													    unavailable instead of letting the operator hit a 403. */}
													{writeLock.reason && (
														<Alert style={{ marginBottom: '1rem' }}>
															<AlertDescription>{writeLock.reason}</AlertDescription>
														</Alert>
													)}
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
															key={`${selectedModel.slug}-${trashMode ? 'trash' : 'live'}-${tableReload}`}
															columns={tableColumns}
															fetchData={fields.length > 0 ? fetchData : undefined}
															defaultPageSize={25}
															showToolbar
															density="compact"
															borderStyle="row"
															striped
															stickyHeader
															enableRowSelection={writeLock.canMutate}
															enableColumnResizing
															enableColumnReordering
															onSelectionChange={writeLock.canMutate ? setSelectedRows : undefined}
															onRowClick={(row) => {
																setSelectedRows([]);
																openRecordView(row, selectedSchema);
															}}
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
																	<Button
																		size="sm"
																		variant="outline"
																		title="Export records to CSV"
																		onClick={() => openExport(tableInstance)}
																	>
																		<Download size={13} /> Export
																	</Button>
																	<Button
																		size="sm"
																		variant={trashMode ? 'default' : 'outline'}
																		title={trashMode ? 'Showing deleted records' : 'Show deleted records'}
																		onClick={() => {
																			setTrashMode((v) => !v);
																			setSelectedRows([]);
																		}}
																	>
																		<Trash2 size={13} /> {trashMode ? 'Trash' : 'Trash'}
																	</Button>
																	{writeLock.canMutate && selectedPartition.writable.length > 0 && !trashMode && (
																		<Button size="sm" variant="outline" title="Edit selected records" onClick={() => setBatchOpen(true)}>
																			Edit ({selectedPartition.writable.length})
																		</Button>
																	)}
																	{writeLock.canMutate && selectedPartition.writable.length > 0 && trashMode && (
																		<Button
																			size="sm"
																			variant="outline"
																			title="Restore selected records"
																			onClick={() => void handleRestore(selectedRows)}
																		>
																			Restore ({selectedPartition.writable.length})
																		</Button>
																	)}
																	{writeLock.canMutate && selectedPartition.writable.length > 0 && (
																		<Button
																			size="sm"
																			variant="outline"
																			title={trashMode ? 'Permanently delete selected records' : 'Delete selected records'}
																			onClick={() => void handleDelete(selectedRows)}
																			style={{ color: '#dc2626' }}
																		>
																			<Trash2 size={13} /> Delete ({selectedPartition.writable.length})
																		</Button>
																	)}
																	{selectedPartition.frozen.length > 0 && (
																		<span
																			title={frozenRowsReason(writeLock, selectedPartition.frozen.length)}
																			style={{ fontSize: '0.72rem', color: '#9ca3af', alignSelf: 'center' }}
																		>
																			{selectedPartition.frozen.length} frozen
																		</span>
																	)}
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
															slug={selectedModel.slug}
															pageRowCount={exportState?.pageRows.length ?? 0}
															columnCount={tableColumns.filter((c) => c.enableHiding !== false).length}
															visibleColumnCount={exportState?.visibleIds.size ?? 0}
															onExport={runExport}
														/>
													</div>
												</>
											)
										) : (
											<>
												<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
													<h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>{selectedModel.name}</h2>
													<Badge variant="outline">{visibleFields.length} fields</Badge>
													<div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
														<Button size="sm" variant="outline" onClick={() => setWfOpen(true)}>
															<Workflow size={13} /> Workflow
														</Button>
														<Button size="sm" variant="outline" onClick={() => setPermOpen(true)}>
															<ShieldCheck size={13} /> Permissions
														</Button>
														<Button size="sm" variant="outline" onClick={() => setAuditOpen(true)}>
															<History size={13} /> Audit
														</Button>
														<Button
															size="sm"
															variant="outline"
															onClick={() => void openDocNoDialog()}
															title='Auto-number new records — e.g. "OUT-" (OUT-00001) or "OUT-####" (OUT-0001); empty = off'
														>
															<Hash size={13} /> Doc No.
														</Button>
														<Button size="sm" variant="outline" onClick={() => setPolicyOpen(true)}>
															<Gauge size={13} /> Policies
														</Button>
													</div>
												</div>

												<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
													{visibleFields.map((f) => (
														<Card
															key={f.name}
															style={{
																...(f.required ? { borderColor: 'var(--mmbix-primary, #0f766e)' } : {}),
															}}
														>
															<CardContent style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0.65rem' }}>
																<FieldTypeIcon type={f.type} />
																<span
																	style={{
																		flex: 1,
																		minWidth: 0,
																		fontSize: '0.82rem',
																		fontWeight: 500,
																		overflow: 'hidden',
																		textOverflow: 'ellipsis',
																		whiteSpace: 'nowrap',
																	}}
																>
																	{f.label || f.name}
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
																	<DropdownMenuContent align="end">
																		<DropdownMenuSeparator />
																		<DropdownMenuItem onClick={() => removeField(f.name)} style={{ color: '#dc2626' }}>
																			<span style={{ width: 13, display: 'inline-flex' }} />
																			Delete field
																		</DropdownMenuItem>
																	</DropdownMenuContent>
																</DropdownMenu>
															</CardContent>
														</Card>
													))}
												</div>
											</>
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
							) : section === 'menu' ? (
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
							) : section === 'builder' ? (
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

			{selectedModel && selectedSchema && (
				<BatchEditDialog
					token={token}
					open={batchOpen}
					onOpenChange={setBatchOpen}
					collection={selectedModel}
					schema={selectedSchema}
					rows={selectedPartition.writable}
					onSaved={() => {
						setSelectedRows([]);
						refreshRows(selectedModel.slug);
					}}
				/>
			)}

			<Dialog open={newOpen} onOpenChange={setNewOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>New Collection</DialogTitle>
						<DialogDescription>Create a model and attach it to this app, or bind an existing one from the system.</DialogDescription>
					</DialogHeader>
					{/* Mode toggle — create a fresh model vs. bind an existing system collection. */}
					<div style={{ display: 'flex', gap: 6, marginBottom: '0.75rem' }}>
						<Button
							size="sm"
							variant={newMode === 'create' ? 'default' : 'outline'}
							onClick={() => setNewMode('create')}
							style={{ flex: 1 }}
						>
							Create new
						</Button>
						<Button size="sm" variant={newMode === 'bind' ? 'default' : 'outline'} onClick={() => setNewMode('bind')} style={{ flex: 1 }}>
							Bind existing
						</Button>
					</div>
					{newMode === 'create' ? (
						<form onSubmit={createModel}>
							<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.25rem 0' }}>
								<Label htmlFor="nc-name">Name</Label>
								<Input id="nc-name" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Customers" />
								<Label htmlFor="nc-desc">Description</Label>
								<Input id="nc-desc" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Optional" />
								<Label htmlFor="nc-naming">Doc No. format (optional)</Label>
								<Input
									id="nc-naming"
									value={newNaming}
									onChange={(e) => setNewNaming(e.target.value)}
									placeholder="e.g. OUT- or OUT-####"
								/>
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
									{newBusy ? 'Creating…' : 'Create & attach'}
								</Button>
							</DialogFooter>
						</form>
					) : (
						<form onSubmit={bindCollection}>
							{(() => {
								const attached = new Set((mod?.collections ?? []).map((c) => c.slug));
								const available = allCollections.filter((c) => !attached.has(c.slug));
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
								<Button type="button" variant="ghost" onClick={() => setNewOpen(false)}>
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
			<Dialog open={permOpen} onOpenChange={setPermOpen}>
				<DialogContent style={{ width: 460, maxHeight: '82vh', overflowY: 'auto' }}>
					<DialogHeader>
						<DialogTitle>Field Permissions</DialogTitle>
						<DialogDescription>
							Control which fields each role can see for “{selectedModel?.name ?? selected ?? 'this collection'}”.
						</DialogDescription>
					</DialogHeader>
					{selected && <PermissionsPanel token={token} slug={selected} fields={fields} />}
				</DialogContent>
			</Dialog>

			{/* Multi-level approval workflow designer — engine-enforced on submit/approve/reject. */}
			<Dialog open={wfOpen} onOpenChange={setWfOpen}>
				<DialogContent style={{ width: 560, maxHeight: '82vh', overflowY: 'auto' }}>
					<DialogHeader>
						<DialogTitle>Approval Workflow</DialogTitle>
						<DialogDescription>
							Submit routes documents through role-gated approval levels for “{selectedModel?.name ?? selected ?? 'this collection'}”.
						</DialogDescription>
					</DialogHeader>
					{selected && <WorkflowPanel token={token} slug={selected} fields={fields} schema={selectedSchema} />}
				</DialogContent>
			</Dialog>

			{/* Per-collection audit toggle (Directus-style) — schema_json.audit_enabled. */}
			<Dialog open={auditOpen} onOpenChange={setAuditOpen}>
				<DialogContent style={{ width: 480 }}>
					<DialogHeader>
						<DialogTitle>Audit Log</DialogTitle>
						<DialogDescription>
							Control whether changes to “{selectedModel?.name ?? selected ?? 'this collection'}” are recorded in the audit trail.
						</DialogDescription>
					</DialogHeader>
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
				</DialogContent>
			</Dialog>

			{/* Runtime feature policies — headless control plane (schema_json.policies). */}
			<Dialog open={policyOpen} onOpenChange={setPolicyOpen}>
				<DialogContent style={{ width: 480 }}>
					<DialogHeader>
						<DialogTitle>Runtime Policies</DialogTitle>
						<DialogDescription>
							Enable / configure engine behaviors for “{selectedModel?.name ?? selected ?? 'this collection'}” at runtime — no code, no
							redeploy.
						</DialogDescription>
					</DialogHeader>
					{selected && <PolicyPanel token={token} slug={selected} schema={selectedSchema} />}
				</DialogContent>
			</Dialog>

			{/* Auto-numbering Doc No. — the collection's naming-series pattern (prefix +
			 * optional `#` counter width). The engine assigns display_number at create;
			 * empty pattern turns numbering off. */}
			<Dialog open={docNoOpen} onOpenChange={setDocNoOpen}>
				<DialogContent style={{ width: 480 }}>
					<DialogHeader>
						<DialogTitle>Doc No. — auto numbering</DialogTitle>
						<DialogDescription>
							New records of “{selectedModel?.name ?? selected ?? 'this collection'}” are numbered from this pattern. Leave it empty to turn
							Doc No. off.
						</DialogDescription>
					</DialogHeader>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', padding: '0.25rem 0' }}>
						<Label htmlFor="docno-pattern">Pattern</Label>
						<Input
							id="docno-pattern"
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
		</>
	);
}
