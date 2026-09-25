import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@mmbix/design-system';
import { Activity, Play } from 'lucide-react';
import { collectionsQuery, operationsQuery, schedulerTasksQuery } from '../../lib/queries';
import {
	listGenerationProposals,
	runIntegrity,
	runSchedulerTask,
	type IntegrityReport,
	type IntegrityRuleViolation,
	type SchedulerTaskRow,
} from '../../lib/api';
import { qk } from '../../lib/query-keys';
import StatusBadge from '../StatusBadge';

/* ── Operations tab — the engine's self-tuning telemetry (admin) ──
 *
 * Surfaces the index advisor: the mode (auto/propose), every composite index it
 * auto-created/proposed, and the hot filter shapes it is observing. Read-only
 * telemetry — the backend route is admin-gated and never exposes row data. */

const th = { textAlign: 'left' as const, padding: '0.25rem 0.5rem', color: 'var(--mmbix-muted-foreground, #9ca3af)', fontWeight: 600 };
const td = { padding: '0.35rem 0.5rem', verticalAlign: 'top' as const, whiteSpace: 'normal' as const };
const mono = { fontFamily: 'ui-monospace, monospace' } as const;
const field = {
	fontSize: '0.74rem',
	padding: '0.2rem 0.35rem',
	border: '1px solid var(--mmbix-border, #e5e7eb)',
	borderRadius: 6,
	background: 'var(--mmbix-card, #ffffff)',
	color: 'var(--mmbix-foreground, #0f172a)',
} as const;

export function OperationsTab({ token }: { token: string }) {
	const opsQ = useQuery(operationsQuery(token));
	const report = opsQ.data ?? null;
	const journal = useMemo(() => report?.journal ?? [], [report]);
	const candidates = useMemo(() => report?.candidates ?? [], [report]);

	// Generation-gate telemetry — how many proposals sit in each review state.
	// `retry:false` + success-only rendering means a deployment with the
	// generation plugin disabled shows nothing rather than a spurious error.
	const genQ = useQuery({ queryKey: ['generation-proposals'], queryFn: () => listGenerationProposals(token), retry: false });
	const genCounts = useMemo(() => {
		const counts: Record<string, number> = {};
		for (const p of genQ.data ?? []) counts[p.status] = (counts[p.status] ?? 0) + 1;
		return counts;
	}, [genQ.data]);

	return (
		<div style={{ padding: '0.5rem 0.75rem' }}>
			<SchedulerJobs token={token} />
			<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)', margin: '0 0 0.6rem' }}>
				<Activity size={12} /> Self-tuning index advisor — the composite indexes the engine created (or proposes) and the hot filter shapes
				it observes. Read-only telemetry.
			</p>

			{opsQ.isLoading ? (
				<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>Loading telemetry…</p>
			) : opsQ.error ? (
				<p role="alert" style={{ fontSize: '0.72rem', color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}>
					{opsQ.error instanceof Error ? opsQ.error.message : 'Failed to load telemetry'}
				</p>
			) : (
				<>
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
						<span style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Mode</span>
						<StatusBadge
							tone={report?.mode === 'auto' ? 'positive' : 'warning'}
							label={report?.mode === 'auto' ? 'auto (applies DDL)' : 'propose only'}
						/>
					</div>

					<h4 style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--mmbix-muted-foreground, #64748b)', margin: '0 0 0.3rem' }}>
						Created / proposed indexes
					</h4>
					{journal.length === 0 ? (
						<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>None yet.</p>
					) : (
						<Table style={{ width: '100%', fontSize: '0.74rem', marginBottom: '0.9rem' }}>
							<TableHeader>
								<TableRow>
									<TableHead style={th}>Table</TableHead>
									<TableHead style={th}>Columns</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{journal.map((e, i) => (
									<TableRow key={`${e.table}-${i}`}>
										<TableCell style={{ ...td, ...mono }}>{e.table}</TableCell>
										<TableCell style={{ ...td, ...mono }}>{e.columns.join(', ')}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}

					<h4 style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--mmbix-muted-foreground, #64748b)', margin: '0 0 0.3rem' }}>
						Hot filter shapes
					</h4>
					{candidates.length === 0 ? (
						<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>None observed.</p>
					) : (
						<Table style={{ width: '100%', fontSize: '0.74rem' }}>
							<TableHeader>
								<TableRow>
									<TableHead style={th}>Table</TableHead>
									<TableHead style={th}>Columns</TableHead>
									<TableHead style={th}>Seen</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{candidates.map((c, i) => (
									<TableRow key={`${c.table}-${i}`}>
										<TableCell style={{ ...td, ...mono }}>{c.table}</TableCell>
										<TableCell style={{ ...td, ...mono }}>{c.columns.join(', ')}</TableCell>
										<TableCell style={td}>{c.count}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}

					{genQ.isSuccess && (
						<>
							<h4
								style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--mmbix-muted-foreground, #64748b)', margin: '0.9rem 0 0.3rem' }}
							>
								Generation gate
							</h4>
							{(genQ.data ?? []).length === 0 ? (
								<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>No proposals yet.</p>
							) : (
								<div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
									{['draft', 'review', 'promoted', 'live', 'rejected']
										.filter((s) => genCounts[s])
										.map((s) => (
											<Badge key={s} variant="outline">
												{s}: {genCounts[s]}
											</Badge>
										))}
								</div>
							)}
						</>
					)}
				</>
			)}

			<Integrity token={token} />
		</div>
	);
}

/* ── Integrity — the generic data-quality engine ──
 *
 * Runs a collection's declared `policies.integrity.rules` (orphan / aggregate
 * mismatch / duplicate / stale) on demand and shows what each rule found. The
 * engine is deny-by-default: a collection that declares no rules answers
 * `enabled:false` with 200, so that is a plain empty state, not an error. A
 * non-zero violation count is the thing that must pop at a glance (the DS
 * `destructive` tint), while a clean run and an undeclared policy stay neutral. */

/** Human label for a declared rule — the operator should read WHAT was checked. */
function ruleLabel(rule: IntegrityRuleViolation['rule']): string {
	switch (rule?.type) {
		case 'orphan':
			return `orphan · ${rule.field ?? '?'}`;
		case 'duplicate':
			return `duplicate · ${(rule.fields ?? []).join(', ') || '?'}`;
		case 'stale':
			return `stale · ${rule.field ?? 'updated_at'} older than ${rule.max_age_days ?? 30}d`;
		case 'aggregate_mismatch':
			return `aggregate mismatch · ${rule.field ?? '?'} vs ${rule.child?.collection ?? '?'}.${rule.child?.fk ?? '?'}`;
		default:
			return typeof rule?.type === 'string' ? rule.type : 'rule';
	}
}

function Integrity({ token }: { token: string }) {
	const collectionsQ = useQuery(collectionsQuery(token));
	const collections = useMemo(
		() => [...(collectionsQ.data ?? [])].sort((a, b) => (a.name ?? a.slug).localeCompare(b.name ?? b.slug)),
		[collectionsQ.data],
	);
	const [picked, setPicked] = useState('');
	const selected = picked || collections[0]?.slug || '';
	const [report, setReport] = useState<IntegrityReport | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function run() {
		if (!selected) return;
		setBusy(true);
		setError(null);
		setReport(null);
		try {
			// The api helper throws on a non-2xx envelope, so the catch IS the error
			// path — a failed run must never look like a clean report.
			setReport(await runIntegrity(token, selected));
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Integrity run failed');
		} finally {
			setBusy(false);
		}
	}

	const results = report?.results ?? [];
	const errors = report?.errors ?? [];
	// The API reports truncation PER RULE (`results[].truncated`); there is no
	// top-level flag, so the summary surfaces it when any rule hit its bound.
	const truncated = results.some((r) => r.truncated);

	return (
		<section style={{ marginTop: '1rem' }}>
			<h4 style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--mmbix-muted-foreground, #64748b)', margin: '0 0 0.3rem' }}>
				Integrity
			</h4>
			<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)', margin: '0 0 0.5rem' }}>
				Run a collection&apos;s declared data-quality rules (orphan / aggregate mismatch / duplicate / stale). Read-only.
			</p>

			<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
				<label htmlFor="integrity-collection" style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
					Collection
				</label>
				<select
					id="integrity-collection"
					value={selected}
					disabled={busy || collections.length === 0}
					onChange={(e) => {
						setPicked(e.target.value);
						setReport(null);
						setError(null);
					}}
					style={{ ...field, minWidth: 200 }}
				>
					{collections.length === 0 && <option value="">—</option>}
					{collections.map((c) => (
						<option key={c.slug} value={c.slug}>
							{c.name ?? c.slug}
						</option>
					))}
				</select>
				<Button size="sm" variant="outline" disabled={busy || !selected} onClick={() => void run()}>
					<Play size={11} /> {busy ? 'Running…' : 'Run'}
				</Button>
			</div>

			{collectionsQ.isLoading ? (
				<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>Loading collections…</p>
			) : collectionsQ.error ? (
				<p role="alert" style={{ fontSize: '0.72rem', color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}>
					{collectionsQ.error instanceof Error ? collectionsQ.error.message : 'Failed to load collections'}
				</p>
			) : collections.length === 0 ? (
				<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>No collections to check.</p>
			) : null}

			{error && (
				<p role="alert" style={{ fontSize: '0.72rem', color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}>
					{error}
				</p>
			)}

			{report && !report.enabled && (
				<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>
					No integrity rules declared for this collection.
				</p>
			)}

			{report && report.enabled && (
				<>
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
						<Badge variant={report.violations > 0 ? 'destructive' : 'outline'}>
							{report.violations > 0 ? `${report.violations} violation${report.violations === 1 ? '' : 's'}` : 'No violations'}
						</Badge>
						<span style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
							{report.checked} rule{report.checked === 1 ? '' : 's'} checked
						</span>
						{truncated && <Badge variant="outline">truncated — more rows exist</Badge>}
					</div>

					{results.length === 0 ? (
						<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>No rules ran.</p>
					) : (
						<Table style={{ width: '100%', fontSize: '0.74rem' }}>
							<TableHeader>
								<TableRow>
									<TableHead style={th}>Rule</TableHead>
									<TableHead style={th}>Violations</TableHead>
									<TableHead style={th}>Sample rows</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{results.map((r, i) => (
									<TableRow key={`${r.rule?.type ?? 'rule'}-${i}`}>
										<TableCell style={{ ...td, ...mono }}>{ruleLabel(r.rule)}</TableCell>
										<TableCell style={td}>
											<Badge variant={r.count > 0 ? 'destructive' : 'outline'}>{r.count}</Badge>
										</TableCell>
										<TableCell style={{ ...td, ...mono, color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
											{r.rows.length === 0
												? '—'
												: `${r.rows
														.slice(0, 3)
														.map((row) => String(row.id ?? JSON.stringify(row)))
														.join(', ')}${r.rows.length > 3 ? ` +${r.rows.length - 3}` : ''}`}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}

					{errors.length > 0 && (
						<ul
							style={{ margin: '0.5rem 0 0', padding: '0 0 0 1.1rem', fontSize: '0.72rem', color: 'var(--mmbix-tone-warning-fg, #b45309)' }}
						>
							{errors.map((e, i) => (
								<li key={i}>{e.error}</li>
							))}
						</ul>
					)}
				</>
			)}
		</section>
	);
}

/* ── Declared jobs — the visibility half of the scheduler ──
 *
 * A job that stops is invisible unless someone can see it. This lists what the
 * factory declared, when it next runs, and — the point of the table — its
 * `last_error`, so a broken job is obvious instead of silently absent. Rendered
 * independently of the index advisor above: one failing query must not hide the
 * other. `retry:false` means a deployment with the scheduler plugin off shows
 * nothing rather than an error. */

function when(iso: string | null | undefined): string {
	if (!iso) return '—';
	const ms = Date.parse(iso);
	return Number.isNaN(ms) ? '—' : new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
}

function SchedulerJobs({ token }: { token: string }) {
	const qc = useQueryClient();
	const jobsQ = useQuery(schedulerTasksQuery(token));
	const jobs = jobsQ.data ?? [];
	const [busy, setBusy] = useState<string | null>(null);
	const [failure, setFailure] = useState<string | null>(null);

	async function runNow(task: SchedulerTaskRow) {
		setBusy(task.id);
		setFailure(null);
		try {
			// The api helper throws on a non-2xx envelope, so the catch IS the
			// error path — a failed run must never look like a successful one.
			await runSchedulerTask(token, task.id);
		} catch (err) {
			setFailure(err instanceof Error ? err.message : 'run failed');
		} finally {
			setBusy(null);
			// The task row changed (status, run_count, last_result) — re-read it.
			await qc.invalidateQueries({ queryKey: qk.schedulerTasks() });
		}
	}

	return (
		<section style={{ marginBottom: '1rem' }}>
			<h4 style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--mmbix-muted-foreground, #64748b)', margin: '0 0 0.3rem' }}>
				Declared jobs
			</h4>
			{failure && (
				<p role="alert" style={{ fontSize: '0.72rem', color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}>
					{failure}
				</p>
			)}
			{jobsQ.isLoading ? (
				<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>Loading jobs…</p>
			) : jobs.length === 0 ? (
				<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>
					No jobs declared. A manifest `schedules` entry creates one.
				</p>
			) : (
				<Table style={{ width: '100%', fontSize: '0.74rem' }}>
					<TableHeader>
						<TableRow>
							<TableHead style={th}>Job</TableHead>
							<TableHead style={th}>Status</TableHead>
							<TableHead style={th}>Cadence</TableHead>
							<TableHead style={th}>Next run</TableHead>
							<TableHead style={th}>Runs</TableHead>
							<TableHead style={th}>Last result / error</TableHead>
							<TableHead style={th} />
						</TableRow>
					</TableHeader>
					<TableBody>
						{jobs.map((t) => (
							<TableRow key={t.id}>
								<TableCell style={td}>
									<div>{t.name ?? t.id}</div>
									<div style={{ ...td, ...mono, color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>{t.type}</div>
								</TableCell>
								<TableCell style={td}>
									<StatusBadge status={t.status} />
								</TableCell>
								<TableCell style={{ ...td, ...mono }}>{t.cron ?? (t.repeat_ms ? `${Math.round(t.repeat_ms / 1000)}s` : 'once')}</TableCell>
								<TableCell style={td}>{when(t.run_at)}</TableCell>
								<TableCell style={td}>{t.run_count}</TableCell>
								<TableCell
									style={{ ...td, color: t.last_error ? 'var(--mmbix-tone-danger-fg, #dc2626)' : 'var(--mmbix-muted-foreground, #6b7280)' }}
								>
									{t.last_error ?? (t.last_result ? 'ok' : '—')}
								</TableCell>
								<TableCell style={td}>
									<Button size="sm" variant="outline" disabled={busy === t.id} onClick={() => void runNow(t)}>
										<Play size={11} /> {busy === t.id ? 'Running…' : 'Run now'}
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}
		</section>
	);
}
