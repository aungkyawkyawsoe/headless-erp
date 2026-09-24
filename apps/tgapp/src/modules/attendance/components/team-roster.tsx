import { useQuery } from '@tanstack/react-query';
import { CARD_FRAME } from '@/shared/components/card';
import { RefreshCw, User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@mmbix/design-system/avatar';

import { fetchTeamRoster, type TeamEmployeeHit } from '../data/api';
import { IDENTITY_STALE_MS, qk } from '../data/query-keys';
import { Shimmer } from '@/shared/components/skeletons';
import { hapticSelection } from '@/shared/platform/haptics';

/**
 * Team Tracking — the viewer's DIRECT reports, listed straight away (no search
 * gate): the roster is loaded whole from the server-scoped
 * `GET /api/hr/attendances/team` and each row opens that employee's attendance.
 * An admin sees every employee; an employee with no reports gets an empty state.
 *
 * The scope (who is in the list) is resolved server-side from the signed
 * session — this component never supplies an identity.
 */
interface TeamRosterProps {
	onPick: (employee: TeamEmployeeHit) => void;
	/** The bottom-bar search term — filters the loaded roster client-side
	 *  (name / eid / designation / department); empty shows everyone. */
	query?: string;
}

export function TeamRoster({ onPick, query = '' }: TeamRosterProps) {
	const result = useQuery({
		queryKey: qk.teamRoster(),
		queryFn: fetchTeamRoster,
		staleTime: IDENTITY_STALE_MS,
	});
	const roster = result.data ?? [];
	const term = query.trim().toLowerCase();
	const visible = term
		? roster.filter((hit) =>
				[hit.nameMm, hit.nameEn, hit.eid, hit.designationName, hit.departmentName]
					.filter((part): part is string => Boolean(part))
					.some((part) => part.toLowerCase().includes(term)),
			)
		: roster;

	if (result.isPending) {
		return (
			<div className="flex flex-col gap-2.5" aria-hidden>
				{[0, 1, 2, 3].map((i) => (
					<div key={i} className={`flex items-center gap-3 ${CARD_FRAME} p-3`}>
						<Shimmer className="size-9 shrink-0 rounded-full" />
						<div className="flex-1">
							<Shimmer className="h-4 w-1/2 rounded" />
							<Shimmer className="mt-1.5 h-3 w-1/3 rounded" />
						</div>
					</div>
				))}
			</div>
		);
	}

	if (result.isError) {
		return (
			<div className="flex flex-1 flex-col items-center gap-3 px-4 pt-16 text-center">
				<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load your team.</p>
				<button
					type="button"
					onClick={() => void result.refetch()}
					className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
				>
					<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
					Try again
				</button>
			</div>
		);
	}

	if (roster.length === 0) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center px-4 pb-12 text-center">
				<p className="text-sm font-medium leading-myanmar text-muted-foreground">No team members report to you yet.</p>
			</div>
		);
	}

	if (visible.length === 0) {
		return (
			<div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
				<p className="text-xs font-medium leading-myanmar text-muted-foreground">No team member matches «{query.trim()}»</p>
			</div>
		);
	}

	return (
		<ul className="flex flex-col gap-2.5">
			{visible.map((hit) => (
				<TeamRosterRow key={hit.id} hit={hit} onOpen={() => onPick(hit)} />
			))}
		</ul>
	);
}

/** One roster card — avatar + name (MM preferred) with the eid · designation ·
 *  department line beneath; tap opens that employee's attendance. */
function TeamRosterRow({ hit, onOpen }: { hit: TeamEmployeeHit; onOpen: () => void }) {
	const name = hit.nameMm || hit.nameEn || '—';
	const detail = [hit.eid, hit.designationName, hit.departmentName].filter((part): part is string => Boolean(part?.trim())).join(' · ');

	return (
		<li>
			<button
				type="button"
				onClick={() => {
					hapticSelection();
					onOpen();
				}}
				aria-label={`${name} — attendance`}
				className={`flex w-full items-center gap-3 ${CARD_FRAME} p-3 text-left shadow-card transition-transform duration-150 active:scale-[0.99]`}
			>
				<Avatar className="size-9 shrink-0">
					{hit.avatar ? <AvatarImage src={hit.avatar} alt={name} /> : null}
					<AvatarFallback>
						<User className="size-4.5" strokeWidth={2} aria-hidden />
					</AvatarFallback>
				</Avatar>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-semibold leading-myanmar text-foreground">{name}</p>
					{detail ? <p className="truncate text-xs leading-5 text-muted-foreground">{detail}</p> : null}
				</div>
			</button>
		</li>
	);
}
