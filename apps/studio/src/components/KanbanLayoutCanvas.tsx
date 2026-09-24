import { useEffect, useMemo } from 'react';
import { Spinner } from '@mmbix/design-system';
import { KanbanBoard, pickDisplayField, type KanbanViewConfig } from '@mmbix/ui-views';
import { useBuilder } from './PageBuilderContext';
import { SYSTEM_FIELD_NAMES } from '../lib/api';
import { useCollectionPreview } from '../lib/use-collection-preview';

/**
 * KanbanLayoutCanvas — the middle-column kanban canvas.
 * A pure WYSIWYG live preview: the collection's records rendered as a kanban
 * board with the current kanban config (preview == runtime). All kanban
 * properties (Data, Board, Cards) live in the right pane.
 */
export default function KanbanLayoutCanvas() {
	const { token, viewConfigs, schemas, fetchSchema, focusCollection, setViewConfig } = useBuilder();
	const { collection, schema, fields, rows, loading, vc } = useCollectionPreview(
		token,
		viewConfigs,
		schemas,
		fetchSchema,
		focusCollection,
		'kanban',
		{
			limit: 100,
			enabled: !!viewConfigs['kanban']?.kanban?.groupBy,
		},
	);
	const kv = vc.kanban ?? {};

	// Seed the canvas from the collection's RUNTIME kanban config
	// (schema_json.kanban_view) when the page has no kanban config of its own yet —
	// so Studio preview == runtime even before the designer touches anything.
	useEffect(() => {
		const runtime = (schema?.schema_json as { kanban_view?: unknown } | undefined)?.kanban_view as KanbanViewConfig | undefined;
		const pageKanban = vc.kanban;
		const unconfigured = !pageKanban?.groupBy;
		if (!collection || !runtime || !unconfigured) return;
		setViewConfig('kanban', { collection, kanban: runtime });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [collection, schema, vc.kanban]);

	const displayField = useMemo(() => pickDisplayField(fields, SYSTEM_FIELD_NAMES), [fields]);

	return (
		<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
			<div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.9rem', background: 'var(--mmbix-background, #fff)' }}>
				{!collection ? (
					<div
						style={{
							border: '1px dashed var(--mmbix-border, #d1d5db)',
							borderRadius: 10,
							padding: '1.25rem',
							color: '#9ca3af',
							fontSize: '0.8rem',
							textAlign: 'center',
						}}
					>
						Pick a collection in the right panel to design the kanban board.
					</div>
				) : !kv.groupBy ? (
					<div
						style={{
							border: '1px dashed var(--mmbix-border, #d1d5db)',
							borderRadius: 10,
							padding: '1.25rem',
							color: '#9ca3af',
							fontSize: '0.8rem',
							textAlign: 'center',
						}}
					>
						Choose a "Group by" field in the right panel to build the board.
					</div>
				) : (
					<>
						{loading && rows.length === 0 ? (
							<div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: '0.8rem', padding: '1rem 0.25rem' }}>
								<Spinner /> Loading records…
							</div>
						) : (
							<KanbanBoard config={kv} rows={rows} fields={fields} loading={loading} displayField={displayField} />
						)}
					</>
				)}
			</div>
		</div>
	);
}
