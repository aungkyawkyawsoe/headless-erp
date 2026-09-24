'use client';

import * as React from 'react';
import type { RowData } from '@tanstack/react-table';
import type { LegacyReactTable, LegacyRow } from '@tanstack/react-table/legacy';
import type { ColumnDef, DataTableLabels, Density } from './core/types';

interface ProcessedDataContextValue<TData extends RowData> {
	table: LegacyReactTable<TData>;
	rows: LegacyRow<TData>[];
	columns: ColumnDef<TData>[];
	isLoading: boolean;
	error: string | null;
	density: Density;
	labels?: DataTableLabels;
	enableRowSelection: boolean;
	onRowClick?: (row: TData) => void;
	rowKey: keyof TData & string;
	onSelectionChange?: (selectedData: TData[]) => void;
	enableRowExpansion: boolean;
	expandedRowIds: string[];
	getIsRowExpanded: (rowId: string) => boolean;
	toggleRowExpanded: (rowId: string, expanded?: boolean) => void;
	expandAll: () => void;
	collapseAll: () => void;
}

// Table<TData> is invariant — a generic context must use `any` and cast at the
// consumer level via useProcessedData<TData>().
const ProcessedDataContext = React.createContext<
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ProcessedDataContextValue<any> | undefined
>(undefined);

export function useProcessedData<TData extends RowData>() {
	const ctx = React.useContext(ProcessedDataContext);
	if (!ctx) {
		throw new Error('useProcessedData must be used within a <DataTable /> component.');
	}
	return ctx as ProcessedDataContextValue<TData>;
}

export function ProcessedDataProvider<TData extends RowData>({
	children,
	...value
}: ProcessedDataContextValue<TData> & { children: React.ReactNode }) {
	// Table<TData> is invariant — the context is typed `any` and cast here;
	// consumers re-cast via useProcessedData<TData>().
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return <ProcessedDataContext.Provider value={value as ProcessedDataContextValue<any>}>{children}</ProcessedDataContext.Provider>;
}
