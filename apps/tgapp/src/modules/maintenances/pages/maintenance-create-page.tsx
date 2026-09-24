import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Truck, X } from 'lucide-react';

import { MaintenanceLogForm } from '../components/maintenance-log-form';
import { fetchTruckIdentity } from '../data/api';
import { qk } from '../data/query-keys';
import { FormField } from '@/shared/components/form-field';
import { ModuleShell } from '@/shared/components/module-shell';
import { VehiclePickerSheet } from '@/shared/components/vehicle-picker-sheet';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';
import { URL_PARAM, stringParam, useViewState } from '@/shared/url-state';

/** The optional `?vehicle=` the truck page's + passes — a one-shot prefill. */
export const VEHICLE_PARAM = stringParam;

/** The create screen's WHOLE URL view state, declared ONCE — the screen's single
 *  source of truth for "where am I in this view" (key from `URL_PARAM`). */
const MAINTENANCE_CREATE_VIEW = {
	[URL_PARAM.vehicle]: VEHICLE_PARAM,
} as const;

/**
 * New maintenance log — the create page behind every maintenance + button
 * (`/app/maintenances/+`, reached from the register or a truck's file).
 *
 * A truck can arrive ALREADY bound (`?vehicle=<id>`, the per-truck + path) — its
 * plate is resolved with ONE lean fleet read for the header — or be picked here
 * with the shared vehicle sheet. The form writes one `veh_maintenance_logs` row;
 * the engine computes `total_cost` from parts + labor.
 */
export default function MaintenanceCreatePage() {
	const navigate = useNavigate();
	const [view, setView] = useViewState(MAINTENANCE_CREATE_VIEW);
	const { vehicle: boundVehicleId } = view;
	const [pickerOpen, setPickerOpen] = useState(false);

	// The bound truck's plate — ONE lean fleet read (only when a truck is bound),
	// so the operator confirms they are logging against the right vehicle.
	const identity = useQuery({
		queryKey: qk.fleet(boundVehicleId ?? ''),
		queryFn: () => fetchTruckIdentity(boundVehicleId as string),
		enabled: boundVehicleId != null && boundVehicleId !== '',
	});

	const plate = identity.data?.plate ?? null;
	const currentOdo = identity.data?.lastOdo ?? null;
	const canSave = boundVehicleId != null && boundVehicleId !== '';

	const handleSaved = () => {
		notifySaved('Maintenance logged');
		if (boundVehicleId) popBack(navigate, `/app/maintenances/vehicle/${boundVehicleId}`);
		else popBack(navigate, '/app/maintenances/browse');
	};

	return (
		<ModuleShell title="New maintenance log" backTo="/app/maintenances">
			<div className="flex flex-1 flex-col gap-5 pt-2">
				{/* The bound truck — fixed when arriving from a truck's +, pickable here. */}
				<section>
					{/* Composite picker → the caption is a GROUP label (no dangling htmlFor). */}
					<FormField label="Vehicle" required group>
						{() => (
							<div className="flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-sm leading-myanmar">
								<button
									type="button"
									onClick={() => setPickerOpen(true)}
									className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left outline-none"
								>
									<Truck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
									<span className={`truncate ${plate ? 'text-foreground' : 'text-muted-foreground'}`}>{plate ?? 'Select a truck…'}</span>
								</button>
								{canSave ? (
									<button
										type="button"
										aria-label="Change vehicle"
										onClick={() => setPickerOpen(true)}
										className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
									>
										<X className="size-4" aria-hidden />
									</button>
								) : (
									<button
										type="button"
										aria-label="Select vehicle"
										onClick={() => setPickerOpen(true)}
										className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
									>
										<ChevronDown className="size-4" aria-hidden />
									</button>
								)}
							</div>
						)}
					</FormField>
					<VehiclePickerSheet
						open={pickerOpen}
						onOpenChange={setPickerOpen}
						selectedId={boundVehicleId}
						onSelect={(id) => {
							void setView({ vehicle: id });
							setPickerOpen(false);
						}}
					/>
				</section>

				{canSave ? (
					<MaintenanceLogForm
						vehicleId={boundVehicleId as string}
						initialOdo={currentOdo}
						onSaved={handleSaved}
						hideMainButton={pickerOpen}
					/>
				) : (
					<p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm leading-myanmar text-muted-foreground">
						Pick the truck this job was performed on to continue.
					</p>
				)}
			</div>
		</ModuleShell>
	);
}
