import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@mmbix/design-system';
import { DataTable, type ColumnDef } from '@mmbix/design-system/datatable';
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
 * telemetry — the backend route is admin-gated and never exposes row data.
 * Every table here is the SHARED `DataTable` (search box in the toolbar, sticky
 * header, empty state) — the same component every other Studio surface uses. */

const mono = { fontFamily: 'ui-monospace, monospace' } as const;
const field = {
	fontSize: '0.74rem',
	padding: '0.2rem 0.35rem',
	border: '1px solid var(--mmbix-border, #e5e7eb)',
	borderRadius: 6,
	background: 'var(--mmbix-card, #ffffff)',
	color: 'var(--mmbix-foreground, #0f172a)',
} as const;

/** A telemetry row carries no id of its own — the row key is derived (table + index). */
type IndexRow = { key: string; table: string; columns: string[] };

type CandidateRow = IndexRow & { count: number };

/** The table/columns pair the journal and the candidates both render. */
function indexColumns<T extends IndexRow>(extra: ColumnDef<T>[]): ColumnDef<T>[] {
	return [
		{
			id: 'table',
			header: 'Table',
			enableSorting: false,
			enableHeaderMenu: false,
			cell: ({ row }) => <span style={mono}>{row.original.table}</span>,
		},
		{
			id: 'columns',
			header: 'Columns',
			enableSorting: false,
			enableHeaderMenu: false,
			cell: ({ row }) => <span style={mono}>{row.original.columns.join(', ')}</span>,
		},
		...extra,
	];
}

const journalColumns = indexColumns<IndexRow>([]);
const candidateColumns = indexColumns<CandidateRow>([
	{
		id: 'count',
		header: 'Seen',
		enableSorting: false,
		enableHeaderMenu: false,
		cell: ({ row }) => <span>{row.original.count}</span>,
	},
]);

export function OperationsTab({ token }: { token: string }) {
	const opsQ = useQuery(operationsQuery(token));
	const report = opsQ.data ?? null;
	const journal = useMemo(() => report?.journal ?? [], [report]);
	const candidates = useMemo(() => report?.candidates ?? [], [report]);
	// Stable row identity for the row engine — a telemetry row has no id column.
	const journalRows = useMemo<IndexRow[]>(() => journal.map((e, i) => ({ ...e, key: `${e.table}-${i}` })), [journal]);
	const candidateRows = useMemo<CandidateRow[]>(() => candidates.map((c, i) => ({ ...c, key: `${c.table}-${i}` })), [candidates]);

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
					{journalRows.length === 0 ? (
						<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>None yet.</p>
					) : (
						<DataTable<IndexRow>
							columns={journalColumns}
							data={journalRows}
							rowKey="key"
							density="compact"
							stickyHeader
							showToolbar={false}
							showPagination={false}
							className="mb-3"
						/>
					)}

					<h4 style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--mmbix-muted-foreground, #64748b)', margin: '0 0 0.3rem' }}>
						Hot filter shapes
					</h4>
					{candidateRows.length === 0 ? (
						<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>None observed.</p>
					) : (
						<DataTable<CandidateRow>
							columns={candidateColumns}
							data={candidateRows}
							rowKey="key"
							density="compact"
							stickyHeader
							showToolbar={false}
							showPagination={false}
						/>
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

/** Sample rows summarised as ids (the engine returns row objects, not a row page). */
function sampleRows(rows: Array<Record<string, unknown>>): string {
	if (rows.length === 0) return '—';
	const ids = rows.slice(0, 3).map((row) => String(row.id ?? JSON.stringify(row)));
	return `${ids.join(', ')}${rows.length > 3 ? ` +${rows.length - 3}` : ''}`;
}

type RuleRow = IntegrityRuleViolation & { key: string };

const ruleColumns: ColumnDef<RuleRow>[] = [
	{
		id: 'rule',
		header: 'Rule',
		enableSorting: false,
		enableHeaderMenu: false,
		cell: ({ row }) => <span style={mono}>{ruleLabel(row.original.rule)}</span>,
	},
	{
		id: 'violations',
		header: 'Violations',
		enableSorting: false,
		enableHeaderMenu: false,
		cell: ({ row }) => <Badge variant={row.original.count > 0 ? 'destructive' : 'outline'}>{row.original.count}</Badge>,
	},
	{
		id: 'rows',
		header: 'Sample rows',
		enableSorting: false,
		enableHeaderMenu: false,
		cell: ({ row }) => <span style={{ ...mono, color: 'var(--mmbix-muted-foreground, #6b7280)' }}>{sampleRows(row.original.rows)}</span>,
	},
];

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
	// Stable row identity — a rule result has no id column of its own.
	const ruleRows = useMemo<RuleRow[]>(() => results.map((r, i) => ({ ...r, key: `${r.rule?.type ?? 'rule'}-${i}` })), [results]);
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

					{ruleRows.length === 0 ? (
						<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>No rules ran.</p>
					) : (
						<DataTable<RuleRow>
							columns={ruleColumns}
							data={ruleRows}
							rowKey="key"
							density="compact"
							stickyHeader
							showToolbar={false}
							showPagination={false}
						/>
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

function cadenceOf(task: SchedulerTaskRow): string {
	return task.cron ?? (task.repeat_ms ? `${Math.round(task.repeat_ms / 1000)}s` : 'once');
}

function SchedulerJobs({ token }: { token: string }) {
	const qc = useQueryClient();
	const jobsQ = useQuery(schedulerTasksQuery(token));
	const jobs = jobsQ.data ?? [];
	const [query, setQuery] = useState('');
	const [busyId, setBusyId] = useState<string | null>(null);
	const [failure, setFailure] = useState<string | null>(null);

	// Caller-owned predicate — the rows below are already the filtered set.
	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return jobs;
		return jobs.filter((t) => `${t.name ?? ''} ${t.id} ${t.type} ${t.status}`.toLowerCase().includes(q));
	}, [jobs, query]);

	async function runNow(task: SchedulerTaskRow) {
		setBusyId(task.id);
		setFailure(null);
		try {
			// The api helper throws on a non-2xx envelope, so the catch IS the
			// error path — a failed run must never look like a successful one.
			await runSchedulerTask(token, task.id);
		} catch (err) {
			setFailure(err instanceof Error ? err.message : 'run failed');
		} finally {
			setBusyId(null);
			// The task row changed (status, run_count, last_result) — re-read it.
			await qc.invalidateQueries({ queryKey: qk.schedulerTasks() });
		}
	}

	// The columns close over the section's `busyId`/`runNow`, so one row's run
	// cannot look like another's.
	const jobColumns: ColumnDef<SchedulerTaskRow>[] = [
		{
			id: 'job',
			header: 'Job',
			enableSorting: false,
			enableHeaderMenu: false,
			cell: ({ row }) => (
				<div>
					<div>{row.original.name ?? row.original.id}</div>
					<div style={{ ...mono, color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>{row.original.type}</div>
				</div>
			),
		},
		{
			id: 'status',
			header: 'Status',
			enableSorting: false,
			enableHeaderMenu: false,
			cell: ({ row }) => <StatusBadge status={row.original.status} />,
		},
		{
			id: 'cadence',
			header: 'Cadence',
			enableSorting: false,
			enableHeaderMenu: false,
			cell: ({ row }) => <span style={mono}>{cadenceOf(row.original)}</span>,
		},
		{
			id: 'next',
			header: 'Next run',
			enableSorting: false,
			enableHeaderMenu: false,
			cell: ({ row }) => <span>{when(row.original.run_at)}</span>,
		},
		{
			id: 'runs',
			header: 'Runs',
			enableSorting: false,
			enableHeaderMenu: false,
			cell: ({ row }) => <span>{row.original.run_count}</span>,
		},
		{
			id: 'last',
			header: 'Last result / error',
			enableSorting: false,
			enableHeaderMenu: false,
			cell: ({ row }) => (
				<span
					style={{
						color: row.original.last_error ? 'var(--mmbix-tone-danger-fg, #dc2626)' : 'var(--mmbix-muted-foreground, #6b7280)',
					}}
				>
					{row.original.last_error ?? (row.original.last_result ? 'ok' : '—')}
				</span>
			),
		},
		{
			id: 'actions',
			header: '',
			enableSorting: false,
			enableHeaderMenu: false,
			align: 'right',
			cell: ({ row }) => (
				<Button size="sm" variant="outline" disabled={busyId === row.original.id} onClick={() => void runNow(row.original)}>
					<Play size={11} /> {busyId === row.original.id ? 'Running…' : 'Run now'}
				</Button>
			),
		},
	];

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
			<DataTable<SchedulerTaskRow>
				columns={jobColumns}
				data={shown}
				rowKey="id"
				globalFilter={query}
				onGlobalFilterChange={setQuery}
				manualFiltering
				density="compact"
				stickyHeader
				showFilters={false}
				showPagination={false}
				isLoading={jobsQ.isLoading}
				labels={{
					searchPlaceholder: 'Search jobs',
					searchLabel: 'Search jobs',
					empty: jobs.length === 0 ? 'No jobs declared. A manifest `schedules` entry creates one.' : `No job matches “${query}”.`,
				}}
			/>
		</section>
	);
}
