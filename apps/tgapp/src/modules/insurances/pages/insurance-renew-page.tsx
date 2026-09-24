import { useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, RefreshCw } from 'lucide-react';

import { InsuranceRecordForm } from '../components/insurance-record-form';
import { endDateLabel } from '../components/insurance-badge';
import { fetchTruckCurrentPolicy, fetchTruckIdentity, insuranceCurrentOf } from '../data/api';
import { INSURANCE_STALE_MS, qk } from '../data/query-keys';
import { insuranceRenewStateOf } from '../data/status';
import type { InsuranceCurrentState } from '../data/types';
import { ModuleShell } from '@/shared/components/module-shell';
import { Shimmer } from '@/shared/components/skeletons';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';

/**
 * The navigation state the per-truck page hands to this screen — its ALREADY
 * resolved current policy (the renew gate), the plate, and the providers already
 * on the truck's file (the form's combo suggestions), so opening the form costs
 * NO read on the tap path. A deep link / refresh carries none and falls back to
 * one lean current-policy read below.
 */
export interface InsuranceRenewNavState {
	plate?: string | null;
	current?: InsuranceCurrentState | null;
	existingProviders?: ReadonlyArray<string>;
}

/**
 * အာမခံ → the truck's RENEWAL / first-policy screen (`/app/insurances/:id/renew`),
 * opened by the truck page's + button.
 *
 * A DEDICATED page — not a tab of the truck page — so the form is full-screen
 * with NO bottom toolbar, and its Save is the Telegram native MainButton (the
 * form's default `nativeSubmit`). The current policy still gates it: a still
 * comfortably valid policy renders the LOCKED "renew within the last 30 days"
 * notice instead of the form, so a premature / duplicate renewal stays blocked
 * (the same rule the truck page's inline form enforced).
 *
 * On save it lands on the truck page's HISTORY view so the new policy leads the
 * file — replacing the form entry so Back never returns to it.
 */
export default function InsuranceRenewPage() {
	const navigate = useNavigate();
	const location = useLocation();
	const { id } = useParams<{ id: string }>();
	const vehicleId = id ?? '';
	const routed = (location.state as InsuranceRenewNavState | null) ?? null;

	// The truck's plate for the header — the SAME cached fleet read the truck
	// page used, so arriving here is a cache hit (no second request).
	const identity = useQuery({
		queryKey: qk.fleet(vehicleId),
		queryFn: () => fetchTruckIdentity(vehicleId),
		enabled: vehicleId !== '',
	});

	// The current policy — routed from the truck page (tap path, no read), else a
	// lean read on a deep link / refresh. Keyed under `qk.current` so the form's
	// own invalidation (on save) targets the same entry.
	const currentQuery = useQuery({
		queryKey: qk.current(vehicleId),
		queryFn: () => fetchTruckCurrentPolicy(vehicleId),
		enabled: vehicleId !== '' && routed == null,
		staleTime: INSURANCE_STALE_MS,
	});
	const current: InsuranceCurrentState | null = routed != null ? (routed.current ?? null) : insuranceCurrentOf(currentQuery.data ?? null);
	const loading = routed == null && currentQuery.isPending;

	const handleSaved = useCallback(() => {
		notifySaved('Policy saved');
		navigate(`/app/insurances/${vehicleId}?tab=history`, { replace: true });
	}, [navigate, vehicleId]);

	const backTo = vehicleId ? `/app/insurances/${vehicleId}` : '/app/insurances';
	const plate = routed?.plate ?? identity.data?.plate ?? null;
	const title = current ? 'Renew policy' : 'Record policy';
	const renewLocked = insuranceRenewStateOf(current) === 'not-due';

	if (loading) {
		return (
			<ModuleShell title={title} subtitle={plate ?? undefined} backTo={backTo}>
				<div aria-hidden className="flex flex-1 flex-col gap-3 pt-2">
					<Shimmer className="h-11 rounded-lg" />
					<Shimmer className="h-11 rounded-lg" />
					<Shimmer className="h-20 rounded-lg" />
				</div>
			</ModuleShell>
		);
	}

	if (currentQuery.isError) {
		return (
			<ModuleShell title={title} subtitle={plate ?? undefined} backTo={backTo}>
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Could not check this truck's policy file.</p>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => void currentQuery.refetch()}
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

	return (
		<ModuleShell title={title} subtitle={plate ?? undefined} backTo={backTo}>
			<div className="flex flex-1 flex-col gap-5 pt-2">
				{renewLocked ? (
					<div className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-muted/25 px-3 py-2.5">
						<BadgeCheck className="size-4 shrink-0 text-status-success" aria-hidden />
						<p className="min-w-0 flex-1 text-sub leading-snug text-muted-foreground">
							Valid until <span className="font-semibold text-foreground">{endDateLabel(current?.expiryDate ?? null)}</span>. Renew
							within the last 30 days, or once expired.
						</p>
					</div>
				) : (
					<InsuranceRecordForm vehicleId={vehicleId} existingProviders={routed?.existingProviders ?? []} onSaved={handleSaved} />
				)}
			</div>
		</ModuleShell>
	);
}
