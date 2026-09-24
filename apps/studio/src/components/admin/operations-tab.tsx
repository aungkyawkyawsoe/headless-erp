import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@mmbix/design-system';
import { Activity } from 'lucide-react';
import { operationsQuery } from '../../lib/queries';

/* ── Operations tab — the engine's self-tuning telemetry (admin) ──
 *
 * Surfaces the index advisor: the mode (auto/propose), every composite index it
 * auto-created/proposed, and the hot filter shapes it is observing. Read-only
 * telemetry — the backend route is admin-gated and never exposes row data. */

const th = { textAlign: 'left' as const, padding: '0.25rem 0.5rem', color: '#9ca3af', fontWeight: 600 };
const td = { padding: '0.35rem 0.5rem', verticalAlign: 'top' as const };
const mono = { fontFamily: 'ui-monospace, monospace' } as const;

export function OperationsTab({ token }: { token: string }) {
	const opsQ = useQuery(operationsQuery(token));
	const report = opsQ.data ?? null;
	const journal = useMemo(() => report?.journal ?? [], [report]);
	const candidates = useMemo(() => report?.candidates ?? [], [report]);

	return (
		<div style={{ padding: '0.5rem 0.75rem' }}>
			<p style={{ fontSize: '0.72rem', color: '#9ca3af', margin: '0 0 0.6rem' }}>
				<Activity size={12} /> Self-tuning index advisor — the composite indexes the engine created (or proposes) and the hot filter shapes
				it observes. Read-only telemetry.
			</p>

			{opsQ.isLoading ? (
				<p style={{ fontSize: '0.72rem', color: '#9ca3af' }}>Loading telemetry…</p>
			) : opsQ.error ? (
				<p role="alert" style={{ fontSize: '0.72rem', color: '#dc2626' }}>
					{opsQ.error instanceof Error ? opsQ.error.message : 'Failed to load telemetry'}
				</p>
			) : (
				<>
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
						<span style={{ fontSize: '0.72rem', color: '#6b7280' }}>Mode</span>
						<Badge style={{ background: report?.mode === 'auto' ? '#059669' : '#b45309', color: '#fff' }}>
							{report?.mode === 'auto' ? 'auto (applies DDL)' : 'propose only'}
						</Badge>
					</div>

					<h4 style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', margin: '0 0 0.3rem' }}>Created / proposed indexes</h4>
					{journal.length === 0 ? (
						<p style={{ fontSize: '0.72rem', color: '#9ca3af' }}>None yet.</p>
					) : (
						<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem', marginBottom: '0.9rem' }}>
							<thead>
								<tr>
									<th style={th}>Table</th>
									<th style={th}>Columns</th>
								</tr>
							</thead>
							<tbody>
								{journal.map((e, i) => (
									<tr key={`${e.table}-${i}`} style={{ borderTop: '1px solid var(--mmbix-border, #e5e7eb)' }}>
										<td style={{ ...td, ...mono }}>{e.table}</td>
										<td style={{ ...td, ...mono }}>{e.columns.join(', ')}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}

					<h4 style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', margin: '0 0 0.3rem' }}>Hot filter shapes</h4>
					{candidates.length === 0 ? (
						<p style={{ fontSize: '0.72rem', color: '#9ca3af' }}>None observed.</p>
					) : (
						<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
							<thead>
								<tr>
									<th style={th}>Table</th>
									<th style={th}>Columns</th>
									<th style={th}>Seen</th>
								</tr>
							</thead>
							<tbody>
								{candidates.map((c, i) => (
									<tr key={`${c.table}-${i}`} style={{ borderTop: '1px solid var(--mmbix-border, #e5e7eb)' }}>
										<td style={{ ...td, ...mono }}>{c.table}</td>
										<td style={{ ...td, ...mono }}>{c.columns.join(', ')}</td>
										<td style={td}>{c.count}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</>
			)}
		</div>
	);
}
