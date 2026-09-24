import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { PivotTable, type PivotFetchResult } from './pivot-table';

/**
 * Pivot (cross-tab) table — renders the API's pivot report result
 * (`{ rows, columns }`) as an enterprise-grade grid: sorting, search, column
 * show/hide, pagination, totals, loading/error states. Presentational only.
 */
const meta: Meta<typeof PivotTable> = {
	title: 'Components/PivotTable',
	component: PivotTable,
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				component: `
An enterprise-grade pivot (cross-tabulation) table for report blocks. Given the
backend's pivot report result — \`rows\` (one per row-group value) + \`columns\`
(distinct column-group values) — it renders a sortable, searchable grid:

- **Sorting** — click any header to cycle asc → desc → none (aria-sort aware).
- **Global search** — filters rows by label or any visible cell value.
- **Column show/hide** — hide noisy cross-tab columns from the toolbar menu.
- **Pagination** — \`defaultPageSize\` enables cursor navigation + page size.
- **Totals** — \`showTotals\` renders a totals row + totals column (client-side
  sums over the VISIBLE columns only).
- **States** — loading skeleton, error, empty / no-results.
- **Presentational** — no fetching; data comes through props.
        `.trim(),
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Sales by region × product — `sum(amount)` cross-tab with enough rows to paginate.
const REGIONS = ['North', 'South', 'East', 'West', 'Central', 'Remote'];
const PRODUCTS = ['Widget', 'Gadget', 'Doohickey', 'Contraption', 'Gizmo'];
const rows = REGIONS.map((region, i) => {
	const row: Record<string, unknown> = { region };
	PRODUCTS.forEach((p, j) => {
		row[p] = i * 10 + j * 3 + 5;
	});
	row.Gadget = (i % 3) * 40 + 10;
	row.Doohickey = i % 2 === 0 ? 0 : i * 7;
	return row;
});
const columns = PRODUCTS;

export const Default: Story = {
	render: () => <PivotTable rows={rows} columns={columns} rowLabel="region" />,
};

export const WithTotals: Story = {
	name: 'With Totals',
	render: () => <PivotTable rows={rows} columns={columns} rowLabel="region" showTotals />,
};

/**
 * Fill-height workspace — the spreadsheet-style layout used by the runtime pivot
 * view: the table fills the parent's height, the toolbar stays put and only the
 * table scrolls vertically inside the remaining space (with a Data-Studio-style
 * property column beside it when the app opens its customize panel).
 */
export const FillHeight: Story = {
	name: 'Fill-height workspace',
	render: () => (
		<div style={{ height: 420, border: '1px solid var(--ds-border, #e5e7eb)', borderRadius: 10, display: 'flex', alignItems: 'stretch' }}>
			<div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
				<PivotTable rows={rows} columns={columns} rowLabel="region" showTotals defaultPageSize={5} fillHeight />
			</div>
			<aside
				style={{
					flex: '0 0 264px',
					minHeight: 0,
					overflowY: 'auto',
					alignSelf: 'stretch',
					borderLeft: '1px solid var(--ds-border, #e5e7eb)',
					padding: '0.75rem',
					fontSize: '0.78rem',
				}}
			>
				<strong>Customize pivot</strong>
				<p style={{ marginTop: 8, color: 'var(--ds-muted-foreground, #6b7280)' }}>
					Y axis (rows) · X axis (columns) · measure — the app's property column.
				</p>
			</aside>
		</div>
	),
};

export const Paginated: Story = {
	name: 'Search + Sort + Pagination',
	render: () => <PivotTable rows={rows} columns={columns} rowLabel="region" showTotals defaultPageSize={3} borderStyle="all" striped />,
};

export const Loading: Story = {
	render: () => <PivotTable rows={rows} columns={columns} rowLabel="region" isLoading />,
};

export const Error: Story = {
	render: () => <PivotTable rows={rows} columns={columns} rowLabel="region" error="Pivot reports require the admin role" />,
};

export const Empty: Story = {
	render: () => <PivotTable rows={[]} columns={columns} rowLabel="region" />,
};

export const RowClick: Story = {
	name: 'Row Click',
	render: () => (
		<PivotTable
			rows={rows}
			columns={columns}
			rowLabel="region"
			showTotals
			onRowClick={(row) => window.alert(`Row clicked: ${String(row.region)}`)}
		/>
	),
};

/**
 * Multi-level column headers — the engine emits composite keys
 * (`region|product|sum_total`) for multi col dims / measures; the table splits
 * them into stacked group rows + a sortable leaf row.
 */
export const MultiLevelHeaders: Story = {
	name: 'Multi-Level Column Headers',
	render: () => {
		const groups = ['North', 'South', 'East'];
		const products = ['Widget', 'Gadget'];
		const measures = ['sum_total', 'count_all'];
		const cols = groups.flatMap((g) =>
			products.map((p) => `${g}|${p}|${measures[0]}`).concat(products.map((p) => `${g}|${p}|${measures[1]}`)),
		);
		const multiRows = groups.map((g, i) => {
			const row: Record<string, unknown> = { region: g };
			cols.forEach((c, j) => {
				row[c] = i * 100 + j * 7 + 3;
			});
			return row;
		});
		return <PivotTable rows={multiRows} columns={cols} rowLabel="region" showTotals borderStyle="all" />;
	},
};

/**
 * Export menu — two formats render a dropdown (CSV / Excel); one format keeps
 * the plain button. The app implements the actual download.
 */
export const ExportMenu: Story = {
	name: 'Export Menu (CSV + Excel)',
	render: () => (
		<PivotTable
			rows={rows}
			columns={columns}
			rowLabel="region"
			showTotals
			showExport
			exportFormats={['csv', 'xlsx']}
			onExport={(format) => window.alert(`Export ${format ?? 'csv'} (app calls /api/reports/export)`)}
		/>
	),
};

/**
 * Measure selector — the Odoo-style Σ toolbar control. The end user can switch
 * the aggregation at runtime (the app re-executes with the chosen measure) via
 * a searchable combobox, exactly like the Customize panel's measure picker.
 */
export const MeasureSelector: Story = {
	name: 'Measure Selector (Σ combobox)',
	render: () => {
		const [measure, setMeasure] = React.useState('sum_amount');
		return (
			<PivotTable
				rows={rows}
				columns={columns}
				rowLabel="region"
				showTotals
				measures={[
					{ key: 'count_all', label: 'Count' },
					{ key: 'sum_amount', label: 'Sum(amount)' },
					{ key: 'avg_amount', label: 'Average of Amount' },
					{ key: 'min_amount', label: 'Min of Amount' },
					{ key: 'max_amount', label: 'Max of Amount' },
				]}
				measure={measure}
				onMeasureChange={(k) => {
					setMeasure(k);
					window.alert(`Measure → ${k} (app re-executes /api/reports/execute)`);
				}}
			/>
		);
	},
};

/**
 * Server mode — `fetchData` supplies the (bounded) matrix from the app (e.g.
 * `/api/reports/execute` with rowLimit/topNColumns). Client-side search/sort/
 * pagination still apply on top. Also demonstrates the Export button and the
 * drill-down hook (`onCellClick` → open the underlying rows).
 */
export const ServerMode: Story = {
	name: 'Server Mode + Export + Drill-down',
	render: () => {
		const [data, setData] = React.useState<PivotFetchResult | null>(null);
		return (
			<PivotTable
				rowLabel="region"
				fetchData={async ({ search }) => {
					// Stand-in for an /api/reports/execute call.
					await new Promise((r) => setTimeout(r, 400));
					const filtered = search ? rows.filter((r) => String(r.region).toLowerCase().includes(search)) : rows;
					const result: PivotFetchResult = { rows: filtered, columns };
					setData(result);
					return result;
				}}
				rows={data?.rows ?? []}
				columns={data?.columns ?? columns}
				showTotals
				defaultPageSize={3}
				showExport
				onExport={() => window.alert('Export CSV (app calls /api/reports/export)')}
				onCellClick={(cell) => window.alert(`Drill-down: ${cell.column ? `${cell.column} = ` : ''}${JSON.stringify(cell.row)}`)}
				labels={{ emptyCell: '—' }}
			/>
		);
	},
};
