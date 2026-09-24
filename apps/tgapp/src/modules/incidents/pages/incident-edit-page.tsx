import { useCallback, useId } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { IncidentRecordForm } from '../components/incident-record-form';
import { fetchIncidentRecord } from '../data/api';
import { INCIDENTS_STALE_MS, qk } from '../data/query-keys';
import type { VehicleRow } from '../data/types';
import { ModuleShell } from '@/shared/components/module-shell';
import { Shimmer } from '@/shared/components/skeletons';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';

/** The record's expanded vehicle — a lean row when the engine expanded the dotted
 *  `fields`, else null (an unlinked record has no plate to show). */
function plateOf(vehicle: unknown): string | null {
	if (!vehicle || typeof vehicle !== 'object') return null;
	const plate = (vehicle as VehicleRow).plate_no?.trim();
	return plate || null;
}

/**
 * Accidents & Incidents — ONE record's edit screen (`/app/incidents/record/:id`,
 * reached by tapping a record card on the register `/app/incidents/browse`).
 *
 * This replaces the old history BOTTOM SHEET: tapping a card no longer dumps the
 * whole truck's record file over the list — it opens the tapped record itself,
 * prefilled, so a wrong type/severity/location can be corrected in place.
 *
 * The record is read RAW by id (`fetchIncidentRecord`) — the register's card
 * model folds title into description and formats the date/cost, which would not
 * survive a round trip. The screen is ONE lean read per VISIT: the query key
 * carries a `useId()` visit token (see `qk.record`), so a re-open can never seed
 * the form from a previous visit's row while React StrictMode's dev remount
 * still shares that one request. The form writes the update (see
 * `IncidentRecordForm`) and the register + the owning truck's feed invalidate
 * before the back pop returns to the list.
 */
export default function IncidentEditPage() {
	const navigate = useNavigate();
	const { id } = useParams<{ id: string }>();
	const recordId = id ?? '';

	// The per-VISIT cache token — stable for this component instance (React
	// StrictMode's dev remount reuses it, so the probe shares ONE cache entry and
	// therefore ONE request), distinct for every new visit.
	const visit = useId();

	const record = useQuery({
		queryKey: qk.record(recordId, visit),
		queryFn: () => fetchIncidentRecord(recordId),
		enabled: recordId !== '',
		// The row read SEEDS the form, so it must be freshly read on every visit —
		// which the per-visit key already guarantees. No `staleTime: 0` here: that
		// would make StrictMode's remount refetch the same row a second time.
		staleTime: INCIDENTS_STALE_MS,
	});

	// A saved edit pops back to the register (a real pop — never a push), with the
	// kiosk as the cold-open fallback.
	const handleSaved = useCallback(() => {
		notifySaved('Incident updated');
		popBack(navigate, '/app/incidents/browse');
	}, [navigate]);

	const plate = plateOf(record.data?.vehicle);

	if (record.isPending) {
		return (
			<ModuleShell title="Edit record" backTo="/app/incidents/browse">
				<section aria-hidden className={`${CARD_FRAME} p-4 shadow-card`}>
					<Shimmer className="h-5 w-1/3 rounded" />
					<div className="mt-4 grid grid-cols-1 gap-3">
						<Shimmer className="h-11 rounded-lg" />
						<Shimmer className="h-11 rounded-lg" />
					</div>
					<Shimmer className="mt-3 h-11 rounded-lg" />
					<Shimmer className="mt-3 h-20 rounded-lg" />
					<Shimmer className="mt-3 h-11 rounded-lg" />
					<Shimmer className="mt-5 h-11 w-full rounded-lg" />
				</section>
			</ModuleShell>
		);
	}

	if (record.isError || !record.data) {
		return (
			<ModuleShell title="Edit record" backTo="/app/incidents/browse">
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load this record.</p>
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
							onClick={() => popBack(navigate, '/app/incidents/browse')}
							className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
						>
							Back to list
						</button>
					</div>
				</div>
			</ModuleShell>
		);
	}

	return (
		<ModuleShell title="Edit record" backTo="/app/incidents/browse">
			<section className={`${CARD_FRAME} p-4 shadow-card`}>
				<div className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
					<p className="text-base font-bold leading-myanmar text-foreground">Edit accident / incident</p>
					{plate && (
						<span className="inline-flex w-fit shrink-0 items-center rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-sm font-semibold leading-none tracking-wider text-foreground">
							{plate}
						</span>
					)}
				</div>
				<IncidentRecordForm record={record.data} onSaved={handleSaved} />
			</section>

			<div className="h-10" aria-hidden />
		</ModuleShell>
	);
}
