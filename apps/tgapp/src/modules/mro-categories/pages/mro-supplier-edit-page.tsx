import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { MasterDeleteAction } from '../components/master-delete-action';
import { SupplierMasterForm } from '@/shared/components/supplier-master-form';
import { fetchSupplierById, removeSupplier, renameSupplier } from '../data/api';
import { qk } from '../data/query-keys';
import { STALE_MS } from '@/shared/api/invalidation';
import { MRO_SUPPLIERS_QUERY_KEY, dropMasterFromDirectory, upsertMasterDirectory } from '@/shared/hooks/use-mro-masters';
import { ModuleShell } from '@/shared/components/module-shell';
import { FormSkeleton } from '@/shared/components/skeletons';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';

/**
 * Edit Supplier — the supplier master edit page
 * (`/app/mro-categories/suppliers/:id`, opened by tapping a supplier row on the
 * masters hub's Supplier tab). Loads the `mro_suppliers` row and renders the
 * shared supplier form seeded with its name / mobile / address. Saving writes
 * the row and FOLDS IT THROUGH the shared supplier directory (server response =
 * truth, no refetch round trip); delete drops it the same way.
 */
export default function MroSupplierEditPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { id } = useParams<{ id: string }>();

	const rowQuery = useQuery({
		queryKey: qk.supplierEdit(id ?? ''),
		queryFn: () => fetchSupplierById(id ?? ''),
		enabled: id != null && id !== '',
		// Seeds the form — always refetch on entry (the app-wide default 30s
		// staleTime would freeze the fields on a cached pre-save row).
		staleTime: STALE_MS.live,
	});

	const initial = useMemo(
		() => ({
			name: rowQuery.data?.name ?? '',
			mobile: rowQuery.data?.mobile ?? '',
			address: rowQuery.data?.address ?? '',
		}),
		[rowQuery.data],
	);

	const save = async (input: { name: string; mobile?: string; address?: string }) => {
		if (!id) return;
		const updated = await renameSupplier(id, input);
		queryClient.setQueryData(qk.supplierEdit(id), updated);
		upsertMasterDirectory(queryClient, MRO_SUPPLIERS_QUERY_KEY, updated);
		notifySaved('Supplier updated');
		popBack(navigate, '/app/mro-categories?tab=suppliers');
	};

	// Delete — the engine refuses (409) while any inbound document uses this
	// supplier; the thrown message is shown verbatim by the action.
	const remove = async () => {
		if (!id) return;
		await removeSupplier(id);
		dropMasterFromDirectory(queryClient, MRO_SUPPLIERS_QUERY_KEY, id);
		notifySaved('Supplier deleted');
		popBack(navigate, '/app/mro-categories?tab=suppliers');
	};

	return (
		<ModuleShell title="Edit Supplier" backTo="/app/mro-categories?tab=suppliers">
			{rowQuery.isPending ? (
				<FormSkeleton />
			) : rowQuery.isError || !rowQuery.data ? (
				<div className="flex flex-1 flex-col items-center gap-3 px-4 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Couldn't load this supplier.</p>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => void rowQuery.refetch()}
							className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
						>
							<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
							Retry
						</button>
						<button
							type="button"
							onClick={() => popBack(navigate, '/app/mro-categories?tab=suppliers')}
							className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
						>
							Back to list
						</button>
					</div>
				</div>
			) : (
				<SupplierMasterForm
					key={id ?? ''}
					initial={initial}
					submitLabel="Save"
					savingLabel="Saving…"
					errorMessage="Couldn't save the supplier. Please try again."
					save={save}
					deleteAction={
						<MasterDeleteAction noun="supplier" errorMessage="Couldn't delete the supplier. Please try again." onDelete={remove} />
					}
				/>
			)}
		</ModuleShell>
	);
}
