// @vitest-environment jsdom
/**
 * ExportDialog — the scope chooser driven through a real DOM.
 *
 * The report that prompted this spec: picking "All matching rows" still
 * produced a one-page CSV. The whole client chain (`onExport({rows})` →
 * `collectAllRows`) hangs off the radio row ACTUALLY committing `rows: 'all'`,
 * so that interaction is pinned here: clicking the radio itself, the row's
 * label TEXT (the way an operator would), and checking the Export button
 * passes the selected scope through verbatim.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExportDialog from './ExportDialog';

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

/** `downloadCsv` touches Blob/URL/createElement — stub the module's leaf helper. */
vi.mock('../lib/csv-export', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../lib/csv-export')>();
	return { ...actual, downloadCsv: vi.fn() };
});

import { downloadCsv } from '../lib/csv-export';

function renderDialog(onExport: (scope: { rows: 'page' | 'all'; columns: 'visible' | 'all' }) => Promise<string>) {
	const onOpenChange = vi.fn();
	render(
		<ExportDialog
			open
			onOpenChange={onOpenChange}
			slug="mro_item_model"
			pageRowCount={25}
			columnCount={40}
			visibleColumnCount={12}
			onExport={onExport}
		/>,
	);
	return { onOpenChange };
}

const exportButton = () => screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement;

describe('ExportDialog', () => {
	it('exports the default scope (current page, visible columns) untouched', async () => {
		const onExport = vi.fn().mockResolvedValue('a,b\n1,2');
		renderDialog(onExport);
		fireEvent.click(exportButton());
		await waitFor(() => expect(onExport).toHaveBeenCalledWith({ rows: 'page', columns: 'visible' }));
	});

	it('commits rows: "all" when the radio itself is clicked', async () => {
		const onExport = vi.fn().mockResolvedValue('a,b\n1,2');
		renderDialog(onExport);
		// base-ui wires `aria-labelledby` to the wrapping row label, so the radio's
		// accessible name is the row's whole text ("All matching rows fetches every page").
		fireEvent.click(screen.getByRole('radio', { name: /All matching rows/ }));
		fireEvent.click(exportButton());
		await waitFor(() => expect(onExport).toHaveBeenCalledWith({ rows: 'all', columns: 'visible' }));
	});

	it('commits rows: "all" when the row LABEL TEXT is clicked', async () => {
		const onExport = vi.fn().mockResolvedValue('a,b\n1,2');
		renderDialog(onExport);
		fireEvent.click(screen.getByText('All matching rows'));
		fireEvent.click(exportButton());
		await waitFor(() => expect(onExport).toHaveBeenCalledWith({ rows: 'all', columns: 'visible' }));
	});

	it('commits rows: "all" when the trailing COUNT text is clicked', async () => {
		const onExport = vi.fn().mockResolvedValue('a,b\n1,2');
		renderDialog(onExport);
		fireEvent.click(screen.getByText('fetches every page'));
		fireEvent.click(exportButton());
		await waitFor(() => expect(onExport).toHaveBeenCalledWith({ rows: 'all', columns: 'visible' }));
	});

	it('passes both scopes through, and downloads the CSV the page built', async () => {
		const onExport = vi.fn().mockResolvedValue('id,name\n1,x');
		renderDialog(onExport);
		fireEvent.click(screen.getByText('All matching rows'));
		fireEvent.click(screen.getByText('All columns'));
		fireEvent.click(exportButton());
		await waitFor(() => expect(onExport).toHaveBeenCalledWith({ rows: 'all', columns: 'all' }));
		await waitFor(() => expect(vi.mocked(downloadCsv)).toHaveBeenCalled());
		expect(vi.mocked(downloadCsv).mock.calls[0][1]).toBe('id,name\n1,x');
	});

	it('re-opens on the safe defaults after a previous "all" run', async () => {
		const onExport = vi.fn().mockResolvedValue('a,b\n1,2');
		const { onOpenChange } = renderDialog(onExport);
		fireEvent.click(screen.getByText('All matching rows'));
		expect(screen.getByRole('radio', { name: /All matching rows/ }).getAttribute('aria-checked')).toBe('true');
		fireEvent.click(exportButton());
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
	});
});
