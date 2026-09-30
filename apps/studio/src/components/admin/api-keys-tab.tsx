import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, confirmDialog } from '@mmbix/design-system';
import { KeyRound, Plus } from 'lucide-react';
import { createApiKey, revokeApiKey, type ApiKeyInfo, type ApiKeyScope } from '../../lib/api';
import { apiKeysQuery, usersQuery } from '../../lib/queries';
import { invalidateApiKeys } from '../../lib/query-client';

/* ── API keys tab — machine tokens for headless/integration access ── */

export function ApiKeysTab({ token }: { token: string }) {
	const queryClient = useQueryClient();
	// Both reads are cached: switching admin tabs (which remounts this pane) is free,
	// and the user registry is shared session-wide.
	const keysQ = useQuery(apiKeysQuery(token));
	const usersQ = useQuery(usersQuery(token));
	const keys = useMemo(() => keysQ.data ?? [], [keysQ.data]);
	const users = useMemo(() => usersQ.data ?? [], [usersQ.data]);
	const [open, setOpen] = useState(false);
	const [name, setName] = useState('');
	const [userId, setUserId] = useState('');
	const [scope, setScope] = useState<ApiKeyScope>('read');
	const [createdKey, setCreatedKey] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		const err = keysQ.error ?? usersQ.error;
		if (err) setMsg(err instanceof Error ? err.message : 'Failed to load API keys');
	}, [keysQ.error, usersQ.error]);

	const create = async () => {
		if (!name.trim() || !userId) return setMsg('Name and user are required');
		setBusy(true);
		setMsg(null);
		try {
			const created = await createApiKey(token, name.trim(), userId, null, scope);
			setCreatedKey(created.key);
			setName('');
			setScope('read');
			setOpen(false);
			await invalidateApiKeys(queryClient);
		} catch (e) {
			setMsg(e instanceof Error ? e.message : 'Create failed');
		} finally {
			setBusy(false);
		}
	};

	const revoke = async (k: ApiKeyInfo) => {
		if (
			!(await confirmDialog({
				title: 'Revoke API key',
				description: `Revoke API key “${k.name}”? It stops working immediately.`,
				destructive: true,
				confirmLabel: 'Revoke',
			}))
		)
			return;
		try {
			await revokeApiKey(token, k.id);
			await invalidateApiKeys(queryClient);
		} catch (e) {
			setMsg(e instanceof Error ? e.message : 'Revoke failed');
		}
	};

	const field: React.CSSProperties = {
		width: '100%',
		boxSizing: 'border-box',
		height: 28,
		fontSize: '0.74rem',
		padding: '0 0.45rem',
		borderRadius: 6,
		border: '1px solid var(--mmbix-border, #e5e7eb)',
		background: 'var(--mmbix-card, #fff)',
		outline: 'none',
	};
	const userEmail = (id: string) => users.find((u) => u.id === id)?.email ?? id;

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0.75rem 0.9rem' }}>
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
					API keys
				</span>
				<span style={{ fontSize: '0.6rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>{keys.length}</span>
				<Button
					size="sm"
					style={{ marginLeft: 'auto' }}
					onClick={() => {
						setOpen(true);
						setCreatedKey(null);
						setMsg(null);
					}}
				>
					<Plus size={12} /> New key
				</Button>
			</div>
			{createdKey && (
				<div
					style={{
						display: 'flex',
						flexDirection: 'column',
						gap: 4,
						border: '1px solid var(--mmbix-tone-positive-fg, #059669)',
						borderRadius: 8,
						padding: '0.5rem 0.6rem',
						background: 'rgba(16,185,129,0.06)',
					}}
				>
					<span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--mmbix-tone-positive-fg, #059669)' }}>
						Key created — copy it now, it is shown only once:
					</span>
					<div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
						<code
							style={{
								flex: 1,
								minWidth: 0,
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								whiteSpace: 'nowrap',
								fontSize: '0.72rem',
								background: 'var(--mmbix-muted, #f3f4f6)',
								padding: '0.25rem 0.45rem',
								borderRadius: 6,
							}}
						>
							{createdKey}
						</code>
						<Button
							size="sm"
							variant="outline"
							onClick={() => {
								void navigator.clipboard.writeText(createdKey).then(() => {
									setCopied(true);
									window.setTimeout(() => setCopied(false), 1500);
								});
							}}
						>
							{copied ? 'Copied' : 'Copy'}
						</Button>
					</div>
				</div>
			)}
			{keys.length === 0 && (
				<p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>
					No API keys — create one for headless/integration access (Bearer mmk_…).
				</p>
			)}
			{keys.map((k) => (
				<div
					key={k.id}
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 6,
						padding: '0.35rem 0.5rem',
						borderRadius: 8,
						border: '1px solid var(--mmbix-border, #e5e7eb)',
						background: 'var(--mmbix-card, #fff)',
					}}
				>
					<KeyRound
						size={13}
						style={{ color: k.is_active === 1 ? 'var(--mmbix-primary, #2563eb)' : 'var(--mmbix-muted-foreground, #9ca3af)', flexShrink: 0 }}
					/>
					<span
						style={{
							flex: 1,
							minWidth: 0,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
							fontSize: '0.74rem',
							fontWeight: 600,
						}}
					>
						{k.name}
					</span>
					<span style={{ fontSize: '0.66rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>{userEmail(k.user_id)}</span>
					<span
						style={{
							fontSize: '0.6rem',
							fontWeight: 700,
							color: k.scope === 'read' ? 'var(--mmbix-muted-foreground, #6b7280)' : 'var(--mmbix-tone-warning-fg, #b45309)',
						}}
					>
						{k.scope ?? 'admin'}
					</span>
					{k.is_active !== 1 ? (
						<span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}>revoked</span>
					) : (
						<span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--mmbix-tone-positive-fg, #059669)' }}>active</span>
					)}
					{k.is_active === 1 && (
						<Button size="sm" variant="outline" onClick={() => void revoke(k)} style={{ color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}>
							Revoke
						</Button>
					)}
				</div>
			))}
			{msg && <span style={{ fontSize: '0.68rem', color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}>{msg}</span>}

			{open && (
				<div
					style={{
						position: 'fixed',
						inset: 0,
						background: 'rgba(0,0,0,0.35)',
						zIndex: 120,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
					onClick={() => setOpen(false)}
				>
					<div
						onClick={(e) => e.stopPropagation()}
						style={{
							background: 'var(--mmbix-card, #fff)',
							borderRadius: 12,
							padding: '0.9rem',
							width: 340,
							display: 'flex',
							flexDirection: 'column',
							gap: 8,
							boxShadow: '0 18px 50px rgba(0,0,0,0.25)',
						}}
					>
						<span style={{ fontSize: '0.82rem', fontWeight: 700 }}>New API key</span>
						<input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Key name — e.g. production-integration"
							style={field}
						/>
						<select value={userId} onChange={(e) => setUserId(e.target.value)} style={field}>
							<option value="">Pick the owning user (permissions follow them)</option>
							{users.map((u) => (
								<option key={u.id} value={u.id}>
									{u.email}
								</option>
							))}
						</select>
						<select value={scope} onChange={(e) => setScope(e.target.value as ApiKeyScope)} style={field}>
							<option value="read">read — may call read tools only (recommended)</option>
							<option value="write">write — may call mutating tools</option>
							<option value="admin">admin — full access</option>
						</select>
						<div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
							<Button variant="outline" size="sm" onClick={() => setOpen(false)}>
								Cancel
							</Button>
							<Button size="sm" onClick={() => void create()} disabled={busy || !name.trim() || !userId}>
								{busy ? 'Creating…' : 'Create'}
							</Button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
