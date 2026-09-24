import { useCallback, useId } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { MaintenanceLogForm, vehicleIdOfLog } from '../components/maintenance-log-form';
import { fetchMaintenanceLog } from '../data/api';
import { MAINTENANCE_STALE_MS, qk } from '../data/query-keys';
import { maintenanceDocStatusOf } from '../data/status';
import { ModuleShell } from '@/shared/components/module-shell';
import { Shimmer } from '@/shared/components/skeletons';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';

/** The log's plate — from the expanded `fleet` row (a bare id has none). */
function plateOf(record: { fleet?: unknown } | null | undefined): string | null {
	const fleet = record?.fleet;
	if (fleet && typeof fleet === 'object') {
		const plate = (fleet as { plate_no?: string | null }).plate_no?.trim();
		return plate || null;
	}
	return null;
}

/**
 * ပြင်ဆင် → ONE log's edit screen (`/app/maintenances/log/:id`, reached by tapping
 * a log card on a truck's file or the register's search results).
 *
 * The log is read RAW by id (`fetchMaintenanceLog`) — the card read formats the
 * dates/costs, which would not survive a round trip. The query key carries a
 * `useId()` visit token, so a re-open always seeds the form from a fresh read
 * while a StrictMode remount shares one request. Saving pops back to where the
 * operator came from.
 */
export default function MaintenanceEditPage() {
	const navigate = useNavigate();
	const { id } = useParams<{ id: string }>();
	const logId = id ?? '';
	const visit = useId();

	const record = useQuery({
		queryKey: qk.record(logId, visit),
		queryFn: () => fetchMaintenanceLog(logId),
		enabled: logId !== '',
		staleTime: MAINTENANCE_STALE_MS,
	});

	const truckId = vehicleIdOfLog(record.data);
	const handleSaved = useCallback(() => {
		notifySaved('Maintenance updated');
		popBack(navigate, truckId ? `/app/maintenances/vehicle/${truckId}` : '/app/maintenances/browse');
	}, [navigate, truckId]);

	if (record.isPending) {
		return (
			<ModuleShell title="Edit maintenance log" backTo="/app/maintenances/browse">
				<section aria-hidden className={`${CARD_FRAME} p-4 shadow-card`}>
					<Shimmer className="h-11 rounded-lg" />
					<div className="mt-3 grid grid-cols-1 gap-3">
						<Shimmer className="h-11 rounded-lg" />
						<Shimmer className="h-11 rounded-lg" />
					</div>
					<Shimmer className="mt-3 h-11 rounded-lg" />
					<Shimmer className="mt-3 h-20 rounded-lg" />
					<Shimmer className="mt-5 h-11 w-full rounded-lg" />
				</section>
			</ModuleShell>
		);
	}

	if (record.isError || !record.data) {
		return (
			<ModuleShell title="Edit maintenance log" backTo="/app/maintenances/browse">
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load this log.</p>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => void record.refetch()}
							className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
						>
							<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
							Retry
						</button>
						<button
							type="button"
							onClick={() => popBack(navigate, '/app/maintenances/browse')}
							className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
						>
							Back to list
						</button>
					</div>
				</div>
			</ModuleShell>
		);
	}

	// A confirmed log is frozen server-side (`writes.freeze_when`) — a direct URL
	// must render the locked state, never an editable form that would 403 on save.
	if (maintenanceDocStatusOf(record.data.doc_status) === 'confirmed') {
		return (
			<ModuleShell title="Maintenance log" backTo="/app/maintenances/browse">
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<p className="text-sm font-bold leading-myanmar text-foreground">This job is confirmed</p>
					<p className="max-w-xs text-xs leading-myanmar text-muted-foreground">
						A confirmed record is locked and can no longer be edited from the app. Ask the office to reopen it if a correction is needed.
					</p>
					<button
						type="button"
						onClick={() => popBack(navigate, truckId ? `/app/maintenances/vehicle/${truckId}` : '/app/maintenances/browse')}
						className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
					>
						Back to history
					</button>
				</div>
			</ModuleShell>
		);
	}

	const plate = plateOf(record.data);

	return (
		<ModuleShell title="Edit maintenance log" backTo="/app/maintenances/browse">
			<section className={`${CARD_FRAME} p-4 shadow-card`}>
				<div className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
					<p className="text-base font-bold leading-myanmar text-foreground">Edit maintenance log</p>
					{plate && (
						<span className="inline-flex w-fit shrink-0 items-center rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-sm font-semibold leading-none tracking-wider text-foreground">
							{plate}
						</span>
					)}
				</div>
				<MaintenanceLogForm record={record.data} onSaved={handleSaved} />
			</section>
			<div className="h-10" aria-hidden />
		</ModuleShell>
	);
}
