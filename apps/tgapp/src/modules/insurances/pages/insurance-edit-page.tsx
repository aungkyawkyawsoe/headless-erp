import { useCallback } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lock, RefreshCw } from 'lucide-react';

import { InsuranceRecordForm, type InsuranceFormInitial } from '../components/insurance-record-form';
import { fetchPolicyById, fetchTruckPolicyPage, policyVehicleId } from '../data/api';
import { INSURANCE_STALE_MS, qk } from '../data/query-keys';
import type { InsuranceRow } from '../data/types';
import { ModuleShell } from '@/shared/components/module-shell';
import { Shimmer } from '@/shared/components/skeletons';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';
import { isNewestRecord } from '@/shared/records/newest';

/** One policy row → the form's raw string prefill. */
function initialOf(row: InsuranceRow): InsuranceFormInitial {
	return {
		id: row.id ?? '',
		provider: row.provider ?? '',
		policyNo: row.policy_no ?? '',
		expiryDate: row.expiry_date ?? '',
		premiumAmount: row.premium_amount != null && row.premium_amount !== '' ? String(row.premium_amount) : '',
		sumInsured: row.sum_insured != null && row.sum_insured !== '' ? String(row.sum_insured) : '',
		windscreenCover: row.windscreen_cover != null && row.windscreen_cover !== '' ? String(row.windscreen_cover) : '',
		betterment: Boolean(row.betterment),
		note: row.note ?? '',
	};
}

/**
 * Insurances → ONE policy's CORRECTION screen (`/app/insurances/policy/:id`,
 * reached from the Edit action on the truck's NEWEST policy card).
 *
 * The policy is read RAW by id — only the vehicle's newest record may be
 * corrected (older history is the audit trail), so the screen also reads the
 * truck's file page 1 and refuses when this id is not at its head (a direct URL
 * to an older policy cannot bypass the rule). The `useId()` visit token keeps a
 * re-open seed fresh while a StrictMode remount shares one read. Saving pops
 * back to where the operator came from.
 */
export default function InsuranceEditPage() {
	const navigate = useNavigate();
	const { id } = useParams<{ id: string }>();
	const policyId = id ?? '';

	const record = useQuery({
		queryKey: qk.record(policyId),
		queryFn: () => fetchPolicyById(policyId),
		enabled: policyId !== '',
		staleTime: INSURANCE_STALE_MS,
	});
	const vehicleId = record.data ? policyVehicleId(record.data) : null;

	// The truck's newest policy — the editability guard (only the head of the
	// file may be corrected) and the provider suggestions. A dedicated key (not
	// the truck page's infinite feed) so the two never share a shape.
	const file = useQuery({
		queryKey: ['insurances', 'edit-guard', vehicleId ?? ''] as const,
		queryFn: () => fetchTruckPolicyPage(vehicleId as string),
		enabled: vehicleId != null && vehicleId !== '',
		staleTime: INSURANCE_STALE_MS,
	});

	const backTo = vehicleId ? `/app/insurances/${vehicleId}` : '/app/insurances';
	const handleSaved = useCallback(() => {
		notifySaved('Policy updated');
		popBack(navigate, backTo);
	}, [navigate, backTo]);

	if (record.isPending) {
		return (
			<ModuleShell title="Edit policy" backTo={backTo}>
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
			<ModuleShell title="Edit policy" backTo="/app/insurances">
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load this policy.</p>
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
							onClick={() => popBack(navigate, '/app/insurances')}
							className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
						>
							Back to list
						</button>
					</div>
				</div>
			</ModuleShell>
		);
	}

	// The editability guard — the id must be the head of the truck's policy file.
	// While page 1 is still loading we hold the shell (never flash the form on a
	// record that turns out to be history).
	if (file.isPending) {
		return (
			<ModuleShell title="Edit policy" backTo={backTo}>
				<section aria-hidden className={`${CARD_FRAME} p-4 shadow-card`}>
					<Shimmer className="h-11 rounded-lg" />
					<Shimmer className="mt-3 h-11 rounded-lg" />
				</section>
			</ModuleShell>
		);
	}

	if (file.isError || !file.data) {
		return (
			<ModuleShell title="Edit policy" backTo={backTo}>
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Could not check this truck's policy file.</p>
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

	const isNewest = isNewestRecord(file.data.rows, policyId);
	if (!isNewest) {
		return (
			<ModuleShell title="Edit policy" backTo={backTo}>
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<Lock className="size-6 text-muted-foreground" aria-hidden />
					<p className="text-sm font-medium leading-myanmar text-foreground">
						This policy is no longer the latest — only the newest record can be edited.
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

	const existingProviders = Array.from(new Set(file.data.rows.map((policy) => policy.provider).filter((p): p is string => Boolean(p))));

	return (
		<ModuleShell title="Edit policy" backTo={backTo}>
			<section className={`${CARD_FRAME} p-4 shadow-card`}>
				<div className="mb-4">
					<p className="text-base font-bold leading-myanmar text-foreground">Edit policy</p>
					<p className="mt-0.5 text-xs leading-myanmar text-muted-foreground">
						Correct this truck's newest policy — saving keeps it current.
					</p>
				</div>
				<InsuranceRecordForm
					vehicleId={vehicleId}
					existingProviders={existingProviders}
					initial={initialOf(record.data)}
					onSaved={handleSaved}
				/>
			</section>
			<div className="h-10" aria-hidden />
		</ModuleShell>
	);
}
