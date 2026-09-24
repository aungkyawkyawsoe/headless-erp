import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { SupplierMasterForm } from '@/shared/components/supplier-master-form';
import { createSupplier } from '../data/api';
import { MRO_SUPPLIERS_QUERY_KEY, upsertMasterDirectory } from '@/shared/hooks/use-mro-masters';
import { ModuleShell } from '@/shared/components/module-shell';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';

/**
 * New Supplier — the supplier master create page
 * (`/app/mro-categories/suppliers/+`, behind the masters hub's Supplier tab
 * + button). Creates an `mro_suppliers` row (Global Tyre, MM Auto Parts, …) with
 * its contact facts (name required, mobile + address optional) — the facts the
 * Suppliers tab rows + the inbound (GRN) flow read. Success WRITES THE ROW
 * THROUGH the shared supplier directory (server response = truth, no refetch)
 * and returns to the suppliers tab.
 */
export default function MroSupplierCreatePage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const save = async (input: { name: string; mobile?: string; address?: string }) => {
		const row = await createSupplier(input);
		upsertMasterDirectory(queryClient, MRO_SUPPLIERS_QUERY_KEY, row);
		notifySaved('Supplier saved');
		popBack(navigate, '/app/mro-categories?tab=suppliers');
	};

	return (
		<ModuleShell title="New Supplier" backTo="/app/mro-categories?tab=suppliers">
			<SupplierMasterForm
				submitLabel="Add"
				savingLabel="Adding…"
				errorMessage="Couldn't add the new supplier. Please try again."
				save={save}
			/>
		</ModuleShell>
	);
}
