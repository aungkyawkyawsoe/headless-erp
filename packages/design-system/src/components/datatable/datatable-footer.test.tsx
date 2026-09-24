/**
 * DataTable footer rendering — `showFooter` produces a real `<tfoot>` from
 * `table.getFooterGroups()`, honoring string footers and render props.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DataTable } from '../datatable';
import type { ColumnDef } from './core/types';

interface Row {
	id: string;
	amount: number;
}

const columns: ColumnDef<Row>[] = [
	{ id: 'id', accessorKey: 'id', header: 'ID', footer: 'Total' },
	{
		id: 'amount',
		accessorKey: 'amount',
		header: 'Amount',
		footer: ({ table, column }) => table.getFilteredRowModel().rows.reduce((sum, row) => sum + (Number(row.getValue(column.id)) || 0), 0),
	},
];

const data: Row[] = [
	{ id: '1', amount: 10 },
	{ id: '2', amount: 20 },
];

describe('DataTable footer', () => {
	it('renders no tfoot when showFooter is off', () => {
		render(<DataTable columns={columns} data={data} defaultPageSize={10} />);
		expect(document.querySelector('[data-slot="datatable-footer"]')).toBeNull();
	});

	it('renders a tfoot with string + render-prop footer cells when showFooter is on', () => {
		render(<DataTable columns={columns} data={data} showFooter defaultPageSize={10} />);

		const footer = document.querySelector('[data-slot="datatable-footer"]');
		expect(footer).not.toBeNull();

		const cells = footer!.querySelectorAll('[data-slot="datatable-footer-cell"]');
		expect(cells).toHaveLength(2);
		expect(cells[0].textContent).toBe('Total');
		expect(cells[1].textContent).toBe('30');
	});
});
