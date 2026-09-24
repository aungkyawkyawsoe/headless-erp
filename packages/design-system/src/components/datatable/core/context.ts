'use client';

import * as React from 'react';
import type { RowData } from '@tanstack/react-table';
import type { DataTableInstance } from './types';

/**
 * Lightweight context to provide the DataTable instance
 * to deeply nested UI components.
 */
// Table<TData> is invariant — a generic context must use `any` and cast at the
// consumer level via useDataTableInstance<TData>().
const DataTableInstanceContext = React.createContext<
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	DataTableInstance<any> | undefined
>(undefined);

export function useDataTableInstance<TData extends RowData>() {
	const ctx = React.useContext(DataTableInstanceContext);
	if (!ctx) {
		throw new Error('useDataTableInstance must be used within a <DataTable /> component.');
	}
	return ctx as DataTableInstance<TData>;
}

export { DataTableInstanceContext };
