/**
 * AppDataPane — the record surface of the app workbench's collection section
 * (the table view): the server-driven list with inline editing, bulk
 * delete / restore, trash mode, CSV export, import, and the record create /
 * detail dialogs.
 *
 * Extracted from `AppDetailPage` (which had grown into the god component that
 * owned every workbench concern) so the record surface has ONE reason to
 * change. Behaviour is unchanged. The parent keys this pane by collection slug,
 * so switching collections resets the per-collection view state (selection, the
 * open record, trash mode) the same way the parent used to reset it by hand.
 *
 * The read/write logic itself (columns, fetch, bulk delete/restore, export) lives
 * in `lib/use-collection-records` — shared with the global Collections registry —
 * so this pane owns only its own chrome and dialogs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AlertDescription, Button } from '@mmbix/design-system';
import { DataTable } from '@mmbix/design-system/datatable';
import { Download, Trash2, Upload } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { importRecords, type CollectionSummary, type EntitySchema, type FieldDefinition } from '../../lib/api';
import { itemsQuery } from '../../lib/queries';
import { useViewState } from '../../lib/view-state';
import { writeLockOf, isRowFrozen, partitionFrozenRows, frozenRowsReason, type CollectionWriteLock } from '../../lib/write-lock';
import { useCollectionRecords } from '../../lib/use-collection-records';
import RecordFormDialog from '../RecordFormDialog';
import RecordDetailView from '../RecordDetailView';
import BatchEditDialog from '../BatchEditDialog';
import ExportDialog from '../ExportDialog';

export interface AppDataPaneProps {
	token: string;
	/** The focused collection. */
	model: CollectionSummary;
	/** Its schema — undefined until the collection query resolves. */
	schema?: EntitySchema;
	/** `schema.schema_json.fields` (all fields, incl. system) — the column source. */
	fields: FieldDefinition[];
	/** The engine-enforced write policy for `model`. */
	writeLock: CollectionWriteLock;
	/** Related schemas for m2o filter/display resolution. */
	m2oSchemas: Record<string, EntitySchema>;
	/** Re-read the visible page after a row write (the parent owns the remount tick). */
	refreshRows: (slug: string | null | undefined) => void;
	/** DataTable remount key — bumped by the parent after any row write. */
	tableReload: number;
	/** Surface a write failure (the parent owns the banner). */
	onError: (message: string | null) => void;
}

/** The record surface for one focused collection (table view). */
export function AppDataPane({ token, model, schema, fields, writeLock, m2oSchemas, refreshRows, tableReload, onError }: AppDataPaneProps) {
	const queryClient = useQueryClient();
	// The id of the record open in the detail view lives in ?row= so pasted links
	// and reloads re-open the same record. Writes REPLACE the entry, never push.
	const { searchParams, update: updateViewState } = useViewState();

	// ── Record create / detail state ────────────────────────────────────────────
	const [createOpen, setCreateOpen] = useState(false);
	// The record being edited (null = create mode).
	const [editRecord, setEditRecord] = useState<Record<string, unknown> | null>(null);
	// o2m child-create target — when set, RecordFormDialog creates a RELATED child
	// (e.g. a join row whose counterpart must be picked) instead of a record of the
	// current collection; createPrefill carries the FK back to the parent record.
	const [createTarget, setCreateTarget] = useState<{ collection: { slug: string; name: string }; schema: EntitySchema } | null>(null);
	const [createPrefill, setCreatePrefill] = useState<Record<string, unknown> | null>(null);
	const [openRecord, setOpenRecord] = useState<Record<string, unknown> | null>(null);
	// The schema for the open record — may differ from the current collection when a
	// related (o2m) record is opened recursively.
	const [openSchema, setOpenSchema] = useState<EntitySchema | null>(null);

	// ── Table state ─────────────────────────────────────────────────────────────
	// Trash mode — list soft-deleted records and allow restore.
	const [trashMode, setTrashMode] = useState(false);
	const [batchOpen, setBatchOpen] = useState(false);
	const [importMsg, setImportMsg] = useState<string | null>(null);
	const importRef = useRef<HTMLInputElement>(null);

	const selected = model.slug;

	// The read/write surface for this collection's rows — columns, server fetch,
	// selection, bulk delete/restore and CSV export — shared with the global
	// Collections registry (see lib/use-collection-records.tsx).
	const {
		tableColumns,
		fetchData,
		selectedRows,
		setSelectedRows,
		deleteRows,
		restoreRows,
		exportState,
		openExport,
		closeExport,
		runExport,
	} = useCollectionRecords({ token, selected, fields, m2oSchemas, writeLock, trashMode, refreshRows, onError });

	// The lock for the record OPEN in the detail view — a related collection may
	// differ, and a row frozen by `freeze_when` 403s any update/delete.
	const openWriteLock = useMemo(() => writeLockOf(openSchema ?? schema), [openSchema, schema]);
	// The current selection split by the row-level `freeze_when` rule, so a bulk
	// action only ever targets rows a generic write may touch.
	const selectedPartition = useMemo(() => partitionFrozenRows(writeLock, selectedRows), [writeLock, selectedRows]);

	// ── URL-backed record detail ────────────────────────────────────────────────
	const openRecordView = useCallback(
		(rec: Record<string, unknown>, s: EntitySchema | undefined) => {
			setOpenRecord(rec);
			setOpenSchema(s ?? null);
			// Detail view is opened/closed inside the collection pane (not a separate
			// page) — it only touches ?row=, so update() replaces the history entry.
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
	// open), fetch that single record by id and show it in the detail view.
	useEffect(() => {
		const rowId = searchParams.get('row');
		if (!rowId || !schema) return;
		if (openRecord && String(openRecord.id) === rowId) return;
		let alive = true;
		queryClient
			.fetchQuery(itemsQuery(token, selected, { limit: 1, filters: { id: { operator: '_eq', value: rowId } } }))
			.then((res) => {
				if (!alive) return;
				const row = res.rows[0];
				if (row) {
					setOpenSchema(schema);
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
	}, [searchParams, selected, schema, openRecord, token, updateViewState, queryClient]);

	// Import records from a CSV/JSON file — row errors reported, not fatal. (Only the
	// app workbench's record pane offers import; the global registry does not.)
	async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		e.target.value = '';
		if (!file) return;
		if (!writeLock.canCreate) return;
		try {
			const text = await file.text();
			const format: 'json' | 'csv' = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json';
			const result = await importRecords(token, selected, format, text);
			const errText =
				result.errors.length > 0
					? ` · ${result.errors.length} row error${result.errors.length === 1 ? '' : 's'} (first: ${result.errors[0].error.slice(0, 60)})`
					: '';
			setImportMsg(`Imported ${result.imported} record${result.imported === 1 ? '' : 's'}${errText}`);
			refreshRows(selected);
		} catch (err) {
			setImportMsg(null);
			onError(err instanceof Error ? err.message : 'Import failed');
		}
	}

	// ── Render ──────────────────────────────────────────────────────────────────
	// Create / edit a record — the type-aware form dialog.
	const createSchema = createTarget?.schema ?? schema;
	if (createOpen && createSchema) {
		return (
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
				collection={createTarget?.collection ?? model}
				schema={createSchema}
				record={editRecord}
				initialValues={createPrefill ?? undefined}
				readOnly={!writeLockOf(createSchema).canCreate}
				onSaved={() => {
					// Refresh the table so the new/edited row appears (rows-only).
					setCreateTarget(null);
					setCreatePrefill(null);
					refreshRows(selected);
					// A child-create (sidebar “add”) returns to the parent record detail —
					// bump the record identity so RecordDetailView re-fetches its rows.
					setOpenRecord((r) => (r ? { ...r } : r));
				}}
				onCreated={(rec) => {
					// o2m children need the parent row to exist first — hop straight into
					// the fresh record's detail view so the related-items sidebar is there.
					if (createTarget) return; // child-create from a parent detail — stay put
					const hasO2m = (schema?.schema_json.fields ?? []).some((f) => f.type === 'o2m' && f.related_collection);
					if (hasO2m && rec && rec.id != null) {
						setEditRecord(null);
						openRecordView(rec, schema);
					}
				}}
			/>
		);
	}

	// Directus-style record detail (row click).
	const detailSchema = openSchema ?? schema;
	if (openRecord && detailSchema) {
		return (
			<RecordDetailView
				token={token}
				collection={model}
				schema={detailSchema}
				record={openRecord}
				readOnly={!openWriteLock.canMutate || isRowFrozen(openWriteLock, openRecord)}
				onClose={closeRecordView}
				onSaved={() => refreshRows(selected)}
				onOpenRelated={(_coll, s, rec) => {
					setOpenSchema(s);
					setOpenRecord(rec);
				}}
				onAddRelated={(coll, s, prefill) => {
					setEditRecord(null);
					setCreateTarget({ collection: coll, schema: s });
					setCreatePrefill(prefill);
					setCreateOpen(true);
				}}
			/>
		);
	}

	return (
		<>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem', paddingLeft: '0.75rem' }}>
				<h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>{model.name}</h2>
				{importMsg && <span style={{ fontSize: '0.7rem', color: 'var(--mmbix-tone-positive-fg, #16a34a)' }}>{importMsg}</span>}
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
			{/* Write policy — say WHY create / edit / delete / import are unavailable
			    instead of letting the operator hit a 403. */}
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
					key={`${selected}-${trashMode ? 'trash' : 'live'}-${tableReload}`}
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
						openRecordView(row, schema);
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
							<Button size="sm" variant="outline" title="Export records to CSV" onClick={() => openExport(tableInstance)}>
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
								<Button size="sm" variant="outline" title="Restore selected records" onClick={() => void restoreRows(selectedRows)}>
									Restore ({selectedPartition.writable.length})
								</Button>
							)}
							{writeLock.canMutate && selectedPartition.writable.length > 0 && (
								<Button
									size="sm"
									variant="outline"
									title={trashMode ? 'Permanently delete selected records' : 'Delete selected records'}
									onClick={() => void deleteRows(selectedRows)}
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
					slug={selected}
					pageRowCount={exportState?.pageRows.length ?? 0}
					columnCount={tableColumns.filter((c) => c.enableHiding !== false).length}
					visibleColumnCount={exportState?.visibleIds.size ?? 0}
					onExport={runExport}
				/>
			</div>

			{/* Batch edit lives with the selection it targets. */}
			{schema && (
				<BatchEditDialog
					token={token}
					open={batchOpen}
					onOpenChange={setBatchOpen}
					collection={model}
					schema={schema}
					rows={selectedPartition.writable}
					onSaved={() => {
						setSelectedRows([]);
						refreshRows(selected);
					}}
				/>
			)}
		</>
	);
}
