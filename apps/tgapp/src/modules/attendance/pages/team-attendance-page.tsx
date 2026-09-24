import { useState } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw, User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@mmbix/design-system/avatar';

import { AttendanceHistory, type HistoryDay } from '../components/attendance-history';
import { PunchLocationSheet } from '../components/punch-location-sheet';
import { TEAM_WEEK_DAYS, fetchEmployeeAttendanceWeek, type TeamEmployeeHit } from '../data/api';
import { qk } from '../data/query-keys';
import { todayWorkDate } from '../utils/time';
import { ModuleShell } from '@/shared/components/module-shell';
import { Shimmer } from '@/shared/components/skeletons';
import { popBack } from '@/shared/platform/history';

/**
 * Team Tracking → ONE employee's attendance (`/app/attendance/team/:id`,
 * reached by picking a result on the attendance page's Team scope).
 *
 * The read is server-scoped (`GET /api/hr/attendances/employee/:id?days=7`): a
 * supervisor may open a direct report, an admin anyone — the server, not this
 * page, decides. The body is the employee's identity card followed by the last
 * 7 WORK days of punches + approved leaves, rendered by the SAME history list
 * the home dashboard uses (with a longer window). The back arrow returns to the
 * Team scope's search screen.
 */
const BACK_TO = '/app/attendance?scope=team';

export default function TeamAttendancePage() {
	const navigate = useNavigate();
	const { id } = useParams<{ id: string }>();
	const employeeId = id ?? '';
	const workDate = todayWorkDate();
	// The tapped day whose punch locations the sheet shows (null = closed).
	const [selectedDay, setSelectedDay] = useState<HistoryDay | null>(null);

	const week = useQuery({
		queryKey: qk.employeeWeek(employeeId, TEAM_WEEK_DAYS),
		queryFn: () => fetchEmployeeAttendanceWeek(employeeId, TEAM_WEEK_DAYS),
		enabled: employeeId !== '',
		staleTime: 60_000,
	});

	const employee = week.data?.employee ?? null;
	const title = employee ? employee.nameMm || employee.nameEn || 'Attendance' : 'Attendance';

	if (employeeId === '') {
		return (
			<ModuleShell title="Attendance" backTo={BACK_TO}>
				<p className={`mb-2 mt-4 ${CARD_FRAME} px-4 py-6 text-center text-sm font-medium leading-myanmar text-muted-foreground`}>
					Employee not found.
				</p>
			</ModuleShell>
		);
	}

	return (
		<ModuleShell title={title} backTo={BACK_TO}>
			{week.isPending ? (
				<>
					<section aria-hidden className={`${CARD_FRAME} p-4 shadow-card`}>
						<div className="flex items-center gap-3">
							<Shimmer className="size-12 shrink-0 rounded-full" />
							<div className="flex-1">
								<Shimmer className="h-5 w-1/2 rounded" />
								<Shimmer className="mt-2 h-3.5 w-1/3 rounded" />
							</div>
						</div>
					</section>
					<AttendanceHistory punches={[]} leaves={[]} workDate={workDate} days={TEAM_WEEK_DAYS} loading />
				</>
			) : week.isError || !employee ? (
				<div className="flex flex-1 flex-col items-center gap-3 px-4 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load this employee's attendance.</p>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => void week.refetch()}
							className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
						>
							<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
							Retry
						</button>
						<button
							type="button"
							onClick={() => popBack(navigate, BACK_TO)}
							className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
						>
							Back
						</button>
					</div>
				</div>
			) : (
				<>
					<EmployeeIdentityCard employee={employee} />
					<AttendanceHistory
						punches={week.data?.attendance ?? []}
						leaves={week.data?.leaves ?? []}
						workDate={workDate}
						days={TEAM_WEEK_DAYS}
						onOpenDay={setSelectedDay}
					/>
				</>
			)}

			<PunchLocationSheet day={selectedDay} open={selectedDay !== null} onOpenChange={(next) => !next && setSelectedDay(null)} />
		</ModuleShell>
	);
}

/** The employee's identity — avatar + name (MM preferred) + eid, with the
 *  designation / department as soft pills when the directory carries them. */
function EmployeeIdentityCard({ employee }: { employee: TeamEmployeeHit }) {
	const name = employee.nameMm || employee.nameEn || '—';
	const pills = [employee.designationName, employee.departmentName].filter((part): part is string => Boolean(part?.trim()));

	return (
		<section className={`${CARD_FRAME} p-4 shadow-card`}>
			<div className="flex items-center gap-3">
				<Avatar className="size-12 shrink-0">
					{employee.avatar ? <AvatarImage src={employee.avatar} alt={name} /> : null}
					<AvatarFallback>
						<User className="size-5" strokeWidth={2} aria-hidden />
					</AvatarFallback>
				</Avatar>
				<div className="min-w-0 flex-1">
					<p className="truncate text-base font-bold leading-myanmar text-foreground">{name}</p>
					{employee.eid ? <p className="truncate text-xs leading-5 text-muted-foreground">{employee.eid}</p> : null}
				</div>
			</div>
			{pills.length > 0 && (
				<div className="mt-3 flex flex-wrap gap-1.5">
					{pills.map((pill) => (
						<span key={pill} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium leading-myanmar text-muted-foreground">
							{pill}
						</span>
					))}
				</div>
			)}
		</section>
	);
}
