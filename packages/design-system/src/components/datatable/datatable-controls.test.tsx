/**
 * DataTable controls — the props a caller uses to take over the toolbar's
 * chrome: a controlled global filter, a caller-owned filter predicate
 * (`manualFiltering`), a table with no pagination (so "the rows on screen" IS
 * the whole filtered set), a toolbar without the filter popover, and a header
 * that is itself a control (`enableHeaderMenu: false`).
 */
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { DataTable } from '../datatable';
import type { ColumnDef } from './core/types';

interface Sale {
	id: string;
	region: string;
}

const columns: ColumnDef<Sale>[] = [
	{ id: 'id', accessorKey: 'id', header: 'ID' },
	{ id: 'region', accessorKey: 'region', header: 'Region' },
];

const rows: Sale[] = [
	{ id: '1', region: 'North' },
	{ id: '2', region: 'South' },
	{ id: '3', region: 'East' },
];

const renderedRows = () => document.querySelectorAll('[data-slot="datatable-row"]').length;
const searchBox = (label = 'Search') => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);

describe('DataTable controlled global filter', () => {
	it('reports every term to the caller and renders the rows the caller filtered', async () => {
		function Harness() {
			const [term, setTerm] = React.useState('');
			const data = term ? rows.filter((r) => r.region.toLowerCase().includes(term.toLowerCase())) : rows;
			return (
				<DataTable
					columns={columns}
					data={data}
					defaultPageSize={10}
					manualFiltering
					globalFilter={term}
					onGlobalFilterChange={setTerm}
					labels={{ searchLabel: 'Search sales' }}
				/>
			);
		}
		render(<Harness />);

		expect(renderedRows()).toBe(3);
		const box = searchBox('Search sales')!;
		fireEvent.change(box, { target: { value: 'south' } });

		await waitFor(() => expect(renderedRows()).toBe(1));
		// Controlled: the box shows the caller's term, not a private copy.
		expect(searchBox('Search sales')!.value).toBe('south');
	});
});

describe('DataTable manualFiltering', () => {
	it('keeps every row the caller passed (the caller owns the predicate)', () => {
		// Same props as the control below except for `manualFiltering`: the table
		// must NOT apply the term a second time, or it would silently subtract
		// rows the caller counted on.
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} manualFiltering globalFilter="south" />);
		expect(renderedRows()).toBe(3);
	});

	it('control — without manualFiltering the table filters and can empty out', () => {
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} globalFilter="zzz" labels={{ empty: 'Nothing here' }} />);
		expect(renderedRows()).toBe(0);
		expect(document.body.textContent).toContain('Nothing here');
	});
});

describe('DataTable showPagination={false}', () => {
	const many: Sale[] = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), region: `R${i + 1}` }));

	it('renders the whole filtered set and no pagination control', () => {
		render(<DataTable columns={columns} data={many} defaultPageSize={10} showPagination={false} />);
		// 12 rows with a 10-row page size: the page size is widened to the row
		// count, so nothing is sliced away.
		expect(renderedRows()).toBe(12);
		expect(document.querySelector('[data-slot="datatable-pagination"]')).toBeNull();
	});

	it('control — the default paginates to the first page and shows the control', () => {
		render(<DataTable columns={columns} data={many} defaultPageSize={10} />);
		expect(renderedRows()).toBe(10);
		expect(document.querySelector('[data-slot="datatable-pagination"]')).not.toBeNull();
	});
});

describe('DataTable showFilters', () => {
	it('renders the filter popover trigger by default', () => {
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} />);
		expect(document.querySelector('button[aria-label^="Filters"]')).not.toBeNull();
	});

	it('omits the trigger when showFilters is false', () => {
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} showFilters={false} labels={{ searchLabel: 'Search' }} />);
		expect(document.querySelector('button[aria-label^="Filters"]')).toBeNull();
		// The rest of the toolbar is untouched — the search box stays.
		expect(searchBox('Search')).not.toBeNull();
	});
});

describe('ColumnDef.enableHeaderMenu', () => {
	const headerSpy = vi.fn();

	function ToggleHeader() {
		const [on, setOn] = React.useState(false);
		return (
			<button
				type="button"
				aria-pressed={on}
				onClick={() => {
					setOn((v) => !v);
					headerSpy();
				}}
			>
				{on ? 'All' : 'None'}
			</button>
		);
	}

	const controlColumns: ColumnDef<Sale>[] = [
		{ id: 'id', accessorKey: 'id', header: 'ID' },
		{ id: 'region', accessorKey: 'region', header: () => <ToggleHeader />, enableHeaderMenu: false, enableSorting: false },
	];

	it('renders a control header bare — no menu trigger wrapper', () => {
		render(<DataTable columns={controlColumns} data={rows} defaultPageSize={10} />);

		const control = document.querySelector<HTMLElement>('th[data-column-id="region"]')!;
		const defaultHeader = document.querySelector<HTMLElement>('th[data-column-id="id"]')!;
		expect(control.querySelector('[aria-haspopup]')).toBeNull();
		expect(defaultHeader.querySelector('[aria-haspopup]')).not.toBeNull();
	});

	it('clicks through to the control without opening a column menu', async () => {
		render(<DataTable columns={controlColumns} data={rows} defaultPageSize={10} />);

		const button = document.querySelector<HTMLButtonElement>('th[data-column-id="region"] button')!;
		expect(button.textContent).toBe('None');
		fireEvent.click(button);

		expect(headerSpy).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(button.textContent).toBe('All'));
		// A nested menu trigger would have opened a column menu on this click.
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});
});
