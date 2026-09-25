import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, confirmDialog } from '@mmbix/design-system';
import { Plus, X } from 'lucide-react';
import { upsertDesignToken, deleteDesignToken, type DesignTokenSet, type ModuleInfo } from '../../lib/api';
import { designTokensQuery } from '../../lib/queries';
import { invalidateDesignTokens } from '../../lib/query-client';

/* ── Design tokens tab — per-app theme swap (CSS variables) ── */

export function TokensTab({ token, modules, refresh }: { token: string; modules: ModuleInfo[]; refresh: () => void }) {
	const queryClient = useQueryClient();
	// Cached read — switching admin tabs (which unmounts/remounts this pane) no longer
	// re-fetches the token sets.
	const setsQ = useQuery(designTokensQuery(token));
	const sets = useMemo(() => setsQ.data ?? [], [setsQ.data]);
	const [sel, setSel] = useState<DesignTokenSet | null>(null);
	const [rows, setRows] = useState<Array<{ key: string; value: string }>>([]);
	const [setName, setSetName] = useState('');
	const [appId, setAppId] = useState('');
	const [isDefault, setIsDefault] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	// Keep the current selection across a refetch (prev wins) so the draft isn't reset.
	useEffect(() => {
		if (sets.length === 0) return;
		setSel((prev) => prev ?? sets[0]);
	}, [sets]);
	useEffect(() => {
		const err = setsQ.error;
		if (err) setMsg(err instanceof Error ? err.message : 'Failed to load token sets');
	}, [setsQ.error]);

	// Parse the selected set's tokens_json into editable rows.
	useEffect(() => {
		if (!sel) {
			setRows([]);
			return;
		}
		setSetName(sel.set_name);
		setAppId(sel.app_id ?? '');
		setIsDefault(sel.is_default === 1);
		try {
			const obj = JSON.parse(sel.tokens_json || '{}') as Record<string, unknown>;
			setRows(Object.entries(obj).map(([key, value]) => ({ key, value: String(value) })));
		} catch {
			setRows([]);
		}
	}, [sel]);

	const save = async () => {
		if (!setName.trim()) return setMsg('Set name is required');
		const tokens: Record<string, string> = {};
		for (const r of rows) if (r.key.trim()) tokens[r.key.trim()] = r.value;
		setBusy(true);
		setMsg(null);
		try {
			await upsertDesignToken(token, {
				id: sel?.id,
				app_id: appId || null,
				set_name: setName.trim(),
				is_default: isDefault,
				tokens_json: JSON.stringify(tokens),
			});
			setMsg('Saved');
			await invalidateDesignTokens(queryClient);
			refresh();
		} catch (e) {
			setMsg(e instanceof Error ? e.message : 'Save failed');
		} finally {
			setBusy(false);
		}
	};

	const removeSet = async () => {
		if (!sel) return;
		if (
			!(await confirmDialog({
				title: 'Delete token set',
				description: `Delete token set “${sel.set_name}”?`,
				destructive: true,
				confirmLabel: 'Delete',
			}))
		)
			return;
		try {
			await deleteDesignToken(token, sel.id);
			setSel(null);
			await invalidateDesignTokens(queryClient);
		} catch (e) {
			setMsg(e instanceof Error ? e.message : 'Delete failed');
		}
	};

	const field: CSSProperties = {
		flex: 1,
		minWidth: 0,
		height: 26,
		fontSize: '0.72rem',
		boxSizing: 'border-box',
		padding: '0 0.4rem',
		borderRadius: 6,
		border: '1px solid var(--mmbix-border, #e5e7eb)',
		background: 'var(--mmbix-card, #fff)',
		outline: 'none',
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0.75rem 0.9rem' }}>
			<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
					<span
						style={{
							fontSize: '0.66rem',
							fontWeight: 700,
							textTransform: 'uppercase',
							letterSpacing: '0.05em',
							color: 'var(--mmbix-muted-foreground, #64748b)',
						}}
					>
						Token sets
					</span>
					<span style={{ fontSize: '0.6rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>{sets.length}</span>
					<Button
						size="sm"
						variant="outline"
						style={{ marginLeft: 'auto' }}
						onClick={() => {
							setSel(null);
							setSetName('');
							setAppId('');
							setIsDefault(false);
							setRows([]);
							setMsg(null);
						}}
					>
						New set
					</Button>
				</div>
				{sets.length === 0 && (
					<p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>
						No token sets yet — create one to theme an app (e.g. --primary, --radius).
					</p>
				)}
				{sets.map((s) => (
					<button
						key={s.id}
						type="button"
						onClick={() => setSel(s)}
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 6,
							padding: '0.3rem 0.5rem',
							borderRadius: 6,
							border: sel?.id === s.id ? '1px solid var(--mmbix-primary, #2563eb)' : '1px solid var(--mmbix-border, #e5e7eb)',
							background: sel?.id === s.id ? 'rgba(37,99,235,0.06)' : 'var(--mmbix-card, #fff)',
							cursor: 'pointer',
							fontSize: '0.74rem',
							textAlign: 'left',
						}}
					>
						<span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.set_name}</span>
						<span style={{ fontSize: '0.62rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>{s.app_id ?? 'global'}</span>
						{s.is_default === 1 ? (
							<span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--mmbix-primary, #2563eb)' }}>default</span>
						) : null}
					</button>
				))}
			</div>

			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					gap: 6,
					border: '1px solid var(--mmbix-border, #e5e7eb)',
					borderRadius: 10,
					padding: '0.6rem',
				}}
			>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
					<input value={setName} onChange={(e) => setSetName(e.target.value)} placeholder="Set name — e.g. brand-a" style={field} />
					<select value={appId} onChange={(e) => setAppId(e.target.value)} style={field}>
						<option value="">Global (all apps)</option>
						{modules.map((m) => (
							<option key={m.slug} value={m.slug}>
								{m.name}
							</option>
						))}
					</select>
				</div>
				<label
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 6,
						fontSize: '0.72rem',
						color: 'var(--mmbix-foreground, #374151)',
						cursor: 'pointer',
					}}
				>
					<input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
					Default set for this app
				</label>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 240, overflowY: 'auto' }}>
					{rows.map((r, i) => (
						<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
							<input
								value={r.key}
								onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
								placeholder="--primary"
								style={{ ...field, flex: 1.2 }}
							/>
							<input
								value={r.value}
								onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
								placeholder="var(--mmbix-primary, #2563eb)"
								style={field}
							/>
							<button
								type="button"
								onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
								style={{
									border: 'none',
									background: 'none',
									color: 'var(--mmbix-muted-foreground, #9ca3af)',
									cursor: 'pointer',
									padding: 2,
									display: 'inline-flex',
								}}
							>
								<X size={13} />
							</button>
						</div>
					))}
				</div>
				<button
					type="button"
					onClick={() => setRows((prev) => [...prev, { key: '', value: '' }])}
					style={{
						alignSelf: 'flex-start',
						display: 'inline-flex',
						alignItems: 'center',
						gap: 4,
						padding: '0.2rem 0.5rem',
						borderRadius: 6,
						border: '1px solid var(--mmbix-border, #e5e7eb)',
						background: 'transparent',
						fontSize: '0.7rem',
						color: 'var(--mmbix-muted-foreground, #64748b)',
						cursor: 'pointer',
					}}
				>
					<Plus size={12} /> Add variable
				</button>
				<div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
					{sel && (
						<Button variant="outline" size="sm" onClick={() => void removeSet()} style={{ color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}>
							Delete
						</Button>
					)}
					<Button size="sm" onClick={() => void save()} disabled={busy}>
						{busy ? 'Saving…' : 'Save set'}
					</Button>
				</div>
				{msg && (
					<span
						style={{
							fontSize: '0.68rem',
							color: msg === 'Saved' ? 'var(--mmbix-tone-positive-fg, #16a34a)' : 'var(--mmbix-tone-danger-fg, #dc2626)',
						}}
					>
						{msg}
					</span>
				)}
			</div>
		</div>
	);
}
