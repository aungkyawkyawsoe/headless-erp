import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
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
	confirmDialog,
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
	SearchBox,
} from '@mmbix/design-system';
import { DataTable, type ColumnDef, type DataTableInstance, type FetchParams, type FetchResult } from '@mmbix/design-system/datatable';
import { Database, Download, Gauge, Hash, History, Plus, ShieldCheck, Sparkles, Trash2, Upload, Workflow } from 'lucide-react';
import {
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
import { collectionQuery, itemsQuery, menusQuery, moduleQuery, modulesQuery, pagesQuery } from '../lib/queries';
import { invalidateCollection, invalidateCollectionList, invalidateModule, invalidateRows } from '../lib/query-client';
import { qk } from '../lib/query-keys';
import { messageOf } from '../lib/errors';
import { writeLockOf, isRowFrozen, partitionFrozenRows, frozenRowsReason } from '../lib/write-lock';
import { useViewState } from '../lib/view-state';
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
import GenerationPanel from '../components/GenerationPanel';
import AddFieldDialog from '../components/AddFieldDialog';
import { PageBuilderProvider, PageCanvas } from '../components/PageBuilder';
import ManageAppDialog from '../components/ManageAppDialog';
import RecordFormDialog from '../components/RecordFormDialog';
import RecordDetailView from '../components/RecordDetailView';
import BatchEditDialog from '../components/BatchEditDialog';
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
import { InlineCellEditor } from '../components/InlineCellEditor';
import { BuilderFormLayout, BuilderLeftPane, BuilderRightPane, toMenuTree } from '../components/builder/builder-parts';
import { AppWorkbenchHeader, type AppSection } from '../components/builder/AppWorkbenchHeader';
import { AppCollectionList } from '../components/builder/AppCollectionList';
import { AppSchemaFields } from '../components/builder/AppSchemaFields';
import { DocNoDialog } from '../components/collections/DocNoDialog';
import { PanelDialog } from '../components/collections/PanelDialog';
import { NewCollectionDialog } from '../components/builder/NewCollectionDialog';

export default function AppDetailPage({ token }: { token: string }) {
	const { slug } = useParams<{ slug: string }>();
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
	const [importMsg, setImportMsg] = useState<string | null>(null);
	const importRef = useRef<HTMLInputElement>(null);
	const [newOpen, setNewOpen] = useState(false);
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
				renderCell: (field, value, row) => {
					const id = row?.id;
					return (
						<InlineCellEditor
							field={field}
							value={value}
							recordId={String(id ?? '')}
							token={token}
							collectionSlug={selectedModel?.slug ?? selected ?? ''}
							// The SAME write gate the record view uses — a service / append-only
							// collection, a frozen row, a frozen column, or a row without an id
							// keeps every cell read-only (least privilege).
							readOnly={
								id == null ||
								!selectedModel ||
								!writeLock.canMutate ||
								isRowFrozen(writeLock, row) ||
								writeLock.frozenFields.includes(field.name)
							}
							onSaved={() => {
								// Reuse the page's row-write refresh so the edited row re-reads from the API.
								if (selectedModel) refreshRows(selectedModel.slug);
							}}
						/>
					);
				},
			}),
		[fields, m2oSchemas, token, selected, selectedModel, writeLock, refreshRows],
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
		if (
			!(await confirmDialog({
				title: 'Delete records',
				description: `Delete ${label}?${frozen.length ? ` (${frozen.length} frozen skipped)` : ''}`,
				destructive: true,
				confirmLabel: 'Delete',
			}))
		)
			return;
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
								section === 'collection' ? (
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
														{importMsg && (
															<span style={{ fontSize: '0.7rem', color: 'var(--mmbix-tone-positive-fg, #16a34a)' }}>{importMsg}</span>
														)}
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
																		<Trash2 size={13} /> Trash
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
																			style={{ color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}
																		>
																			<Trash2 size={13} /> Delete ({selectedPartition.writable.length})
																		</Button>
																	)}
																	{selectedPartition.frozen.length > 0 && (
																		<span
																			title={frozenRowsReason(writeLock, selectedPartition.frozen.length)}
																			style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)', alignSelf: 'center' }}
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
														<Button
															size="sm"
															variant="outline"
															onClick={() => setGenerationOpen(true)}
															title="Propose fields from a design (reviewed before anything is written)"
														>
															<Sparkles size={13} /> Generate
														</Button>
													</div>
												</div>

												<AppSchemaFields fields={visibleFields} onRemoveField={(name) => void removeField(name)} />
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
