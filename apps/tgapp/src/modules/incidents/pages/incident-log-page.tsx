import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { IncidentRecordForm } from '../components/incident-record-form';
import { fetchTruckIdentity } from '../data/api';
import { qk } from '../data/query-keys';
import { ModuleShell } from '@/shared/components/module-shell';
import { notifySaved } from '@/shared/save-feedback';

/**
 * မှတ်တမ်း → the truck's LOG-a-record screen
 * (`/app/incidents/vehicle/:id/log`), opened by the truck page's + button.
 *
 * A DEDICATED page — not a tab of the truck page — so the form is full-screen
 * with NO bottom toolbar, and its Save is the Telegram native MainButton (the
 * form's default `nativeSubmit`). The owning truck is fixed (it never rides a
 * picker). On save it lands back on the truck page so the new record leads its
 * history — replacing the form entry so Back never returns to it.
 */
export default function IncidentLogPage() {
	const navigate = useNavigate();
	const { id } = useParams<{ id: string }>();
	const vehicleId = id ?? '';

	// The truck's plate for the header — the SAME cached fleet read the truck
	// page used, so arriving here is a cache hit (no second request).
	const identity = useQuery({
		queryKey: qk.fleet(vehicleId),
		queryFn: () => fetchTruckIdentity(vehicleId),
		enabled: vehicleId !== '',
	});

	const plate = identity.data?.plate ?? null;
	const backTo = vehicleId ? `/app/incidents/vehicle/${vehicleId}` : '/app/incidents/browse';

	const handleSaved = useCallback(() => {
		notifySaved('Incident recorded');
		navigate(backTo, { replace: true });
	}, [navigate, backTo]);

	return (
		<ModuleShell title="Log accident / incident" subtitle={plate ?? undefined} backTo={backTo}>
			<div className="flex flex-1 flex-col gap-5 pt-2">
				<IncidentRecordForm vehicleId={vehicleId} onSaved={handleSaved} />
			</div>
		</ModuleShell>
	);
}
