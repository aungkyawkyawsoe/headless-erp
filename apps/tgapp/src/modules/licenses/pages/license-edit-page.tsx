import { useCallback } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lock, RefreshCw } from 'lucide-react';

import { LicenseRecordForm, type LicenseFormInitial } from '../components/license-record-form';
import { fetchPermitById, fetchTruckLicensePage, permitVehicleId } from '../data/api';
import { LICENSE_STALE_MS, qk } from '../data/query-keys';
import type { LicensePermitRow } from '../data/types';
import { ModuleShell } from '@/shared/components/module-shell';
import { Shimmer } from '@/shared/components/skeletons';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';
import { isNewestRecord } from '@/shared/records/newest';

/** One permit row → the form's raw string prefill. */
function initialOf(row: LicensePermitRow): LicenseFormInitial {
	const money = (value: number | string | null | undefined) => (value != null && value !== '' ? String(value) : '');
	return {
		id: row.id ?? '',
		licenseNo: row.license_no ?? '',
		place: row.place ?? '',
		issueDate: row.issue_date ?? '',
		expiryDate: row.expiry_date ?? '',
		licenseFee: money(row.license_fee),
		agent: row.agent ?? '',
		mobile: row.mobile ?? '',
		note: row.note ?? '',
	};
}

/**
 * Licenses → ONE permit's CORRECTION screen (`/app/licenses/permit/:id`, reached
 * from the Edit action on the truck's NEWEST permit card).
 *
 * The permit is read RAW by id — only the vehicle's newest record may be
 * corrected (older history is the audit trail), so the screen also reads the
 * truck's file page 1 and refuses when this id is not at its head (a direct URL
 * to an older permit cannot bypass the rule). Saving pops back to where the
 * operator came from.
 */
export default function LicenseEditPage() {
	const navigate = useNavigate();
	const { id } = useParams<{ id: string }>();
	const permitId = id ?? '';

	const record = useQuery({
		queryKey: qk.record(permitId),
		queryFn: () => fetchPermitById(permitId),
		enabled: permitId !== '',
		staleTime: LICENSE_STALE_MS,
	});
	const vehicleId = record.data ? permitVehicleId(record.data) : null;

	// The truck's newest permit — the editability guard (only the head of the
	// file may be corrected). A dedicated key, not the truck page's infinite feed.
	const file = useQuery({
		queryKey: ['licenses', 'edit-guard', vehicleId ?? ''] as const,
		queryFn: () => fetchTruckLicensePage(vehicleId as string),
		enabled: vehicleId != null && vehicleId !== '',
		staleTime: LICENSE_STALE_MS,
	});

	const backTo = vehicleId ? `/app/licenses/${vehicleId}` : '/app/licenses';
	const handleSaved = useCallback(() => {
		notifySaved('License updated');
		popBack(navigate, backTo);
	}, [navigate, backTo]);

	if (record.isPending) {
		return (
			<ModuleShell title="Edit license" backTo={backTo}>
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

	if (record.isError || !record.data || vehicleId == null) {
		return (
			<ModuleShell title="Edit license" backTo="/app/licenses">
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load this license.</p>
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
							onClick={() => popBack(navigate, '/app/licenses')}
							className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
						>
							Back to list
						</button>
					</div>
				</div>
			</ModuleShell>
		);
	}

	if (file.isPending) {
		return (
			<ModuleShell title="Edit license" backTo={backTo}>
				<section aria-hidden className={`${CARD_FRAME} p-4 shadow-card`}>
					<Shimmer className="h-11 rounded-lg" />
					<Shimmer className="mt-3 h-11 rounded-lg" />
				</section>
			</ModuleShell>
		);
	}

	if (file.isError || !file.data) {
		return (
			<ModuleShell title="Edit license" backTo={backTo}>
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Could not check this truck's license file.</p>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => void file.refetch()}
							className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
						>
							<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
							Retry
						</button>
						<button
							type="button"
							onClick={() => popBack(navigate, backTo)}
							className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
						>
							Back
						</button>
					</div>
				</div>
			</ModuleShell>
		);
	}

	const isNewest = isNewestRecord(file.data.rows, permitId);
	if (!isNewest) {
		return (
			<ModuleShell title="Edit license" backTo={backTo}>
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<Lock className="size-6 text-muted-foreground" aria-hidden />
					<p className="text-sm font-medium leading-myanmar text-foreground">
						This license is no longer the latest — only the newest record can be edited.
					</p>
					<button
						type="button"
						onClick={() => popBack(navigate, backTo)}
						className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
					>
						Back
					</button>
				</div>
			</ModuleShell>
		);
	}

	return (
		<ModuleShell title="Edit license" backTo={backTo}>
			<section className={`${CARD_FRAME} p-4 shadow-card`}>
				<div className="mb-4">
					<p className="text-base font-bold leading-myanmar text-foreground">Edit license</p>
					<p className="mt-0.5 text-xs leading-myanmar text-muted-foreground">
						Correct this truck's newest license — saving keeps it current.
					</p>
				</div>
				<LicenseRecordForm vehicleId={vehicleId} initial={initialOf(record.data)} onSaved={handleSaved} />
			</section>
			<div className="h-10" aria-hidden />
		</ModuleShell>
	);
}
