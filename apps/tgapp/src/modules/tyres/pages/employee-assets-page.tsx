import { useMemo } from 'react';
import { useParams } from 'react-router-dom';

import { AssetRegister } from '../components/asset-register';
import { ModuleShell } from '@/shared/components/module-shell';
import { useEmployeeMasters } from '@/shared/lookups/hooks';

/**
 * ONE employee's ISSUED ASSETS (`/app/employees/:id/assets`) — the person-side
 * counterpart of a truck's inventory, built from the SAME shared `AssetRegister`.
 *
 * The body is ONE `GET /api/mro/assets/holder?employee=` read. A person holds only
 * `asset`-kind belongings — a jack, a toolbox, a radio — so the register is ONE
 * list (the truck's richer on-board registry is a different body, over the same
 * read, carrying the per-unit actions a custody does not need). Everything in
 * this person's custody — issued from a store, reassigned from a colleague, or
 * moved off a truck — shows in that ONE list. Tapping a row opens its full
 * lifecycle, where the asset can be reassigned, returned to store or written off.
 * There is no writer on this screen — custody changes happen on the asset's own
 * detail so every move is one guarded, audited action.
 */
export default function EmployeeAssetsPage() {
	const { id = '' } = useParams<{ id: string }>();

	// The employee's display name for the app-bar title — the shared directory.
	const employees = useEmployeeMasters();
	const name = useMemo(() => {
		const row = (employees.data ?? []).find((employee) => employee.id === id);
		return row?.name_en?.trim() || row?.name_mm?.trim() || row?.eid?.trim() || null;
	}, [employees.data, id]);

	return (
		<ModuleShell title={name ? `${name} · Assets` : 'Employee assets'} backTo="/app/employees">
			<AssetRegister
				holder={{ employee: id }}
				empty={{ title: 'No assets', hint: 'Assets issued into this person’s custody show here.' }}
			/>
		</ModuleShell>
	);
}
