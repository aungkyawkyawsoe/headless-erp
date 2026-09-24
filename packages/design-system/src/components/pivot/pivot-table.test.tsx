/**
 * PivotTable — toolbar/pagination placement, sorting, search, column
 * visibility and sticky-header behavior (DataTable-consistency contract).
 */
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PivotTable, type PivotFetchResult } from './pivot-table';

const rows = [
	{ region: 'North', Widget: 10, Gadget: 20 },
	{ region: 'South', Widget: 5, Gadget: 30 },
	{ region: 'East', Widget: 15, Gadget: 5 },
];
const columns = ['Widget', 'Gadget'];

describe('PivotTable toolbar consistency', () => {
	it('renders pagination inside the toolbar (above the table), level with search', () => {
		const { container } = render(<PivotTable rows={rows} columns={columns} rowLabel="region" defaultPageSize={2} />);

		const toolbar = container.querySelector('[data-slot="pivot-toolbar"]');
		expect(toolbar).not.toBeNull();
		// Pagination lives INSIDE the toolbar — not below the table.
		expect(within(toolbar as HTMLElement).queryByText('1–2')).not.toBeNull();
		// And the search box is in the same toolbar row.
		expect(within(toolbar as HTMLElement).getByRole('searchbox')).not.toBeNull();
		// The table wrapper sits AFTER the toolbar in the DOM.
		const table = container.querySelector('[data-slot="pivot-table"]');
		expect(toolbar!.compareDocumentPosition(table!).valueOf() & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('hides pagination entirely when not paginated', () => {
		const { container } = render(<PivotTable rows={rows} columns={columns} rowLabel="region" />);
		expect(container.querySelector('[data-slot="pivot-pagination"]')).toBeNull();
	});

	it('renders no pagination when the result set is empty', () => {
		const { container } = render(<PivotTable rows={[]} columns={columns} rowLabel="region" defaultPageSize={2} />);
		expect(container.querySelector('[data-slot="pivot-pagination"]')).toBeNull();
	});
});

describe('PivotTable sorting', () => {
	it('sorts rows by a column header click (asc → desc → none)', () => {
		const { container } = render(<PivotTable rows={rows} columns={columns} rowLabel="region" />);
		const labelTexts = () => Array.from(container.querySelectorAll('[data-slot="pivot-row-label-cell"]')).map((c) => c.textContent);

		// Ascending by Widget (5, 10, 15).
		const widgetHeader = screen.getByRole('button', { name: /sort by Widget/i });
		fireEvent.click(widgetHeader);
		expect(labelTexts()).toEqual(['South', 'North', 'East']);

		// Descending (15, 10, 5).
		fireEvent.click(widgetHeader);
		expect(labelTexts()).toEqual(['East', 'North', 'South']);

		// Third click clears the sort (back to insertion order).
		fireEvent.click(widgetHeader);
		expect(labelTexts()).toEqual(['North', 'South', 'East']);
	});

	it('exposes aria-sort on the active column', () => {
		const { container } = render(<PivotTable rows={rows} columns={columns} rowLabel="region" />);
		fireEvent.click(screen.getByRole('button', { name: /sort by Widget/i }));
		expect(container.querySelector('[data-slot="pivot-column"]')?.getAttribute('aria-sort')).toBe('ascending');
	});
});

describe('PivotTable search', () => {
	it('filters rows by label and shows the no-results state', () => {
		render(<PivotTable rows={rows} columns={columns} rowLabel="region" />);
		const search = screen.getByRole('searchbox');
		fireEvent.change(search, { target: { value: 'North' } });
		expect(screen.getAllByText(/North|South|East/)).toHaveLength(1);

		fireEvent.change(search, { target: { value: 'zzz' } });
		expect(screen.getByText('No matching rows')).not.toBeNull();
	});
});

describe('PivotTable column visibility', () => {
	it('hides a column and drops it from the totals', () => {
		const { container } = render(<PivotTable rows={rows} columns={columns} rowLabel="region" showTotals />);

		// Hide Gadget from the columns menu.
		fireEvent.click(screen.getByRole('button', { name: /columns/i }));
		fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Gadget' }));

		// Gadget cells are gone.
		expect(screen.queryByText('20')).toBeNull();
		// Totals row sums ONLY visible (Widget) values: 10+5+15 = 30.
		// Both the Widget column total and the grand total show 30.
		const footer = container.querySelector('[data-slot="pivot-footer"]');
		expect(within(footer as HTMLElement).getAllByText('30')).toHaveLength(2);
		expect(within(footer as HTMLElement).queryByText('40')).toBeNull();
	});
});

describe('PivotTable sticky header', () => {
	it('makes header cells sticky-top when stickyHeader is enabled', () => {
		const { container } = render(<PivotTable rows={rows} columns={columns} rowLabel="region" stickyHeader />);
		const headerCells = container.querySelectorAll('thead th');
		expect(headerCells.length).toBeGreaterThan(0);
		for (const th of headerCells) {
			expect(th.className).toContain('top-0');
		}
	});

	it('keeps the row-label column sticky-left on body cells', () => {
		const { container } = render(<PivotTable rows={rows} columns={columns} rowLabel="region" />);
		const labelCells = container.querySelectorAll('[data-slot="pivot-row-label-cell"]');
		expect(labelCells.length).toBe(3);
		for (const td of labelCells) {
			expect(td.className).toContain('left-0');
		}
	});
});

describe('PivotTable hierarchy (Odoo-style subtotal groups)', () => {
	// Engine-style output: leaves first, then the group's `__subtotal` row.
	const hRows = [
		{ region: 'North', status: 'pending', sum_amount: 10 },
		{ region: 'North', status: 'paid', sum_amount: 20 },
		{ __subtotal: true, region: 'North Total', status: '', sum_amount: 30 },
		{ region: 'South', status: 'paid', sum_amount: 40 },
		{ __subtotal: true, region: 'South Total', status: '', sum_amount: 40 },
	];

	it('renders subtotal rows as group headers (Odoo order: header then leaves)', () => {
		const { container } = render(<PivotTable rows={hRows} columns={['sum_amount']} rowLabel="region" />);
		const labels = Array.from(container.querySelectorAll('[data-slot="pivot-row-label-cell"]')).map((c) => c.textContent);
		// Header first, then its leaves, then the next header + its leaves.
		expect(labels[0]).toContain('North Total');
		expect(labels[1]).toBe('North');
		expect(labels[2]).toBe('North');
		expect(labels[3]).toContain('South Total');
		expect(labels[4]).toBe('South');
	});

	it('collapses a group when its header is clicked and re-expands it', () => {
		render(<PivotTable rows={hRows} columns={['sum_amount']} rowLabel="region" />);
		const header = screen.getByText('North Total');
		fireEvent.click(header);
		// North's leaves are hidden; South's still visible.
		expect(screen.queryByText('South')).not.toBeNull();
		expect(screen.queryAllByText('North')).toHaveLength(0);
		fireEvent.click(screen.getByText('North Total'));
		expect(screen.getAllByText('North')).toHaveLength(2);
	});

	it('collapse-all hides every group and expand-all restores them', () => {
		render(<PivotTable rows={hRows} columns={['sum_amount']} rowLabel="region" />);
		fireEvent.click(screen.getByRole('button', { name: /collapse all/i }));
		expect(screen.queryByText('North')).toBeNull();
		expect(screen.queryByText('South')).toBeNull();
		expect(screen.getByText('North Total')).not.toBeNull();
		fireEvent.click(screen.getByRole('button', { name: /expand all/i }));
		expect(screen.getAllByText('North')).toHaveLength(2);
	});

	it('excludes subtotal rows from the totals footer', () => {
		const { container } = render(<PivotTable rows={hRows} columns={['sum_amount']} rowLabel="region" showTotals />);
		const footer = container.querySelector('[data-slot="pivot-footer"]');
		// Leaf sums: 10+20+40 = 70 (subtotal rows must not double-count).
		expect(within(footer as HTMLElement).getAllByText('70')).toHaveLength(2);
	});
});

describe('PivotTable flip axis', () => {
	it('renders the flip button and fires onFlipAxis', () => {
		let flipped = 0;
		render(<PivotTable rows={rows} columns={columns} rowLabel="region" onFlipAxis={() => flipped++} />);
		fireEvent.click(screen.getByRole('button', { name: /flip axis/i }));
		expect(flipped).toBe(1);
	});
});

describe('PivotTable customize trigger', () => {
	it('renders the customize button and fires onCustomize', () => {
		let clicks = 0;
		render(<PivotTable rows={rows} columns={columns} rowLabel="region" onCustomize={() => clicks++} />);
		fireEvent.click(screen.getByRole('button', { name: /customize/i }));
		expect(clicks).toBe(1);
	});
});

describe('PivotTable server mode', () => {
	it('uses the fetchData result and re-fetches on search', async () => {
		let callCount = 0;
		const fetchData = async (): Promise<PivotFetchResult> => {
			callCount += 1;
			return { rows, columns };
		};
		const { container } = render(<PivotTable rows={[]} columns={[]} rowLabel="region" fetchData={fetchData} />);

		// Initial fetch (debounced 300ms).
		await new Promise((r) => setTimeout(r, 400));
		expect(container.querySelectorAll('[data-slot="pivot-row-label-cell"]').length).toBe(3);

		fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'North' } });
		await new Promise((r) => setTimeout(r, 400));
		expect(callCount).toBeGreaterThanOrEqual(2);
	});

	it('fires onCellClick with the column key', () => {
		const clicks: Array<{ column: string | null }> = [];
		render(<PivotTable rows={rows} columns={columns} rowLabel="region" onCellClick={(c) => clicks.push(c)} />);
		fireEvent.click(screen.getByText('10'));
		expect(clicks[0]?.column).toBe('Widget');
	});

	it('renders the Export button when showExport is on', () => {
		render(<PivotTable rows={rows} columns={columns} rowLabel="region" showExport onExport={() => {}} />);
		expect(screen.getByRole('button', { name: /export/i })).not.toBeNull();
	});
});

describe('PivotTable multi-level column headers', () => {
	// Composite `region|product` keys — the engine's format for multi col dims.
	const pivotRows = [
		{ region: 'North', 'North|Widget': 10, 'North|Gadget': 20, 'South|Widget': 5, 'South|Gadget': 30 },
		{ region: 'South', 'North|Widget': 1, 'North|Gadget': 2, 'South|Widget': 3, 'South|Gadget': 4 },
	];
	const pivotColumns = ['North|Widget', 'North|Gadget', 'South|Widget', 'South|Gadget'];

	it('renders group rows on top and a sortable leaf row below', () => {
		const { container } = render(<PivotTable rows={pivotRows} columns={pivotColumns} rowLabel="region" />);
		const groups = container.querySelectorAll('[data-slot="pivot-group-header"]');
		expect(groups).toHaveLength(2); // North (span 2) + South (span 2)
		expect(groups[0].textContent).toBe('North');
		expect(groups[0].getAttribute('colspan')).toBe('2');
		expect(groups[1].textContent).toBe('South');
		// Leaf row shows only the last segment, sortable by the full key.
		expect(screen.getAllByRole('button', { name: /sort by Widget/i })).toHaveLength(2);
		expect(container.querySelectorAll('[data-slot="pivot-column"]')).toHaveLength(4);
		// The raw composite key never appears in the header.
		expect(screen.queryByText('North|Widget')).toBeNull();
	});

	it('keeps the row-label corner spanning all header rows', () => {
		const { container } = render(<PivotTable rows={pivotRows} columns={pivotColumns} rowLabel="region" showTotals />);
		const corner = container.querySelector('[data-slot="pivot-row-label"]');
		expect(corner?.getAttribute('rowspan')).toBe('2');
		const total = container.querySelectorAll('[data-slot="pivot-total-header"]');
		expect(total[0]?.getAttribute('rowspan')).toBe('2');
	});

	it('falls back to a flat header for mixed-depth keys (top-N Other)', () => {
		const { container } = render(
			<PivotTable rows={[{ region: 'North', 'North|Widget': 10, Other: 3 }]} columns={['North|Widget', 'Other']} rowLabel="region" />,
		);
		expect(container.querySelectorAll('[data-slot="pivot-group-header"]')).toHaveLength(0);
		expect(screen.getByText('North|Widget')).not.toBeNull();
	});
});

describe('PivotTable export formats', () => {
	it('renders a plain Export button for a single format', () => {
		render(<PivotTable rows={rows} columns={columns} rowLabel="region" showExport onExport={() => {}} />);
		expect(screen.getByRole('button', { name: /export/i })).not.toBeNull();
	});

	it('renders an Export menu with CSV + Excel when two formats are offered', () => {
		render(<PivotTable rows={rows} columns={columns} rowLabel="region" showExport exportFormats={['csv', 'xlsx']} onExport={() => {}} />);
		fireEvent.click(screen.getByRole('button', { name: /export/i }));
		expect(screen.getByRole('menuitem', { name: 'CSV' })).not.toBeNull();
		expect(screen.getByRole('menuitem', { name: 'Excel' })).not.toBeNull();
	});
});

describe('PivotTable measure selector (Odoo-style)', () => {
	it('renders a searchable measure combobox when measures are provided', () => {
		render(
			<PivotTable
				rows={rows}
				columns={columns}
				rowLabel="region"
				measures={[
					{ key: 'sum_amount', label: 'Sum of amount' },
					{ key: 'count_all', label: 'Count' },
				]}
				measure="sum_amount"
				onMeasureChange={() => {}}
			/>,
		);
		const combobox = screen.getByRole('combobox', { name: /measure/i }) as HTMLInputElement;
		expect(combobox).not.toBeNull();
		// The combobox displays the selected measure's LABEL (the key rides in
		// the hidden aria-hidden value input underneath).
		expect(combobox.value).toBe('Sum of amount');
	});

	it('fires onMeasureChange when the end user picks a different measure', () => {
		const changed: string[] = [];
		render(
			<PivotTable
				rows={rows}
				columns={columns}
				rowLabel="region"
				measures={[
					{ key: 'sum_amount', label: 'Sum of amount' },
					{ key: 'count_all', label: 'Count' },
				]}
				measure="sum_amount"
				onMeasureChange={(k) => changed.push(k)}
			/>,
		);
		// Type to open + filter the combobox (Base UI opens on REAL typed input —
		// `fireEvent.input` creates an InputEvent with inputType), then pick.
		fireEvent.input(screen.getByRole('combobox', { name: /measure/i }), { target: { value: 'Count' }, inputType: 'insertText' });
		const option = screen.getByRole('option', { name: 'Count' });
		expect(option).not.toBeNull();
		fireEvent.click(option);
		expect(changed).toEqual(['count_all']);
	});
});
