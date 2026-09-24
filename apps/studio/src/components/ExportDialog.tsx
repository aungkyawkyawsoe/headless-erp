import { useEffect, useState } from 'react';
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Label,
	RadioGroup,
	RadioGroupItem,
} from '@mmbix/design-system';
import { messageOf } from '../lib/errors';
import { downloadCsv, type ExportColumnsScope, type ExportRowsScope } from '../lib/csv-export';

export interface ExportDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Collection slug — used in the downloaded filename. */
	slug: string;
	/** Rows currently loaded on the page (the "current page" scope). */
	pageRowCount: number;
	/** Total selectable columns. */
	columnCount: number;
	/** Columns currently visible in the table. */
	visibleColumnCount: number;
	/** Runs the export and returns the CSV text (throws on failure). */
	onExport: (scope: { rows: ExportRowsScope; columns: ExportColumnsScope }) => Promise<string>;
}

/** One radio option row — the radio + its label + a trailing count. The group's
 *  `value`/`onValueChange` drives selection; the row is a plain labelled control. */
function OptionRow({ value, label, count, groupLabel }: { value: string; label: string; count: string; groupLabel: string }) {
	return (
		<label className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60" style={{ cursor: 'pointer' }}>
			<RadioGroupItem value={value} aria-label={`${groupLabel}: ${label}`} />
			<span className="text-sm font-medium">{label}</span>
			<span className="ml-auto text-xs text-muted-foreground">{count}</span>
		</label>
	);
}

/**
 * Export scope chooser for the collection tables — lets the operator pick WHICH
 * rows (current page vs every matching row, walked through the cursor API) and
 * WHICH columns (only the visible ones vs the full schema) go into the CSV.
 * The actual work always runs through lib/csv-export so the Collections
 * workbench and the App workbench export identically.
 */
export default function ExportDialog({
	open,
	onOpenChange,
	slug,
	pageRowCount,
	columnCount,
	visibleColumnCount,
	onExport,
}: ExportDialogProps) {
	const [rowsScope, setRowsScope] = useState<ExportRowsScope>('page');
	const [columnsScope, setColumnsScope] = useState<ExportColumnsScope>('visible');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Re-open starts from the safe defaults (visible columns of the current page).
	useEffect(() => {
		if (open) {
			setRowsScope('page');
			setColumnsScope('visible');
			setBusy(false);
			setError(null);
		}
	}, [open]);

	async function run() {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const text = await onExport({ rows: rowsScope, columns: columnsScope });
			downloadCsv(`${slug}-${new Date().toISOString().slice(0, 10)}.csv`, text);
			onOpenChange(false);
		} catch (e) {
			setError(messageOf(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Export records</DialogTitle>
					<DialogDescription>Choose which rows and columns to include in the CSV file.</DialogDescription>
				</DialogHeader>
				<div className="grid gap-5 py-1">
					<div className="grid gap-1.5">
						<Label>Rows</Label>
						<RadioGroup value={rowsScope} onValueChange={(v) => setRowsScope(v as ExportRowsScope)} className="gap-0.5">
							<OptionRow groupLabel="Rows" value="page" label="Current page" count={`${pageRowCount} rows`} />
							<OptionRow groupLabel="Rows" value="all" label="All matching rows" count="fetches every page" />
						</RadioGroup>
					</div>
					<div className="grid gap-1.5">
						<Label>Columns</Label>
						<RadioGroup value={columnsScope} onValueChange={(v) => setColumnsScope(v as ExportColumnsScope)} className="gap-0.5">
							<OptionRow groupLabel="Columns" value="visible" label="Visible columns" count={`${visibleColumnCount}`} />
							<OptionRow groupLabel="Columns" value="all" label="All columns" count={`${columnCount}`} />
						</RadioGroup>
					</div>
				</div>
				{error && (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
						Cancel
					</Button>
					<Button onClick={() => void run()} disabled={busy}>
						{busy ? 'Exporting…' : 'Export'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
