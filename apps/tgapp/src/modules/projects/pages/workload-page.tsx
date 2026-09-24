import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleDashed, FolderKanban, Loader2, UserRoundX } from 'lucide-react';

import { fetchWorkload } from '../data/api';
import { TASK_PRIORITY_META } from '../data/meta';
import { qk } from '../data/query-keys';
import type { PriorityWorkload } from '../data/types';
import { STALE_MS } from '@/shared/api/invalidation';
import { EmptyState } from '@/shared/components/empty-state';
import { ModuleShell } from '@/shared/components/module-shell';
import { ListSkeleton } from '@/shared/components/skeletons';

/** One KPI tile in the summary strip. */
function StatCard({ label, value, tone, icon }: { label: string; value: number; tone: string; icon: ReactNode }) {
	return (
		<div className="flex flex-col gap-1 rounded-2xl border border-border/70 bg-card p-3 shadow-sm">
			<span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
				<span className={tone}>{icon}</span>
				{label}
			</span>
			<span className="text-xl font-extrabold tabular-nums text-foreground">{value}</span>
		</div>
	);
}

/** A labelled progress bar — the shared row for projects and assignees. */
function ProgressRow({ label, value, sub, meta }: { label: ReactNode; value: number; sub: string; meta?: ReactNode }) {
	const pct = Math.max(0, Math.min(100, Math.round(value)));
	return (
		<div className="min-w-0">
			<div className="mb-1.5 flex items-end justify-between gap-2">
				<span className="min-w-0 flex-1 truncate text-xs font-semibold leading-myanmar text-foreground">{label}</span>
				<span className="shrink-0 text-meta font-semibold tabular-nums text-muted-foreground">{sub}</span>
			</div>
			<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
				<div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
			</div>
			{meta}
		</div>
	);
}

/** The priority breakdown chips — only non-zero buckets are rendered. */
function PriorityBreakdown({ priorities, total }: { priorities: PriorityWorkload[]; total: number }) {
	const nonZero = priorities.filter((bucket) => bucket.count > 0);
	if (nonZero.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-1.5">
			{nonZero.map((bucket) => {
				const label = bucket.priority ? TASK_PRIORITY_META[bucket.priority].label : 'No priority';
				const pct = total === 0 ? 0 : Math.round((bucket.count / total) * 100);
				return (
					<span
						key={bucket.priority ?? 'none'}
						className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-meta font-semibold leading-myanmar ${
							bucket.priority ? TASK_PRIORITY_META[bucket.priority].chipClass : 'border-border bg-muted/70 text-muted-foreground'
						}`}
					>
						{label}
						<span className="tabular-nums">
							{bucket.count} · {pct}%
						</span>
					</span>
				);
			})}
		</div>
	);
}

/**
 * Projects — the workload dashboard (`/app/projects/workload`): the company-wide
 * task totals, the completion bar, and the per-project / per-assignee / per-
 * priority breakdowns. ONE read (`fetchWorkload`) over every `hrm_tasks` row
 * plus the project names, cached on the module tier.
 */
export default function WorkloadPage() {
	const workloadQuery = useQuery({ queryKey: qk.workload(), queryFn: fetchWorkload, staleTime: STALE_MS.module });
	const data = workloadQuery.data ?? null;

	return (
		<ModuleShell title="Workload" backTo="/app/projects">
			{workloadQuery.isPending ? (
				<ListSkeleton variant="store-request" count={2} />
			) : workloadQuery.isError || !data ? (
				<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-12 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load the workload.</p>
					<button
						type="button"
						onClick={() => void workloadQuery.refetch()}
						className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
					>
						{workloadQuery.isFetching ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
						Try again
					</button>
				</div>
			) : data.total === 0 ? (
				<EmptyState title="No tasks to report" hint="Add a task to a project and its workload shows up here." />
			) : (
				<div className="flex flex-col gap-5 pt-1">
					{/* KPI strip. */}
					<section className="grid grid-cols-2 gap-2.5">
						<StatCard
							label="Total tasks"
							value={data.total}
							tone="text-foreground"
							icon={<FolderKanban className="size-3.5" aria-hidden />}
						/>
						<StatCard
							label="In progress"
							value={data.inProgress}
							tone="text-status-info"
							icon={<CircleDashed className="size-3.5" aria-hidden />}
						/>
						<StatCard
							label="Overdue"
							value={data.overdue}
							tone="text-status-danger"
							icon={<AlertTriangle className="size-3.5" aria-hidden />}
						/>
						<StatCard
							label="Completed"
							value={data.done}
							tone="text-status-success"
							icon={<CheckCircle2 className="size-3.5" aria-hidden />}
						/>
					</section>

					{/* Company-wide completion. */}
					<section className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
						<div className="flex items-end justify-between gap-2">
							<h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Overall progress</h2>
							<span className="text-lg font-extrabold tabular-nums text-foreground">{data.completionPct}%</span>
						</div>
						<div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
							<div
								className="h-full rounded-full bg-status-success transition-[width] duration-300"
								style={{ width: `${data.completionPct}%` }}
							/>
						</div>
						<p className="text-meta leading-myanmar text-muted-foreground">
							{data.done} of {data.total} tasks done · {data.todo + data.inProgress} still open
						</p>
						{data.unassigned > 0 && (
							<p className="flex items-center gap-1.5 text-meta font-medium leading-myanmar text-status-warning">
								<UserRoundX className="size-3.5" aria-hidden />
								{data.unassigned} {data.unassigned === 1 ? 'task has' : 'tasks have'} no assignee
							</p>
						)}
					</section>

					{/* Per-project progress. */}
					{data.projects.length > 0 && (
						<section className="flex flex-col gap-3.5 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
							<h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">By project</h2>
							{data.projects.map((project) => (
								<ProgressRow
									key={project.id}
									label={project.name}
									value={project.total === 0 ? 0 : (project.done / project.total) * 100}
									sub={`${project.done}/${project.total} done`}
								/>
							))}
						</section>
					)}

					{/* Priority mix. */}
					<section className="flex flex-col gap-2.5 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
						<h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">By priority</h2>
						<PriorityBreakdown priorities={data.priorities} total={data.total} />
					</section>

					{/* Per-assignee open load. */}
					<section className="flex flex-col gap-3.5 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
						<div className="flex items-baseline justify-between gap-2">
							<h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Open load by assignee</h2>
							<span className="text-meta font-medium text-muted-foreground">open / total</span>
						</div>
						{data.assignees.length === 0 ? (
							<p className="text-xs leading-myanmar text-muted-foreground">No tasks are assigned yet.</p>
						) : (
							data.assignees.map((person) => (
								<ProgressRow
									key={person.id}
									label={
										<span className="flex items-center gap-2.5">
											<span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-bold text-muted-foreground">
												{person.photo ? (
													<img src={person.photo} alt="" className="size-full object-cover" />
												) : (
													(person.name?.[0]?.toUpperCase() ?? '?')
												)}
											</span>
											<span className="min-w-0 truncate">{person.name ?? 'Unknown'}</span>
										</span>
									}
									value={person.total === 0 ? 0 : (person.open / person.total) * 100}
									sub={`${person.open}/${person.total}`}
								/>
							))
						)}
					</section>
				</div>
			)}
		</ModuleShell>
	);
}
