import TableConfigEditor from './TableConfigEditor';

/**
 * TableLayoutCanvas — the middle-column table editor (layout mode).
 * Replaces the "No blocks yet" empty outline: the table's Data / Columns /
 * Rows properties are edited here; the right pane keeps the page properties.
 */
export default function TableLayoutCanvas() {
	return (
		<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
			<div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.9rem', background: 'var(--mmbix-background, #fff)' }}>
				<TableConfigEditor view="table" showData={false} showRows={false} />
			</div>
		</div>
	);
}
